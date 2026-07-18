/**
 * Single source of truth for the set of editor settings that a preset captures.
 *
 * Each entry maps a state key (as returned by useEditorState) to its setter name
 * (also on the useEditorState return object). Capture reads the keys; apply calls
 * the setters. This keeps save/load/preset/export from drifting apart.
 *
 * NOTE: per-recording data (trimStart, trimEnd, segments, tracks, loopPlayback)
 * is intentionally NOT here — presets are cross-recording configuration only.
 */

export const PRESET_FIELDS = [
    // Zoom
    { key: 'zoomLevel', setter: 'setZoomLevel' },
    { key: 'autoZoomIntensity', setter: 'setAutoZoomIntensity' },
    { key: 'zoomDuration', setter: 'setZoomDuration' },
    { key: 'transitionDuration', setter: 'setTransitionDuration' },
    // Playback
    { key: 'playbackSpeed', setter: 'setPlaybackSpeed' },
    // Framing
    { key: 'aspectRatio', setter: 'setAspectRatio' },
    { key: 'cropToFill', setter: 'setCropToFill' },
    { key: 'cropZoom', setter: 'setCropZoom' },
    { key: 'cropPanX', setter: 'setCropPanX' },
    { key: 'cropPanY', setter: 'setCropPanY' },
    { key: 'insetPadding', setter: 'setInsetPadding' },
    { key: 'showShadow', setter: 'setShowShadow' },
    { key: 'showBorder', setter: 'setShowBorder' },
    { key: 'borderRadius', setter: 'setBorderRadius' },
    // Background
    { key: 'backgroundMode', setter: 'setBackgroundMode' },
    { key: 'backgroundColor', setter: 'setBackgroundColor' },
    { key: 'backgroundValue', setter: 'setBackgroundValue' },
    { key: 'backgroundBlur', setter: 'setBackgroundBlur' },
    // Interaction
    { key: 'showFollowCursor', setter: 'setShowFollowCursor' },
    { key: 'cursorSmoothing', setter: 'setCursorSmoothing' },
    // Click effects
    { key: 'clickAnimationStyle', setter: 'setClickAnimationStyle' },
    { key: 'clickAnimationOpacity', setter: 'setClickAnimationOpacity' },
    { key: 'clickSound', setter: 'setClickSound' },
    { key: 'clickAnimationInRecording', setter: 'setClickAnimationInRecording' },
    // Caption style (appearance only; caption content is per-recording)
    { key: 'captionFontScale', setter: 'setCaptionFontScale' },
    { key: 'captionFontFamily', setter: 'setCaptionFontFamily' },
    { key: 'captionColor', setter: 'setCaptionColor' },
    { key: 'captionBackground', setter: 'setCaptionBackground' },
    { key: 'captionPosition', setter: 'setCaptionPosition' },
    // Audio
    { key: 'isMuted', setter: 'setIsMuted' },
    { key: 'volume', setter: 'setVolume' },
    // Export
    { key: 'exportResolution', setter: 'setExportResolution' },
    { key: 'exportFps', setter: 'setExportFps' },
    { key: 'exportFormat', setter: 'setExportFormat' },
    { key: 'conversionService', setter: 'setConversionService' },
    { key: 'exportQuality', setter: 'setExportQuality' },
];

/**
 * Pick the preset-relevant fields off a state bag (the useEditorState return
 * object, or anything exposing those keys). Undefined values are omitted.
 */
export function capturePresetSettings(state) {
    const out = {};
    for (const { key } of PRESET_FIELDS) {
        if (state[key] !== undefined) {
            out[key] = state[key];
        }
    }
    return out;
}

/**
 * Apply a settings object to editor state by calling each setter. Missing keys
 * are skipped so partial/legacy settings blobs still apply cleanly.
 */
export function applyPresetSettings(settings, state) {
    if (!settings) return;
    for (const { key, setter } of PRESET_FIELDS) {
        if (settings[key] !== undefined && typeof state[setter] === 'function') {
            state[setter](settings[key]);
        }
    }
}
