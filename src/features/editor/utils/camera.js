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

        // Denormalize coordinates to video dimensions. When the segment carries
        // keyframes (a sustained session that pans between focus points), the
        // anchor is evaluated along the smoothed keyframe path at the current
        // time so the held zoom glides instead of jumping.
        const kf = keyframeAnchor(event, currentTimeMs);
        const pos = kf
            ? { x: kf.x * videoWidth, y: kf.y * videoHeight }
            : denormalizeCoordinates(event, videoWidth, videoHeight);

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

    // Find focus moments: major clicks, typing, selections, focus (skip minor clicks)
    const focusEvents = events.filter(e =>
        e.type === 'click' || e.type === 'dblclick' || e.type === 'zoom' ||
        e.type === 'crop' || e.type === 'typing' || e.type === 'selection' || e.type === 'focus'
    );

    // Take the LAST matching window so overlapping segments resolve to the most
    // recent one (auto-zoom sessions and manual edits can overlap).
    let match = null;
    for (const event of focusEvents) {
        const eventTime = event.time;
        const eventDuration = event.duration || zoomDuration; // Use individual duration or fall back to global
        const zoomStartTime = eventTime - preZoomDuration;
        const zoomInEndTime = eventTime;
        const zoomHoldEndTime = eventTime + eventDuration; // Use event's specific duration
        const zoomOutEndTime = zoomHoldEndTime + transitionDuration;

        if (currentTimeMs >= zoomStartTime && currentTimeMs < zoomOutEndTime) {
            if (currentTimeMs < zoomInEndTime) {
                const elapsed = currentTimeMs - zoomStartTime;
                const progress = Math.max(0, Math.min(1, elapsed / preZoomDuration));
                match = { event, phase: 'zoom-in', progress };
            } else if (currentTimeMs < zoomHoldEndTime) {
                match = { event, phase: 'zoom-hold', progress: 1 };
            } else {
                const elapsed = currentTimeMs - zoomHoldEndTime;
                const progress = Math.max(0, Math.min(1, elapsed / transitionDuration));
                match = { event, phase: 'zoom-out', progress };
            }
        }
    }

    return match;
}

/**
 * Evaluates a sustained-zoom segment's keyframe path at `currentTimeMs`,
 * returning a smoothed {x, y} in the same normalized space as the keyframes.
 * Keyframe `t` is relative to the segment start (event.time). Returns null when
 * there's no multi-point path to follow (the caller falls back to the anchor).
 */
function keyframeAnchor(event, currentTimeMs) {
    if (!event.keyframes || event.keyframes.length < 2) return null;
    const pts = event.keyframes.map(kf => ({ time: event.time + kf.t, x: kf.x, y: kf.y }));
    return smoothCursorPosition(currentTimeMs, pts);
}

// Find a smoothed cursor position for follow mode. Raw cursor samples are
// noisy (hand tremor, trackpad jitter, irregular sampling rate) — following
// them directly makes the camera amplify every micro-movement into a shaky
// pan. Smoothing the path with a spline before using it is what separates a
// cinematic auto-zoom from a nauseating one.
function findFollowTarget(currentTimeMs, events) {
    const followEvents = events.filter(e => e.type === 'follow' || e.type === 'move');
    return smoothCursorPosition(currentTimeMs, followEvents);
}

/**
 * Smooths a chronological cursor path using a centripetal Catmull-Rom
 * spline, evaluated at `currentTimeMs`. Centripetal parameterization (knot
 * spacing ~ distance^0.5 instead of uniform steps) keeps the curve
 * well-behaved even though samples arrive at irregular intervals.
 */
export function smoothCursorPosition(currentTimeMs, pathEvents) {
    if (pathEvents.length === 0) return null;
    if (pathEvents.length === 1) return pathEvents[0];

    // Index of the last sample at or before currentTimeMs.
    let i = -1;
    for (let k = 0; k < pathEvents.length; k++) {
        if (pathEvents[k].time <= currentTimeMs) i = k;
        else break;
    }
    if (i === -1) return pathEvents[0]; // before the first sample
    if (i === pathEvents.length - 1) return pathEvents[i]; // after the last sample

    const p1 = pathEvents[i];
    const p2 = pathEvents[i + 1];
    const p0 = pathEvents[i - 1] || p1; // duplicate boundary point when missing
    const p3 = pathEvents[i + 2] || p2;

    const segmentDuration = p2.time - p1.time;
    const t = segmentDuration > 0 ? (currentTimeMs - p1.time) / segmentDuration : 0;

    return catmullRomSegment(p0, p1, p2, p3, t);
}

/** Centripetal Catmull-Rom spline segment between p1 and p2, using p0/p3 as tangent context. */
function catmullRomSegment(p0, p1, p2, p3, t) {
    const alpha = 0.5;
    const knotDistance = (a, b) => Math.max(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2), 1e-6) ** alpha;

    const t0 = 0;
    const t1 = t0 + knotDistance(p0, p1);
    const t2 = t1 + knotDistance(p1, p2);
    const t3 = t2 + knotDistance(p2, p3);
    const tt = t1 + t * (t2 - t1);

    const interp = (a, b, ta, tb) => {
        if (tb === ta) return a;
        const f = (tt - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };

    const A1 = interp(p0, p1, t0, t1);
    const A2 = interp(p1, p2, t1, t2);
    const A3 = interp(p2, p3, t2, t3);
    const B1 = interp(A1, A2, t0, t2);
    const B2 = interp(A2, A3, t1, t3);
    return interp(B1, B2, t1, t2);
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
