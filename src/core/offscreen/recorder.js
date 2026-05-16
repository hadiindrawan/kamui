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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OFFSCREEN_START_RECORDING':
            startRecording(message.sessionId, message.tabId, message.micEnabled, message.quality, message.segmentId || 1)
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;

        case 'OFFSCREEN_STOP_RECORDING':
            stopRecording()
                .then((recordingId) => sendResponse({ success: true, recordingId }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true;

        case 'CURSOR_EVENT':
            // Collect cursor events
            if (message.sessionId === currentSessionId) {
                eventLog.push(message.event);
            }
            break;

        case 'TRACKING_COMPLETE':
            // Batch update events
            if (message.sessionId === currentSessionId) {
                eventLog = eventLog.concat(message.events);
            }
            break;
    }
});

async function startRecording(sessionId, tabId, micEnabled = false, quality = 'best-quality', segmentId = 1) {
    currentSessionId = sessionId;
    currentSegmentId = segmentId;
    currentQuality = quality;
    eventLog = [];
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

        const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // 2. IMPROVED: Set Content Hint
        // "detail" prioritizes text sharpness (good for code/docs). 
        // Use "motion" if recording games/video.
        const videoTrack = displayStream.getVideoTracks()[0];
        if ('contentHint' in videoTrack) {
            videoTrack.contentHint = 'detail';
        }

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

        // Mix audio streams
        const finalStream = await mixAudioStreams(displayStream, micStream);

        // 3. IMPROVED: Codec Selection & Bitrate
        // We prioritize AV1 (best quality/size) > VP9 (great) > VP8 (fast)
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',           // VP9 (Standard high qual)
            'video/webm;codecs=av01,opus',          // AV1 (Modern alternative)
            'video/webm;codecs=vp8,opus'            // Fallback
        ];

        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

        // 4. IMPROVED: Ultra-lightweight bitrate for Performance mode
        // High Quality: 15 Mbps for crystal clear 4K/1080p
        // Performance: 3 Mbps (720p) for smallest possible file size and fastest editor handling
        const bitrate = quality === 'best-performance' ? 3 * 1000 * 1000 : 15 * 1000 * 1000;

        const options = {
            mimeType: selectedMimeType || 'video/webm',
            videoBitsPerSecond: bitrate
        };

        console.log(`Starting Recorder with: ${options.mimeType} at ${(bitrate / 1000000).toFixed(1)} Mbps (${quality})`);

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

        await updateRecording(currentSessionId, {
            status: 'completed',
            duration: newDuration,
            resolution: { width: 1920, height: 1080 },
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
