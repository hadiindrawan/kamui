/**
 * Framing-transition animator for the editor preview.
 *
 * The editor's framing settings (crop zoom, crop pan, padding, global zoom
 * level) used to snap instantly whenever they changed while paused — the only
 * eased path lived in CanvasPlayer and was gated on `isPlaying`. This module
 * owns the tweening for those *numeric* framing fields so a change eases
 * whether the video is paused or playing, with each field animating on its
 * own timeline (a quick zoom vs. a slower pan/padding settle).
 *
 * Scope: numeric fields only. Structural changes that alter the scene's pixel
 * geometry discretely (aspect ratio, crop-to-fill on/off) can't be lerped as a
 * value — CanvasPlayer crossfades whole layouts for those, reusing this
 * module's TRANSITION_CONFIG so the timing stays centralized here.
 *
 * The animator is pure and React-free (caller supplies the clock via `now`),
 * which keeps it unit-testable without a canvas or rAF.
 */

import { easeOutCubic, easeInOutCubic } from './easing.js';

/**
 * Per-context tuning. Keyed by *interaction context* rather than by field so a
 * quick zoom and a deliberate pan can feel different even though both are just
 * numbers. Durations in ms; `easing` maps normalized progress -> eased value.
 * `aspect` is consumed by CanvasPlayer for its structural layout crossfade.
 */
export const TRANSITION_CONFIG = {
    zoom: { durationMs: 250, easing: easeOutCubic }, // crop zoom + global zoom level — snappy
    cropPan: { durationMs: 320, easing: easeOutCubic }, // pan commit — responsive after a drag-drop
    aspect: { durationMs: 600, easing: easeInOutCubic }, // aspect ratio / crop-to-fill — structural
    padding: { durationMs: 400, easing: easeInOutCubic }, // inset padding
};

// Which context governs each numeric field.
const FIELD_CONTEXT = {
    cropZoom: 'zoom',
    zoomLevel: 'zoom',
    cropPanX: 'cropPan',
    cropPanY: 'cropPan',
    insetPadding: 'padding',
};

export const NUMERIC_FIELDS = Object.keys(FIELD_CONTEXT);

// Sensible fallbacks so a missing initial value never yields NaN mid-tween.
const DEFAULTS = { cropZoom: 1, zoomLevel: 2, cropPanX: 0.5, cropPanY: 0.5, insetPadding: 40 };

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Creates a numeric framing animator seeded with the current committed values
 * (so the first frame matches what's on screen and nothing animates until the
 * user changes something).
 *
 * API:
 *   setTarget(next, now) - retarget any provided fields; only changed fields
 *       (re)start a tween, each seeded from its *current animated* value so a
 *       change landing mid-flight continues seamlessly instead of snapping.
 *       A field whose context duration is 0 jumps immediately.
 *   sample(now) -> { settings } - advances the clocks and returns the current
 *       animated numeric settings for computeSceneLayout.
 *   isActive() -> boolean - true while any field is still animating.
 */
export function createFramingAnimator(initial = {}) {
    const displayed = {};
    for (const f of NUMERIC_FIELDS) displayed[f] = num(initial[f], DEFAULTS[f]);

    // field -> { from, to, startTs, durationMs, easing } | undefined
    const tweens = {};

    // Brings `displayed` up to date at `now`, retiring finished tweens.
    function advance(now) {
        for (const f of NUMERIC_FIELDS) {
            const tw = tweens[f];
            if (!tw) continue;
            if (tw.durationMs <= 0) {
                displayed[f] = tw.to;
                tweens[f] = undefined;
                continue;
            }
            const p = (now - tw.startTs) / tw.durationMs;
            if (p >= 1) {
                displayed[f] = tw.to;
                tweens[f] = undefined;
            } else if (p <= 0) {
                displayed[f] = tw.from;
            } else {
                displayed[f] = tw.from + (tw.to - tw.from) * tw.easing(p);
            }
        }
    }

    return {
        setTarget(next, now) {
            // Reseed from the live animated position, not the last target, so a
            // retarget mid-tween starts where the pixels actually are.
            advance(now);
            for (const f of NUMERIC_FIELDS) {
                if (next[f] === undefined) continue;
                const target = num(next[f], displayed[f]);
                if (target === displayed[f]) {
                    tweens[f] = undefined; // already there; cancel any stale tween
                    continue;
                }
                const ctx = TRANSITION_CONFIG[FIELD_CONTEXT[f]];
                if (ctx.durationMs <= 0) {
                    displayed[f] = target;
                    tweens[f] = undefined;
                    continue;
                }
                tweens[f] = {
                    from: displayed[f],
                    to: target,
                    startTs: now,
                    durationMs: ctx.durationMs,
                    easing: ctx.easing,
                };
            }
        },

        sample(now) {
            advance(now);
            return { settings: { ...displayed } };
        },

        isActive() {
            for (const f of NUMERIC_FIELDS) {
                if (tweens[f]) return true;
            }
            return false;
        },
    };
}
