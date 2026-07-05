/**
 * Shared scene compositor used by BOTH the live editor preview
 * (CanvasPlayer) and the MP4/WebM exporter (export.js). Previously each had
 * its own copy of the layout + draw logic, which drifted apart — the exporter
 * delegated cropping to mediabunny's `crop`/`fit` options while the preview
 * composed everything itself, so crop + zoom combinations stretched only in
 * the exported file. Keeping a single `drawSceneFrame` guarantees the export
 * is a pixel-faithful reproduction of the preview.
 *
 * Coordinate spaces (see coordinates.js header):
 *   - `frameSource` is always drawn from *source pixels* (sx/sy/sW/sH) into
 *     *scene pixels* (vX/vY/vW/vH). Callers must pass a raw, full-resolution
 *     drawable (a <video> element, or a canvas holding the un-resized frame),
 *     never a pre-cropped one.
 *   - The camera is a sub-rect of the *scene* and is applied as a single
 *     ctx.scale/translate around the whole composite.
 */

import { computeSceneLayout, mapVideoPointToScene } from './coordinates.js';

const BLUR_AMOUNTS = { none: 0, light: 4, moderate: 12, strong: 24 };
// Lavender accent (matches the Linear redesign) used for cursor + click FX.
const ACCENT_RGB = '94, 105, 209';

/**
 * Basic parser for the CSS-string gradients the UI stores as presets, e.g.
 * `linear-gradient(135deg, #a, #b)`. Shared so the exporter renders the same
 * gradient the preview shows (the old export path only understood arrays).
 */
export function parseCSSGradient(cssString, ctx, width, height) {
    if (!cssString || typeof cssString !== 'string' || !cssString.includes('gradient')) {
        return cssString;
    }
    try {
        const colors = cssString.match(/#[a-fA-F0-9]{3,6}|rgba?\([^)]+\)/g);
        if (!colors || colors.length < 2) return '#000';

        let x0 = 0, y0 = 0, x1 = 0, y1 = height; // default: top -> bottom
        if (cssString.includes('to right')) {
            x1 = width; y1 = 0;
        } else if (cssString.includes('to top')) {
            y0 = height; y1 = 0;
        } else if (cssString.includes('135deg')) {
            x1 = width; y1 = height;
        } else if (cssString.includes('120deg')) {
            x1 = width * 0.8; y1 = height;
        }

        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        colors.forEach((color, i) => grad.addColorStop(i / (colors.length - 1), color));
        return grad;
    } catch (e) {
        console.warn('Failed to parse gradient:', e);
        return '#000';
    }
}

/**
 * Builds the render model shared by preview and export: the scene layout, the
 * segment/cursor events remapped into scene-normalized space, and the camera
 * config. `settings` carries the framing/background/zoom fields.
 */
export function buildSceneModel({ videoWidth, videoHeight, settings, segments = [], recordingEvents = [] }) {
    const base = computeSceneLayout({
        videoWidth,
        videoHeight,
        aspectRatio: settings.aspectRatio,
        backgroundMode: settings.backgroundMode,
        insetPadding: settings.insetPadding,
        cropToFill: settings.cropToFill,
        cropPanX: settings.cropPanX,
        cropPanY: settings.cropPanY,
        cropZoom: settings.cropZoom,
    });
    const layout = { ...base, videoW: videoWidth, videoH: videoHeight };

    const events = segments.map(seg => {
        const { x, y } = mapVideoPointToScene(seg.x, seg.y, layout);
        // Keyframes (sustained-zoom pan path) must be mapped into the same scene
        // space so the camera evaluates them consistently with the anchor.
        let keyframes = seg.keyframes;
        if (keyframes && keyframes.length) {
            keyframes = keyframes.map(kf => {
                const p = mapVideoPointToScene(kf.x, kf.y, layout);
                return { ...kf, x: p.x, y: p.y };
            });
        }
        return { ...seg, time: seg.startTime, type: seg.type || 'click', x, y, keyframes };
    });

    if (settings.showFollowCursor && recordingEvents) {
        for (const e of recordingEvents) {
            if (e.type !== 'follow' && e.type !== 'move') continue;
            const { x, y } = mapVideoPointToScene(e.x, e.y, layout);
            events.push({ ...e, x, y });
        }
    }

    return {
        layout,
        events,
        cameraConfig: {
            videoWidth: layout.width,
            videoHeight: layout.height,
            canvasWidth: layout.width,
            canvasHeight: layout.height,
            zoomLevel: settings.zoomLevel,
            zoomDuration: settings.zoomDuration,
            transitionDuration: settings.transitionDuration,
        },
    };
}

/**
 * Renders the (blurred) background for a layout into `buffer` once, so the
 * per-frame path only has to blit it. Mirrors the live preview's background.
 */
export function renderBackgroundBuffer(buffer, layout, settings, backgroundImage) {
    const { width, height } = layout;
    if (buffer.width !== width || buffer.height !== height) {
        buffer.width = width;
        buffer.height = height;
    }
    const bctx = buffer.getContext('2d');
    const blurAmount = BLUR_AMOUNTS[settings.backgroundBlur] || 0;
    const mode = settings.backgroundMode;

    bctx.clearRect(0, 0, width, height);
    if (blurAmount > 0) bctx.filter = `blur(${blurAmount}px)`;

    if (mode === 'color' || mode === 'hidden') {
        bctx.fillStyle = mode === 'hidden'
            ? (settings.backgroundColor || '#1a2e3b')
            : (settings.backgroundColor || settings.backgroundValue || '#1a2e3b');
        bctx.fillRect(0, 0, width, height);
    } else if (mode === 'gradient') {
        bctx.fillStyle = parseCSSGradient(settings.backgroundValue, bctx, width, height);
        bctx.fillRect(0, 0, width, height);
    } else if (mode === 'image' && backgroundImage) {
        const img = backgroundImage;
        const imgRatio = img.width / img.height;
        const canvasRatio = width / height;
        let dW = width, dH = height, dX = 0, dY = 0;
        if (canvasRatio > imgRatio) {
            dH = width / imgRatio;
            dY = (height - dH) / 2;
        } else {
            dW = height * imgRatio;
            dX = (width - dW) / 2;
        }
        bctx.drawImage(img, dX, dY, dW, dH);
    } else if (mode === 'image') {
        bctx.fillStyle = '#222';
        bctx.fillRect(0, 0, width, height);
    }
    bctx.filter = 'none';
    return buffer;
}

/**
 * Draws one composited frame. `layout` may be an interpolated layout (during
 * an aspect-ratio transition) distinct from `model.layout`; `events` default
 * to the model's. The compositing order is identical to the live preview:
 * camera transform -> background -> shadow -> clipped video -> border ->
 * overlays.
 */
export function drawSceneFrame(ctx, frameSource, timeMs, model, opts = {}) {
    const layout = opts.layout || model.layout;
    const events = opts.events || model.events;
    const {
        camera,
        backgroundBuffer,
        showShadow = false,
        showBorder = false,
        borderRadius = 0,
        backgroundMode = 'hidden',
        showCursorHighlight = false,
        showClickAnimations = true,
        cursorScale = 1,
    } = opts;

    const { width, height, vX, vY, vW, vH, sx, sy, sW, sH } = layout;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Single camera transform around the whole composite (scene space).
    ctx.scale(width / camera.srcW, height / camera.srcH);
    ctx.translate(-camera.srcX, -camera.srcY);

    // Stretch to the (possibly interpolated) layout size: during an aspect
    // transition the buffer is still at the target size, so this eases it too.
    if (backgroundBuffer) ctx.drawImage(backgroundBuffer, 0, 0, width, height);

    const vRadius = Math.max(0, borderRadius * (vW / sW));

    if (backgroundMode !== 'hidden' && showShadow) {
        ctx.save();
        ctx.fillStyle = 'black';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 20;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(vX, vY, vW, vH, vRadius);
            ctx.fill();
        } else {
            ctx.fillRect(vX, vY, vW, vH);
        }
        ctx.restore();
    }

    ctx.save();
    if (vRadius > 0 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(vX, vY, vW, vH, vRadius);
        ctx.clip();
    }
    // Draw the raw source frame: source sub-rect (sx/sy/sW/sH) -> scene rect.
    ctx.drawImage(frameSource, sx, sy, sW, sH, vX, vY, vW, vH);
    ctx.restore();

    if (backgroundMode !== 'hidden' && showBorder) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(vX, vY, vW, vH, vRadius);
            ctx.stroke();
        } else {
            ctx.strokeRect(vX, vY, vW, vH);
        }
    }

    drawSceneOverlays(ctx, timeMs, events, width, height, { showCursorHighlight, showClickAnimations, cursorScale });

    ctx.restore();
}

/**
 * Click ripples (+ optional cursor highlight), drawn inside the camera
 * transform so they track the zoomed frame. Stateless — derived purely from
 * events + time, so preview and export produce identical FX.
 */
export function drawSceneOverlays(ctx, timeMs, events, sceneW, sceneH, opts = {}) {
    const { showCursorHighlight = false, showClickAnimations = true, cursorScale = 1 } = opts;

    if (showClickAnimations) {
        for (const event of events) {
            if (event.type !== 'click' && event.type !== 'dblclick') continue;
            const elapsed = timeMs - event.time;
            if (elapsed < 0 || elapsed > 600) continue;

            const progress = elapsed / 600;
            const cx = event.x * sceneW;
            const cy = event.y * sceneH;

            for (let ring = 0; ring < 3; ring++) {
                const ringProgress = Math.min(1, (progress - ring * 0.1) / 0.7);
                if (ringProgress <= 0) continue;
                const radius = (8 + ringProgress * 40) * cursorScale;
                const alpha = (1 - ringProgress) * 0.6;
                ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${alpha})`;
                ctx.lineWidth = 2 - ringProgress;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    if (showCursorHighlight) {
        let cursorEvent = null;
        for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].time <= timeMs) { cursorEvent = events[i]; break; }
        }
        if (!cursorEvent && events.length) cursorEvent = events[0];
        if (cursorEvent) {
            const cx = cursorEvent.x * sceneW;
            const cy = cursorEvent.y * sceneH;
            const r = 12 * cursorScale;
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            gradient.addColorStop(0, `rgba(${ACCENT_RGB}, 1)`);
            gradient.addColorStop(0.5, `rgba(${ACCENT_RGB}, 0.6)`);
            gradient.addColorStop(1, `rgba(${ACCENT_RGB}, 0)`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(cx, cy, 3 * cursorScale, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
