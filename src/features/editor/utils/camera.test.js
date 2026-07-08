import { calculateCameraPosition, interpolateCamera, interpolateCameraByTime, smoothCursorPosition } from './camera.js';

const dimensions = { videoWidth: 1000, videoHeight: 1000, zoomLevel: 2, zoomDuration: 800, transitionDuration: 300 };

describe('calculateCameraPosition', () => {
    it('shows the full frame when no event is active', () => {
        const camera = calculateCameraPosition(0, [], dimensions);
        expect(camera).toEqual({ srcX: 0, srcY: 0, srcW: 1000, srcH: 1000, zoom: 1 });
    });

    it('zooms in progressively toward the event target during the zoom-in phase', () => {
        const events = [{ type: 'click', time: 1000, x: 0.5, y: 0.5 }];
        // zoom-in window is [time - transitionDuration, time) = [700, 1000)
        const camera = calculateCameraPosition(850, events, dimensions);
        expect(camera.zoom).toBeGreaterThan(1);
        expect(camera.zoom).toBeLessThan(2);
        // Midway through the transition, srcW should have shrunk from full width toward target width.
        expect(camera.srcW).toBeLessThan(1000);
        expect(camera.srcW).toBeGreaterThan(500);
    });

    it('holds a steady, fully-zoomed camera during the zoom-hold phase', () => {
        const events = [{ type: 'click', time: 1000, x: 0.5, y: 0.5 }];
        // hold window is [time, time + zoomDuration) = [1000, 1800)
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.zoom).toBe(2);
        expect(camera.srcW).toBe(500); // videoWidth / zoomLevel
        expect(camera.srcH).toBe(500);
        // Centered on (0.5, 0.5) -> target rect starts at (250, 250).
        expect(camera.srcX).toBeCloseTo(250);
        expect(camera.srcY).toBeCloseTo(250);
    });

    it('zooms back out after the hold duration elapses', () => {
        const events = [{ type: 'click', time: 1000, x: 0.5, y: 0.5 }];
        // zoom-out window is [1800, 2100)
        const camera = calculateCameraPosition(1950, events, dimensions);
        expect(camera.zoom).toBeLessThan(2);
        expect(camera.zoom).toBeGreaterThan(1);
    });

    it('returns to the full frame once the zoom-out completes', () => {
        const events = [{ type: 'click', time: 1000, x: 0.5, y: 0.5 }];
        const camera = calculateCameraPosition(5000, events, dimensions);
        expect(camera.zoom).toBe(1);
        expect(camera.srcW).toBe(1000);
    });

    it('ignores click-minor events (not zoom-worthy)', () => {
        const events = [{ type: 'click-minor', time: 1000, x: 0.5, y: 0.5 }];
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.zoom).toBe(1);
    });

    it('clamps the zoom target so it never pans outside the video bounds', () => {
        // Target near the top-left corner: naive centering would push srcX/srcY negative.
        const events = [{ type: 'click', time: 1000, x: 0.05, y: 0.05 }];
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.srcX).toBeGreaterThanOrEqual(0);
        expect(camera.srcY).toBeGreaterThanOrEqual(0);
    });

    it('uses a per-event zoom level override when provided', () => {
        const events = [{ type: 'click', time: 1000, x: 0.5, y: 0.5, zoomLevel: 4 }];
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.zoom).toBe(4);
        expect(camera.srcW).toBe(250); // videoWidth / 4
    });

    it('pans smoothly toward the cursor in follow mode when no zoom is active', () => {
        const events = [{ type: 'follow', time: 500, x: 0.8, y: 0.8 }];
        const camera = calculateCameraPosition(600, events, dimensions);
        // Follow mode lerps toward a 1.5x view of the cursor at a slow factor (0.05),
        // so a single call only nudges the camera slightly off the full-frame default.
        expect(camera.zoom).toBeGreaterThan(1);
        expect(camera.zoom).toBeLessThan(1.5);
    });

    it('resolves a standalone crop segment the same way a zoom segment would (backward compat)', () => {
        const events = [{ type: 'crop', time: 1000, x: 0.5, y: 0.5, cropWidth: 400, cropHeight: 400 }];
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.srcW).toBe(400);
        expect(camera.srcH).toBe(400);
        expect(camera.srcX).toBeCloseTo(300); // centered on (0.5, 0.5) -> 500 - 400/2
        expect(camera.srcY).toBeCloseTo(300);
    });

    it('composites a stacked zoom segment inside a crop segment on a different track', () => {
        // Crop covers the left half of the frame; zoom pans within it toward its own corner.
        const events = [
            { type: 'crop', time: 1000, x: 0.25, y: 0.5, cropWidth: 500, cropHeight: 1000, trackId: 0 },
            { type: 'click', time: 1000, x: 0.1, y: 0.1, trackId: 1, zoomLevel: 2 },
        ];
        const camera = calculateCameraPosition(1400, events, dimensions);
        // Zoom's target rect (250x250 at videoWidth/2) must stay clamped inside the crop's [0,500]x[0,500] rect.
        expect(camera.srcW).toBeLessThanOrEqual(500);
        expect(camera.srcH).toBeLessThanOrEqual(500);
        expect(camera.srcX).toBeGreaterThanOrEqual(0);
        expect(camera.srcY).toBeGreaterThanOrEqual(0);
        expect(camera.srcX + camera.srcW).toBeLessThanOrEqual(500.001);
        expect(camera.srcY + camera.srcH).toBeLessThanOrEqual(500.001);
    });

    it('suppresses follow-cursor mode while a crop-only segment is active', () => {
        const events = [
            { type: 'crop', time: 1000, x: 0.5, y: 0.5, cropWidth: 400, cropHeight: 400 },
            { type: 'follow', time: 1000, x: 0.9, y: 0.9 },
        ];
        const camera = calculateCameraPosition(1400, events, dimensions);
        expect(camera.srcW).toBe(400);
        expect(camera.srcH).toBe(400);
    });

    it('picks the highest-trackId segment when two same-type segments overlap', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.2, y: 0.2, zoomLevel: 2, trackId: 0 },
            { type: 'click', time: 1000, x: 0.8, y: 0.8, zoomLevel: 3, trackId: 1 },
        ];
        const camera = calculateCameraPosition(1400, events, dimensions);
        // trackId 1's segment (zoomLevel 3) should win over trackId 0's (zoomLevel 2).
        expect(camera.zoom).toBe(3);
    });
});

describe('calculateCameraPosition - overlapping same-track segments (crossfade)', () => {
    // A's zoom-out ramp is [1800, 2100); B's zoom-in ramp is [1700, 2000) -
    // they overlap for 300ms. Before the crossfade fix, findBestMatch's
    // array-order tiebreak meant the instant B's window opened (t=1700), the
    // camera would snap straight from A's held zoom (zoom 2, tight corner) to
    // B's own zoom-in-from-rest starting value (zoom 1, full frame) - a hard,
    // visible teleport whenever two segments sit closer together than
    // ~2x transitionDuration. This is the exact bug reported: two segments
    // under a ~1s gap apart made the zoom visibly jump.
    const events = [
        { type: 'click', time: 1000, x: 0.2, y: 0.2 }, // A: window [700, 2100)
        { type: 'click', time: 2000, x: 0.8, y: 0.8 }, // B: window [1700, 3100)
    ];

    it('does not snap toward rest the instant the next segment\'s window opens', () => {
        const justBefore = calculateCameraPosition(1699, events, dimensions);
        const justAfter = calculateCameraPosition(1700, events, dimensions);
        expect(justBefore.zoom).toBeCloseTo(2, 5);
        // Old behavior would drop this to 1 (full rest) here; fixed behavior
        // stays continuous with justBefore.
        expect(justAfter.zoom).toBeGreaterThan(1.8);
        expect(Math.abs(justAfter.zoom - justBefore.zoom)).toBeLessThan(0.1);
    });

    it('drifts gradually across the handoff instead of teleporting in one frame', () => {
        let prev = null;
        for (let t = 1650; t <= 2150; t += 10) {
            const camera = calculateCameraPosition(t, events, dimensions);
            if (prev) {
                expect(Math.abs(camera.srcX - prev.srcX)).toBeLessThan(60);
                expect(Math.abs(camera.srcY - prev.srcY)).toBeLessThan(60);
                expect(Math.abs(camera.zoom - prev.zoom)).toBeLessThan(0.3);
            }
            prev = camera;
        }
    });

    it('still settles on each segment\'s own held target outside the overlap', () => {
        const duringA = calculateCameraPosition(1500, events, dimensions); // A's hold, before overlap
        const duringB = calculateCameraPosition(2400, events, dimensions); // B's hold, after overlap
        expect(duringA.srcX).toBeCloseTo(0);
        expect(duringA.srcY).toBeCloseTo(0);
        expect(duringB.srcX).toBeCloseTo(500);
        expect(duringB.srcY).toBeCloseTo(500);
    });

    it('still hard-switches (no crossfade) when the overlapping segments are on different tracks', () => {
        const stacked = [
            { type: 'click', time: 1000, x: 0.2, y: 0.2, trackId: 0 },
            { type: 'click', time: 2000, x: 0.8, y: 0.8, trackId: 1 },
        ];
        const bOnly = [stacked[1]];
        const t = 1900; // both windows active here; trackId 1 must win outright, unblended.
        // A's presence should have zero effect on the result - the higher
        // track wins outright rather than crossfading with the lower one.
        expect(calculateCameraPosition(t, stacked, dimensions)).toEqual(calculateCameraPosition(t, bOnly, dimensions));
    });
});

describe('interpolateCamera', () => {
    it('returns the target directly when there is no current camera', () => {
        const target = { srcX: 10, srcY: 20, srcW: 100, srcH: 100, zoom: 2 };
        expect(interpolateCamera(null, target)).toEqual(target);
    });

    it('moves partway from current to target by the given factor', () => {
        const current = { srcX: 0, srcY: 0, srcW: 1000, srcH: 1000, zoom: 1 };
        const target = { srcX: 100, srcY: 100, srcW: 500, srcH: 500, zoom: 2 };
        const result = interpolateCamera(current, target, 0.5);
        expect(result.srcX).toBeCloseTo(50);
        expect(result.zoom).toBeCloseTo(1.5);
    });

    it('snaps directly to the target when the factor is 1', () => {
        const current = { srcX: 0, srcY: 0, srcW: 1000, srcH: 1000, zoom: 1 };
        const target = { srcX: 100, srcY: 100, srcW: 500, srcH: 500, zoom: 2 };
        expect(interpolateCamera(current, target, 1.0)).toEqual(target);
    });
});

describe('interpolateCameraByTime', () => {
    const current = { srcX: 0, srcY: 0, srcW: 1000, srcH: 1000, zoom: 1 };
    const target = { srcX: 100, srcY: 100, srcW: 500, srcH: 500, zoom: 2 };

    it('returns the target directly when there is no current camera', () => {
        expect(interpolateCameraByTime(null, target, 16.7)).toEqual(target);
    });

    it('moves partway from current to target, converging further with a longer dt', () => {
        const small = interpolateCameraByTime(current, target, 16.7); // ~60fps frame
        const large = interpolateCameraByTime(current, target, 200);
        expect(small.srcX).toBeGreaterThan(0);
        expect(small.srcX).toBeLessThan(large.srcX);
        expect(large.srcX).toBeLessThan(target.srcX);
    });

    it('produces the same camera position for the same elapsed time regardless of how many steps it took', () => {
        // 60fps preview stepping twice (2 * 16.7ms) should land close to a
        // single 30fps export step of 33.3ms - this is the frame-rate
        // independence that keeps preview and export motion in sync.
        let twoSteps = interpolateCameraByTime(current, target, 16.7);
        twoSteps = interpolateCameraByTime(twoSteps, target, 16.7);
        const oneStep = interpolateCameraByTime(current, target, 33.4);
        expect(twoSteps.srcX).toBeCloseTo(oneStep.srcX, 1);
    });

    it('treats a non-positive or non-finite dt as an instant snap', () => {
        expect(interpolateCameraByTime(current, target, 0)).toEqual(target);
        expect(interpolateCameraByTime(current, target, NaN)).toEqual(target);
    });
});

describe('smoothCursorPosition', () => {
    it('returns null for an empty path', () => {
        expect(smoothCursorPosition(1000, [])).toBeNull();
    });

    it('returns the single sample unchanged when there is only one point', () => {
        const path = [{ time: 500, x: 0.3, y: 0.7 }];
        expect(smoothCursorPosition(1000, path)).toBe(path[0]);
    });

    it('clamps to the first sample before the path starts', () => {
        const path = [{ time: 500, x: 0.3, y: 0.7 }, { time: 1000, x: 0.5, y: 0.5 }];
        expect(smoothCursorPosition(0, path)).toBe(path[0]);
    });

    it('clamps to the last sample after the path ends', () => {
        const path = [{ time: 500, x: 0.3, y: 0.7 }, { time: 1000, x: 0.5, y: 0.5 }];
        expect(smoothCursorPosition(5000, path)).toBe(path[1]);
    });

    it('passes exactly through each control point at its own timestamp', () => {
        // Catmull-Rom splines interpolate (pass through) every control point —
        // only the tangents between them are shaped by neighboring points.
        const path = [
            { time: 0, x: 0.1, y: 0.1 },
            { time: 100, x: 0.4, y: 0.2 },
            { time: 200, x: 0.5, y: 0.6 },
            { time: 300, x: 0.9, y: 0.8 },
        ];
        const atP1 = smoothCursorPosition(100, path);
        expect(atP1.x).toBeCloseTo(0.4);
        expect(atP1.y).toBeCloseTo(0.2);

        const atP2 = smoothCursorPosition(200, path);
        expect(atP2.x).toBeCloseTo(0.5);
        expect(atP2.y).toBeCloseTo(0.6);
    });

    it('smooths a jittery midpoint instead of jumping straight to it', () => {
        // A path that moves steadily right, except one sample jitters far off
        // the line. The smoothed midpoint should pull toward the jitter (it's
        // real data) but not overshoot wildly outside the surrounding points'
        // bounding range the way a naive spline with a sharp corner might.
        const path = [
            { time: 0, x: 0.0, y: 0.5 },
            { time: 100, x: 0.3, y: 0.5 },
            { time: 200, x: 0.6, y: 0.9 }, // jitter spike
            { time: 300, x: 0.9, y: 0.5 },
        ];
        const mid = smoothCursorPosition(150, path);
        expect(mid.x).toBeGreaterThan(0.3);
        expect(mid.x).toBeLessThan(0.6);
        // Stays in a sane range — no spline blow-up outside the surrounding points.
        expect(mid.y).toBeGreaterThan(0);
        expect(mid.y).toBeLessThan(1.5);
    });

    it('handles a path with no trailing point by duplicating the last one', () => {
        const path = [
            { time: 0, x: 0, y: 0 },
            { time: 100, x: 1, y: 1 },
        ];
        // Only 2 points total: the segment between them still resolves cleanly
        // (p0 falls back to p1, p3 falls back to p2).
        const result = smoothCursorPosition(50, path);
        expect(Number.isFinite(result.x)).toBe(true);
        expect(Number.isFinite(result.y)).toBe(true);
    });
});
