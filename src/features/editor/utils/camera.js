// Virtual camera system for smooth zoom effects
// Inspired by Cursorful.com architecture

import { easeInOutQuart, easeOutCubic, easeInOutCubic } from './easing.js';

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

// Resolves an event's target rect (position + size) at currentTimeMs, clamped
// to an optional outer `bounds` rect (defaults to the full video). Used both
// for zoom-type events (bounds = the active crop rect, if any) and crop-type
// events (bounds = null, i.e. clamped to the full video).
function resolveEventRect(event, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds) {
    const kf = keyframeAnchor(event, currentTimeMs);
    const pos = kf
        ? { x: kf.x * videoWidth, y: kf.y * videoHeight }
        : denormalizeCoordinates(event, videoWidth, videoHeight);

    const eventZoomLevel = event.zoomLevel || zoomLevel;

    let targetW, targetH;
    if (event.type === 'crop' && event.cropWidth && event.cropHeight) {
        targetW = event.cropWidth;
        targetH = event.cropHeight;
    } else {
        targetW = videoWidth / eventZoomLevel;
        targetH = videoHeight / eventZoomLevel;
    }

    const boundX = bounds ? bounds.x : 0;
    const boundY = bounds ? bounds.y : 0;
    const boundW = bounds ? bounds.w : videoWidth;
    const boundH = bounds ? bounds.h : videoHeight;
    // A target can't be larger than the bounds it's confined to (e.g. a zoom
    // segment's default width when its crop bound is already tighter than it).
    targetW = Math.min(targetW, boundW);
    targetH = Math.min(targetH, boundH);

    const targetX = pos.x - (targetW / 2);
    const targetY = pos.y - (targetH / 2);
    const clampedX = Math.max(boundX, Math.min(targetX, boundX + boundW - targetW));
    const clampedY = Math.max(boundY, Math.min(targetY, boundY + boundH - targetH));

    return { clampedX, clampedY, targetW, targetH, eventZoomLevel };
}

// Interpolates camera fields between a `from` rect (the resting/unzoomed
// state) and a `to` rect (the fully-zoomed target) through zoom-in/hold/out.
function applyPhase(phase, progress, from, to) {
    if (phase === 'zoom-in') {
        // Symmetric ease-in-out for the punch-in: accelerate off the rest
        // state, decelerate into the held zoom.
        const t = easeInOutQuart(progress);
        return {
            srcX: lerp(from.x, to.x, t), srcY: lerp(from.y, to.y, t),
            srcW: lerp(from.w, to.w, t), srcH: lerp(from.h, to.h, t),
            zoom: lerp(from.zoom, to.zoom, t),
        };
    }
    if (phase === 'zoom-out') {
        // Softer release: ease-out pulls away from the held zoom immediately
        // and settles gently, which reads as more natural than the symmetric
        // curve snapping back at the end.
        const t = easeOutCubic(progress);
        return {
            srcX: lerp(to.x, from.x, t), srcY: lerp(to.y, from.y, t),
            srcW: lerp(to.w, from.w, t), srcH: lerp(to.h, from.h, t),
            zoom: lerp(to.zoom, from.zoom, t),
        };
    }
    return { srcX: to.x, srcY: to.y, srcW: to.w, srcH: to.h, zoom: to.zoom };
}

/**
 * Resolves a (possibly crossfading) zoom match into a camera rect. A plain
 * match resolves through the normal zoom-in/hold/out phase easing. A
 * `crossfade` match (see findZoomTarget) blends the outgoing segment's tail
 * directly into the incoming segment's head across the span where their
 * windows overlap, instead of hard-cutting between them - that hard cut is
 * what caused two closely-spaced segments (gap smaller than roughly
 * 2x transitionDuration) to visibly jump: the camera was still mid-way
 * through zooming out from A when ownership flipped to B's zoom-in, computed
 * from "rest" rather than from A's actual current position.
 */
function resolveZoomCamera(match, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds, restRect) {
    if (match.crossfade) {
        const { outgoing, incoming } = match.crossfade;
        const a = resolveZoomCamera(outgoing, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds, restRect);
        const b = resolveZoomCamera(incoming, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds, restRect);
        const span = outgoing.windowEnd - incoming.windowStart;
        const raw = span > 0 ? (currentTimeMs - incoming.windowStart) / span : 1;
        const t = easeInOutCubic(Math.max(0, Math.min(1, raw)));
        return {
            srcX: lerp(a.srcX, b.srcX, t), srcY: lerp(a.srcY, b.srcY, t),
            srcW: lerp(a.srcW, b.srcW, t), srcH: lerp(a.srcH, b.srcH, t),
            zoom: lerp(a.zoom, b.zoom, t),
        };
    }
    const { event, phase, progress } = match;
    const rect = resolveEventRect(event, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds);
    const targetRect = { x: rect.clampedX, y: rect.clampedY, w: rect.targetW, h: rect.targetH, zoom: rect.eventZoomLevel };
    return applyPhase(phase, progress, restRect, targetRect);
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

    const settings = { zoomDuration, transitionDuration };
    // Zoom-type and crop-type segments are resolved independently so they can
    // stack on different tracks: the topmost crop segment sets the outer
    // bounds, the topmost zoom segment pans/zooms within them.
    const zoomTarget = findZoomTarget(currentTimeMs, events, settings);
    const cropTarget = findCropTarget(currentTimeMs, events, settings);

    const fullRect = { x: 0, y: 0, w: videoWidth, h: videoHeight, zoom: 1 };

    // The crop's own animated rect (respecting its own zoom-in/hold/out timing).
    // When present, this becomes both the camera's rest state for the zoom
    // target (if any) and the camera itself when no zoom target is active.
    let cropRect = null;
    if (cropTarget) {
        const rect = resolveEventRect(cropTarget.event, currentTimeMs, videoWidth, videoHeight, zoomLevel, null);
        const targetRect = { x: rect.clampedX, y: rect.clampedY, w: rect.targetW, h: rect.targetH, zoom: rect.eventZoomLevel };
        const applied = applyPhase(cropTarget.phase, cropTarget.progress, fullRect, targetRect);
        cropRect = { x: applied.srcX, y: applied.srcY, w: applied.srcW, h: applied.srcH, zoom: applied.zoom };
    }

    if (zoomTarget) {
        const bounds = cropRect ? { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h } : null;
        const restRect = cropRect || fullRect;
        Object.assign(camera, resolveZoomCamera(zoomTarget, currentTimeMs, videoWidth, videoHeight, zoomLevel, bounds, restRect));
    } else if (cropRect) {
        camera.srcX = cropRect.x;
        camera.srcY = cropRect.y;
        camera.srcW = cropRect.w;
        camera.srcH = cropRect.h;
        camera.zoom = cropRect.zoom;
    }

    // Follow-cursor mode: Smooth camera panning (suppressed whenever a zoom or
    // crop segment already has camera control).
    const followTarget = findFollowTarget(currentTimeMs, events);
    if (followTarget && !zoomTarget && !cropRect) {
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

// Frame-rate-independent camera smoothing: converts elapsed wall-clock time
// into an exponential-decay factor so preview (variable rAF cadence) and
// export (constant-fps cadence) converge to the same camera position at the
// same wall-clock time, instead of drifting apart with a fixed per-frame
// factor. `tau` is the time constant in ms (time to close ~63% of the gap).
export function interpolateCameraByTime(current, target, dtMs, tau = 70) {
    if (!current || !Number.isFinite(dtMs) || dtMs <= 0) return target;
    const factor = 1 - Math.exp(-dtMs / tau);
    return interpolateCamera(current, target, factor);
}

// Find focus moments: major clicks, typing, selections, focus (skip minor
// clicks). Crop-type events are resolved separately by findCropTarget so the
// two can stack independently.
//
// Different tracks still use "topmost wins" outright (a manually stacked
// segment overrides an auto one, no blending). But two segments on the *same*
// track whose transition windows overlap - which happens whenever the gap
// between them is smaller than roughly 2x transitionDuration - are chained
// into a single `{ crossfade }` match instead of the hard-cut that
// `findBestMatch`'s array-order tiebreak used to produce (see
// resolveZoomCamera for why that was a visible jump).
function findZoomTarget(currentTimeMs, events, settings) {
    const zoomTypeEvents = events.filter(e =>
        e.type === 'click' || e.type === 'dblclick' || e.type === 'zoom' ||
        e.type === 'typing' || e.type === 'selection' || e.type === 'focus'
    );
    const matches = findActiveMatches(currentTimeMs, zoomTypeEvents, settings);
    if (matches.length === 0) return null;

    const maxTrackId = matches.reduce((max, m) => Math.max(max, m.event.trackId ?? 0), -Infinity);
    const topMatches = matches.filter((m) => (m.event.trackId ?? 0) === maxTrackId);
    if (topMatches.length === 1) return topMatches[0];

    // Blend the two most recent (nearest to currentTimeMs) overlapping
    // matches; with >2 simultaneously active (rare/dense clicks) the earlier
    // ones are moot since we're already past their own window's start.
    topMatches.sort((a, b) => a.event.time - b.event.time);
    const incoming = topMatches[topMatches.length - 1];
    const outgoing = topMatches[topMatches.length - 2];
    return { crossfade: { outgoing, incoming } };
}

function findCropTarget(currentTimeMs, events, settings) {
    const cropTypeEvents = events.filter(e => e.type === 'crop');
    return findBestMatch(currentTimeMs, cropTypeEvents, settings);
}

// Among all events whose window covers currentTimeMs, keep the one on the
// highest track (ties keep the last one in array order) - this is the
// "topmost wins" stacking rule for same-type overlaps.
function findBestMatch(currentTimeMs, focusEvents, settings) {
    let best = null;
    for (const event of focusEvents) {
        const match = computeWindowMatch(currentTimeMs, event, settings);
        if (!match) continue;
        if (!best || (event.trackId ?? 0) >= (best.event.trackId ?? 0)) {
            best = match;
        }
    }
    return best;
}

// Every event whose window covers currentTimeMs, not just the top-priority
// one - lets findZoomTarget detect and crossfade overlapping same-track
// segments instead of hard-cutting between them.
function findActiveMatches(currentTimeMs, focusEvents, settings) {
    const matches = [];
    for (const event of focusEvents) {
        const match = computeWindowMatch(currentTimeMs, event, settings);
        if (match) matches.push(match);
    }
    return matches;
}

function computeWindowMatch(currentTimeMs, event, settings) {
    const { zoomDuration, transitionDuration } = settings;
    const preZoomDuration = transitionDuration;

    const eventTime = event.time;
    const eventDuration = event.duration || zoomDuration; // Use individual duration or fall back to global
    const zoomStartTime = eventTime - preZoomDuration;
    const zoomInEndTime = eventTime;
    const zoomHoldEndTime = eventTime + eventDuration; // Use event's specific duration
    const zoomOutEndTime = zoomHoldEndTime + transitionDuration;

    if (currentTimeMs >= zoomStartTime && currentTimeMs < zoomOutEndTime) {
        // windowStart/windowEnd (this match's full [zoom-in start, zoom-out
        // end] span) let resolveZoomCamera compute a crossfade blend factor
        // between two overlapping matches without recomputing their timing.
        const windowStart = zoomStartTime;
        const windowEnd = zoomOutEndTime;
        if (currentTimeMs < zoomInEndTime) {
            const elapsed = currentTimeMs - zoomStartTime;
            const progress = Math.max(0, Math.min(1, elapsed / preZoomDuration));
            return { event, phase: 'zoom-in', progress, windowStart, windowEnd };
        } else if (currentTimeMs < zoomHoldEndTime) {
            return { event, phase: 'zoom-hold', progress: 1, windowStart, windowEnd };
        } else {
            const elapsed = currentTimeMs - zoomHoldEndTime;
            const progress = Math.max(0, Math.min(1, elapsed / transitionDuration));
            return { event, phase: 'zoom-out', progress, windowStart, windowEnd };
        }
    }

    return null;
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
