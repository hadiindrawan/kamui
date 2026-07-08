/**
 * Scene-layout math shared between CanvasPlayer (renders the scene) and the
 * zoom-target overlay (positions a drag box over the video within the
 * scene). Both must agree on "where the source video sits inside the
 * aspect-ratio canvas" or the overlay will visually drift from the
 * rendered frame — this used to be hand-duplicated in both places.
 */

import { easeInOutCubic } from './easing.js';

const ASPECT_RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };

/**
 * Fixed pixel dimensions for each social preset — matches what
 * YouTube/TikTok/Instagram actually expect. Deriving canvas size from the
 * source video's short side instead (the old approach) produced odd,
 * non-standard resolutions, e.g. reframing a 1920x1080 source to 9:16 gave
 * ~608x1080 instead of the expected 1080x1920.
 */
export const STANDARD_RESOLUTIONS = {
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
};

export function getAspectRatioValue(aspectRatio, fallback) {
    if (aspectRatio === 'Native') return fallback;
    return ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['16:9'];
}

/**
 * Computes the scene (aspect-ratio canvas) dimensions and where the source
 * video is placed within it.
 *
 * This happens in two independent steps:
 * 1. The "box" the video has to fit into: the full canvas when the
 *    background is hidden, or a padded inset box otherwise (so a background
 *    color/gradient/image can show around the video).
 * 2. How the video fits into that box: "contain" (letterboxed, the whole
 *    source video is visible) or, when cropToFill is set, "cover" (the box
 *    is filled edge-to-edge by cropping a sub-rect of the source, panned by
 *    cropPanX/cropPanY over whichever axis overflows). Cropping can be
 *    combined with any background mode - the background still shows in the
 *    padding around the (now cropped) video.
 *
 * The return always includes both a destination rect (vX/vY/vW/vH - where
 * on the scene canvas to draw) and a source rect (sx/sy/sW/sH - which part
 * of the source video to draw from). Contain fit always draws the whole
 * source video, so sx/sy/sW/sH default to the full video.
 */
export function computeSceneLayout({ videoWidth, videoHeight, aspectRatio, backgroundMode, insetPadding, cropToFill = false, cropPanX = 0.5, cropPanY = 0.5, cropZoom = 1 }) {
    const videoRatio = videoWidth / videoHeight;
    const targetRatio = getAspectRatioValue(aspectRatio, videoRatio);

    let width = videoWidth;
    let height = videoHeight;
    if (aspectRatio !== 'Native') {
        const standard = STANDARD_RESOLUTIONS[aspectRatio];
        if (standard) {
            width = standard.width;
            height = standard.height;
        } else if (targetRatio >= 1) {
            height = videoHeight;
            width = height * targetRatio;
        } else {
            width = videoHeight;
            height = width / targetRatio;
        }
    }
    width = Math.round(width);
    height = Math.round(height);

    // 1. The box the video fits into.
    let boxX = 0, boxY = 0, boxW = width, boxH = height;
    if (backgroundMode !== 'hidden') {
        const scaleBase = Math.min(width, height) / 1080;
        const scaledPadding = insetPadding * scaleBase;
        boxX = scaledPadding;
        boxY = scaledPadding;
        boxW = width - scaledPadding * 2;
        boxH = height - scaledPadding * 2;
    }
    const boxRatio = boxW / boxH;

    // 2. Fit the video into the box.
    let vX, vY, vW, vH;
    let sx = 0, sy = 0, sW = videoWidth, sH = videoHeight;

    if (cropToFill) {
        if (boxRatio > videoRatio) {
            sW = videoWidth;
            sH = videoWidth / boxRatio;
        } else {
            sH = videoHeight;
            sW = videoHeight * boxRatio;
        }
        // cropZoom (>=1) shrinks the sampled sub-rect further, zooming into the
        // source. Cover-fit alone leaves one axis with zero overflow (e.g. a
        // 16:9 source in a 9:16 frame only overflows horizontally), so vertical
        // panning is impossible; zooming in gives both axes room to pan.
        const z = Math.max(1, cropZoom || 1);
        sW = sW / z;
        sH = sH / z;
        sx = (videoWidth - sW) * cropPanX;
        sy = (videoHeight - sH) * cropPanY;
        vX = boxX;
        vY = boxY;
        vW = boxW;
        vH = boxH;
    } else {
        const fitScale = Math.min(boxW / videoWidth, boxH / videoHeight);
        vW = videoWidth * fitScale;
        vH = videoHeight * fitScale;
        vX = boxX + (boxW - vW) / 2;
        vY = boxY + (boxH - vH) / 2;
    }

    return { width, height, vX, vY, vW, vH, sx, sy, sW, sH };
}

/**
 * Maps a point given in source-video-normalized coordinates (0-1 over the
 * full, uncropped source video) to scene-normalized coordinates (0-1 over
 * the aspect-ratio canvas), given a layout from computeSceneLayout. Shared
 * so cursor/click overlays land in the same place in the live canvas and in
 * the exported video regardless of fit mode.
 */
export function mapVideoPointToScene(nx, ny, layout) {
    const { width, height, vX, vY, vW, vH, sx, sy, sW, sH, videoW, videoH } = layout;
    const px = nx * videoW;
    const py = ny * videoH;
    return {
        x: (vX + ((px - sx) / sW) * vW) / width,
        y: (vY + ((py - sy) / sH) * vH) / height,
    };
}

/**
 * When cropping: the (oversized) on-scene rect the full, uncropped source
 * video would occupy if drawn at cover-scale. The live render never draws
 * this directly (it draws the cropped sx/sy/sW/sH sub-rect instead), but the
 * crop-pan drag overlay needs it to size/position its draggable handle
 * relative to the visible box.
 */
export function computeCoverVideoRect(layout, videoWidth, videoHeight) {
    const { width, height, vX, vY, vW, sW, sx, sy } = layout;
    const scale = vW / sW;
    return {
        width, height,
        vX: vX - sx * scale,
        vY: vY - sy * scale,
        vW: videoWidth * scale,
        vH: videoHeight * scale,
    };
}

/**
 * Maps a point in source-video-normalized coordinates (0-1 over the full,
 * uncropped source) to frame-normalized coordinates (0-1 over the *visible*
 * cropped video area). Identity when not cropping (sx=0, sW=videoW). The
 * zoom-target overlay lives in this space so its handle sits over the pixels
 * actually shown on the aspect-ratio canvas, and can only be placed where the
 * camera can actually reach.
 */
export function mapVideoPointToFrame(nx, ny, layout) {
    const { sx, sy, sW, sH, videoW, videoH } = layout;
    return {
        x: (nx * videoW - sx) / sW,
        y: (ny * videoH - sy) / sH,
    };
}

/** Inverse of mapVideoPointToFrame: frame-normalized -> source-normalized. */
export function mapFramePointToVideo(fx, fy, layout) {
    const { sx, sy, sW, sH, videoW, videoH } = layout;
    return {
        x: (sx + fx * sW) / videoW,
        y: (sy + fy * sH) / videoH,
    };
}

/**
 * Frame-normalized size of the region the camera actually shows at a given
 * zoom level — i.e. what fraction of the visible video the zoom viewport
 * covers. Used to size the draggable zoom-target box so it visually matches
 * the rendered zoom.
 */
export function getZoomRegionFrameSize(layout, zoomLevel) {
    const z = Math.max(1, zoomLevel || 1);
    return {
        w: (layout.width / z) / layout.vW,
        h: (layout.height / z) / layout.vH,
    };
}

/**
 * Eased interpolation between two scene layouts (from computeSceneLayout),
 * for animating a framing/aspect-ratio change smoothly while the video plays
 * instead of snapping. Only the geometric fields are interpolated; videoW/H
 * come from the target since the source never changes mid-clip.
 */
export function interpolateSceneLayout(from, to, t) {
    if (!from) return to;
    const e = easeInOutCubic(Math.max(0, Math.min(1, t)));
    const mix = (a, b) => a + (b - a) * e;
    return {
        width: Math.round(mix(from.width, to.width)),
        height: Math.round(mix(from.height, to.height)),
        vX: mix(from.vX, to.vX),
        vY: mix(from.vY, to.vY),
        vW: mix(from.vW, to.vW),
        vH: mix(from.vH, to.vH),
        sx: mix(from.sx, to.sx),
        sy: mix(from.sy, to.sy),
        sW: mix(from.sW, to.sW),
        sH: mix(from.sH, to.sH),
        videoW: to.videoW,
        videoH: to.videoH,
    };
}

/**
 * Maps a scene-space rect (from computeSceneLayout) onto the visual
 * on-screen container rect, for overlays positioned in the DOM above the
 * canvas element rather than drawn onto it.
 */
export function mapSceneRectToContainer(sceneLayout, containerWidth, containerHeight) {
    const { width: sceneW, height: sceneH } = sceneLayout;
    const containerRatio = containerWidth / containerHeight;
    const sceneRatio = sceneW / sceneH;

    let visualW, visualH;
    if (containerRatio > sceneRatio) {
        visualH = containerHeight;
        visualW = visualH * sceneRatio;
    } else {
        visualW = containerWidth;
        visualH = visualW / sceneRatio;
    }

    const visualX = (containerWidth - visualW) / 2;
    const visualY = (containerHeight - visualH) / 2;

    return {
        x: visualX + (sceneLayout.vX / sceneW) * visualW,
        y: visualY + (sceneLayout.vY / sceneH) * visualH,
        width: (sceneLayout.vW / sceneW) * visualW,
        height: (sceneLayout.vH / sceneH) * visualH,
    };
}
