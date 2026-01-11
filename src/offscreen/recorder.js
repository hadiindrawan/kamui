import { saveRecording, updateRecording } from '../storage/indexeddb.js';

let mediaRecorder = null;
let recordedChunks = [];
let currentSessionId = null;
let eventLog = [];
let audioContext = null;
let mixedStream = null;
let globalDisplayStream = null;
let globalMicStream = null;
let recordingStartTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OFFSCREEN_START_RECORDING':
            startRecording(message.sessionId, message.tabId, message.micEnabled)
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

async function startRecording(sessionId, tabId, micEnabled = false) {
    currentSessionId = sessionId;
    recordedChunks = [];
    eventLog = [];
    recordingStartTime = Date.now();

    try {
        // 1. IMPROVED: Use stricter constraints for maximum resolution
        const displayMediaOptions = {
            video: {
                // Request 4K to ensure we get the max available source resolution
                width: { ideal: 3840, max: 3840 },
                height: { ideal: 2160, max: 2160 },
                frameRate: { ideal: 60 },
                // VITAL: Prevents Chrome from downscaling the image
                resizeMode: "none"
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 48000 // Standard for video (vs 44.1k for music)
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
            'video/webm;codecs=av01.0.05M.08,opus', // AV1 (Ultra crisp)
            'video/webm;codecs=vp9,opus',           // VP9 (Standard high qual)
            'video/webm;codecs=vp8,opus'            // Fallback
        ];

        let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));

        // Set up MediaRecorder with high quality settings
        const options = {
            mimeType: selectedMimeType || 'video/webm',
            // 4. IMPROVED: Massive bitrate increase
            // 50 Mbps ensures that when you zoom 300% on a generic button, it isn't blocky.
            videoBitsPerSecond: 50 * 1000 * 1000
        };

        console.log(`Starting Recorder with: ${options.mimeType} at 50Mbps`);

        mediaRecorder = new MediaRecorder(finalStream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
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
        mediaRecorder.start(500);
    } catch (error) {
        console.error('Recording Start Failed:', error);
        throw error;
    }
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
    const blob = new Blob(recordedChunks, { type: 'video/webm' });

    const recording = {
        id: currentSessionId,
        videoBlob: blob,
        id: currentSessionId,
        videoBlob: blob,
        events: eventLog,
        startTime: recordingStartTime,
        duration: (Date.now() - recordingStartTime) / 1000, // Duration in seconds
        resolution: {
            width: 1920,
            height: 1080
        },
        mimeType: blob.type,
        size: blob.size
    };

    try {
        await saveRecording(recording);
        console.log(`Recording saved: ${currentSessionId}, Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB, Events: ${eventLog.length}`);
    } catch (error) {
        console.error('Error saving recording:', error);
    }

    // Reset
    recordedChunks = [];
    eventLog = [];
    currentSessionId = null;
}
