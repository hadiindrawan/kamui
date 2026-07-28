import { saveRecording, updateRecording, saveChunk, getChunks, saveEventLogs, getRecording } from '../../storage/indexeddb.js';

let mediaRecorder = null;
let currentSessionId = null;
let currentSegmentId = 1;
let currentThumbnail = null;
let eventLog = [];
let eventFlushInterval = null;
let audioContext = null;
let mixedStream = null;
let globalDisplayStream = null;
let globalMicStream = null;
let recordingStartTime = 0;
let currentQuality = 'best-quality';
// When recording a pre-selected region, this holds the crop in viewport-
// normalized coordinates so cursor events can be renormalized to the (cropped)
// stored video, keeping the source-normalized convention intact for the editor.
let regionCrop = null;
let regionCropPx = null; // cropped output resolution, for recording metadata

/** Renormalize a viewport-normalized event to the cropped region. */
function remapEventToRegion(event) {
    if (!regionCrop) return event;
    const { x, y, w, h } = regionCrop;
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return event;
    return {
        ...event,
        x: Math.max(0, Math.min(1, (event.x - x) / w)),
        y: Math.max(0, Math.min(1, (event.y - y) / h)),
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OFFSCREEN_START_RECORDING':
            startRecording(message.sessionId, message.tabId, message.micEnabled, message.quality, message.segmentId || 1, message.regionSelection)
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;

        case 'OFFSCREEN_STOP_RECORDING':
            stopRecording()
                .then((recordingId) => sendResponse({ success: true, recordingId }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;

        case 'CURSOR_EVENT':
            // Collect cursor events (renormalized to the region when cropping).
            if (message.sessionId === currentSessionId) {
                eventLog.push(remapEventToRegion(message.event));
            }
            break;

        case 'TRACKING_COMPLETE':
            // Batch update events
            if (message.sessionId === currentSessionId) {
                eventLog = eventLog.concat(message.events.map(remapEventToRegion));
            }
            break;
    }
});

async function startRecording(sessionId, tabId, micEnabled = false, quality = 'best-quality', segmentId = 1, regionSelection = null) {
    currentSessionId = sessionId;
    currentSegmentId = segmentId;
    currentQuality = quality;
    eventLog = [];
    regionCrop = null;
    regionCropPx = null;
    recordingStartTime = Date.now();

    // 0. VITAL: Save initial metadata with "in-progress" status for Zero-Loss recovery
    if (segmentId === 1) {
        await saveRecording({
            id: currentSessionId,
            status: 'in-progress',
            videoBlob: null,
            events: [],
            startTime: recordingStartTime,
            quality: currentQuality
        }).catch(err => console.error('[Recorder] Initial save error:', err));
    } else {
        // Mark as in-progress if resuming
        await updateRecording(currentSessionId, { status: 'in-progress' })
            .catch(err => console.error('[Recorder] Resume save error:', err));
    }
    
    // Setup incremental flush for tracking events
    eventFlushInterval = setInterval(() => {
        if (eventLog.length > 0) {
            const batch = [...eventLog];
            eventLog = []; // clear to accept new
            saveEventLogs(currentSessionId, currentSegmentId, batch).catch(err => {
                console.error('[Recorder] Event flush failed:', err);
                eventLog = batch.concat(eventLog); // Put back on failure
            });
        }
    }, 5000);

    try {
        // 1. IMPROVED: Dynamic constraints based on quality preference
        // Best Quality: Request 4K/60fps to get the max possible source resolution
        // Best Performance: Request 720p/30fps for ultra-low CPU and disk usage
        const isPerformance = quality === 'best-performance';
        
        const displayMediaOptions = {
            video: {
                width: isPerformance ? { ideal: 1280 } : { ideal: 3840, max: 3840 },
                height: isPerformance ? { ideal: 720 } : { ideal: 2160, max: 2160 },
                frameRate: isPerformance ? { ideal: 30 } : { ideal: 60 },
                // VITAL: 'none' for quality to prevent blurring, 'allow-chroma-subsampling' for speed
                resizeMode: isPerformance ? "allow-chroma-subsampling" : "none"
            },
            audio: {
                systemAudio: 'include',
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000
            }
        };

        // For region recording, nudge Chrome toward capturing the current tab —
        // that's the surface where the region maps exactly onto the frame.
        if (regionSelection) {
            displayMediaOptions.preferCurrentTab = true;
        }

        const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // 2. IMPROVED: Set Content Hint
        // "detail" prioritizes text sharpness (good for code/docs). 
        // Use "motion" if recording games/video.
        const videoTrack = displayStream.getVideoTracks()[0];
        if ('contentHint' in videoTrack) {
            videoTrack.contentHint = 'detail';
        }

        // When the user stops the capture from Chrome's own UI (e.g. the macOS
        // menu-bar screen-sharing indicator, or "Stop sharing"), the track ends
        // but nothing else tells the extension. Notify the service worker so it
        // runs the normal stop path instead of leaving the recording hanging.
        videoTrack.addEventListener('ended', () => {
            console.log('[Recorder] Display track ended (capture stopped externally).');
            chrome.runtime.sendMessage({ type: 'OFFSCREEN_TRACK_ENDED', sessionId: currentSessionId }).catch(() => {});
        });

        // Get microphone only if enabled
        let micStream = null;
        if (micEnabled) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        sampleRate: 48000
                    }
                });
                console.log('Microphone enabled and acquired');
            } catch (e) {
                console.warn('Microphone not available:', e);
            }
        } else {
            console.log('Microphone disabled by user');
        }

        // Store global references
        globalDisplayStream = displayStream;
        globalMicStream = micStream;

        // Region recording: crop the captured stream down to the selected area
        // at record time, so the stored file is exactly the region (smaller +
        // no editor step needed). Only the tab-capture surface maps the region
        // exactly; other surfaces fall back to a full recording.
        let regionVideoTrack = null;
        if (regionSelection) {
            regionVideoTrack = applyRegionCrop(videoTrack, regionSelection);
        }

        // Mix audio streams
        const finalStream = await mixAudioStreams(displayStream, micStream);

        // Swap the full-frame video track for the cropped one, if we built it.
        if (regionVideoTrack) {
            const oldVideo = finalStream.getVideoTracks()[0];
            if (oldVideo) finalStream.removeTrack(oldVideo);
            finalStream.addTrack(regionVideoTrack);
        }

        // 3. IMPROVED: Codec Selection & Bitrate
        // We prioritize AV1 (best quality/size) > VP9 (great) > VP8 (fast)
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',           // VP9 (Standard high qual)
            'video/webm;codecs=av01,opus',          // AV1 (Modern alternative)
            'video/webm;codecs=vp8,opus'            // Fallback
        ];

        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

        // 4. Bitrate scales with the *actual* capture size for Best Quality.
        // This recording is the hard quality ceiling for every later export, so
        // a flat rate under-served large captures: 15 Mbps at 4K is ~half what
        // crisp screen text needs, and the editor's re-encode could only lose
        // more from there. Performance mode stays deliberately tiny.
        const recordedSettings = videoTrack.getSettings?.() || {};
        const capturePixels = (regionCropPx?.width || recordedSettings.width || 1920)
            * (regionCropPx?.height || recordedSettings.height || 1080);
        const bitrate = isPerformance
            ? 3 * 1000 * 1000
            : videoBitrateForPixels(capturePixels);

        const options = {
            mimeType: selectedMimeType || 'video/webm',
            videoBitsPerSecond: bitrate
        };

        console.log(`Starting Recorder with: ${options.mimeType} at ${(bitrate / 1000000).toFixed(1)} Mbps (${quality}), capture ${recordedSettings.width}x${recordedSettings.height}@${recordedSettings.frameRate}fps`);

        mediaRecorder = new MediaRecorder(finalStream, options);

        // Capture a thumbnail from the first frame of display stream
        captureThumbnail(displayStream).then(thumb => {
            currentThumbnail = thumb;
        }).catch(err => console.error('[Recorder] Thumbnail capture failed:', err));

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                // 1. PERSIST IMMEDIATELY to IndexedDB for safety/crash-protection
                // This ensures that even if the tab crashes or user closes it, data is safe.
                saveChunk(currentSessionId, e.data, currentSegmentId).catch(err => {
                    console.error('[Recorder] Failed to save chunk to IDB:', err);
                });
                
                // VITAL: Do NOT push to an in-memory array like recordedChunks.push(e.data).
                // For long-duration (1hr+), we must rely entirely on Disk to avoid OOM crashes.
            }
        };

        mediaRecorder.onstop = async () => {
            if (eventFlushInterval) {
                clearInterval(eventFlushInterval);
                eventFlushInterval = null;
            }
            if (eventLog.length > 0) {
                await saveEventLogs(currentSessionId, currentSegmentId, eventLog).catch(e => console.error(e));
                eventLog = [];
            }
            await saveRecordingData();

            // Clean up
            finalStream.getTracks().forEach(track => track.stop());
            if (audioContext && audioContext.state !== 'closed') {
                audioContext.close();
                audioContext = null;
            }
        };

        mediaRecorder.onerror = (error) => {
            console.error('MediaRecorder error:', error);
        };

        // Start recording
        // Slice every 500ms for safer memory management with high bitrate
        // Flush chunks every 5 seconds for incremental saving
        mediaRecorder.start(5000);
    } catch (error) {
        console.error('Recording Start Failed:', error);
        throw error;
    }
}

/**
 * VP9 capture bitrate for a given pixel count, for the Best Quality mode.
 *
 * Anchored at the previous flat rate for 1080p (15 Mbps — so no existing case
 * regresses) and scaled with the square root of the pixel ratio, which roughly
 * doubles it to ~30 Mbps at 4K. The old flat 15 Mbps left a 4K capture at about
 * half the bitrate crisp screen text needs, and since this recording is the hard
 * ceiling for every later export, the editor's re-encode could only lose more
 * from there. Screen content is mostly static, so real files stay well under the
 * nominal rate. The old flat rate is the floor, so this change can only ever
 * raise quality (never regresses sub-1080p captures), and it's capped so huge
 * ones (5K/6K) stay sane on disk.
 */
function videoBitrateForPixels(pixels) {
    const referencePixels = 1920 * 1080;
    const referenceBitrate = 15 * 1000 * 1000;
    const scaled = referenceBitrate * Math.sqrt((pixels || referencePixels) / referencePixels);
    return Math.round(Math.min(40 * 1000 * 1000, Math.max(referenceBitrate, scaled)));
}

/**
 * Builds a cropped video track for region recording using the WebCodecs
 * insertable-streams pipeline (MediaStreamTrackProcessor -> per-frame
 * VideoFrame(visibleRect) -> MediaStreamTrackGenerator). Sets `regionCrop`
 * (viewport-normalized) so cursor events get renormalized to match. Returns the
 * new track, or null when cropping isn't possible (unsupported API, or a
 * non-tab capture surface where the region can't be mapped exactly) — in which
 * case recording proceeds full-frame.
 */
function applyRegionCrop(videoTrack, regionSelection) {
    const hasPipeline = typeof MediaStreamTrackProcessor !== 'undefined'
        && typeof MediaStreamTrackGenerator !== 'undefined'
        && typeof VideoFrame !== 'undefined';
    if (!hasPipeline) {
        console.warn('[Recorder] Insertable streams unsupported — recording region full-frame.');
        return null;
    }

    const settings = videoTrack.getSettings();
    const captureW = settings.width;
    const captureH = settings.height;
    const surface = settings.displaySurface;
    const { rect } = regionSelection;

    // Only the tab-capture frame corresponds 1:1 to the page viewport the region
    // was drawn over. For monitor/window captures the mapping needs screen
    // geometry we can't derive reliably, so we skip the crop.
    if (surface !== 'browser' || !captureW || !captureH) {
        console.warn(`[Recorder] Region crop skipped (surface=${surface}). Share "This Tab" to record a region exactly.`);
        return null;
    }

    const cropPx = {
        x: Math.max(0, Math.round(rect.x * captureW)),
        y: Math.max(0, Math.round(rect.y * captureH)),
        w: Math.round(rect.w * captureW),
        h: Math.round(rect.h * captureH),
    };
    // Encoders want even dimensions.
    cropPx.w = Math.min(captureW - cropPx.x, Math.floor(cropPx.w / 2) * 2);
    cropPx.h = Math.min(captureH - cropPx.y, Math.floor(cropPx.h / 2) * 2);
    if (cropPx.w < 2 || cropPx.h < 2) return null;

    regionCrop = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    regionCropPx = { width: cropPx.w, height: cropPx.h };

    try {
        const processor = new MediaStreamTrackProcessor({ track: videoTrack });
        const generator = new MediaStreamTrackGenerator({ kind: 'video' });
        const transformer = new TransformStream({
            transform(frame, controller) {
                try {
                    const cropped = new VideoFrame(frame, {
                        visibleRect: { x: cropPx.x, y: cropPx.y, width: cropPx.w, height: cropPx.h },
                        timestamp: frame.timestamp,
                    });
                    controller.enqueue(cropped);
                } catch (e) {
                    controller.enqueue(frame.clone());
                } finally {
                    frame.close();
                }
            },
        });
        processor.readable.pipeThrough(transformer).pipeTo(generator.writable).catch((e) => {
            console.warn('[Recorder] Region crop pipeline ended:', e?.message || e);
        });
        console.log(`[Recorder] Region crop active: ${cropPx.w}x${cropPx.h} @ (${cropPx.x},${cropPx.y})`);
        return generator;
    } catch (e) {
        console.error('[Recorder] Failed to build region crop pipeline:', e);
        regionCrop = null;
        return null;
    }
}

async function captureThumbnail(stream) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        video.onloadedmetadata = async () => {
            await video.play();
            // Wait a tiny bit for the first frame to decode
            await new Promise(r => setTimeout(r, 300));

            const canvas = document.createElement('canvas');
            const thumbW = 320;
            const ratio = video.videoHeight / video.videoWidth;
            canvas.width = thumbW;
            canvas.height = thumbW * ratio;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.82); // Compressed JPEG

            // Clean up
            video.pause();
            video.srcObject = null;
            resolve(dataUrl);
        };
        video.onerror = () => resolve(null);
    });
}

async function mixAudioStreams(displayStream, micStream) {
    const videoTrack = displayStream.getVideoTracks()[0];
    const audioTracks = displayStream.getAudioTracks();

    // If no audio streams to mix, return display stream
    if (audioTracks.length === 0 && !micStream) {
        return displayStream;
    }

    // Create audio context for mixing
    audioContext = new AudioContext({ sampleRate: 48000 });
    const destination = audioContext.createMediaStreamDestination();

    // Add display audio if available
    if (audioTracks.length > 0) {
        const displayAudioSource = audioContext.createMediaStreamSource(
            new MediaStream([audioTracks[0]])
        );
        const displayGain = audioContext.createGain();
        displayGain.gain.value = 1.0; // Keep system audio clear
        displayAudioSource.connect(displayGain).connect(destination);
    }

    // Add microphone audio if available
    if (micStream) {
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        // Slightly boost mic to cut through system sound
        micGain.gain.value = 1.2;
        micAudioSource.connect(micGain).connect(destination);
    }

    // Combine video track with mixed audio
    const mixedAudioTrack = destination.stream.getAudioTracks()[0];
    mixedStream = new MediaStream([videoTrack, mixedAudioTrack]);

    return mixedStream;
}

async function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        console.warn('No active recording to stop');
        return currentSessionId;
    }

    return new Promise((resolve) => {
        const recordingId = currentSessionId;

        mediaRecorder.onstop = async () => {
            if (eventFlushInterval) {
                clearInterval(eventFlushInterval);
                eventFlushInterval = null;
            }
            if (eventLog.length > 0) {
                await saveEventLogs(currentSessionId, currentSegmentId, eventLog).catch(e => console.error(e));
                eventLog = [];
            }
            await saveRecordingData();

            // Clean up ALL media streams and tracks
            if (mixedStream) {
                mixedStream.getTracks().forEach(track => track.stop());
                mixedStream = null;
            }
            if (globalDisplayStream) {
                globalDisplayStream.getTracks().forEach(track => track.stop());
                globalDisplayStream = null;
            }
            if (globalMicStream) {
                globalMicStream.getTracks().forEach(track => track.stop());
                globalMicStream = null;
            }

            // Close audio context
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }

            resolve(recordingId);
        };

        mediaRecorder.stop();
    });
}

async function saveRecordingData() {
    if (!currentSessionId) return;

    try {
        const existing = await getRecording(currentSessionId, false);
        const addedDuration = (Date.now() - recordingStartTime) / 1000;
        const newDuration = (existing && existing.duration ? existing.duration : 0) + addedDuration;

        // Read the actual capture resolution off the live track (still open at this
        // point — track.stop() runs after saveRecordingData() in both callers).
        const captureSettings = globalDisplayStream?.getVideoTracks()[0]?.getSettings?.();
        // Region recordings are stored at the cropped resolution.
        const resolution = regionCropPx
            ? regionCropPx
            : (captureSettings?.width && captureSettings?.height
                ? { width: captureSettings.width, height: captureSettings.height }
                : (existing?.resolution || { width: 1920, height: 1080 }));

        // The capture's real frame rate. Stored so the editor can stop offering
        // export frame rates above it — encoding a 60fps source at 120fps only
        // duplicates frames while spreading the bitrate thinner per frame.
        const frameRate = Number.isFinite(captureSettings?.frameRate)
            ? Math.round(captureSettings.frameRate)
            : (existing?.frameRate || null);

        await updateRecording(currentSessionId, {
            status: 'completed',
            duration: newDuration,
            resolution,
            frameRate,
            sourceCrop: regionCrop || existing?.sourceCrop || null,
            mimeType: (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : 'video/webm',
            thumbnail: currentThumbnail || (existing ? existing.thumbnail : null)
        });
        console.log(`[Recorder] Final session saved: ${currentSessionId}, Total Duration: ${newDuration.toFixed(1)}s`);
    } catch (err) {
        console.error('[Recorder] Failed to persist final session metadata:', err);
    }

    // Reset
    currentSessionId = null;
    currentSegmentId = 1;
}
