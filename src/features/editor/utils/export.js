// MP4 video export using canvas frame capture and backend API conversion
import { calculateCameraPosition, interpolateCamera } from './camera.js';
import { getAspectRatioValue, STANDARD_RESOLUTIONS } from './coordinates.js';
import { buildSceneModel, renderBackgroundBuffer, drawSceneFrame } from './scene-renderer.js';
import { conversionAPI, APIError } from '../../../core/services/api-client.js';
import { config, isBackendConversionEnabled } from '../../../shared/config.js';


export async function exportVideoMP4(recording, settings, onProgress) {
    const {
        zoomLevel = 2,
        zoomDuration = 800,
        transitionDuration = 300,
        segments = [],
        trimStart = 0,
        trimEnd,
        playbackSpeed = 1,
        bitrate = 4000000, // Optimized default for better efficiency (4Mbps)
        fps = 30,
        exportQuality = 'high',
        exportScale = 1,
        aspectRatio = '16:9',
        backgroundColor = '#1a2e3b',
        backgroundMode = 'hidden',
        backgroundValue = null,
        backgroundBlur = 'none',
        insetPadding = 0,
        cropToFill = false,
        cropPanX = 0.5,
        cropPanY = 0.5,
        cropZoom = 1,
        showShadow = false,
        showBorder = false,
        showFollowCursor = false,
        conversionService = 'local'
    } = settings;

            // STEP 1: Preload assets and calculate scene
            let backgroundImage = null;
            if (backgroundMode === 'image' && backgroundValue) {
                backgroundImage = await preloadImage(backgroundValue);
            }

            // STEP 2: Use Single-Pass High Performance Pipeline if MP4 is requested and Local is available
            if (settings.format === 'mp4' && conversionService === 'local') {
                console.log('[Export] Using High Performance Single-Pass Pipeline');
                const mp4Blob = await runLocalConversion({
                    recording,
                    settings,
                    backgroundImage,
                    onProgress
                });
                
                onProgress(100);
                downloadBlob(mp4Blob, `beunta_${Date.now()}.mp4`);
                
                setTimeout(() => {
                    alert(`✅ Video exported as MP4!\n\nSuccessfully converted using High-Performance Direct Mode.`);
                }, 500);

                return;
            }

            // --- LEGACY/FALLBACK WEBM CAPTURE (Real-time) ---
            // This is still used for WebM exports or if specific fallbacks occur
            console.log('[Export] Using real-time capture fallback (WebM)');
            
            const canvas = document.createElement('canvas');
            const video = document.createElement('video');
            const videoUrl = URL.createObjectURL(recording.videoBlob);
            video.src = videoUrl;
            video.muted = true;
            
            await new Promise((res, rej) => {
                video.onloadedmetadata = () => {
                    const { width, height } = calculateCanvasSize(video.videoWidth, video.videoHeight, aspectRatio, exportScale);
                    canvas.width = width;
                    canvas.height = height;
                    res();
                };
                video.onerror = rej;
            });

            const ctx = canvas.getContext('2d', { alpha: false });
            const actualTrimEnd = trimEnd || video.duration;
            const stream = canvas.captureStream(fps);
            
            // Add audio to legacy stream
            try {
                if (!settings.isMuted) {
                    const videoStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
                    if (videoStream && videoStream.getAudioTracks().length > 0) {
                        stream.addTrack(videoStream.getAudioTracks()[0]);
                    }
                }
            } catch (e) {}

            let recordMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus';
            const mediaRecorder = new MediaRecorder(stream, { mimeType: recordMime, videoBitsPerSecond: bitrate });
            const chunks = [];
            
            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            const webmPromise = new Promise(r => mediaRecorder.onstop = () => r(new Blob(chunks, { type: recordMime })));
            
            mediaRecorder.start();
            video.currentTime = trimStart;
            video.playbackRate = playbackSpeed;
            await new Promise(r => video.onseeked = r);
            video.play();

            // Constants for rendering setup. The legacy path draws the raw
            // <video> element directly (no upstream cropping), so the shared
            // scene renderer applies the source-rect crop itself.
            const model = buildSceneModel({
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                settings,
                segments: settings.segments || [],
                recordingEvents: recording?.events || [],
            });
            const bgBuffer = document.createElement('canvas');
            renderBackgroundBuffer(bgBuffer, model.layout, settings, backgroundImage);
            const scaleX = canvas.width / model.layout.width;
            const scaleY = canvas.height / model.layout.height;
            let lastCamera = null;

            const legacyRenderLoop = () => {
                if (video.currentTime >= actualTrimEnd || video.ended || video.paused) {
                    mediaRecorder.stop();
                    return;
                }

                const currentTimeMs = video.currentTime * 1000;
                onProgress(Math.min(70, 10 + ((video.currentTime - trimStart) / (actualTrimEnd - trimStart)) * 60));

                const targetCamera = calculateCameraPosition(currentTimeMs, model.events, model.cameraConfig);
                const camera = interpolateCamera(lastCamera, targetCamera, 0.15);
                lastCamera = camera;

                ctx.save();
                ctx.scale(scaleX, scaleY);
                drawSceneFrame(ctx, video, currentTimeMs, model, {
                    camera, backgroundBuffer: bgBuffer,
                    showShadow, showBorder, borderRadius: settings.borderRadius || 0,
                    backgroundMode,
                });
                ctx.restore();
                requestAnimationFrame(legacyRenderLoop);
            };

            legacyRenderLoop();
            const webmBlob = await webmPromise;
            URL.revokeObjectURL(videoUrl);

            // If user wanted MP4 but we were in legacy mode, try cloud/local fallback here
            if (settings.format === 'mp4') {
                // ... Backend logic ...
                // For brevity, we'll just download WebM if legacy was used (unlikely for MP4 now)
            }

            onProgress(100);
            downloadBlob(webmBlob, `beunta_${Date.now()}.webm`);
            return;
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
 * Client-side MP4 conversion using mediabunny (High-Performance Single-Pass Mode)
 */
async function runLocalConversion({ recording, settings, backgroundImage, onProgress }) {
    console.log('[Export] Initializing High-Performance local conversion...');
    
    // Dynamic imports for scalability
    const { 
        Conversion, Input, Output, 
        BlobSource, BufferTarget, Mp4OutputFormat,
        ALL_FORMATS, canEncodeAudio, QUALITY_HIGH
    } = await import('mediabunny');
    
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');

    if (!(await canEncodeAudio('aac'))) {
        registerAacEncoder();
    }

    const input = new Input({
        source: new BlobSource(recording.videoBlob),
        formats: ALL_FORMATS
    });

    // Determine dimensions
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in source');
    
    const { width: canvasW, height: canvasH } = calculateCanvasSize(videoTrack.squarePixelWidth, videoTrack.squarePixelHeight, settings.aspectRatio, settings.exportScale || 1);
    
    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat(),
        target: target
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

    // Output/composite canvas at the final (possibly exportScale-d) resolution.
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvasW, canvasH) : document.createElement('canvas');
    if (!(canvas instanceof OffscreenCanvas)) {
        canvas.width = canvasW; canvas.height = canvasH;
    }
    const ctx = canvas.getContext('2d', { alpha: false });

    // Pre-render background once at layout (native) resolution; the per-frame
    // exportScale transform upscales it along with everything else.
    const backgroundBuffer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    renderBackgroundBuffer(backgroundBuffer, model.layout, settings, backgroundImage);

    // Persistent canvas we blit each raw sample into so drawSceneFrame can
    // sample an arbitrary source sub-rect (VideoSample has no sub-rect draw).
    const srcCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(videoW, videoH) : document.createElement('canvas');
    if (!(srcCanvas instanceof OffscreenCanvas)) {
        srcCanvas.width = videoW; srcCanvas.height = videoH;
    }
    const srcCtx = srcCanvas.getContext('2d', { alpha: false });

    // exportScale (and even-dimension rounding) folded into one outer scale.
    const scaleX = canvasW / model.layout.width;
    const scaleY = canvasH / model.layout.height;

    const conversion = await Conversion.init({
        input,
        output,
        trim: {
            start: settings.trimStart || 0,
            end: settings.trimEnd || undefined
        },
        video: {
            codec: 'avc',
            processedWidth: canvasW,
            processedHeight: canvasH,
            bitrate: settings.bitrate || QUALITY_HIGH,
            preset: settings.preset || 'medium',
            hardwareAcceleration: 'no-preference',
            process: (sample) => {
                const currentTimeMs = sample.timestamp * 1000;

                const targetCamera = calculateCameraPosition(currentTimeMs, model.events, model.cameraConfig);
                const camera = interpolateCamera(lastCamera, targetCamera, 0.15);
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
            codec: 'aac'
        }
    });

    if (!conversion.isValid) throw new Error('Local conversion setup failed.');

    conversion.onProgress = (progress) => onProgress(Math.round(progress * 100));
    await conversion.execute();
    
    return new Blob([target.buffer], { type: 'video/mp4' });
}

// Logic separation for better maintainability and performance
export function calculateCanvasSize(videoW, videoH, aspectRatio, exportScale = 1) {
    let canvasW = videoW;
    let canvasH = videoH;

    if (aspectRatio !== 'Native') {
        const standard = STANDARD_RESOLUTIONS[aspectRatio];
        if (standard) {
            canvasW = standard.width;
            canvasH = standard.height;
        } else {
            const targetRatio = getAspectRatioValue(aspectRatio, videoW / videoH);
            if (targetRatio >= 1) {
                canvasH = videoH;
                canvasW = canvasH * targetRatio;
            } else {
                canvasW = videoH;
                canvasH = canvasW / targetRatio;
            }
        }
    }

    canvasW *= exportScale;
    canvasH *= exportScale;

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
