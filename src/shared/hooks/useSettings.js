import { useState, useEffect, useCallback } from 'react';
import {
    loadPersistedSettings,
    persistMicSetting,
    persistQualitySetting,
    persistRecordingMode,
    isNativeAppAvailable,
    loadCachedNativeAvailability,
    persistNativeAvailability,
    log,
} from '../../core/services/recording-service.js';

function detectOS() {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('mac')) return 'darwin';
    if (platform.includes('win')) return 'win32';
    return 'unknown';
}

/** Persisted recording settings (mic, quality, mode) + native app availability. */
export function useSettings() {
    const [micEnabled, setMicEnabled] = useState(false);
    const [quality, setQuality] = useState('best-quality');
    const [recordingMode, setRecordingModeState] = useState('browser'); // 'browser' | 'native'
    const [os] = useState(detectOS);

    // Tri-state avoids the flicker where flipping to native mode momentarily
    // rendered the setup guide before the ~2s availability probe returned.
    // 'unknown' | 'checking' | 'available' | 'unavailable'
    const [nativeAvailability, setNativeAvailability] = useState('unknown');
    const [showNativeSetup, setShowNativeSetup] = useState(false);

    const checkNativeAvailability = useCallback(async (opts = {}) => {
        // Seed from cache first so the UI doesn't flash while we re-probe.
        const cached = await loadCachedNativeAvailability();
        if (cached !== null) {
            setNativeAvailability(cached ? 'available' : 'unavailable');
        } else if (opts.showChecking) {
            setNativeAvailability('checking');
        }

        try {
            const available = await isNativeAppAvailable();
            setNativeAvailability(available ? 'available' : 'unavailable');
            persistNativeAvailability(available).catch(() => {});
            if (!available) {
                log.warn('Native app not found, showing setup guide.');
                setShowNativeSetup(true);
            } else {
                setShowNativeSetup(false);
            }
            return available;
        } catch (e) {
            log.error('Error checking native availability:', e);
            setNativeAvailability('unavailable');
            return false;
        }
    }, []);

    useEffect(() => {
        (async () => {
            const settings = await loadPersistedSettings();
            setMicEnabled(settings.micEnabled);
            setQuality(settings.quality);
            setRecordingModeState(settings.recordingMode);
            // Only actively probe on mount if native mode is the persisted choice.
            if (settings.recordingMode === 'native') {
                checkNativeAvailability();
            } else {
                const cached = await loadCachedNativeAvailability();
                if (cached !== null) setNativeAvailability(cached ? 'available' : 'unavailable');
            }
        })();
    }, [checkNativeAvailability]);

    const toggleMicrophone = useCallback(() => {
        setMicEnabled((prev) => {
            const next = !prev;
            persistMicSetting(next).catch((e) => log.error('Error saving mic setting:', e));
            return next;
        });
    }, []);

    const updateQuality = useCallback((newQuality) => {
        setQuality(newQuality);
        persistQualitySetting(newQuality).catch((e) => log.error('Error saving quality setting:', e));
    }, []);

    const setRecordingMode = useCallback((mode) => {
        log.info('Setting recording mode:', mode);
        setRecordingModeState(mode);
        persistRecordingMode(mode).catch((e) => log.error('Error saving recording mode:', e));
        if (mode === 'native') {
            // Show the "checking" placeholder only when we have no cached result.
            checkNativeAvailability({ showChecking: true });
        }
    }, [checkNativeAvailability]);

    return {
        micEnabled,
        toggleMicrophone,
        quality,
        setQuality: updateQuality,
        recordingMode,
        setRecordingMode,
        /** Reflects the service worker's authoritative mode locally, without persisting/notifying. */
        syncRecordingMode: setRecordingModeState,
        os,
        nativeAvailability,
        /** Backward-compatible boolean derived from the tri-state. */
        nativeAvailable: nativeAvailability === 'available',
        showNativeSetup,
        setShowNativeSetup,
        checkNativeAvailability,
    };
}
