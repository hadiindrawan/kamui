// MP4/WebM video export using mediabunny, constant-frame-rate compositing
import { calculateCameraPosition, interpolateCameraByTime } from './camera.js';
import { calculateCanvasSize } from './coordinates.js';
import { buildSceneModel, renderBackgroundBuffer, drawSceneFrame } from './scene-renderer.js';
import { filterRapidClicks } from './click-animations.js';
import { scheduleClickSound, CLICK_MASTER_GAIN } from '../services/click-sound.js';
import {
    selectExportCodec,
    computeAudioBitrate,
    SIZE_BUDGET_BYTES_PER_MIN,
} from './export-codec.js';
import { downloadBlob } from './download.js';
import { mapCaptionsToOutputTime } from './captions.js';

export async function exportVideoMP4(recording, settings, onProgress) {
    const { conversionService = 'local', format = 'mp4' } = settings;

    if (conversionService === 'cloud') {
        throw new Error('Cloud export is coming soon. Please use local export.');
    }

    let backgroundImage = null;
    if (settings.backgroundMode === 'image' && settings.backgroundValue) {
        backgroundImage = await preloadImage(settings.backgroundValue);
    }

    const { blob: convertedBlob, codec, warning: codecWarning, durationSec } =
        await runLocalConversion({ recording, settings, backgroundImage, onProgress });
    let blob = convertedBlob;

    // Click sounds are composited into the exported audio track in a second,
    // isolated pass that losslessly copies the video packets and rewrites only
    // the audio (original audio + click blips). Kept out of the tuned Conversion
    // pipeline so the video path is byte-for-byte unchanged; any failure falls
    // back to the click-free video rather than failing the whole export.
    try {
        const withClicks = await mixClickAudioIntoBlob(blob, recording, settings);
        if (withClicks) blob = withClicks;
    } catch (e) {
        console.warn('Click audio mix failed; exporting without click sounds:', e);
    }
    onProgress(100);

    const extension = format === 'webm' ? 'webm' : 'mp4';
    downloadBlob(blob, `kamui_${Date.now()}.${extension}`);

    // Non-blocking size validation: the download already happened. Surface a
    // warning if the file exceeds the 100MB/min budget (or carry over the
    // codec-fallback warning from selectExportCodec).
    let warning = codecWarning;
    const budget = SIZE_BUDGET_BYTES_PER_MIN * ((durationSec || 0) / 60);
    if (budget > 0 && blob.size > budget) {
        const mb = Math.round(blob.size / (1024 * 1024));
        const overMsg = `Export is ${mb} MB — exceeds the 100MB/min target.`;
        warning = warning ? `${warning} ${overMsg}` : overMsg;
    }

    return { sizeBytes: blob.size, durationSec, codec, warning };
}

// Alias for backward compatibility
export async function exportVideoWebM(recording, settings, onProgress) {
    return exportVideoMP4(recording, settings, onProgress);
}

export async function exportVideo(recording, onProgress) {
    return exportVideoMP4(recording, {
        zoomLevel: 2,
        zoomDuration: 800,
        transitionDuration: 600,
        segments: []
    }, onProgress);
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
        ALL_FORMATS, canEncodeAudio, AudioSample
    } = await import('mediabunny');

    const isWebM = settings.format === 'webm';

    if (!isWebM) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        if (!(await canEncodeAudio('aac'))) {
            registerAacEncoder();
        }
    }

    // Fresh mediabunny Input for each Conversion attempt (an Input's read
    // cursor can't be safely reused across executes).
    const makeInput = () => new Input({
        source: new BlobSource(recording.videoBlob),
        formats: ALL_FORMATS,
    });

    // Probe input: dimensions + duration only (never executed).
    const probeInput = makeInput();
    const videoTrack = await probeInput.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in source');

    const targetResolution = settings.targetResolution || 1080;
    const { width: canvasW, height: canvasH } = calculateCanvasSize(videoTrack.squarePixelWidth, videoTrack.squarePixelHeight, settings.aspectRatio, targetResolution);

    const videoW = videoTrack.squarePixelWidth;
    const videoH = videoTrack.squarePixelHeight;

    // Effective output duration (source duration clamped to the trim window),
    // used for the post-export size-vs-budget check.
    const sourceDuration = await videoTrack.computeDuration();
    const trimStartSec = settings.trimStart || 0;
    const trimEndSec = settings.trimEnd || sourceDuration;
    const durationSec = Math.max(0, Math.min(trimEndSec, sourceDuration) - trimStartSec);

    // Captions to burn in, rebased to output (trimmed, 0-based) time — which is
    // exactly what mediabunny hands processFrame via `sample.timestamp`.
    const exportCaptions = settings.burnInCaptions
        ? mapCaptionsToOutputTime(settings.captions || [], trimStartSec, trimEndSec)
        : [];

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

    const tier = settings.exportQuality || 'best';
    const audioBitrate = computeAudioBitrate({ format: isWebM ? 'webm' : 'mp4', tier });

    // Pick the best encodable codec + a budget-aware bitrate. An explicit
    // numeric settings.bitrate (legacy/auto-export callers) overrides the model.
    let selection;
    if (typeof settings.bitrate === 'number') {
        selection = { attempts: [{ codec: isWebM ? 'vp9' : 'avc', bitrate: settings.bitrate, capped: false }], warning: null };
    } else {
        selection = await selectExportCodec({
            format: isWebM ? 'webm' : 'mp4',
            width: canvasW,
            height: canvasH,
            resolution: targetResolution,
            fps,
            tier,
        });
    }

    // Per-frame compositor shared across attempts. `lastCamera` is reset before
    // each attempt so a retry starts the camera smoothing fresh.
    let lastCamera = null;
    const processFrame = (sample) => {
        const currentTimeMs = sample.timestamp * 1000;

        // Constant frame spacing (guaranteed by the `frameRate` option below)
        // means the camera can smooth over a fixed dt instead of the source's
        // irregular sample spacing.
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
            // Render the (smoothed) cursor dot into the export, matching the
            // preview, whenever Follow Cursor Mode is on.
            showCursorHighlight: settings.showFollowCursor === true,
            // "Include in recording" toggle: default on for legacy settings blobs.
            showClickAnimations: settings.clickAnimationInRecording !== false,
            clickStyle: settings.clickAnimationStyle,
            clickOpacity: settings.clickAnimationOpacity,
            captions: exportCaptions,
            showCaptions: exportCaptions.length > 0,
            captionStyle: settings.captionStyle,
        });
        ctx.restore();

        return canvas;
    };

    // Try each encodable codec in preference order. The probe in
    // selectExportCodec and Conversion.init's own isConfigSupported can
    // disagree (a race / driver quirk), so a failed init or execute falls
    // through to the next candidate rather than failing the whole export.
    let lastError = null;
    for (const attempt of selection.attempts) {
        lastCamera = null;
        const target = new BufferTarget();
        const output = new Output({
            format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat(),
            target,
        });
        try {
            const conversion = await Conversion.init({
                input: makeInput(),
                output,
                trim: {
                    start: settings.trimStart || 0,
                    end: settings.trimEnd || undefined,
                },
                video: {
                    codec: attempt.codec,
                    processedWidth: canvasW,
                    processedHeight: canvasH,
                    frameRate: fps,
                    bitrate: attempt.bitrate,
                    hardwareAcceleration: 'no-preference',
                    process: processFrame,
                },
                audio: settings.isMuted ? { discard: true } : buildAudioOptions(settings, isWebM, AudioSample, audioBitrate),
            });

            if (!conversion.isValid) throw new Error(`Conversion invalid for codec ${attempt.codec}`);

            conversion.onProgress = (progress) => onProgress(Math.round(progress * 100));
            await conversion.execute();

            const blob = new Blob([target.buffer], { type: isWebM ? 'video/webm' : 'video/mp4' });
            return { blob, codec: attempt.codec, warning: selection.warning, durationSec };
        } catch (e) {
            lastError = e;
            console.warn(`Export attempt with codec ${attempt.codec} failed; trying next:`, e);
        }
    }

    throw lastError || new Error('Local conversion setup failed.');
}

// Build the mediabunny audio conversion options. When volume === 1 we keep the
// cheap copy-through path (no re-encode). For any other gain we force a
// transcode and scale every sample by the gain in a `process` callback. The
// samples are read as interleaved f32; if an encoder ever rejects that we'd
// fall back to per-plane 'f32-planar' copies.
function buildAudioOptions(settings, isWebM, AudioSample, audioBitrate) {
    const gain = settings.volume === undefined ? 1 : settings.volume;
    const base = { codec: isWebM ? 'opus' : 'aac', bitrate: audioBitrate };
    if (gain === 1) return base;

    return {
        ...base,
        forceTranscode: true,
        process: (sample) => {
            const floatCount = sample.allocationSize({ planeIndex: 0, format: 'f32' }) / 4;
            const buf = new Float32Array(floatCount);
            sample.copyTo(buf, { planeIndex: 0, format: 'f32' });
            for (let i = 0; i < buf.length; i++) {
                buf[i] = Math.max(-1, Math.min(1, buf[i] * gain));
            }
            const out = new AudioSample({
                data: buf,
                format: 'f32',
                numberOfChannels: sample.numberOfChannels,
                sampleRate: sample.sampleRate,
                timestamp: sample.timestamp,
            });
            sample.close();
            return out;
        },
    };
}

/**
 * Second export pass — composite click sounds into the audio track. Copies the
 * finalized video packets verbatim (no re-encode) and replaces the audio with
 * an OfflineAudioContext mix of the original audio + click blips. Returns a new
 * Blob, or null when no click audio is wanted (the caller keeps the original).
 *
 * Timing: `runLocalConversion` rebases the output to start at 0 (Conversion
 * subtracts the trim start), so a recorded click at source time `t` seconds
 * lands in the output at `t - trimStart`. Working against the finalized,
 * already-0-based blob keeps click alignment independent of any per-sample
 * timestamp quirks in the conversion callbacks.
 */
async function mixClickAudioIntoBlob(intermediateBlob, recording, settings) {
    const isWebM = settings.format === 'webm';
    const clickSound = settings.clickSound;
    const includeClicks = settings.clickAnimationInRecording !== false;

    // Muted export drops click sound too (mirrors the preview, which gates
    // click sounds on !isMuted). Also bail when the effect is off/silent.
    if (settings.isMuted || !includeClicks || !clickSound || clickSound === 'none') {
        return null;
    }

    const OfflineCtor = typeof self !== 'undefined' && (self.OfflineAudioContext || self.webkitOfflineAudioContext);
    if (!OfflineCtor) return null; // no Web Audio here — keep the original

    const trimStart = settings.trimStart || 0;
    const trimEnd = settings.trimEnd || Infinity;
    // Deduped clicks (the same filter the visuals use), mapped into output time.
    const clickOffsets = filterRapidClicks(
        (recording?.events || []).filter((e) => e.type === 'click' || e.type === 'dblclick')
    )
        .map((e) => (e.time || 0) / 1000)
        .filter((t) => t >= trimStart && t <= trimEnd)
        .map((t) => t - trimStart);

    if (clickOffsets.length === 0) return null;

    const {
        Input, Output, BlobSource, BufferTarget, ALL_FORMATS,
        Mp4OutputFormat, WebMOutputFormat, EncodedPacketSink, EncodedVideoPacketSource,
        AudioBufferSource, canEncodeAudio,
    } = await import('mediabunny');

    const tier = settings.exportQuality || 'best';
    const audioBitrate = computeAudioBitrate({ format: isWebM ? 'webm' : 'mp4', tier });

    if (!isWebM && !(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
    }

    const input = new Input({ source: new BlobSource(intermediateBlob), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;

    const videoDuration = await videoTrack.computeDuration();
    // The intermediate's own audio is already volume-adjusted by the first pass;
    // recordings with no audio track decode to null and the mix is clicks-only.
    const originalAudio = await decodeBlobAudio(intermediateBlob, OfflineCtor);

    const sampleRate = 48000;
    const lengthSec = Math.max(videoDuration, originalAudio?.duration || 0, ...clickOffsets) + 0.5;
    const offline = new OfflineCtor(2, Math.ceil(lengthSec * sampleRate), sampleRate);

    if (originalAudio) {
        const base = offline.createBufferSource();
        base.buffer = originalAudio;
        base.connect(offline.destination);
        base.start(0);
    }

    // Clicks scale by volume × the shared master gain, matching preview loudness
    // (original audio already carries its own volume from the first pass).
    const clickGain = offline.createGain();
    const vol = settings.volume === undefined ? 1 : settings.volume;
    clickGain.gain.value = Math.max(0, Math.min(1, vol)) * CLICK_MASTER_GAIN;
    clickGain.connect(offline.destination);
    for (const when of clickOffsets) {
        await scheduleClickSound(offline, clickGain, clickSound, when);
    }

    const mixed = await offline.startRendering();

    // Remux: copy the video packets in decode order, attach the mixed audio.
    const target = new BufferTarget();
    const output = new Output({
        format: isWebM ? new WebMOutputFormat() : new Mp4OutputFormat(),
        target,
    });
    const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
    output.addVideoTrack(videoSource);
    const audioSource = new AudioBufferSource({ codec: isWebM ? 'opus' : 'aac', bitrate: audioBitrate });
    output.addAudioTrack(audioSource);
    await output.start();

    const decoderConfig = await videoTrack.getDecoderConfig();
    const sink = new EncodedPacketSink(videoTrack);
    let first = true;
    for await (const packet of sink.packets()) {
        await videoSource.add(packet, first ? { decoderConfig } : undefined);
        first = false;
    }
    await audioSource.add(mixed);
    await output.finalize();

    return new Blob([target.buffer], { type: isWebM ? 'video/webm' : 'video/mp4' });
}

/**
 * Decodes a media blob's audio into a single AudioBuffer, or null when the blob
 * has no decodable audio track (a screen recording with the mic off and no
 * system audio). Uses a throwaway OfflineAudioContext purely for decoding.
 */
async function decodeBlobAudio(blob, OfflineCtor) {
    try {
        // 1ch/1-frame context is enough to borrow decodeAudioData; the returned
        // buffer keeps the source's own channel count / sample rate.
        const ctx = new OfflineCtor(1, 1, 48000);
        return await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
        return null;
    }
}
// Re-exported for callers that historically imported it from here (e.g. tests);
// the implementation now lives with the other scene geometry in coordinates.js.
export { calculateCanvasSize };

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
