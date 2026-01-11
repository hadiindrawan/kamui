// MP4 video export using canvas frame capture and backend API conversion
import { calculateCameraPosition, interpolateCamera } from './camera.js';
import { conversionAPI, APIError } from '../services/api-client.js';
import { config, isBackendConversionEnabled } from '../config.js';


export async function exportVideoMP4(recording, settings, onProgress) {
    const {
        zoomLevel = 2,
        zoomDuration = 800,
        transitionDuration = 300,
        segments = [],
        trimStart = 0,
        trimEnd,
        playbackSpeed = 1,
        bitrate = 8000000,
        fps = 30,
        exportQuality = 'high', // high, medium, low
        exportScale = 1 // 1x, 2x, 3x, 4x
    } = settings;

    return new Promise(async (resolve, reject) => {
        try {
            onProgress(0);

            // FFmpeg initialization disabled - exporting directly as WebM
            /*
            // Step 1: Initialize FFmpeg first (0-10%)
            onProgress(1);
            await initFFmpeg((loadProgress) => {
                if (loadProgress.type === 'load') {
                    const progress = 1 + Math.round(loadProgress.progress * 0.09);
                    onProgress(progress);
                }
            });
            */

            // Step 2: Create offscreen canvas and record WebM (0-70%)
            onProgress(10);

            const canvas = document.createElement('canvas');
            const video = document.createElement('video');

            const videoUrl = URL.createObjectURL(recording.videoBlob);
            video.src = videoUrl;
            video.muted = true;
            video.playbackRate = playbackSpeed;

            await new Promise((res, rej) => {
                video.onloadedmetadata = () => {
                    canvas.width = video.videoWidth || 1920;
                    canvas.height = video.videoHeight || 1080;
                    res();
                };
                video.onerror = (e) => rej(new Error('Video load error'));
                setTimeout(() => rej(new Error('Video load timeout')), 10000);
            });

            const ctx = canvas.getContext('2d', { alpha: false });
            const actualTrimEnd = trimEnd || video.duration;

            onProgress(15);

            // Set up MediaRecorder to capture canvas (always WebM first)
            const stream = canvas.captureStream(fps);

            // Add audio track from original video if available
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: 'tab'
                        }
                    }
                }).catch(() => null);

                if (audioStream) {
                    const audioTrack = audioStream.getAudioTracks()[0];
                    if (audioTrack) {
                        stream.addTrack(audioTrack);
                    }
                }
            } catch (e) {
                console.log('Could not add audio:', e);
            }

            // Always use WebM for intermediate recording
            let mimeType = 'video/webm;codecs=vp9,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm;codecs=vp8,opus';
            }

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: bitrate
            });

            const chunks = [];
            let lastCamera = null;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            const recordingPromise = new Promise((resolveRecording) => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunks, { type: mimeType });
                    resolveRecording(blob);
                };
            });

            // Start recording
            mediaRecorder.start(100);

            // Seek to trim start
            video.currentTime = trimStart;
            await new Promise(res => {
                video.onseeked = res;
                setTimeout(res, 100);
            });

            onProgress(20);

            // Play and render
            video.play();

            const segmentEvents = segments.map(seg => ({
                ...seg,
                time: seg.startTime,
                type: 'click'
            }));

            let frameCount = 0;
            const totalDuration = actualTrimEnd - trimStart;

            const renderFrame = () => {
                if (video.currentTime >= actualTrimEnd || video.ended || video.paused) {
                    video.pause();
                    mediaRecorder.stop();
                    return;
                }

                const currentTimeMs = video.currentTime * 1000;

                // Progress (20-70%)
                if (frameCount % 10 === 0) {
                    const progress = 20 + ((video.currentTime - trimStart) / totalDuration) * 50;
                    onProgress(Math.min(70, progress));
                }
                frameCount++;

                // Calculate camera
                const targetCamera = calculateCameraPosition(
                    currentTimeMs,
                    segmentEvents,
                    {
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        canvasWidth: canvas.width,
                        canvasHeight: canvas.height,
                        zoomLevel,
                        zoomDuration,
                        transitionDuration
                    }
                );

                const camera = interpolateCamera(lastCamera, targetCamera, 0.15);
                lastCamera = camera;

                // Draw frame
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(
                    video,
                    camera.srcX,
                    camera.srcY,
                    camera.srcW,
                    camera.srcH,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // Draw click effects
                drawClickEffects(ctx, camera, currentTimeMs, segmentEvents);

                requestAnimationFrame(renderFrame);
            };

            renderFrame();

            // Wait for WebM recording
            const webmBlob = await recordingPromise;
            URL.revokeObjectURL(videoUrl);

            onProgress(70);

            // Step 3: Backend conversion if enabled
            if (isBackendConversionEnabled()) {
                try {
                    console.log('[Export] Starting backend conversion...');

                    // Check backend health first
                    const isHealthy = await conversionAPI.checkHealth();
                    if (!isHealthy) {
                        throw new APIError('Backend service is unavailable', 503);
                    }

                    // Upload video and start conversion (70-75%)
                    onProgress(70);
                    const task = await conversionAPI.uploadAndConvert(webmBlob, exportQuality, exportScale);
                    console.log('[Export] Video uploaded, task ID:', task.id);

                    onProgress(75);

                    // Poll for conversion completion (75-95%)
                    await conversionAPI.pollUntilComplete(
                        task.id,
                        (status) => {
                            console.log('[Export] Conversion progress:', status.progress, '%');
                            // Map backend progress (0-100) to our progress range (75-95)
                            const progress = 75 + (status.progress * 0.20);
                            onProgress(Math.min(95, Math.round(progress)));
                        }
                    );

                    // Download converted MP4 (95-100%)
                    onProgress(95);
                    const mp4Blob = await conversionAPI.downloadConvertedVideo(task.id);

                    onProgress(100);
                    console.log('[Export] MP4 conversion complete!');

                    // Download MP4
                    downloadBlob(mp4Blob, `beunta_${Date.now()}.mp4`);

                    // Show success message
                    setTimeout(() => {
                        alert('✅ Video exported as MP4!\n\nYour video has been successfully converted and downloaded.');
                    }, 500);

                    resolve();
                    return;

                } catch (error) {
                    console.error('[Export] Backend conversion failed:', error);

                    // Show error and fallback to WebM
                    const errorMessage = error instanceof APIError
                        ? error.message
                        : 'Failed to connect to conversion service';

                    console.warn('[Export] Fallback to WebM:', errorMessage);

                    // Continue to WebM fallback below
                }
            }

            // Fallback: Download as WebM
            onProgress(100);
            console.log('[Export] Downloading as WebM');
            downloadBlob(webmBlob, `beunta_${Date.now()}.webm`);

            // Notify user about WebM export
            setTimeout(() => {
                const message = '✅ Video exported as WebM!\n\n' +
                    'WebM is a modern, high-quality format supported by all browsers.\n\n' +
                    'To convert to MP4:\n' +
                    '• Online: CloudConvert.com (free)\n' +
                    '• Desktop: HandBrake or VLC\n' +
                    '• Command: ffmpeg -i input.webm output.mp4';

                if (confirm(message + '\n\nOpen CloudConvert now?')) {
                    window.open('https://cloudconvert.com/webm-to-mp4', '_blank');
                }
            }, 1000);

            resolve();

        } catch (error) {
            console.error('Export error:', error);
            reject(error);
        }
    });
}

function drawClickEffects(ctx, camera, currentTimeMs, events) {
    events.forEach(event => {
        const elapsed = currentTimeMs - event.time;
        if (elapsed < 0 || elapsed > 600) return;

        const progress = elapsed / 600;
        const scaleX = camera.srcW / (event.viewportWidth || 1920);
        const scaleY = camera.srcH / (event.viewportHeight || 1080);

        const cursorX = ((event.x * scaleX - camera.srcX) / camera.srcW) * ctx.canvas.width;
        const cursorY = ((event.y * scaleY - camera.srcY) / camera.srcH) * ctx.canvas.height;

        // Draw expanding rings
        for (let ring = 0; ring < 3; ring++) {
            const ringProgress = Math.min(1, (progress - ring * 0.1) / 0.7);
            if (ringProgress <= 0) continue;

            const radius = 8 + ringProgress * 35;
            const alpha = (1 - ringProgress) * 0.5;

            ctx.strokeStyle = `rgba(254, 109, 115, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cursorX, cursorY, radius, 0, Math.PI * 2);
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
