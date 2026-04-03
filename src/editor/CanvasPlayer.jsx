import React, { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { calculateCameraPosition, interpolateCamera } from './camera.js';

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
    showShadow = true,
    showBorder = false,
    showFollowCursor = false,
    onTimeUpdate,
    onDurationChange,
    onVideoDimensions,
    onSeek
}, ref) => {
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const videoUrlRef = useRef(null); // Track ObjectURL for revocation
    const lastRecordingIdRef = useRef(null); // Fix: Prevent redundant setup
    const rafRef = useRef(null);
    const lastCameraRef = useRef(null);
    const clickAnimationsRef = useRef([]);
    const containerRef = useRef(null);
    const backgroundImageRef = useRef(null); 
    const backgroundBufferRef = useRef(null); // Cache blurred/rendered background
    const [isHoveringVideo, setIsHoveringVideo] = useState(false);
    const [isDraggingProgress, setIsDraggingProgress] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);
    const [lastRefresh, setLastRefresh] = useState(0); // Trigger for settings-based re-renders

    useImperativeHandle(ref, () => ({
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        seekTo: (time) => {
            if (videoRef.current && Number.isFinite(time)) {
                videoRef.current.currentTime = time;
            }
        }
    }));

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

    // Pre-calculate Scene Layout and Map Events (Memoized for Performance)
    const sceneLayout = React.useMemo(() => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;

        const videoW = video.videoWidth;
        const videoH = video.videoHeight;
        let canvasW = videoW;
        let canvasH = videoH;

        if (aspectRatio !== 'Native') {
            const ratios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
            const targetRatio = ratios[aspectRatio] || 16 / 9;
            if (targetRatio >= 1) {
                canvasH = videoH;
                canvasW = canvasH * targetRatio;
            } else {
                canvasW = videoH;
                canvasH = canvasW / targetRatio;
            }
        }

        const width = Math.round(canvasW);
        const height = Math.round(canvasH);

        // Calculate Video Placement
        let vX = 0, vY = 0, vW = width, vH = height;
        const videoRatio = videoW / videoH;

        if (backgroundMode === 'hidden') {
            const canvasRatio = width / height;
            if (canvasRatio > videoRatio) {
                vH = height;
                vW = vH * videoRatio;
                vX = (width - vW) / 2;
            } else {
                vW = width;
                vH = vW / videoRatio;
                vY = (height - vH) / 2;
            }
        } else {
            const scaleBase = Math.min(width, height) / 1080;
            const scaledPadding = insetPadding * scaleBase;
            const safeW = width - (scaledPadding * 2);
            const safeH = height - (scaledPadding * 2);
            const fitScale = Math.min(safeW / videoW, safeH / videoH);
            vW = videoW * fitScale;
            vH = videoH * fitScale;
            vX = (width - vW) / 2;
            vY = (height - vH) / 2;
        }

        // Map Events
        const mappedEvents = segments.map(seg => ({
            ...seg,
            time: seg.startTime,
            type: seg.type || 'click',
            x: (seg.x * vW + vX) / width,
            y: (seg.y * vH + vY) / height
        }));

        if (showFollowCursor && recording?.events) {
            const followEvents = recording.events.filter(e => e.type === 'follow' || e.type === 'move');
            
            // Fix: Avoid spread operator on large arrays which can hit stack limits
            for (const e of followEvents) {
                mappedEvents.push({
                    ...e,
                    x: (e.x * vW + vX) / width,
                    y: (e.y * vH + vY) / height
                });
            }
        }

        return { 
            width, height, 
            videoW, videoH, 
            vX, vY, vW, vH, 
            events: mappedEvents,
            cameraConfig: {
                videoWidth: width, videoHeight: height,
                canvasWidth: width, canvasHeight: height,
                zoomLevel, zoomDuration, transitionDuration
            }
        };
    }, [recording, segments, aspectRatio, backgroundMode, insetPadding, showFollowCursor, zoomLevel, zoomDuration, transitionDuration]);

    const refreshBackground = () => {
        if (!sceneLayout) return;
        const { width, height } = sceneLayout;
        
        if (!backgroundBufferRef.current) {
            backgroundBufferRef.current = typeof OffscreenCanvas !== 'undefined' 
                ? new OffscreenCanvas(width, height) 
                : document.createElement('canvas');
        }
        
        const buffer = backgroundBufferRef.current;
        if (buffer.width !== width || buffer.height !== height) {
            buffer.width = width;
            buffer.height = height;
        }

        const bctx = buffer.getContext('2d');
        const blurs = { 'none': 0, 'light': 4, 'moderate': 12, 'strong': 24 };
        const blurAmount = blurs[backgroundBlur] || 0;

        bctx.clearRect(0, 0, width, height);
        if (blurAmount > 0) bctx.filter = `blur(${blurAmount}px)`;

        if (backgroundMode === 'color' || backgroundMode === 'hidden') {
            bctx.fillStyle = backgroundMode === 'hidden' ? backgroundColor : (backgroundValue || backgroundColor);
            bctx.fillRect(0, 0, width, height);
        } else if (backgroundMode === 'gradient') {
            if (Array.isArray(backgroundValue)) {
                const grad = bctx.createLinearGradient(0, 0, 0, height);
                backgroundValue.forEach((color, i) => grad.addColorStop(i / (backgroundValue.length - 1), color));
                bctx.fillStyle = grad;
            } else {
                bctx.fillStyle = backgroundValue || '#000';
            }
            bctx.fillRect(0, 0, width, height);
        } else if (backgroundMode === 'image' && backgroundImageRef.current) {
            const img = backgroundImageRef.current;
            const imgRatio = img.width / img.height;
            const canvasRatio = width / height;
            let dW = width, dH = height, dX = 0, dY = 0;
            if (canvasRatio > imgRatio) {
                dH = width / imgRatio;
                dY = (height - dH) / 2;
            } else {
                dW = height * imgRatio;
                dX = (width - dW) / 2;
            }
            bctx.drawImage(img, dX, dY, dW, dH);
        }
        bctx.filter = 'none';
    };

    useEffect(() => {
        refreshBackground();
        if (!isPlaying) renderFrame();
    }, [sceneLayout, backgroundBlur, backgroundColor, backgroundValue]);

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
                if (videoUrlRef.current) {
                    URL.revokeObjectURL(videoUrlRef.current);
                    videoUrlRef.current = null;
                }
            }
        };
    }, [recording?.id]); // Depend on ID instead of object reference

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackSpeed;
        }
    }, [playbackSpeed]);

    useEffect(() => {
        if (videoRef.current) {
            if (isPlaying) {
                // Fix: Check readyState (2 = HAVE_CURRENT_DATA) before playing to avoid NotSupportedError
                if (videoRef.current.readyState >= 2) {
                    videoRef.current.play().catch(e => console.warn('Play error:', e));
                } else {
                    // Wait for metadata/load if needed
                    videoRef.current.addEventListener('canplay', () => {
                        if (isPlaying) videoRef.current.play().catch(e => console.warn('Play error:', e));
                    }, { once: true });
                }
                renderLoop();
            } else {
                videoRef.current.pause();
                if (rafRef.current) {
                    cancelAnimationFrame(rafRef.current);
                }
            }
        }
    }, [isPlaying]);

    useEffect(() => {
        // Force re-render when display properties change while paused
        if (videoRef.current && !isPlaying) {
            renderFrame();
        }
    }, [
        currentTime, zoomLevel,
        aspectRatio, backgroundMode,
        backgroundValue, backgroundBlur,
        insetPadding, showShadow, showBorder
    ]);

    async function setupVideo() {
        if (!videoRef.current || !recording?.videoBlob) return;
        const video = videoRef.current;
        
        // Final guard against redundant setup
        if (recording.id === lastRecordingIdRef.current) return;
        lastRecordingIdRef.current = recording.id;

        // Revoke old URL if exists
        if (videoUrlRef.current) {
            URL.revokeObjectURL(videoUrlRef.current);
        }

        const videoUrl = URL.createObjectURL(recording.videoBlob);
        videoUrlRef.current = videoUrl;

        // 1. Attach listeners FIRST (before setting src) to avoid missing fast-cached events
        video.onerror = (e) => {
            console.error('[CanvasPlayer] Video Error:', video.error || e);
        };

        video.onloadedmetadata = () => {
            console.log('[CanvasPlayer] Metadata loaded:', video.videoWidth, 'x', video.videoHeight);
            
            // Priority 1: Browser reported duration
            let actualDuration = video.duration;

            // Fallback for WebM Infinity
            if (!Number.isFinite(video.duration)) {
                if (recording?.events && recording.events.length > 0) {
                    // Fix: Avoid spread operator on large arrays which can hit stack limits
                    const maxEventTime = recording.events.reduce((max, e) => Math.max(max, e.time || 0), 0);
                    actualDuration = maxEventTime / 1000;
                } else {
                    actualDuration = 10;
                }
            }

            if (Number.isFinite(actualDuration) && actualDuration > 0) {
                onDurationChange(actualDuration);
            }

            // Sync dimensions
            if (onVideoDimensions && video.videoWidth > 0 && video.videoHeight > 0) {
                onVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
                renderFrame();
            } else {
                // Polling fallback for certain browsers/codecs where dimensions aren't ready in onloadedmetadata
                const checkDims = setInterval(() => {
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        clearInterval(checkDims);
                        onVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
                        renderFrame();
                    }
                }, 50);
                setTimeout(() => clearInterval(checkDims), 2000); // Stop after 2s
            }
        };

        video.oncanplay = () => {
            if (onVideoDimensions && video.videoWidth > 0) {
                onVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
            }
            renderFrame();
        };

        video.ontimeupdate = () => {
            if (Number.isFinite(video.currentTime)) {
                onTimeUpdate(video.currentTime);
            }
        };

        // 2. Set src and load
        video.src = videoUrl;
        video.load();
    }

    function renderLoop() {
        if (videoRef.current && !videoRef.current.paused) {
            renderFrame();
            rafRef.current = requestAnimationFrame(renderLoop);
        }
    }

    function renderFrame() {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const layout = sceneLayout;
        const backgroundBuffer = backgroundBufferRef.current;

        if (!canvas || !video || !video.videoWidth || !layout || !backgroundBuffer) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        const currentTimeMs = (video.currentTime || 0) * 1000;

        // Sync canvas size
        if (canvas.width !== layout.width || canvas.height !== layout.height) {
            canvas.width = layout.width;
            canvas.height = layout.height;
        }

        // Calculate SCENE Camera
        const targetCamera = calculateCameraPosition(currentTimeMs, layout.events, layout.cameraConfig);
        const camera = interpolateCamera(lastCameraRef.current, targetCamera, 0.12);
        lastCameraRef.current = camera;

        ctx.save();
        ctx.clearRect(0, 0, layout.width, layout.height);

        // Apply Camera Transform
        ctx.scale(layout.width / camera.srcW, layout.height / camera.srcH);
        ctx.translate(-camera.srcX, -camera.srcY);

        // 1. Draw Background (from pre-rendered buffer)
        ctx.drawImage(backgroundBuffer, 0, 0);

        // 2. Draw Video
        if (backgroundMode !== 'hidden' && showShadow) {
            ctx.fillStyle = 'black';
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
            ctx.fillRect(layout.vX, layout.vY, layout.vW, layout.vH);
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        }

        ctx.drawImage(video, 0, 0, layout.videoW, layout.videoH, layout.vX, layout.vY, layout.vW, layout.vH);

        if (backgroundMode !== 'hidden' && showBorder) {
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 2;
            ctx.strokeRect(layout.vX, layout.vY, layout.vW, layout.vH);
        }

        // 3. Overlays
        updateClickAnimations(currentTimeMs, layout.events);
        drawSceneOverlays(ctx, currentTimeMs, layout.events);

        ctx.restore();
    }

    function drawBackground(ctx, w, h) {
        if (backgroundMode === 'hidden') {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, w, h);
            return;
        }

        // Blur filter if needed
        const blurs = {
            'none': 0,
            'light': 4,
            'moderate': 12,
            'strong': 24
        };
        const blurAmount = blurs[backgroundBlur] || 0;

        if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

        if (backgroundMode === 'color') {
            ctx.fillStyle = backgroundValue || backgroundColor;
            ctx.fillRect(0, 0, w, h);
        } else if (backgroundMode === 'gradient') {
            // Basic parsing of linear-gradient string could be complex.
            // For now support simple top-to-bottom or 2-color array?
            // Or assumes `backgroundValue` is a CanvasGradient? No, it's CSS string usually.
            // Let's assume simpler preset inputs: 
            // If array: [color1, color2] -> Linear Gradient

            if (Array.isArray(backgroundValue)) {
                const grad = ctx.createLinearGradient(0, 0, 0, h);
                backgroundValue.forEach((color, i) => {
                    grad.addColorStop(i / (backgroundValue.length - 1), color);
                });
                ctx.fillStyle = grad;
            } else {
                // Fallback
                ctx.fillStyle = backgroundValue || '#000';
            }
            ctx.fillRect(0, 0, w, h);

        } else if (backgroundMode === 'image') {
            if (backgroundImageRef.current) {
                // Cover behavior for background image
                const img = backgroundImageRef.current;
                const imgRatio = img.width / img.height;
                const canvasRatio = w / h;

                let drawW, drawH, drawX, drawY;

                if (canvasRatio > imgRatio) {
                    drawW = w;
                    drawH = w / imgRatio;
                    drawX = 0;
                    drawY = (h - drawH) / 2;
                } else {
                    drawH = h;
                    drawW = h * imgRatio;
                    drawX = (w - drawW) / 2;
                    drawY = 0;
                }
                ctx.drawImage(img, drawX, drawY, drawW, drawH);
            } else {
                ctx.fillStyle = '#222';
                ctx.fillRect(0, 0, w, h);
            }
        }

        ctx.filter = 'none'; // Reset filter
    }

    function drawSceneOverlays(ctx, currentTimeMs, events) {
        // Clicks
        clickAnimationsRef.current.forEach(anim => {
            const elapsed = currentTimeMs - anim.eventTime;
            const progress = Math.min(elapsed / 600, 1);

            // anim.x, anim.y are 0-1 SCENE relative
            // We need Scene Pixels
            // Note: Canvas.width/height in `anim.viewportWidth` were overridden in mapping step.
            // But we can just use current canvas dimensions if we assume constant layout...
            // Or better, use the mapped coordinates directly.

            const cx = anim.x * ctx.canvas.width;
            const cy = anim.y * ctx.canvas.height;

            for (let ring = 0; ring < 3; ring++) {
                const ringProgress = Math.min(1, (progress - ring * 0.1) / 0.7);
                if (ringProgress <= 0) continue;

                const radius = 8 + ringProgress * 40;
                const alpha = (1 - ringProgress) * 0.6;

                ctx.strokeStyle = `rgba(254, 109, 115, ${alpha})`;
                ctx.lineWidth = 2 - ringProgress;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
            }
        });

        // Cursor
        const cursorEvent = findCurrentCursor(currentTimeMs, events);
        if (cursorEvent) {
            const cx = cursorEvent.x * ctx.canvas.width;
            const cy = cursorEvent.y * ctx.canvas.height;

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
            gradient.addColorStop(0, 'rgba(254, 109, 115, 1)');
            gradient.addColorStop(0.5, 'rgba(254, 109, 115, 0.6)');
            gradient.addColorStop(1, 'rgba(254, 109, 115, 0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fill();

            // White center
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Removed old drawClickAnimations and drawCursor as they are replaced by drawSceneOverlays
    // and mapping logic is moved inside renderFrame.
    function updateClickAnimations(currentTimeMs, events) {
        const clickEvents = events.filter(e =>
            currentTimeMs >= e.time && currentTimeMs <= e.time + 600
        );

        clickEvents.forEach(event => {
            if (!clickAnimationsRef.current.some(a => a.eventTime === event.time)) {
                clickAnimationsRef.current.push({
                    eventTime: event.time,
                    x: event.x,
                    y: event.y
                });
            }
        });

        clickAnimationsRef.current = clickAnimationsRef.current.filter(
            a => currentTimeMs <= a.eventTime + 600
        );
    }

    function findCurrentCursor(timeMs, events) {
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].time <= timeMs) return events[i];
        }
        return events[0];
    }

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
        if (!containerRef.current || !videoRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const time = percent * (videoRef.current.duration || 0);
        setHoverTime(time);

        if (isDraggingProgress) {
            handleProgressSeek(e);
        }
    };

    const handleProgressSeek = (e) => {
        if (!containerRef.current || !videoRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const time = percent * (videoRef.current.duration || 0);
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

    const duration = videoRef.current?.duration || 0;
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
            <video
                ref={videoRef}
                style={{ display: 'none' }}
                playsInline
            />

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

export default CanvasPlayer;
