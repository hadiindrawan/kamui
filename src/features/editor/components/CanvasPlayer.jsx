import React, { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { calculateCameraPosition, interpolateCamera } from '../utils/camera.js';
import { interpolateSceneLayout } from '../utils/coordinates.js';
import { buildSceneModel, renderBackgroundBuffer, drawSceneFrame } from '../utils/scene-renderer.js';

// Duration of the eased tween when the framing/aspect ratio changes mid-play.
const FRAMING_TRANSITION_MS = 300;

const CanvasPlayer = forwardRef(({
    recording,
    isPlaying,
    currentTime,
    segments = [],
    zoomLevel = 2,
    zoomDuration = 800,
    transitionDuration = 300,
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
    cropZoom = 1,
    onTimeUpdate,
    onPlaybackEnded,
    onFrameTime,
    onDurationChange,
    onVideoDimensions,
    onSeek,
    borderRadius = 12,
    isMuted = false
}, ref) => {
    const canvasRef = useRef(null);
    const videoRefs = useRef([]);
    const [activeVideoIndex, setActiveVideoIndex] = useState(0);
    const [segmentDurations, setSegmentDurations] = useState([]);
    const videoUrlsRef = useRef([]); // Track ObjectURL for revocation
    const lastRecordingIdRef = useRef(null); // Fix: Prevent redundant setup
    const rafRef = useRef(null);
    const lastCameraRef = useRef(null);
    const containerRef = useRef(null);
    const backgroundImageRef = useRef(null);
    const backgroundBufferRef = useRef(null); // Cache blurred/rendered background
    const renderFrameRef = useRef(null); // Stable handle so the rAF loop never closes over stale state
    const layoutAnimRef = useRef(null); // { from, to, startTs } for framing transitions
    const lastLayoutRef = useRef(null); // Last layout actually drawn, to seed transitions
    const lastTargetLayoutRef = useRef(null); // Last target layout, to detect framing changes
    const [isHoveringVideo, setIsHoveringVideo] = useState(false);
    const [isDraggingProgress, setIsDraggingProgress] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);
    const [lastRefresh, setLastRefresh] = useState(0); // Trigger for settings-based re-renders
    const [metadataReady, setMetadataReady] = useState(false);

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

    // Sync muted state
    useEffect(() => {
        videoRefs.current.forEach(v => { if (v) v.muted = isMuted; });
    }, [isMuted]);

    // Load background image when needed
    useEffect(() => {
        if (backgroundMode === 'image' && backgroundValue) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                backgroundImageRef.current = img;
                refreshBackground();
                if (!isPlaying) renderFrame();
            };
            img.src = backgroundValue;
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
        zoomLevel, zoomDuration, transitionDuration, showFollowCursor,
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
    }, [recording, segments, aspectRatio, backgroundMode, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom, showFollowCursor, zoomLevel, zoomDuration, transitionDuration, metadataReady]);

    // When the framing (aspect ratio / crop / padding) changes during
    // playback, start an eased transition from the last-drawn layout to the new
    // target instead of snapping. Snap when paused.
    useEffect(() => {
        if (!sceneModel) return;
        const target = sceneModel.layout;
        const prev = lastTargetLayoutRef.current;
        const geomChanged = prev && (
            prev.width !== target.width || prev.height !== target.height ||
            prev.vX !== target.vX || prev.vY !== target.vY ||
            prev.vW !== target.vW || prev.vH !== target.vH ||
            prev.sx !== target.sx || prev.sy !== target.sy ||
            prev.sW !== target.sW || prev.sH !== target.sH
        );
        if (geomChanged && isPlaying) {
            layoutAnimRef.current = { from: lastLayoutRef.current || prev, to: target, startTs: performance.now() };
        } else {
            layoutAnimRef.current = null;
        }
        lastTargetLayoutRef.current = target;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sceneModel]);

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
                renderLoop();
            } else {
                videoRefs.current.forEach(v => { if (v && !v.paused) v.pause(); });
                if (rafRef.current) {
                    cancelAnimationFrame(rafRef.current);
                }
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

    function renderLoop() {
        const video = videoRefs.current[activeVideoIndex];
        if (video && !video.paused) {
            // Call through a ref so the scheduled callback always uses the
            // latest props/state (framing, segments...) instead of the closure
            // captured when playback started.
            if (renderFrameRef.current) renderFrameRef.current();
            rafRef.current = requestAnimationFrame(renderLoop);
        }
    }

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

        // Report a frame-accurate global time so the timeline playhead can move
        // smoothly at rAF cadence instead of the media element's coarse
        // (100-300ms) timeupdate events.
        if (isPlaying && onFrameTime) {
            let globalTime = video.currentTime || 0;
            for (let i = 0; i < activeVideoIndex; i++) globalTime += segmentDurations[i] || 0;
            onFrameTime(globalTime);
        }

        // Ease between framings when the aspect ratio changes mid-playback.
        let layout = model.layout;
        const anim = layoutAnimRef.current;
        if (anim && isPlaying) {
            const t = (performance.now() - anim.startTs) / FRAMING_TRANSITION_MS;
            if (t >= 1) {
                layoutAnimRef.current = null;
            } else {
                layout = interpolateSceneLayout(anim.from, anim.to, t);
            }
        }
        lastLayoutRef.current = layout;

        if (canvas.width !== layout.width || canvas.height !== layout.height) {
            canvas.width = layout.width;
            canvas.height = layout.height;
        }

        // During a transition the camera must be resolved in the interpolated
        // scene so its zoom stays consistent with the drawn geometry.
        const cameraConfig = layout === model.layout
            ? model.cameraConfig
            : { ...model.cameraConfig, videoWidth: layout.width, videoHeight: layout.height, canvasWidth: layout.width, canvasHeight: layout.height };

        const targetCamera = calculateCameraPosition(currentTimeMs, model.events, cameraConfig);
        const factor = isPlaying ? 0.12 : 1.0;
        const camera = interpolateCamera(lastCameraRef.current, targetCamera, factor);
        lastCameraRef.current = camera;

        drawSceneFrame(ctx, video, currentTimeMs, model, {
            layout,
            camera,
            backgroundBuffer,
            showShadow,
            showBorder,
            borderRadius,
            backgroundMode,
            showCursorHighlight: true,
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
