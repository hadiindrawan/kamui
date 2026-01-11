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
    showFollowCursor = false,
    onTimeUpdate,
    onDurationChange,
    onSeek
}, ref) => {
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const rafRef = useRef(null);
    const lastCameraRef = useRef(null);
    const clickAnimationsRef = useRef([]);
    const containerRef = useRef(null);
    const [isHoveringVideo, setIsHoveringVideo] = useState(false);
    const [isDraggingProgress, setIsDraggingProgress] = useState(false);
    const [hoverTime, setHoverTime] = useState(null);

    useImperativeHandle(ref, () => ({
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        seekTo: (time) => {
            if (videoRef.current && Number.isFinite(time)) {
                videoRef.current.currentTime = time;
            }
        }
    }));

    useEffect(() => {
        setupVideo();
        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [recording]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackSpeed;
        }
    }, [playbackSpeed]);

    useEffect(() => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.play().catch(e => console.warn('Play error:', e));
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
        if (videoRef.current && !isPlaying && Number.isFinite(currentTime)) {
            videoRef.current.currentTime = currentTime;
            renderFrame();
        }
    }, [currentTime]);

    async function setupVideo() {
        if (!videoRef.current || !recording?.videoBlob) return;

        const video = videoRef.current;
        const videoUrl = URL.createObjectURL(recording.videoBlob);
        video.src = videoUrl;

        video.onloadedmetadata = () => {
            let actualDuration = video.duration;

            // Handle Infinity duration (common with WebM from MediaRecorder)
            if (!Number.isFinite(video.duration)) {
                // Calculate duration from recording events
                if (recording?.events && recording.events.length > 0) {
                    const maxEventTime = Math.max(...recording.events.map(e => e.time || 0));
                    actualDuration = maxEventTime / 1000; // Convert ms to seconds
                } else {
                    actualDuration = 10; // Fallback
                }
            }

            if (Number.isFinite(actualDuration) && actualDuration > 0) {
                onDurationChange(actualDuration);
            } else {
                // Could not determine valid duration
            }

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = video.videoWidth || 1920;
                canvas.height = video.videoHeight || 1080;
                renderFrame();
            }
        };

        video.ontimeupdate = () => {
            if (Number.isFinite(video.currentTime)) {
                onTimeUpdate(video.currentTime);
            }
        };
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

        if (!canvas || !video || !video.videoWidth) return;

        const ctx = canvas.getContext('2d');
        const currentTimeMs = (video.currentTime || 0) * 1000;

        // Calculate aspect ratio dimensions
        const aspectRatios = {
            '16:9': 16 / 9,
            '9:16': 9 / 16,
            '1:1': 1,
            '4:5': 4 / 5
        };
        const targetRatio = aspectRatios[aspectRatio] || 16 / 9;

        // Apply aspect ratio to canvas
        const videoRatio = video.videoWidth / video.videoHeight;
        let renderWidth = canvas.width;
        let renderHeight = canvas.height;
        let offsetX = 0;
        let offsetY = 0;

        if (aspectRatio !== '16:9') {
            if (targetRatio > videoRatio) {
                renderHeight = renderWidth / targetRatio;
                offsetY = (canvas.height - renderHeight) / 2;
            } else {
                renderWidth = renderHeight * targetRatio;
                offsetX = (canvas.width - renderWidth) / 2;
            }
        }

        // Convert segments to event format for camera calculation
        const segmentEvents = segments.map(seg => ({
            ...seg,
            time: seg.startTime,
            type: seg.type || 'click'
        }));

        // Add follow-cursor events if enabled
        if (showFollowCursor) {
            const followEvents = recording?.events?.filter(e => e.type === 'follow' || e.type === 'move') || [];
            segmentEvents.push(...followEvents);
        }

        // Calculate target camera position
        const targetCamera = calculateCameraPosition(
            currentTimeMs,
            segmentEvents,
            {
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                zoomLevel,
                zoomDuration,
                transitionDuration
            }
        );

        // Smooth interpolation for camera movement
        const camera = interpolateCamera(lastCameraRef.current, targetCamera, 0.12);
        lastCameraRef.current = camera;

        // Clear with background color
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw video with aspect ratio framing
        ctx.drawImage(
            video,
            camera.srcX,
            camera.srcY,
            camera.srcW,
            camera.srcH,
            offsetX,
            offsetY,
            renderWidth,
            renderHeight
        );

        // Update and draw click animations
        updateClickAnimations(currentTimeMs, segmentEvents);
        drawClickAnimations(ctx, camera, currentTimeMs);

        // Draw cursor
        const cursorEvent = findCurrentCursor(currentTimeMs, segmentEvents);
        if (cursorEvent) {
            drawCursor(ctx, camera, cursorEvent);
        }
    }

    function updateClickAnimations(currentTimeMs, events) {
        const clickEvents = events.filter(e =>
            currentTimeMs >= e.time && currentTimeMs <= e.time + 600
        );

        clickEvents.forEach(event => {
            if (!clickAnimationsRef.current.some(a => a.eventTime === event.time)) {
                clickAnimationsRef.current.push({
                    eventTime: event.time,
                    x: event.x,
                    y: event.y,
                    viewportWidth: event.viewportWidth || 1920,
                    viewportHeight: event.viewportHeight || 1080
                });
            }
        });

        clickAnimationsRef.current = clickAnimationsRef.current.filter(
            a => currentTimeMs <= a.eventTime + 600
        );
    }

    function drawClickAnimations(ctx, camera, currentTimeMs) {
        clickAnimationsRef.current.forEach(anim => {
            const elapsed = currentTimeMs - anim.eventTime;
            const progress = Math.min(elapsed / 600, 1);

            const scaleX = camera.srcW / anim.viewportWidth;
            const scaleY = camera.srcH / anim.viewportHeight;

            const cursorX = ((anim.x * scaleX - camera.srcX) / camera.srcW) * ctx.canvas.width;
            const cursorY = ((anim.y * scaleY - camera.srcY) / camera.srcH) * ctx.canvas.height;

            // Draw 3 expanding rings
            for (let ring = 0; ring < 3; ring++) {
                const ringProgress = Math.min(1, (progress - ring * 0.1) / 0.7);
                if (ringProgress <= 0) continue;

                const radius = 8 + ringProgress * 40;
                const alpha = (1 - ringProgress) * 0.6;

                ctx.strokeStyle = `rgba(254, 109, 115, ${alpha})`;
                ctx.lineWidth = 2 - ringProgress;
                ctx.beginPath();
                ctx.arc(cursorX, cursorY, radius, 0, Math.PI * 2);
                ctx.stroke();
            }
        });
    }

    function findCurrentCursor(timeMs, events) {
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].time <= timeMs) return events[i];
        }
        return events[0];
    }

    function drawCursor(ctx, camera, event) {
        if (!event) return;

        const scaleX = camera.srcW / (event.viewportWidth || 1920);
        const scaleY = camera.srcH / (event.viewportHeight || 1080);

        const cursorX = ((event.x * scaleX - camera.srcX) / camera.srcW) * ctx.canvas.width;
        const cursorY = ((event.y * scaleY - camera.srcY) / camera.srcH) * ctx.canvas.height;

        // Gradient cursor
        const gradient = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 12);
        gradient.addColorStop(0, 'rgba(254, 109, 115, 1)');
        gradient.addColorStop(0.5, 'rgba(254, 109, 115, 0.6)');
        gradient.addColorStop(1, 'rgba(254, 109, 115, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 12, 0, Math.PI * 2);
        ctx.fill();

        // White center
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 3, 0, Math.PI * 2);
        ctx.fill();
    }

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
