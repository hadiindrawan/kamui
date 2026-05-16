// Virtual camera system for smooth zoom effects
// Inspired by Cursorful.com architecture

// Helper: Convert normalized coordinates (0-1) back to absolute pixels
function denormalizeCoordinates(event, videoWidth, videoHeight) {
    // Check if using new normalized format
    if (event.x !== undefined && event.x <= 1 && event.y <= 1) {
        return {
            x: event.x * videoWidth,
            y: event.y * videoHeight
        };
    }

    // Fallback: old absolute format with viewport scaling
    const scaleX = videoWidth / (event.viewportWidth || 1920);
    const scaleY = videoHeight / (event.viewportHeight || 1080);
    return {
        x: (event.absX || event.x || 0) * scaleX,
        y: (event.absY || event.y || 0) * scaleY
    };
}

export function calculateCameraPosition(currentTimeMs, events, dimensions) {
    const {
        videoWidth,
        videoHeight,
        zoomLevel = 2,
        zoomDuration = 800,
        transitionDuration = 300
    } = dimensions;

    // Default camera shows full video
    let camera = {
        srcX: 0,
        srcY: 0,
        srcW: videoWidth,
        srcH: videoHeight,
        zoom: 1
    };

    // Find if we should be zooming based on events
    const zoomTarget = findZoomTarget(currentTimeMs, events, {
        zoomDuration,
        transitionDuration
    });

    if (zoomTarget) {
        const { event, phase, progress } = zoomTarget;

        // Denormalize coordinates to video dimensions
        const pos = denormalizeCoordinates(event, videoWidth, videoHeight);

        // Get zoom level from the event itself, or fall back to global zoom level
        const eventZoomLevel = event.zoomLevel || zoomLevel;

        // Calculate target zoom position (centered on cursor)
        let targetW, targetH;

        // For crop segments, use custom dimensions if provided
        if (event.type === 'crop' && event.cropWidth && event.cropHeight) {
            targetW = event.cropWidth;
            targetH = event.cropHeight;
        } else {
            targetW = videoWidth / eventZoomLevel;
            targetH = videoHeight / eventZoomLevel;
        }

        const targetX = pos.x - (targetW / 2);
        const targetY = pos.y - (targetH / 2);

        // Clamp to video bounds
        const clampedX = Math.max(0, Math.min(targetX, videoWidth - targetW));
        const clampedY = Math.max(0, Math.min(targetY, videoHeight - targetH));

        // Apply smooth interpolation with easing
        const t = easeInOutQuart(progress);

        if (phase === 'zoom-in') {
            camera.srcX = lerp(0, clampedX, t);
            camera.srcY = lerp(0, clampedY, t);
            camera.srcW = lerp(videoWidth, targetW, t);
            camera.srcH = lerp(videoHeight, targetH, t);
            camera.zoom = lerp(1, eventZoomLevel, t);
        } else if (phase === 'zoom-hold') {
            camera.srcX = clampedX;
            camera.srcY = clampedY;
            camera.srcW = targetW;
            camera.srcH = targetH;
            camera.zoom = eventZoomLevel;
        } else if (phase === 'zoom-out') {
            camera.srcX = lerp(clampedX, 0, t);
            camera.srcY = lerp(clampedY, 0, t);
            camera.srcW = lerp(targetW, videoWidth, t);
            camera.srcH = lerp(targetH, videoHeight, t);
            camera.zoom = lerp(eventZoomLevel, 1, t);
        }
    }

    // Follow-cursor mode: Smooth camera panning
    const followTarget = findFollowTarget(currentTimeMs, events);
    if (followTarget && !zoomTarget) {
        const pos = denormalizeCoordinates(followTarget, videoWidth, videoHeight);

        // Calculate follow camera (wider view than zoom)
        const followW = videoWidth / 1.5; // Less zoom for follow mode
        const followH = videoHeight / 1.5;

        const targetX = pos.x - (followW / 2);
        const targetY = pos.y - (followH / 2);

        const clampedX = Math.max(0, Math.min(targetX, videoWidth - followW));
        const clampedY = Math.max(0, Math.min(targetY, videoHeight - followH));

        // Smooth follow with easing
        camera.srcX = lerp(camera.srcX, clampedX, 0.05);
        camera.srcY = lerp(camera.srcY, clampedY, 0.05);
        camera.srcW = lerp(camera.srcW, followW, 0.05);
        camera.srcH = lerp(camera.srcH, followH, 0.05);
        camera.zoom = lerp(camera.zoom, 1.5, 0.05);
    }

    return camera;
}

// Smooth interpolation between camera states for fluid motion
export function interpolateCamera(current, target, factor = 0.1) {
    if (!current) return target;

    return {
        srcX: lerp(current.srcX, target.srcX, factor),
        srcY: lerp(current.srcY, target.srcY, factor),
        srcW: lerp(current.srcW, target.srcW, factor),
        srcH: lerp(current.srcH, target.srcH, factor),
        zoom: lerp(current.zoom, target.zoom, factor)
    };
}

function findZoomTarget(currentTimeMs, events, settings) {
    const { zoomDuration, transitionDuration } = settings;
    const preZoomDuration = transitionDuration;

    // Find focus moments: major clicks, typing, selections (skip minor clicks)
    const clickEvents = events.filter(e =>
        e.type === 'click' || e.type === 'dblclick' || e.type === 'zoom' ||
        e.type === 'crop' || e.type === 'typing' || e.type === 'selection'
    );

    // Filter out 'click-minor' events to reduce noise
    const focusEvents = clickEvents.filter(e => e.type !== 'click-minor');

    for (const event of focusEvents) {
        const eventTime = event.time;
        const eventDuration = event.duration || zoomDuration; // Use individual duration or fall back to global
        const zoomStartTime = eventTime - preZoomDuration;
        const zoomInEndTime = eventTime;
        const zoomHoldEndTime = eventTime + eventDuration; // Use event's specific duration
        const zoomOutEndTime = zoomHoldEndTime + transitionDuration;

        if (currentTimeMs >= zoomStartTime && currentTimeMs < zoomOutEndTime) {
            if (currentTimeMs < zoomInEndTime) {
                // Zooming in
                const elapsed = currentTimeMs - zoomStartTime;
                const progress = Math.max(0, Math.min(1, elapsed / preZoomDuration));
                return { event, phase: 'zoom-in', progress };
            } else if (currentTimeMs < zoomHoldEndTime) {
                // Holding zoom
                return { event, phase: 'zoom-hold', progress: 1 };
            } else {
                // Zooming out
                const elapsed = currentTimeMs - zoomHoldEndTime;
                const progress = Math.max(0, Math.min(1, elapsed / transitionDuration));
                return { event, phase: 'zoom-out', progress };
            }
        }
    }

    return null;
}

// Find the most recent cursor position for follow mode
function findFollowTarget(currentTimeMs, events) {
    // Look for recent 'follow' or 'move' events
    const followEvents = events.filter(e => e.type === 'follow' || e.type === 'move');

    if (followEvents.length === 0) return null;

    // Find the most recent event before current time
    let latestEvent = null;
    for (let i = followEvents.length - 1; i >= 0; i--) {
        if (followEvents[i].time <= currentTimeMs) {
            latestEvent = followEvents[i];
            break;
        }
    }

    return latestEvent;
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

// Smoother easing function for more natural camera movement
function easeInOutQuart(t) {
    return t < 0.5
        ? 8 * t * t * t * t
        : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

// Alternative easing for quick response
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}
