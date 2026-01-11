import { saveRecording, updateRecording } from '../storage/indexeddb.js';

let mediaRecorder = null;
let recordedChunks = [];
let currentSessionId = null;
let eventLog = [];
let audioContext = null;
let mixedStream = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OFFSCREEN_START_RECORDING':
            startRecording(message.sessionId, message.tabId)
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

async function startRecording(sessionId, tabId) {
    currentSessionId = sessionId;
    recordedChunks = [];
    eventLog = [];

    try {
        // Get screen capture with audio
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 60 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });

        // Get microphone
        let micStream = null;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
        } catch (e) {
            console.warn('Microphone not available:', e);
        }

        // Mix audio streams
        const finalStream = await mixAudioStreams(displayStream, micStream);

        // Set up MediaRecorder
        const options = {
            mimeType: 'video/webm;codecs=vp9,opus',
            videoBitsPerSecond: 5000000 // 5 Mbps
        };

        // Fallback to VP8 if VP9 not supported
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp8,opus';
        }

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
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }
        };

        mediaRecorder.onerror = (error) => {
            console.error('MediaRecorder error:', error);
        };

        // Start recording
        mediaRecorder.start(1000); // Collect data every second
    } catch (error) {
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
    audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Add display audio if available
    if (audioTracks.length > 0) {
        const displayAudioSource = audioContext.createMediaStreamSource(
            new MediaStream([audioTracks[0]])
        );
        displayAudioSource.connect(destination);
    }

    // Add microphone audio if available
    if (micStream) {
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.7; // Reduce mic volume slightly
        micAudioSource.connect(gainNode);
        gainNode.connect(destination);
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
                mixedStream.getTracks().forEach(track => {
                    track.stop();
                });
                mixedStream = null;
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
        events: eventLog,
        startTime: Date.now(),
        duration: 0, // Will be calculated when video loads
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
