import { useState, useEffect, useRef, useCallback } from 'react';
import { applyPresetSettings, capturePresetSettings } from '../utils/preset-fields.js';
import {
    listPresets,
    createPreset,
    updatePreset,
    removePreset,
    isStorageDegraded,
} from '../services/preset-service.js';
import { useToast } from '../../../shared/hooks/useToast.js';

const COUNTDOWN_SECONDS = 5;

// Export-relevant fields passed as explicit overrides to handleExport when
// auto-exporting, so the preset's export config wins even if React state
// hasn't settled yet.
const EXPORT_OVERRIDE_KEYS = [
    'exportResolution', 'exportFps', 'exportFormat', 'conversionService', 'exportQuality', 'isMuted', 'volume',
    // Click FX are composited into the output (frames + audio), so the preset's
    // config must win during auto-export too.
    'clickAnimationStyle', 'clickAnimationOpacity', 'clickAnimationInRecording', 'clickSound',
    // The cursor dot (and its smoothing) is now composited into the export too.
    'showFollowCursor', 'cursorSmoothing',
];

const exportOverridesFromPreset = (settings) => {
    const out = {};
    for (const k of EXPORT_OVERRIDE_KEYS) {
        if (settings?.[k] !== undefined) out[k] = settings[k];
    }
    return out;
};

const hasChromeStorage = () =>
    typeof chrome !== 'undefined' && chrome.storage?.local;

const readPrefs = async () => {
    if (!hasChromeStorage()) return { activePresetId: null, globalAutoExport: false, globalCursorSmoothing: null };
    try {
        return (await chrome.storage.local.get(['activePresetId', 'globalAutoExport', 'globalCursorSmoothing'])) || {};
    } catch {
        return { activePresetId: null, globalAutoExport: false, globalCursorSmoothing: null };
    }
};

const writePref = (obj) => {
    if (!hasChromeStorage()) return;
    try {
        chrome.storage.local.set(obj);
    } catch {
        // no-op
    }
};

/**
 * Preset management: CRUD, apply (from UI or the native tray), active-default
 * loading, and the cancelable auto-export countdown. Takes the useEditorState
 * return object so it can read/apply the full editor configuration.
 */
export function usePresets(editorState) {
    const { showToast } = useToast();

    const [presets, setPresets] = useState([]);
    const [activePresetId, setActivePresetId] = useState(null);
    const [globalAutoExport, setGlobalAutoExportState] = useState(false);
    // Global default cursor-smoothing level (null = "no global default"). A
    // per-preset or per-recording value wins over this.
    const [globalCursorSmoothing, setGlobalCursorSmoothingState] = useState(null);
    const [managerOpen, setManagerOpen] = useState(false);
    const [storageDegraded, setStorageDegraded] = useState(false);
    // { presetName, secondsLeft, exportOverrides } | null
    const [countdown, setCountdown] = useState(null);

    // Refs so the stable callbacks / message listener read fresh values.
    const editorStateRef = useRef(editorState);
    editorStateRef.current = editorState;
    const presetsRef = useRef(presets);
    presetsRef.current = presets;
    const globalAutoExportRef = useRef(globalAutoExport);
    globalAutoExportRef.current = globalAutoExport;
    const handleExportRef = useRef(editorState.handleExport);
    handleExportRef.current = editorState.handleExport;

    const refreshPresets = useCallback(async () => {
        const list = await listPresets();
        setPresets(list);
        setStorageDegraded(isStorageDegraded());
        return list;
    }, []);

    const startCountdown = useCallback((preset) => {
        setCountdown({
            presetName: preset.name,
            secondsLeft: COUNTDOWN_SECONDS,
            exportOverrides: exportOverridesFromPreset(preset.settings),
        });
    }, []);

    const cancelCountdown = useCallback(() => {
        setCountdown(null);
    }, []);

    // Drive the countdown: tick every second, fire the export at zero.
    useEffect(() => {
        if (!countdown) return;
        if (countdown.secondsLeft <= 0) {
            const overrides = countdown.exportOverrides;
            setCountdown(null);
            handleExportRef.current?.(overrides);
            return;
        }
        const t = setTimeout(() => {
            setCountdown((c) => (c ? { ...c, secondsLeft: c.secondsLeft - 1 } : null));
        }, 1000);
        return () => clearTimeout(t);
    }, [countdown]);

    const applyPreset = useCallback(async (id, { allowAutoExport = true } = {}) => {
        let preset = presetsRef.current.find((p) => p.id === id);
        if (!preset) {
            const list = await refreshPresets();
            preset = list.find((p) => p.id === id);
        }
        if (!preset) return;

        applyPresetSettings(preset.settings, editorStateRef.current);
        editorStateRef.current.setHasPendingEdits?.(true);
        setActivePresetId(id);
        writePref({ activePresetId: id });
        showToast({ type: 'success', message: `Preset "${preset.name}" applied` });

        if (allowAutoExport && (preset.autoExport || globalAutoExportRef.current)) {
            startCountdown(preset);
        }
    }, [refreshPresets, showToast, startCountdown]);
    const applyPresetRef = useRef(applyPreset);
    applyPresetRef.current = applyPreset;

    const saveCurrentAsPreset = useCallback(async (name, autoExport = false) => {
        const settings = capturePresetSettings(editorStateRef.current);
        const preset = await createPreset({ name, autoExport, settings });
        await refreshPresets();
        showToast({ type: 'success', message: `Preset "${preset.name}" saved` });
        return preset;
    }, [refreshPresets, showToast]);

    const setPresetAutoExport = useCallback(async (preset, autoExport) => {
        await updatePreset({ ...preset, autoExport });
        await refreshPresets();
    }, [refreshPresets]);

    const deletePresetById = useCallback(async (id) => {
        await removePreset(id);
        if (activePresetId === id) {
            setActivePresetId(null);
            writePref({ activePresetId: null });
        }
        await refreshPresets();
    }, [activePresetId, refreshPresets]);

    const setActivePreset = useCallback((id) => {
        setActivePresetId(id);
        writePref({ activePresetId: id });
    }, []);

    const setGlobalAutoExport = useCallback((value) => {
        setGlobalAutoExportState(value);
        writePref({ globalAutoExport: value });
    }, []);

    const setGlobalCursorSmoothing = useCallback((value) => {
        const next = value || null;
        setGlobalCursorSmoothingState(next);
        writePref({ globalCursorSmoothing: next });
    }, []);

    const openManager = useCallback(() => setManagerOpen(true), []);
    const closeManager = useCallback(() => setManagerOpen(false), []);

    // Initial load: fetch presets + prefs. The active-default preset is only
    // auto-applied to recordings that have NO saved editorSettings of their own
    // (i.e. brand-new recordings) — otherwise it would silently overwrite a
    // recording the user already customized (e.g. wipe its background). An
    // already-customized recording keeps its settings; the user can still apply
    // a preset explicitly from the dropdown/tray.
    const didInit = useRef(false);
    useEffect(() => {
        if (editorState.loading || didInit.current) return;
        didInit.current = true;
        (async () => {
            const list = await refreshPresets();
            const prefs = await readPrefs();
            setGlobalAutoExportState(!!prefs.globalAutoExport);
            setGlobalCursorSmoothingState(prefs.globalCursorSmoothing || null);
            setActivePresetId(prefs.activePresetId || null);

            const savedSettings = editorStateRef.current.recording?.editorSettings;
            const recordingIsCustomized = savedSettings && Object.keys(savedSettings).length > 0;
            const appliedPreset = (prefs.activePresetId && !recordingIsCustomized)
                ? list.find((p) => p.id === prefs.activePresetId)
                : null;
            if (appliedPreset) {
                applyPresetSettings(appliedPreset.settings, editorStateRef.current);
            }

            // Global default cursor smoothing: applies only when neither the
            // saved recording settings nor the auto-applied preset already set
            // it (precedence: saved > preset > global > built-in 'medium').
            const savedHasSmoothing = savedSettings?.cursorSmoothing !== undefined;
            const presetHasSmoothing = appliedPreset?.settings?.cursorSmoothing !== undefined;
            if (prefs.globalCursorSmoothing && !savedHasSmoothing && !presetHasSmoothing) {
                editorStateRef.current.setCursorSmoothing?.(prefs.globalCursorSmoothing);
            }
        })();
    }, [editorState.loading, refreshPresets]);

    // Listen for tray-originated applies broadcast by the service worker.
    useEffect(() => {
        if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
        const onMessage = (message) => {
            if (message?.type === 'PRESET_APPLIED' && message.presetId) {
                const st = editorStateRef.current;
                if (st.loading || st.isExporting) return;
                applyPresetRef.current(message.presetId);
            }
        };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => chrome.runtime.onMessage.removeListener(onMessage);
    }, []);

    return {
        presets,
        refreshPresets,
        activePresetId,
        setActivePreset,
        globalAutoExport,
        setGlobalAutoExport,
        globalCursorSmoothing,
        setGlobalCursorSmoothing,
        saveCurrentAsPreset,
        applyPreset,
        setPresetAutoExport,
        deletePresetById,
        countdown,
        cancelCountdown,
        managerOpen,
        openManager,
        closeManager,
        storageDegraded,
    };
}
