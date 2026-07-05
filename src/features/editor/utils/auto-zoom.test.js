import { generateAutoZoomSegments, resolveIntensity, AUTO_ZOOM_INTENSITY } from './auto-zoom.js';

const opts = { zoomLevel: 2, idleReleaseMs: 2000, minHoldMs: 1000, retargetDistance: 0.18 };

describe('generateAutoZoomSegments', () => {
    it('merges two nearby clicks into a single sustained session', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.5, y: 0.5 },
            { type: 'click', time: 2000, x: 0.52, y: 0.51 },
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs).toHaveLength(1);
        // Session spans from the first click through the last + idle release.
        expect(segs[0].startTime).toBe(1000);
        expect(segs[0].duration).toBe((2000 + 2000) - 1000);
        expect(segs[0].source).toBe('auto');
        expect(segs[0].v).toBe(2);
    });

    it('splits into two sessions when the gap exceeds the idle release', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.5, y: 0.5 },
            { type: 'click', time: 10000, x: 0.5, y: 0.5 },
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs).toHaveLength(2);
    });

    it('adds a keyframe (pan) when a later event moves beyond the retarget distance', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.2, y: 0.2 },
            { type: 'click', time: 1500, x: 0.8, y: 0.8 }, // far -> pan
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs).toHaveLength(1);
        expect(segs[0].keyframes).toBeDefined();
        expect(segs[0].keyframes.length).toBe(2);
        expect(segs[0].keyframes[1]).toMatchObject({ x: 0.8, y: 0.8 });
    });

    it('does not add a keyframe when subsequent events stay near the anchor', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.5, y: 0.5 },
            { type: 'click', time: 1500, x: 0.51, y: 0.49 },
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs[0].keyframes).toBeUndefined();
    });

    it('collapses a typing burst into one input-focused session with a tighter zoom', () => {
        const events = [
            { type: 'typing', time: 1000, x: 0.4, y: 0.6 },
            { type: 'typing', time: 1300, x: 0.4, y: 0.6 },
            { type: 'typing', time: 1600, x: 0.4, y: 0.6 },
        ];
        const segs = generateAutoZoomSegments(events, { ...opts, typingZoomBoost: 0.5 });
        expect(segs).toHaveLength(1);
        expect(segs[0].zoomLevel).toBeCloseTo(2.5);
    });

    it('never opens a session from click-minor events alone', () => {
        const events = [
            { type: 'click-minor', time: 1000, x: 0.5, y: 0.5 },
            { type: 'click-minor', time: 1200, x: 0.5, y: 0.5 },
        ];
        expect(generateAutoZoomSegments(events, opts)).toHaveLength(0);
    });

    it('lets click-minor sustain an already-open session', () => {
        const events = [
            { type: 'click', time: 1000, x: 0.5, y: 0.5 },
            { type: 'click-minor', time: 2500, x: 0.5, y: 0.5 }, // within 2000ms of extended end
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs).toHaveLength(1);
        // Extended to the minor click + idle release.
        expect(segs[0].duration).toBe((2500 + 2000) - 1000);
    });

    it('ignores move events for session boundaries', () => {
        const events = [
            { type: 'move', time: 500, x: 0.1, y: 0.1 },
            { type: 'click', time: 1000, x: 0.5, y: 0.5 },
            { type: 'move', time: 1200, x: 0.6, y: 0.6 },
        ];
        const segs = generateAutoZoomSegments(events, opts);
        expect(segs).toHaveLength(1);
        expect(segs[0].startTime).toBe(1000);
    });
});

describe('resolveIntensity', () => {
    it('maps named intensities to presets', () => {
        expect(resolveIntensity('subtle')).toEqual(AUTO_ZOOM_INTENSITY.subtle);
        expect(resolveIntensity('strong')).toEqual(AUTO_ZOOM_INTENSITY.strong);
    });
    it('falls back to the provided zoom level for unknown intensities', () => {
        expect(resolveIntensity('bogus', 2.2)).toEqual({ zoomLevel: 2.2, idleReleaseMs: 2000 });
    });
});
