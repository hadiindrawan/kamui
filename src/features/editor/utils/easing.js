/**
 * Shared easing curves for the editor's motion. Previously each module carried
 * its own private copy (camera.js had easeInOutQuart/easeOutCubic,
 * coordinates.js had easeInOutCubic), which meant a curve tweak in one place
 * silently diverged from the others. Keep every tween pulling from here.
 *
 * All functions take a normalized progress `t` (expected 0-1) and return the
 * eased progress. Callers should clamp `t` themselves if the input can stray
 * outside [0, 1].
 */

export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutQuart(t) {
    return t < 0.5
        ? 8 * t * t * t * t
        : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/**
 * Builds an easing function from a CSS-style cubic-bezier control polygon
 * (P0 = (0,0), P3 = (1,1) fixed). Returns f(t) where t is the timeline
 * progress and the result is the eased value. Solves the parametric bezier's
 * x(s) = t for s with a few Newton-Raphson steps (falling back to bisection),
 * then evaluates y(s). Handy when a named curve above doesn't capture the
 * feel we want and we'd rather express it the way designers do.
 */
export function cubicBezier(p1x, p1y, p2x, p2y) {
    const bez = (a, b, u) => {
        // Cubic bezier component with the two fixed endpoints at 0 and 1.
        const c = 3 * a;
        const bb = 3 * (b - a) - c;
        const aa = 1 - c - bb;
        return ((aa * u + bb) * u + c) * u;
    };
    const bezDeriv = (a, b, u) => {
        const c = 3 * a;
        const bb = 3 * (b - a) - c;
        const aa = 1 - c - bb;
        return (3 * aa * u + 2 * bb) * u + c;
    };

    return (t) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        let u = t;
        for (let i = 0; i < 5; i++) {
            const x = bez(p1x, p2x, u) - t;
            if (Math.abs(x) < 1e-5) break;
            const dx = bezDeriv(p1x, p2x, u);
            if (Math.abs(dx) < 1e-6) break;
            u -= x / dx;
        }
        // Clamp the solved parameter, then read the y curve.
        u = Math.max(0, Math.min(1, u));
        return bez(p1y, p2y, u);
    };
}
