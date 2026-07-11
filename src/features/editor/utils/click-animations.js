/**
 * Click animation styles drawn on the scene canvas (live preview AND export —
 * see scene-renderer.js). Every renderer is a pure function of
 * (progress, position, size, alpha): no per-frame state, no randomness that
 * isn't derived deterministically from the inputs. That property is what
 * guarantees the exported video reproduces the preview exactly, frame for
 * frame, at any fps.
 *
 * Coordinates are scene pixels (the same space drawSceneOverlays draws in,
 * inside the camera transform, so animations track the zoomed frame).
 */

// Lavender accent (matches the Linear redesign) used for cursor + click FX.
export const ACCENT_RGB = '94, 105, 209';

const BASE_RADIUS = 14;
const TWO_PI = Math.PI * 2;

export const CLICK_ANIMATION_STYLES = [
    { value: 'orb', label: 'Orb' },
    { value: 'press', label: 'Press' },
    { value: 'ripple', label: 'Ripple' },
    { value: 'glow', label: 'Glow' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'splash', label: 'Splash' },
];

// Visual intensity presets. `alpha` multiplies every stroke/fill the style draws.
export const CLICK_OPACITY_LEVELS = [
    { value: 'low', label: 'Low', alpha: 0.35 },
    { value: 'med', label: 'Med', alpha: 0.65 },
    { value: 'high', label: 'High', alpha: 1 },
];

// Per-style lifetime in ms (spec: 300-500ms, style-dependent).
export const CLICK_ANIMATION_DURATIONS = {
    orb: 400,
    press: 300,
    ripple: 500,
    glow: 400,
    pulse: 450,
    splash: 500,
};

// Rapid-click rate limit: at most one animation per 250ms window (~4/sec).
export const MIN_CLICK_GAP_MS = 250;

export function opacityAlpha(level) {
    const found = CLICK_OPACITY_LEVELS.find((l) => l.value === level);
    return found ? found.alpha : 0.65;
}

/**
 * Deduplicates rapid clicks: keeps the first click of any burst and drops
 * followers closer than `minGapMs`. Applied once when the scene model is
 * built, so the preview render loop, the exporter, and the preview sound
 * trigger all see the same filtered list.
 */
export function filterRapidClicks(events, minGapMs = MIN_CLICK_GAP_MS) {
    const sorted = [...events].sort((a, b) => (a.time || 0) - (b.time || 0));
    const kept = [];
    let lastTime = -Infinity;
    for (const event of sorted) {
        const t = event.time || 0;
        if (t - lastTime >= minGapMs) {
            kept.push(event);
            lastTime = t;
        }
    }
    return kept;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const accent = (a) => `rgba(${ACCENT_RGB}, ${Math.max(0, Math.min(1, a))})`;

// --- Style renderers -------------------------------------------------------
// Signature: (ctx, cx, cy, t, r, alpha) where t is 0..1 progress over the
// style's duration, r the base radius (already cursor-scaled), alpha the
// opacity-level multiplier.

// Glowing sphere at the cursor that swells slightly and fades out.
function drawOrb(ctx, cx, cy, t, r, alpha) {
    const fade = (1 - t) * alpha;
    const radius = r * (1 + easeOutCubic(t) * 0.5);
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.8);
    halo.addColorStop(0, accent(fade));
    halo.addColorStop(0.55, accent(fade * 0.45));
    halo.addColorStop(1, accent(0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.8, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${fade * 0.9})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.25, 0, TWO_PI);
    ctx.fill();
}

// Button-press indent: a disc that dips inward then springs back.
function drawPress(ctx, cx, cy, t, r, alpha) {
    const fade = (1 - t) * alpha;
    const dip = Math.sin(Math.PI * t); // 0 -> 1 -> 0: pressed at midpoint
    const radius = r * (1 - 0.35 * dip);
    ctx.fillStyle = accent(fade * 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.fill();
    // Static outer rim the disc sinks away from — sells the indent.
    ctx.strokeStyle = accent(fade * 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.15, 0, TWO_PI);
    ctx.stroke();
}

// Concentric circles expanding outward (the classic, previously hardcoded).
function drawRipple(ctx, cx, cy, t, r, alpha) {
    for (let ring = 0; ring < 3; ring++) {
        const ringProgress = Math.min(1, (t - ring * 0.1) / 0.7);
        if (ringProgress <= 0) continue;
        const radius = (r * 0.6) + ringProgress * r * 2.8;
        ctx.strokeStyle = accent((1 - ringProgress) * 0.6 * alpha);
        ctx.lineWidth = 2 - ringProgress;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TWO_PI);
        ctx.stroke();
    }
}

// Radiant light burst: an expanding soft flare with short rays.
function drawGlow(ctx, cx, cy, t, r, alpha) {
    const fade = (1 - t) * alpha;
    const spread = easeOutCubic(t);
    const radius = r * (0.8 + spread * 2.7);
    const flare = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    flare.addColorStop(0, `rgba(255, 255, 255, ${fade * 0.7})`);
    flare.addColorStop(0.3, accent(fade * 0.8));
    flare.addColorStop(1, accent(0));
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = accent(fade * 0.7);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * TWO_PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * radius * 0.55, cy + Math.sin(angle) * radius * 0.55);
        ctx.lineTo(cx + Math.cos(angle) * radius * 0.95, cy + Math.sin(angle) * radius * 0.95);
        ctx.stroke();
    }
}

// Pulsing circle whose oscillation amplitude decays to rest.
function drawPulse(ctx, cx, cy, t, r, alpha) {
    const fade = (1 - t) * alpha;
    const radius = r * (1.2 + 0.35 * Math.sin(t * Math.PI * 3) * (1 - t));
    ctx.fillStyle = accent(fade * 0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = accent(fade * 0.9);
    ctx.lineWidth = 1 + 2 * (1 - t);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.stroke();
}

// Particle splash dispersing outward; jitter is derived from the particle
// index (not Math.random) so preview and export disperse identically.
function drawSplash(ctx, cx, cy, t, r, alpha) {
    const fade = (1 - t) * alpha;
    const travel = easeOutCubic(t) * r * 3;
    const count = 8;
    ctx.fillStyle = accent(fade);
    for (let i = 0; i < count; i++) {
        const jitter = Math.sin(i * 12.9898) * 0.35;
        const angle = (i / count) * TWO_PI + jitter;
        const dist = travel * (0.8 + 0.2 * Math.cos(i * 4.1));
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        const size = Math.max(0.5, r * 0.22 * (1 - t));
        ctx.beginPath();
        ctx.arc(px, py, size, 0, TWO_PI);
        ctx.fill();
    }
    ctx.strokeStyle = accent(fade * 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, travel * 0.4 + r * 0.3, 0, TWO_PI);
    ctx.stroke();
}

const RENDERERS = {
    orb: drawOrb,
    press: drawPress,
    ripple: drawRipple,
    glow: drawGlow,
    pulse: drawPulse,
    splash: drawSplash,
};

/**
 * Draws every click event whose animation window covers `timeMs`. Events must
 * carry scene-normalized x/y (0..1) and `time` in ms; call inside the camera
 * transform so the FX track the zoomed frame.
 */
export function drawClickAnimations(ctx, timeMs, clickEvents, sceneW, sceneH, opts = {}) {
    const { style = 'ripple', opacity = 'med', cursorScale = 1 } = opts;
    const renderer = RENDERERS[style] || RENDERERS.ripple;
    const duration = CLICK_ANIMATION_DURATIONS[style] || 400;
    const alpha = opacityAlpha(opacity);
    const r = BASE_RADIUS * cursorScale;

    for (const event of clickEvents) {
        const elapsed = timeMs - event.time;
        if (elapsed < 0 || elapsed > duration) continue;
        renderer(ctx, event.x * sceneW, event.y * sceneH, elapsed / duration, r, alpha);
    }
}
