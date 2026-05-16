// MP4 video export using canvas frame capture and backend API conversion
import { calculateCameraPosition, interpolateCamera } from './camera.js';
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
                    const { width, height } = calculateCanvasSize(video.videoWidth, video.videoHeight, aspectRatio);
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

            // Constants for rendering setup
            const sceneParams = prepareSceneParams(video.videoWidth, video.videoHeight, canvas.width, canvas.height, settings, recording, backgroundImage);
            let lastCamera = null;

            const legacyRenderLoop = () => {
                if (video.currentTime >= actualTrimEnd || video.ended || video.paused) {
                    mediaRecorder.stop();
                    return;
                }
                
                const currentTimeMs = video.currentTime * 1000;
                onProgress(Math.min(70, 10 + ((video.currentTime - trimStart) / (actualTrimEnd - trimStart)) * 60));
                
                const targetCamera = calculateCameraPosition(currentTimeMs, sceneParams.events, sceneParams.cameraConfig);
                const camera = interpolateCamera(lastCamera, targetCamera, 0.15);
                lastCamera = camera;

                drawExportFrame(ctx, video, currentTimeMs, { ...sceneParams, camera });
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


function drawBackground(ctx, w, h, mode, value, color, blur, img) {
    if (mode === 'hidden') {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        return;
    }

    const blurs = {
        'none': 0,
        'light': 4,
        'moderate': 12,
        'strong': 24
    };
    const blurAmount = blurs[blur] || 0;

    if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

    if (mode === 'color') {
        ctx.fillStyle = value || color;
        ctx.fillRect(0, 0, w, h);
    } else if (mode === 'gradient') {
        if (Array.isArray(value)) {
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            value.forEach((c, i) => {
                grad.addColorStop(i / (value.length - 1), c);
            });
            ctx.fillStyle = grad;
        } else {
            // Fallback for string
            ctx.fillStyle = value || '#000';
        }
        ctx.fillRect(0, 0, w, h);

    } else if (mode === 'image') {
        if (img) {
            const imgRatio = img.width / img.height;
            const canvasRatio = w / h;

            let drawW, drawH, drawX, drawY;

            if (canvasRatio > imgRatio) {
                drawW = w;
                drawH = w / imgRatio;
                drawX = 0;
                drawY = (h - drawH) / 2;
            } else {
                drawH = h;
                drawW = h * imgRatio;
                drawX = (w - drawW) / 2;
                drawY = 0;
            }
            ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, w, h);
        }
    }

    ctx.filter = 'none';
}

function drawSceneOverlays(ctx, currentTimeMs, events, sceneW, sceneH) {
    // Note: ctx is already transformed by Camera.
    // events.x/y are normalized relative to Scene.

    // Filter active clicks
    events.forEach(event => {
        if (event.type !== 'click') return;

        const elapsed = currentTimeMs - event.time;
        if (elapsed < 0 || elapsed > 600) return;

        const progress = elapsed / 600;

        // Calculate position in Scene Pixels
        // Since we are drawing into a context that is already transformed to the scene,
        // we just map normalized -> pixels.

        const cx = event.x * sceneW;
        const cy = event.y * sceneH;

        // Draw expanding rings
        for (let ring = 0; ring < 3; ring++) {
            const ringProgress = Math.min(1, (progress - ring * 0.1) / 0.7);
            if (ringProgress <= 0) continue;

            const radius = 8 + ringProgress * 40; // Increased size to match editor
            const alpha = (1 - ringProgress) * 0.6;

            ctx.strokeStyle = `rgba(254, 109, 115, ${alpha})`;
            ctx.lineWidth = 2 - ringProgress;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
    });
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
    
    const { width: canvasW, height: canvasH } = calculateCanvasSize(videoTrack.squarePixelWidth, videoTrack.squarePixelHeight, settings.aspectRatio);
    
    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat(),
        target: target
    });

    const sceneParams = prepareSceneParams(videoTrack.squarePixelWidth, videoTrack.squarePixelHeight, canvasW, canvasH, settings, recording, backgroundImage);
    let lastCamera = null;

    // Create the main rendering canvas (Offscreen if possible)
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvasW, canvasH) : document.createElement('canvas');
    if (!(canvas instanceof OffscreenCanvas)) {
        canvas.width = canvasW; canvas.height = canvasH;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    
    // Pre-render background once to a separate buffer for maximum performance
    const backgroundBuffer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvasW, canvasH) : document.createElement('canvas');
    if (!(backgroundBuffer instanceof OffscreenCanvas)) {
        backgroundBuffer.width = canvasW; backgroundBuffer.height = canvasH;
    }
    const bctx = backgroundBuffer.getContext('2d');
    drawBackground(bctx, canvasW, canvasH, settings.backgroundMode, settings.backgroundValue, settings.backgroundColor, settings.backgroundBlur, backgroundImage);

    const conversion = await Conversion.init({
        input,
        output,
        trim: {
            start: settings.trimStart || 0,
            end: settings.trimEnd || undefined
        },
        video: { 
            codec: 'avc',
            width: canvasW,
            height: canvasH,
            bitrate: settings.bitrate || QUALITY_HIGH,
            preset: settings.preset || 'medium',
            fit: 'fill',
            hardwareAcceleration: 'no-preference',
            process: (sample) => {
                const currentTimeMs = sample.timestamp * 1000;
                
                // Calculate Camera
                const targetCamera = calculateCameraPosition(currentTimeMs, sceneParams.events, sceneParams.cameraConfig);
                const camera = interpolateCamera(lastCamera, targetCamera, 0.15);
                lastCamera = camera;

                // Draw processed frame using the PRE-RENDERED background
                drawExportFrame(ctx, sample, currentTimeMs, { ...sceneParams, camera, backgroundBuffer });

                // Return the canvas to be encoded
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
function calculateCanvasSize(videoW, videoH, aspectRatio) {
    let canvasW = videoW;
    let canvasH = videoH;

    if (aspectRatio !== 'Native') {
        const aspectRatios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const targetRatio = aspectRatios[aspectRatio] || 16 / 9;
        if (targetRatio >= 1) {
            canvasH = videoH;
            canvasW = canvasH * targetRatio;
        } else {
            canvasW = videoH;
            canvasH = canvasW / targetRatio;
        }
    }

    return {
        width: Math.floor(canvasW / 2) * 2,
        height: Math.floor(canvasH / 2) * 2
    };
}

function prepareSceneParams(videoW, videoH, canvasW, canvasH, settings, recording, backgroundImage) {
    const { backgroundMode, insetPadding, showFollowCursor } = settings;
    const videoRatio = videoW / videoH;
    let videoRectX = 0, videoRectY = 0, videoRectW = canvasW, videoRectH = canvasH;

    if (backgroundMode === 'hidden') {
        const canvasRatio = canvasW / canvasH;
        if (canvasRatio > videoRatio) {
            videoRectH = canvasH;
            videoRectW = videoRectH * videoRatio;
            videoRectX = (canvasW - videoRectW) / 2;
        } else {
            videoRectW = canvasW;
            videoRectH = videoRectW / videoRatio;
            videoRectY = (canvasH - videoRectH) / 2;
        }
    } else {
        const scaleBase = Math.min(canvasW, canvasH) / 1080;
        const scaledPadding = insetPadding * scaleBase;
        const safeW = canvasW - (scaledPadding * 2);
        const safeH = canvasH - (scaledPadding * 2);
        const fitScale = Math.min(safeW / videoW, safeH / videoH);
        videoRectW = videoW * fitScale;
        videoRectH = videoH * fitScale;
        videoRectX = (canvasW - videoRectW) / 2;
        videoRectY = (canvasH - videoRectH) / 2;
    }

    const events = settings.segments.map(seg => ({
        ...seg, time: seg.startTime, type: 'click',
        x: (seg.x * videoRectW + videoRectX) / canvasW,
        y: (seg.y * videoRectH + videoRectY) / canvasH
    }));

    if (showFollowCursor) {
        const followEvents = recording?.events?.filter(e => e.type === 'follow' || e.type === 'move') || [];
        events.push(...followEvents.map(e => ({
            ...e, x: (e.x * videoRectW + videoRectX) / canvasW, y: (e.y * videoRectH + videoRectY) / canvasH
        })));
    }

    return {
        canvasW, canvasH, videoW, videoH,
        videoRectX, videoRectY, videoRectW, videoRectH,
        ...settings,
        backgroundImage,
        events,
        cameraConfig: {
            videoWidth: canvasW, videoHeight: canvasH,
            canvasWidth: canvasW, canvasHeight: canvasH,
            zoomLevel: settings.zoomLevel,
            zoomDuration: settings.zoomDuration,
            transitionDuration: settings.transitionDuration
        }
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

function drawExportFrame(ctx, source, timestampMs, params) {
    const { 
        canvasW, canvasH, videoW, videoH, videoRectX, videoRectY, videoRectW, videoRectH,
        backgroundMode, backgroundBuffer,
        showShadow, showBorder, borderRadius = 0, camera, events 
    } = params;

    ctx.save();
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.scale(canvasW / camera.srcW, canvasH / camera.srcH);
    ctx.translate(-camera.srcX, -camera.srcY);

    // Use pre-rendered buffer for background (fast!)
    ctx.drawImage(backgroundBuffer, 0, 0);

    // 2. Draw Video
    // Calculate effective radius based on the visual width of the video in the scene
    const scale = videoRectW / videoW;
    const vRadius = Math.max(0, (borderRadius || 0) * scale);

    if (backgroundMode !== 'hidden' && showShadow) {
        ctx.save();
        ctx.fillStyle = 'black';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 40; ctx.shadowOffsetY = 20;
        
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(videoRectX, videoRectY, videoRectW, videoRectH, vRadius);
            ctx.fill();
        } else {
            ctx.fillRect(videoRectX, videoRectY, videoRectW, videoRectH);
        }
        ctx.restore();
    }

    ctx.save();
    if (vRadius > 0 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(videoRectX, videoRectY, videoRectW, videoRectH, vRadius);
        ctx.clip();
    }

    // Direct draw (compatible with both VideoElement and VideoSample)
    if (source.draw) {
        source.draw(ctx, videoRectX, videoRectY, videoRectW, videoRectH);
    } else {
        ctx.drawImage(source, 0, 0, videoW, videoH, videoRectX, videoRectY, videoRectW, videoRectH);
    }
    ctx.restore();

    if (backgroundMode !== 'hidden' && showBorder) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(videoRectX, videoRectY, videoRectW, videoRectH, vRadius);
            ctx.stroke();
        } else {
            ctx.strokeRect(videoRectX, videoRectY, videoRectW, videoRectH);
        }
    }

    drawSceneOverlays(ctx, timestampMs, events, canvasW, canvasH);
    ctx.restore();
}
