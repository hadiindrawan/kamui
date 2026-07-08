// MP4/WebM video export using mediabunny, constant-frame-rate compositing
import { calculateCameraPosition, interpolateCameraByTime } from './camera.js';
import { getAspectRatioValue } from './coordinates.js';
import { buildSceneModel, renderBackgroundBuffer, drawSceneFrame } from './scene-renderer.js';

export async function exportVideoMP4(recording, settings, onProgress) {
    const { conversionService = 'local', format = 'mp4' } = settings;

    if (conversionService === 'cloud') {
        throw new Error('Cloud export is coming soon. Please use local export.');
    }

    let backgroundImage = null;
    if (settings.backgroundMode === 'image' && settings.backgroundValue) {
        backgroundImage = await preloadImage(settings.backgroundValue);
    }

    const blob = await runLocalConversion({ recording, settings, backgroundImage, onProgress });
    onProgress(100);

    const extension = format === 'webm' ? 'webm' : 'mp4';
    downloadBlob(blob, `beunta_${Date.now()}.${extension}`);
}

// Alias for backward compatibility
export async function exportVideoWebM(recording, settings, onProgress) {
    return exportVideoMP4(recording, settings, onProgress);
}

export async function exportVideo(recording, onProgress) {
    return exportVideoMP4(recording, {
        zoomLevel: 2,
        zoomDuration: 800,
        transitionDuration: 300,
        segments: []
    }, onProgress);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Client-side MP4/WebM conversion using mediabunny. Both formats go through
 * this single pipeline: mediabunny is told a fixed `frameRate` so it pads/
 * dedupes frames to constant-frame-rate output (the source screen recording
 * is variable-frame-rate, since getDisplayMedia only emits a frame when the
 * screen changes). Without this, the zoom/pan camera animation is sampled at
 * the source's irregular frame timestamps, producing visible stutter that
 * the rAF-driven live preview never has.
 */
async function runLocalConversion({ recording, settings, backgroundImage, onProgress }) {
    const {
        Conversion, Input, Output,
        BlobSource, BufferTarget, Mp4OutputFormat, WebMOutputFormat,
        ALL_FORMATS, canEncodeAudio, QUALITY_HIGH
    } = await import('mediabunny');

    const isWebM = settings.format === 'webm';

    if (!isWebM) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        if (!(await canEncodeAudio('aac'))) {
            registerAacEncoder();
        }
    }

    const input = new Input({
        source: new BlobSource(recording.videoBlob),
        formats: ALL_FORMATS
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in source');

    const targetResolution = settings.targetResolution || 1080;
    const { width: canvasW, height: canvasH } = calculateCanvasSize(videoTrack.squarePixelWidth, videoTrack.squarePixelHeight, settings.aspectRatio, targetResolution);

    const target = new BufferTarget();
    const output = new Output({
        format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat(),
        target
    });

    const videoW = videoTrack.squarePixelWidth;
    const videoH = videoTrack.squarePixelHeight;

    // Build the SAME scene model the live preview uses, so the export is a
    // faithful reproduction. All cropping/zoom/framing geometry happens in
    // drawSceneFrame; mediabunny is told NOT to resize or crop (we omit
    // width/height/crop/fit) so `process` receives raw, full-resolution
    // frames, and `processedWidth/Height` announce our composited output size.
    const model = buildSceneModel({
        videoWidth: videoW,
        videoHeight: videoH,
        settings,
        segments: settings.segments || [],
        recordingEvents: recording?.events || [],
    });
    let lastCamera = null;

    // Output/composite canvas at the final target resolution.
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvasW, canvasH) : document.createElement('canvas');
    if (!(canvas instanceof OffscreenCanvas)) {
        canvas.width = canvasW; canvas.height = canvasH;
    }
    const ctx = canvas.getContext('2d', { alpha: false });

    // Pre-render background once at layout (native) resolution; the per-frame
    // scale transform upscales it along with everything else.
    const backgroundBuffer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    renderBackgroundBuffer(backgroundBuffer, model.layout, settings, backgroundImage);

    // Persistent canvas we blit each raw sample into so drawSceneFrame can
    // sample an arbitrary source sub-rect (VideoSample has no sub-rect draw).
    const srcCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(videoW, videoH) : document.createElement('canvas');
    if (!(srcCanvas instanceof OffscreenCanvas)) {
        srcCanvas.width = videoW; srcCanvas.height = videoH;
    }
    const srcCtx = srcCanvas.getContext('2d', { alpha: false });

    // Target resolution (and even-dimension rounding) folded into one outer scale.
    const scaleX = canvasW / model.layout.width;
    const scaleY = canvasH / model.layout.height;

    const fps = settings.fps || 60;
    const frameDurationMs = 1000 / fps;

    const conversion = await Conversion.init({
        input,
        output,
        trim: {
            start: settings.trimStart || 0,
            end: settings.trimEnd || undefined
        },
        video: {
            codec: isWebM ? 'vp9' : 'avc',
            processedWidth: canvasW,
            processedHeight: canvasH,
            frameRate: fps,
            bitrate: settings.bitrate || QUALITY_HIGH,
            hardwareAcceleration: 'no-preference',
            process: (sample) => {
                const currentTimeMs = sample.timestamp * 1000;

                // Constant frame spacing (guaranteed by the `frameRate` option
                // above) means the camera can smooth over a fixed dt instead of
                // the source's irregular sample spacing.
                const targetCamera = calculateCameraPosition(currentTimeMs, model.events, model.cameraConfig);
                const camera = interpolateCameraByTime(lastCamera, targetCamera, frameDurationMs);
                lastCamera = camera;

                // Blit the raw frame to the source canvas at native resolution.
                sample.draw(srcCtx, 0, 0, videoW, videoH);

                ctx.save();
                ctx.scale(scaleX, scaleY);
                drawSceneFrame(ctx, srcCanvas, currentTimeMs, model, {
                    camera,
                    backgroundBuffer,
                    showShadow: settings.showShadow,
                    showBorder: settings.showBorder,
                    borderRadius: settings.borderRadius || 0,
                    backgroundMode: settings.backgroundMode,
                });
                ctx.restore();

                return canvas;
            }
        },
        audio: settings.isMuted ? { discard: true } : {
            codec: isWebM ? 'opus' : 'aac'
        }
    });

    if (!conversion.isValid) throw new Error('Local conversion setup failed.');

    conversion.onProgress = (progress) => onProgress(Math.round(progress * 100));
    await conversion.execute();

    return new Blob([target.buffer], { type: isWebM ? 'video/webm' : 'video/mp4' });
}

// Maps a resolution preset (the target pixel count on the frame's short
// edge - e.g. 1080 for "1080p", matching how vertical/square video
// resolutions are conventionally named) + aspect ratio to a final
// even-dimensioned canvas size.
//
// Standard aspect ratios (16:9, 9:16, 1:1, 4:5) always reframe to that short
// edge regardless of source size - their fixed ratios all have a short edge
// of 1080 (see STANDARD_RESOLUTIONS in coordinates.js), so scaling relative
// to that 1080 baseline reaches the requested preset exactly (e.g. 2160 ->
// 4K). 'Native' preserves the source's own aspect ratio and short edge,
// clamped so it never upscales beyond the source's actual resolution.
export function calculateCanvasSize(videoW, videoH, aspectRatio, targetResolution = 1080) {
    let canvasW, canvasH;

    if (aspectRatio === 'Native') {
        const videoShortSide = Math.min(videoW, videoH);
        const shortSide = Math.min(targetResolution, videoShortSide);
        const scale = shortSide / videoShortSide;
        canvasW = videoW * scale;
        canvasH = videoH * scale;
    } else {
        const targetRatio = getAspectRatioValue(aspectRatio, videoW / videoH); // width/height
        const scale = targetResolution / 1080;
        if (targetRatio >= 1) {
            canvasH = 1080 * scale;
            canvasW = canvasH * targetRatio;
        } else {
            canvasW = 1080 * scale;
            canvasH = canvasW / targetRatio;
        }
    }

    return {
        width: Math.floor(canvasW / 2) * 2,
        height: Math.floor(canvasH / 2) * 2
    };
}

async function preloadImage(src) {
    try {
        return await new Promise((res, rej) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = src;
        });
    } catch (e) {
        return null;
    }
}
