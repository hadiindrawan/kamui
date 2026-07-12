import { useState, useEffect, useCallback } from 'react';
import {
    getRecordingState,
    startBrowserRecording,
    startNativeRecording,
    stopRecording as stopRecordingRequest,
    resumeRecording as resumeRecordingRequest,
    getNextResumeSegmentId,
    log,
} from '../../core/services/recording-service.js';

/**
 * Recording lifecycle (start/stop/resume) plus the service-worker state sync
 * and native "tray stop" listener. Takes the settings needed to build
 * start-recording payloads and a callback to refresh the recordings list.
 */
export function useRecording({ settings, onRecordingStopped }) {
    const [isRecording, setIsRecording] = useState(false);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    // Surfaces a native-side failure (e.g. click tracker couldn't start due to
    // a missing macOS Accessibility permission) that would otherwise only be
    // visible in the native app's log file — the recording proceeds, but
    // click/cursor capture outside the browser silently wouldn't work.
    const [nativeTrackerWarning, setNativeTrackerWarning] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const state = await getRecordingState();
                if (state) {
                    log.info('State sync:', state);
                    setIsRecording(state.isRecording);
                    setCurrentSessionId(state.currentSessionId);
                    if (state.recordingMode) {
                        settings.syncRecordingMode(state.recordingMode);
                    }
                    if (state.nativeTrackerWarning) {
                        setNativeTrackerWarning(state.nativeTrackerWarning);
                    }
                }
            } catch (e) {
                log.error('Error checking state:', e);
            }
        })();
        // Settings identity is stable across the popup's lifetime; only run on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const messageListener = (message) => {
            // Reset when a recording is finalized outside the popup: a native
            // tray "Stop", or the capture ending via Chrome's stop indicator /
            // the native helper disconnecting.
            const stoppedExternally =
                (message.type === 'NATIVE_MESSAGE' && message.nativeType === 'TRACKING_STOPPED') ||
                message.type === 'RECORDING_STOPPED';
            if (stoppedExternally) {
                setIsRecording(false);
                setCurrentSessionId(null);
                setTimeout(() => onRecordingStopped(), 1000);
            }

            if (message.type === 'NATIVE_MESSAGE' && message.nativeType === 'ERROR') {
                const code = message.payload?.code;
                if (code === 'CLICK_TRACKER_FAILED') {
                    log.warn('Native click tracker failed to start:', message.payload?.message);
                    setNativeTrackerWarning(message.payload?.message || 'Native click tracking failed to start.');
                }
            }
        };
        chrome.runtime.onMessage.addListener(messageListener);
        return () => chrome.runtime.onMessage.removeListener(messageListener);
    }, [onRecordingStopped]);

    const startRecording = useCallback(async () => {
        const { recordingMode, quality, micEnabled } = settings;
        log.info('startRecording: mode=', recordingMode, 'quality=', quality);
        setNativeTrackerWarning(null);
        try {
            const response =
                recordingMode === 'native'
                    ? await startNativeRecording({ micEnabled, quality })
                    : await startBrowserRecording({ micEnabled, quality });

            if (response.success) {
                log.info('Recording started, session:', response.sessionId);
                setIsRecording(true);
                setCurrentSessionId(response.sessionId);
            } else {
                log.error('Failed to start recording:', response.error);
                alert('Failed to start recording: ' + response.error);
            }
        } catch (error) {
            log.error('Error starting recording:', error);
            alert('Error: ' + error.message);
        }
    }, [settings]);

    const stopRecording = useCallback(async () => {
        log.info('stopRecording: mode=', settings.recordingMode);
        try {
            const response = await stopRecordingRequest(settings.recordingMode);
            if (response.success) {
                log.info('Recording stopped successfully.');
                setIsRecording(false);
                setCurrentSessionId(null);
                setTimeout(() => onRecordingStopped(), 1000);
            } else {
                log.error('Failed to stop recording:', response.error);
                alert('Failed to stop recording: ' + response.error);
            }
        } catch (error) {
            log.error('Error stopping recording:', error);
            alert('Error: ' + error.message);
        }
    }, [settings.recordingMode, onRecordingStopped]);

    const resumeRecording = useCallback(async (recordingId) => {
        if (isRecording) {
            alert('A recording is already in progress.');
            return;
        }
        try {
            const segmentId = await getNextResumeSegmentId(recordingId);
            const response = await resumeRecordingRequest({
                sessionId: recordingId,
                segmentId,
                micEnabled: settings.micEnabled,
                quality: settings.quality,
            });
            if (response.success) {
                setIsRecording(true);
                setCurrentSessionId(recordingId);
            } else {
                alert('Failed to resume recording: ' + response.error);
            }
        } catch (error) {
            log.error('Error resuming recording:', error);
            alert('Error: ' + error.message);
        }
    }, [isRecording, settings.micEnabled, settings.quality]);

    return { isRecording, currentSessionId, startRecording, stopRecording, resumeRecording, nativeTrackerWarning };
}
