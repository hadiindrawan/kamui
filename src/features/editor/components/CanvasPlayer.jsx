import React, { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { calculateCameraPosition, interpolateCameraByTime } from '../utils/camera.js';
import { computeSceneLayout, interpolateSceneLayout } from '../utils/coordinates.js';
import { buildSceneModel, renderBackgroundBuffer, drawSceneFrame } from '../utils/scene-renderer.js';
import { createFramingAnimator, TRANSITION_CONFIG } from '../utils/framing-transition.js';
import { playClickSound } from '../services/click-sound.js';
import { DEFAULT_CURSOR_SMOOTHING } from '../utils/cursor-smoothing.js';

const CanvasPlayer = forwardRef(({
    recording,
    isPlaying,
    currentTime,
    segments = [],
    zoomLevel = 2,
    zoomDuration = 800,
    transitionDuration = 600,
    playbackSpeed = 1,
    aspectRatio = '16:9',
    backgroundColor = '#1a2e3b',
    backgroundMode = 'hidden', // 'hidden', 'color', 'gradient', 'image'
    backgroundValue = '#1a2e3b', // color hex, gradient string, or image url
    backgroundBlur = 'none', // 'none', 'light', 'moderate', 'strong'
    insetPadding = 48,
    cropToFill = false,
    cropPanX = 0.5,
    cropPanY = 0.5,
    showShadow = true,
    showBorder = false,
    showFollowCursor = false,
    cursorSmoothing = DEFAULT_CURSOR_SMOOTHING,
    cropZoom = 1,
    onTimeUpdate,
    onPlaybackEnded,
    onFrameTime,
    onDurationChange,
    onVideoDimensions,
    onSeek,
    borderRadius = 12,
    isMuted = false,
    volume = 1,
    clickAnimationStyle = 'ripple',
    clickAnimationOpacity = 'med',
    clickSound = 'none'
}, ref) => {
    const canvasRef = useRef(null);
    const videoRefs = useRef([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState(0);
    const [segmentDurations, setSegmentDurations] = useState([]);
    const videoUrlsRef = useRef([]); // Track ObjectURL for revocation
    const lastRecordingIdRef = useRef(null); // Fix: Prevent redundant setup
    const rafRef = useRef(null);
    const lastCameraRef = useRef(null);
    const lastCameraTsRef = useRef(null); // wall-clock ts of the last camera sample, for frame-rate-independent smoothing
    const containerRef = useRef(null);
    const backgroundImageRef = useRef(null);
    const backgroundBufferRef = useRef(null); // Cache blurred/rendered background
    const renderFrameRef = useRef(null); // Stable handle so the rAF loop never closes over stale state
    const layoutAnimRef = useRef(null); // { fromLayout, startTs, durationMs } for structural (aspect/fit) crossfades
    const lastLayoutRef = useRef(null); // Last layout actually drawn, to seed transitions
    // Numeric framing animator (crop zoom/pan, padding, global zoom level). Seeded
    // lazily below once props are available so nothing animates on first paint.
    const animatorRef = useRef(null);
    const structuralRef = useRef(null); // Last discrete structural inputs, to detect aspect/fit/background changes
    const ensureRenderLoopRef = useRef(null); // Stable handle to (re)start the rAF loop from effects
    const [isHoveringVideo, setIsHoveringVideo] = useState(false);
    const [isDraggingProgress, setIsDraggingProgress] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);
    const [lastRefresh, setLastRefresh] = useState(0); // Trigger for settings-based re-renders
    const [metadataReady, setMetadataReady] = useState(false);
    const lastSoundScanMsRef = useRef(null); // playhead ms of the previous frame's click-sound scan

    useImperativeHandle(ref, () => ({
        getCurrentTime: () => {
            const video = videoRefs.current[activeVideoIndex];
            if (!video) return 0;
            let globalTime = video.currentTime || 0;
            for (let i = 0; i < activeVideoIndex; i++) {
                globalTime += segmentDurations[i] || 0;
            }
            return globalTime;
        },
        seekTo: (time) => {
            if (!Number.isFinite(time) || segmentDurations.length === 0) return;
            let accumulated = 0;
            let targetIdx = 0;
            let localTime = time;

            for (let i = 0; i < segmentDurations.length; i++) {
                if (time <= accumulated + segmentDurations[i] || i === segmentDurations.length - 1) {
                    targetIdx = i;
                    localTime = time - accumulated;
                    break;
                }
                accumulated += segmentDurations[i];
            }

            videoRefs.current.forEach((v, i) => {
                if (v && i !== targetIdx && !v.paused) v.pause();
            });

            if (activeVideoIndex !== targetIdx) {
                setActiveVideoIndex(targetIdx);
            }

            const targetVideo = videoRefs.current[targetIdx];
            if (targetVideo) {
                targetVideo.currentTime = localTime;
                if (isPlaying) {
                    targetVideo.play().catch(e => console.warn(e));
                }
            }
        }
    }));

    // Sync muted state + volume
    useEffect(() => {
        videoRefs.current.forEach(v => { if (v) { v.muted = isMuted; v.volume = volume; } });
    }, [isMuted, volume]);

    // Load background image when needed
    useEffect(() => {
        if (backgroundMode === 'image' && backgroundValue) {
            // A CORS-tagged request can fail when the same URL is already cached
            // without CORS (e.g. by the FramingPanel's CSS `background:url(...)`
            // preview), leaving the canvas background blank. Try with crossOrigin
            // first; on error, retry once without it — the preview canvas is
            // display-only so a tainted image is fine here (export preloads its
            // own CORS image separately).
            const loadImage = (useCors) => {
                const img = new Image();
                if (useCors) img.crossOrigin = 'anonymous';
                img.onload = () => {
                    backgroundImageRef.current = img;
                    refreshBackground();
                    if (!isPlaying) renderFrame();
                };
                img.onerror = () => {
                    if (useCors) loadImage(false);
                };
                img.src = backgroundValue;
            };
            loadImage(true);
        } else {
            backgroundImageRef.current = null;
            refreshBackground();
            if (!isPlaying) renderFrame();
        }
    }, [backgroundMode, backgroundValue, backgroundBlur, backgroundColor]);

    // Framing/background settings the shared scene renderer needs.
    const rendererSettings = {
        aspectRatio, backgroundMode, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom,
        backgroundColor, backgroundValue, backgroundBlur,
        zoomLevel, zoomDuration, transitionDuration, showFollowCursor, cursorSmoothing,
    };

    // Pre-calculate the shared scene model (layout + mapped events + camera
    // config), identical to what the exporter builds. Memoized for perf.
    const sceneModel = React.useMemo(() => {
        const video = videoRefs.current[0];
        if (!video || !video.videoWidth) return null;
        return buildSceneModel({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            settings: rendererSettings,
            segments,
            recordingEvents: recording?.events || [],
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recording, segments, aspectRatio, backgroundMode, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom, showFollowCursor, cursorSmoothing, zoomLevel, zoomDuration, transitionDuration, metadataReady]);

    // Lazily seed the numeric framing animator with the current committed
    // values so the first paint matches the props and nothing animates until
    // the user actually changes a setting.
    if (!animatorRef.current) {
        animatorRef.current = createFramingAnimator({ cropZoom, zoomLevel, cropPanX, cropPanY, insetPadding });
        structuralRef.current = { aspectRatio, cropToFill, backgroundMode };
    }

    // Numeric framing changes (crop zoom/pan, padding, global zoom level) ease
    // on their own per-field timelines whether paused or playing. Until the
    // video's metadata is ready (settings still loading from IndexedDB) we snap
    // instead, so opening a recording doesn't play an intro animation.
    useEffect(() => {
        const animator = animatorRef.current;
        if (!metadataReady) {
            animatorRef.current = createFramingAnimator({ cropZoom, zoomLevel, cropPanX, cropPanY, insetPadding });
            return;
        }
        animator.setTarget({ cropZoom, zoomLevel, cropPanX, cropPanY, insetPadding }, performance.now());
        ensureRenderLoopRef.current?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cropZoom, zoomLevel, cropPanX, cropPanY, insetPadding, metadataReady]);

    // Structural changes alter the scene's pixel geometry discretely (canvas
    // dimensions on an aspect switch, contain<->cover on a crop-to-fill toggle,
    // the padded inset box appearing/disappearing with the background mode) and
    // can't be lerped as a value, so we crossfade whole layouts. Seeded from the
    // last drawn layout so a change mid-tween (numeric or structural) continues
    // seamlessly. interpolateSceneLayout applies easeInOutCubic internally,
    // which matches TRANSITION_CONFIG.aspect.easing — we only take its duration.
    useEffect(() => {
        const prev = structuralRef.current;
        structuralRef.current = { aspectRatio, cropToFill, backgroundMode };
        if (!metadataReady || !prev) return;
        const changed = prev.aspectRatio !== aspectRatio || prev.cropToFill !== cropToFill || prev.backgroundMode !== backgroundMode;
        if (!changed) return;
        layoutAnimRef.current = { fromLayout: lastLayoutRef.current, startTs: performance.now(), durationMs: TRANSITION_CONFIG.aspect.durationMs };
        ensureRenderLoopRef.current?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aspectRatio, cropToFill, backgroundMode, metadataReady]);

    const refreshBackground = () => {
        if (!sceneModel) return;
        if (!backgroundBufferRef.current) {
            backgroundBufferRef.current = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(1, 1)
                : document.createElement('canvas');
        }
        renderBackgroundBuffer(backgroundBufferRef.current, sceneModel.layout, rendererSettings, backgroundImageRef.current);
    };

    useEffect(() => {
        refreshBackground();
        if (!isPlaying) renderFrame();
    }, [sceneModel, backgroundBlur, backgroundColor, backgroundValue]);

    useEffect(() => {
        // Only trigger setup if ID really changed
        if (recording?.id !== lastRecordingIdRef.current) {
            setupVideo();
        }
        return () => {
            // Only revoke if the component is being destroyed or ID is changing
            // React's strict mode or minor re-renders shouldn't kill the URL
            if (!recording || recording.id !== lastRecordingIdRef.current) {
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                videoUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
                videoUrlsRef.current = [];
            }
        };
    }, [recording?.id]); // Depend on ID instead of object reference

    useEffect(() => {
        videoRefs.current.forEach(v => { if (v) v.playbackRate = playbackSpeed; });
    }, [playbackSpeed]);

    useEffect(() => {
        const video = videoRefs.current[activeVideoIndex];
        if (video) {
            if (isPlaying) {
                if (video.readyState >= 2) {
                    video.play().catch(e => console.warn('Play error:', e));
                } else {
                    video.addEventListener('canplay', () => {
                        if (isPlaying) video.play().catch(e => console.warn('Play error:', e));
                    }, { once: true });
                }
                ensureRenderLoop();
            } else {
                videoRefs.current.forEach(v => { if (v && !v.paused) v.pause(); });
                // Don't hard-cancel: a framing transition may still be settling.
                // The loop stops itself once nothing needs animating.
            }
        }
    }, [isPlaying]);

    useEffect(() => {
        // Sync video currentTime with prop when paused
        if (!isPlaying && Number.isFinite(currentTime) && segmentDurations.length > 0) {
            let accumulated = 0;
            let targetIdx = 0;
            let localTime = currentTime;
            for (let i = 0; i < segmentDurations.length; i++) {
                if (currentTime <= accumulated + segmentDurations[i] || i === segmentDurations.length - 1) {
                    targetIdx = i;
                    localTime = currentTime - accumulated;
                    break;
                }
                accumulated += segmentDurations[i];
            }
            if (activeVideoIndex !== targetIdx) setActiveVideoIndex(targetIdx);
            const video = videoRefs.current[targetIdx];
            if (video) {
                const diff = Math.abs(video.currentTime - localTime);
                if (diff > 0.05) video.currentTime = localTime;
            }
        }

    }, [currentTime, isPlaying]);

    useEffect(() => {
        // Force re-render when display properties change while paused
        if (videoRefs.current[activeVideoIndex] && !isPlaying) {
            renderFrame();
        }
    }, [
        currentTime, zoomLevel,
        aspectRatio, backgroundMode,
        backgroundValue, backgroundBlur,
        insetPadding, cropToFill, cropPanX, cropPanY, cropZoom, showShadow, showBorder, borderRadius, metadataReady,
        clickAnimationStyle, clickAnimationOpacity,
        sceneModel
    ]);

    async function setupVideo() {
        const blobs = recording?.videoBlobs || (recording?.videoBlob ? [recording.videoBlob] : []);
        if (blobs.length === 0) return;

        if (recording.id === lastRecordingIdRef.current) return;
        lastRecordingIdRef.current = recording.id;

        videoUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        videoUrlsRef.current = [];
        setMetadataReady(false);

        const durations = new Array(blobs.length).fill(0);
        let loadedCount = 0;

        blobs.forEach((blob, idx) => {
            const videoUrl = URL.createObjectURL(blob);
            videoUrlsRef.current.push(videoUrl);

            // Give react time to render the video tags if they don't exist yet
            setTimeout(() => {
                const video = videoRefs.current[idx];
                if (!video) return;

                video.onerror = (e) => console.error('[CanvasPlayer] Video Error:', e);

                video.onloadedmetadata = () => {
                    let actualDuration = video.duration;
                    if (!Number.isFinite(video.duration)) {
                        if (idx === 0 && recording?.events?.length > 0) {
                            const maxEventTime = recording.events.reduce((max, e) => Math.max(max, e.time || 0), 0);
                            actualDuration = maxEventTime / 1000;
                        } else {
                            actualDuration = 10;
                        }
                    }
                    durations[idx] = actualDuration;
                    loadedCount++;

                    if (loadedCount === blobs.length) {
                        setSegmentDurations(durations);
                        const totalDur = durations.reduce((a, b) => a + b, 0);
                        setMetadataReady(true);
                        onDurationChange(totalDur);

                        if (onVideoDimensions && videoRefs.current[0].videoWidth > 0) {
                            onVideoDimensions({ width: videoRefs.current[0].videoWidth, height: videoRefs.current[0].videoHeight });
                            renderFrame();
                        }
                    }
                };

                video.onended = () => {
                    if (idx < blobs.length - 1) {
                        setActiveVideoIndex(idx + 1);
                        const nextVideo = videoRefs.current[idx + 1];
                        nextVideo.currentTime = 0;
                        if (isPlaying) nextVideo.play().catch(e => console.warn(e));
                    } else if (onPlaybackEnded) {
                        onPlaybackEnded();
                    }
                };

                video.ontimeupdate = () => {
                    if (idx === activeVideoIndex && Number.isFinite(video.currentTime)) {
                        let globalTime = video.currentTime;
                        for (let i = 0; i < idx; i++) globalTime += durations[i] || 0;
                        onTimeUpdate(globalTime);
                    }
                };

                video.src = videoUrl;
                video.load();
            }, 0);
        });
    }

    // The loop runs while the video is playing OR a framing transition (numeric
    // tween or structural crossfade) is still settling — the latter is what lets
    // crop/zoom/aspect changes ease while paused.
    function shouldKeepAnimating() {
        const video = videoRefs.current[activeVideoIndex];
        const playing = video && !video.paused;
        return playing || animatorRef.current?.isActive() || !!layoutAnimRef.current;
    }

    function renderLoop() {
        // Call through a ref so the scheduled callback always uses the latest
        // props/state (framing, segments...) instead of the closure captured
        // when the loop started.
        if (renderFrameRef.current) renderFrameRef.current();
        if (shouldKeepAnimating()) {
            rafRef.current = requestAnimationFrame(renderLoop);
        } else {
            rafRef.current = null;
        }
    }

    function ensureRenderLoop() {
        if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(renderLoop);
        }
    }
    ensureRenderLoopRef.current = ensureRenderLoop;

    function renderFrame() {
        const canvas = canvasRef.current;
        const video = videoRefs.current[activeVideoIndex];
        const model = sceneModel;
        const backgroundBuffer = backgroundBufferRef.current;

        if (!canvas || !video || !video.videoWidth || !model || !backgroundBuffer) return;

        const ctx = canvas.getContext('2d', { alpha: false });

        // Prop time when paused (instant scrub feedback); media time when playing.
        const timeToRender = isPlaying ? video.currentTime : currentTime;
        const currentTimeMs = (timeToRender || 0) * 1000;

        // Click sounds: fire for every (deduped) click the playhead crossed
        // since the last frame. A window cap keeps seeks/segment jumps from
        // machine-gunning every click in between.
        if (!isPlaying) {
            lastSoundScanMsRef.current = null;
        } else {
            const prevMs = lastSoundScanMsRef.current;
            lastSoundScanMsRef.current = currentTimeMs;
            if (prevMs != null && currentTimeMs > prevMs && currentTimeMs - prevMs < 1000
                && !isMuted && clickSound && clickSound !== 'none') {
                for (const e of model.clickEvents || []) {
                    if (e.time > prevMs && e.time <= currentTimeMs) {
                        playClickSound(clickSound, { volume });
                    }
                }
            }
        }

        // Report a frame-accurate global time so the timeline playhead can move
        // smoothly at rAF cadence instead of the media element's coarse
        // (100-300ms) timeupdate events.
        if (isPlaying && onFrameTime) {
            let globalTime = video.currentTime || 0;
            for (let i = 0; i < activeVideoIndex; i++) globalTime += segmentDurations[i] || 0;
            onFrameTime(globalTime);
        }

        const nowAnim = performance.now();

        // Layout is rebuilt from the *animated* numeric framing values so crop
        // zoom/pan and padding ease every frame (paused or playing). The
        // discrete inputs (aspect/fit/background) come straight from props.
        const anim = animatorRef.current.sample(nowAnim).settings;
        const targetLayout = {
            ...computeSceneLayout({
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                aspectRatio,
                backgroundMode,
                insetPadding: anim.insetPadding,
                cropToFill,
                cropPanX: anim.cropPanX,
                cropPanY: anim.cropPanY,
                cropZoom: anim.cropZoom,
            }),
            videoW: video.videoWidth,
            videoH: video.videoHeight,
        };

        // Crossfade whole layouts for a structural (aspect/fit/background)
        // change. interpolateSceneLayout eases the raw progress itself.
        let layout = targetLayout;
        const structural = layoutAnimRef.current;
        if (structural && structural.fromLayout) {
            const t = (nowAnim - structural.startTs) / structural.durationMs;
            if (t >= 1) {
                layoutAnimRef.current = null;
            } else {
                layout = interpolateSceneLayout(structural.fromLayout, targetLayout, t);
            }
        } else if (structural) {
            layoutAnimRef.current = null; // no seed layout captured yet; snap
        }
        lastLayoutRef.current = layout;

        if (canvas.width !== layout.width || canvas.height !== layout.height) {
            canvas.width = layout.width;
            canvas.height = layout.height;
        }

        // Resolve the camera against the drawn geometry, and ease the global
        // zoom level through the same animated value so the depth doesn't snap.
        const cameraConfig = {
            ...model.cameraConfig,
            videoWidth: layout.width,
            videoHeight: layout.height,
            canvasWidth: layout.width,
            canvasHeight: layout.height,
            zoomLevel: anim.zoomLevel,
        };

        const targetCamera = calculateCameraPosition(currentTimeMs, model.events, cameraConfig);
        const nowTs = performance.now();
        const dtMs = isPlaying && lastCameraTsRef.current != null ? nowTs - lastCameraTsRef.current : null;
        const camera = dtMs != null
            ? interpolateCameraByTime(lastCameraRef.current, targetCamera, dtMs)
            : targetCamera;
        lastCameraRef.current = camera;
        lastCameraTsRef.current = nowTs;

        drawSceneFrame(ctx, video, currentTimeMs, model, {
            layout,
            camera,
            backgroundBuffer,
            showShadow,
            showBorder,
            borderRadius,
            backgroundMode,
            showCursorHighlight: true,
            clickStyle: clickAnimationStyle,
            clickOpacity: clickAnimationOpacity,
        });
    }

    // Keep the ref pointing at the freshest renderFrame closure every render.
    renderFrameRef.current = renderFrame;

    // ... Mouse interaction handlers ...
    // Note: Mouse interaction (onSeek) on the canvas needs to account for the new layout!
    // The previous implementation assumed the progress bar was an overlay on the wrapper div.
    // The `video-trackbar` in `render` is just an overlay UI, so it should be fine.
    // BUT `handleProgressMouseMove` uses `containerRef` width.
    // As long as the `containerRef` wraps the `canvas` correctly, the progress bar logic (time = x% * duration)
    // is abstract and doesn't care about the video rendering inside.

    // HOWEVER, the dragging of "Zoom Overlay" in parent (Editor.jsx) relies on visual positioning.
    // Editor.jsx's `getVideoRect()` helper MUST be updated to match the logic here.

    // We should expose the `getRenderRect` via imperative handle or callback to keep them in sync?
    // Or just duplicate logic carefully.
    // For now, let's keep the existing interaction handlers for the progress bar.

    const handleProgressMouseDown = (e) => {
        setIsDraggingProgress(true);
        handleProgressSeek(e);
    };

    const handleProgressMouseMove = (e) => {
        if (!containerRef.current || segmentDurations.length === 0) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const time = percent * (segmentDurations.reduce((a, b) => a + b, 0) || 0);
        setHoverTime(time);

        if (isDraggingProgress) {
            handleProgressSeek(e);
        }
    };

    const handleProgressSeek = (e) => {
        if (!containerRef.current || segmentDurations.length === 0) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const time = percent * (segmentDurations.reduce((a, b) => a + b, 0) || 0);
        if (onSeek) onSeek(time);
    };

    useEffect(() => {
        if (isDraggingProgress) {
            const handleMouseUp = () => setIsDraggingProgress(false);
            document.addEventListener('mouseup', handleMouseUp);
            return () => document.removeEventListener('mouseup', handleMouseUp);
        }
    }, [isDraggingProgress]);

    const formatTimeShort = (seconds) => {
        if (!Number.isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const duration = segmentDurations.reduce((a, b) => a + b, 0);
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div
            className="canvas-player"
            ref={containerRef}
            onMouseEnter={() => setIsHoveringVideo(true)}
            onMouseLeave={() => {
                setIsHoveringVideo(false);
                setHoverTime(null);
            }}
            onMouseMove={handleProgressMouseMove}
        // Ensure container matches canvas size visually, or centers it?
        // Styles usually handle this.
        >
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {(recording?.videoBlobs || (recording?.videoBlob ? [recording.videoBlob] : [])).map((_, i) => (
                <video
                    key={i}
                    ref={el => videoRefs.current[i] = el}
                    style={{ display: 'none' }}
                    playsInline
                />
            ))}

            {/* Video Progress Trackbar Overlay */}
            {duration > 0 && (
                <div className={`video-trackbar ${isHoveringVideo || isDraggingProgress ? 'visible' : ''}`}>
                    <div
                        className="trackbar-container"
                        onMouseDown={handleProgressMouseDown}
                    >
                        <div className="trackbar-bg">
                            <div
                                className="trackbar-progress"
                                style={{ width: `${progressPercent}%` }}
                            />
                            <div
                                className="trackbar-playhead"
                                style={{ left: `${progressPercent}%` }}
                            />
                        </div>
                        {hoverTime !== null && (
                            <div
                                className="trackbar-tooltip"
                                style={{
                                    left: `${(hoverTime / duration) * 100}%`,
                                    transform: 'translateX(-50%)'
                                }}
                            >
                                {formatTimeShort(hoverTime)}
                            </div>
                        )}
                    </div>
                    <div className="trackbar-time">
                        {formatTimeShort(currentTime)} / {formatTimeShort(duration)}
                    </div>
                </div>
            )}
        </div>
    );
});

export default React.memo(CanvasPlayer);
