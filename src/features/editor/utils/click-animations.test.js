import {
    CLICK_ANIMATION_STYLES,
    CLICK_ANIMATION_DURATIONS,
    CLICK_OPACITY_LEVELS,
    MIN_CLICK_GAP_MS,
    opacityAlpha,
    filterRapidClicks,
    drawClickAnimations,
} from './click-animations.js';

// Minimal 2D-context spy: counts draw ops so tests can assert whether a style
// painted anything, without needing a real canvas.
function makeCtxSpy() {
    let drawOps = 0;
    const ctx = {
        save() {}, restore() {},
        beginPath() {}, moveTo() {}, lineTo() {},
        arc() { drawOps++; },
        fill() {}, stroke() {},
        createRadialGradient() { return { addColorStop() {} }; },
        set fillStyle(_) {}, get fillStyle() { return ''; },
        set strokeStyle(_) {}, get strokeStyle() { return ''; },
        set lineWidth(_) {}, get lineWidth() { return 0; },
        set shadowColor(_) {}, get shadowColor() { return ''; },
        set shadowBlur(_) {}, get shadowBlur() { return 0; },
    };
    return { ctx, drawCount: () => drawOps };
}

describe('click animation registry', () => {
    it('offers exactly the six documented styles', () => {
        expect(CLICK_ANIMATION_STYLES.map((s) => s.value)).toEqual([
            'orb', 'press', 'ripple', 'glow', 'pulse', 'splash',
        ]);
    });

    it('every style has a lifetime in the 300-500ms band', () => {
        for (const { value } of CLICK_ANIMATION_STYLES) {
            const duration = CLICK_ANIMATION_DURATIONS[value];
            expect(duration).toBeGreaterThanOrEqual(300);
            expect(duration).toBeLessThanOrEqual(500);
        }
    });

    it('maps opacity levels to increasing alpha, defaulting unknown to med', () => {
        const [low, med, high] = CLICK_OPACITY_LEVELS.map((l) => l.alpha);
        expect(low).toBeLessThan(med);
        expect(med).toBeLessThan(high);
        expect(opacityAlpha('low')).toBe(low);
        expect(opacityAlpha('nonsense')).toBe(opacityAlpha('med'));
    });
});

describe('filterRapidClicks', () => {
    it('drops clicks closer than the rate-limit gap, keeping the first of a burst', () => {
        const events = [
            { time: 0 }, { time: 100 }, { time: 200 },   // burst -> keep only t=0
            { time: 300 },                                // 300ms after t=0 -> kept
            { time: 549 },                                // 249ms after t=300 -> dropped
            { time: 560 },                                // 260ms after t=300 -> kept
        ];
        expect(filterRapidClicks(events).map((e) => e.time)).toEqual([0, 300, 560]);
    });

    it('caps throughput at ~4 animations per second', () => {
        const spam = Array.from({ length: 50 }, (_, i) => ({ time: i * 20 })); // 50 clicks in 1s
        expect(filterRapidClicks(spam).length).toBeLessThanOrEqual(4);
    });

    it('sorts unordered input and respects a custom gap', () => {
        const events = [{ time: 500 }, { time: 0 }, { time: 400 }];
        expect(filterRapidClicks(events, 450).map((e) => e.time)).toEqual([0, 500]);
    });

    it('handles empty input', () => {
        expect(filterRapidClicks([])).toEqual([]);
    });
});

describe('drawClickAnimations', () => {
    const clickAt = (timeMs) => [{ time: timeMs, x: 0.5, y: 0.5, type: 'click' }];

    it.each(CLICK_ANIMATION_STYLES.map((s) => s.value))(
        '%s renders mid-animation without throwing',
        (style) => {
            const { ctx, drawCount } = makeCtxSpy();
            const midpoint = CLICK_ANIMATION_DURATIONS[style] / 2;
            drawClickAnimations(ctx, midpoint, clickAt(0), 1920, 1080, { style, opacity: 'high' });
            expect(drawCount()).toBeGreaterThan(0);
        }
    );

    it('draws nothing before the click or after the style duration', () => {
        const { ctx, drawCount } = makeCtxSpy();
        drawClickAnimations(ctx, 100, clickAt(200), 1920, 1080, { style: 'orb' });
        drawClickAnimations(ctx, 200 + CLICK_ANIMATION_DURATIONS.orb + 1, clickAt(200), 1920, 1080, { style: 'orb' });
        expect(drawCount()).toBe(0);
    });

    it('falls back to ripple for an unknown style', () => {
        const { ctx, drawCount } = makeCtxSpy();
        drawClickAnimations(ctx, 250, clickAt(0), 1920, 1080, { style: 'does-not-exist' });
        expect(drawCount()).toBeGreaterThan(0);
    });

    it('positions the effect from scene-normalized coordinates', () => {
        const arcs = [];
        const { ctx } = makeCtxSpy();
        ctx.arc = (x, y) => arcs.push([x, y]);
        drawClickAnimations(ctx, 150, [{ time: 0, x: 0.25, y: 0.75 }], 1000, 800, { style: 'pulse' });
        expect(arcs.length).toBeGreaterThan(0);
        for (const [x, y] of arcs) {
            expect(x).toBeCloseTo(250, 5);
            expect(y).toBeCloseTo(600, 5);
        }
    });

    it('exposes the documented 250ms dedupe window', () => {
        expect(MIN_CLICK_GAP_MS).toBe(250);
    });
});
