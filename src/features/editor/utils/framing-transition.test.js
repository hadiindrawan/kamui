import { createFramingAnimator, TRANSITION_CONFIG, NUMERIC_FIELDS } from './framing-transition.js';

const ZOOM = TRANSITION_CONFIG.zoom.durationMs;
const PAN = TRANSITION_CONFIG.cropPan.durationMs;

describe('createFramingAnimator', () => {
    it('seeds displayed values and is idle until something changes', () => {
        const a = createFramingAnimator({ cropZoom: 1, cropPanX: 0.5, cropPanY: 0.5, insetPadding: 40, zoomLevel: 2 });
        expect(a.isActive()).toBe(false);
        const { settings } = a.sample(0);
        expect(settings.cropZoom).toBe(1);
        expect(settings.cropPanX).toBe(0.5);
        expect(a.isActive()).toBe(false);
    });

    it('fills missing initial fields with sane defaults (never NaN)', () => {
        const a = createFramingAnimator({});
        const { settings } = a.sample(0);
        for (const f of NUMERIC_FIELDS) expect(Number.isFinite(settings[f])).toBe(true);
    });

    it('eases a changed field from start to target and then goes idle', () => {
        const a = createFramingAnimator({ cropZoom: 1 });
        a.setTarget({ cropZoom: 2 }, 0);
        expect(a.isActive()).toBe(true);

        const mid = a.sample(ZOOM / 2).settings.cropZoom;
        expect(mid).toBeGreaterThan(1);
        expect(mid).toBeLessThan(2);

        const end = a.sample(ZOOM + 16).settings.cropZoom;
        expect(end).toBe(2);
        expect(a.isActive()).toBe(false);
    });

    it('runs zoom and crop channels on independent timelines', () => {
        const a = createFramingAnimator({ cropZoom: 1, cropPanX: 0 });
        // Change both at once; zoom (shorter) should finish before pan (longer).
        a.setTarget({ cropZoom: 2, cropPanX: 1 }, 0);

        // Sample just past the zoom duration but before the pan duration.
        const t = ZOOM + 1;
        expect(t).toBeLessThan(PAN); // guards the premise if configs are retuned
        const s = a.sample(t).settings;

        expect(s.cropZoom).toBe(2);          // zoom channel settled
        expect(s.cropPanX).toBeGreaterThan(0);
        expect(s.cropPanX).toBeLessThan(1);  // crop channel still moving
        expect(a.isActive()).toBe(true);     // because the pan is unfinished
    });

    it('reseeds from the live animated value on a mid-flight retarget (no jump)', () => {
        const a = createFramingAnimator({ cropZoom: 1 });
        a.setTarget({ cropZoom: 2 }, 0);
        const midway = a.sample(ZOOM / 2).settings.cropZoom; // partway 1 -> 2

        // Reverse course at the same instant; the value must not jump.
        a.setTarget({ cropZoom: 1 }, ZOOM / 2);
        const afterRetarget = a.sample(ZOOM / 2).settings.cropZoom;
        expect(afterRetarget).toBeCloseTo(midway, 5);

        // And it now heads back toward 1.
        const later = a.sample(ZOOM / 2 + ZOOM).settings.cropZoom;
        expect(later).toBe(1);
    });

    it('clamps progress: never overshoots past the target', () => {
        const a = createFramingAnimator({ insetPadding: 0 });
        a.setTarget({ insetPadding: 100 }, 0);
        const way = a.sample(1_000_000).settings.insetPadding;
        expect(way).toBe(100);
    });

    it('does not start a tween when the target equals the current value', () => {
        const a = createFramingAnimator({ cropZoom: 1.5 });
        a.setTarget({ cropZoom: 1.5 }, 0);
        expect(a.isActive()).toBe(false);
    });

    it('ignores undefined fields in a partial target', () => {
        const a = createFramingAnimator({ cropZoom: 1, cropPanX: 0.5 });
        a.setTarget({ cropZoom: 2 }, 0); // cropPanX omitted
        const s = a.sample(ZOOM + 16).settings;
        expect(s.cropZoom).toBe(2);
        expect(s.cropPanX).toBe(0.5); // untouched
    });
});
