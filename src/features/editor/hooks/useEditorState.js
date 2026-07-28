import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { computeSceneLayout, mapSceneRectToContainer, computeCoverVideoRect } from '../utils/coordinates.js';
import { generateAutoZoomSegments, resolveIntensity } from '../utils/auto-zoom.js';
import { capturePresetSettings, applyPresetSettings } from '../utils/preset-fields.js';
import { DEFAULT_CURSOR_SMOOTHING } from '../utils/cursor-smoothing.js';
import { createCaption, sortCaptions, DEFAULT_CAPTION_STYLE } from '../utils/captions.js';
import { useToast } from '../../../shared/hooks/useToast.js';
import { formatTime as formatTimeWithPrecision } from '../utils/time.js';

export const INTERACTION_TYPES = new Set(['click', 'dblclick', 'typing', 'selection']);
const MIN_SEGMENT_DISTANCE_MS = 1000;

// Resolution presets: `resolution` is the target pixel count on the frame's
// short edge (see calculateCanvasSize in utils/export.js for why). Bitrate is
// no longer fixed here — it's computed per codec/fps/quality-tier at export
// time by selectExportCodec (see utils/export-codec.js).
export const RESOLUTION_PRESETS = {
    // 'source' keeps the recording's native resolution (no downscale) — the
    // default, so a 4K capture exports at 4K instead of being reduced to 1080p.
    'source': { resolution: 'source', label: 'Source (match recording)' },
    '2160': { resolution: 2160, label: '4K (2160p)' },
    '1080': { resolution: 1080, label: '1080p (Full HD)' },
    '720': { resolution: 720, label: '720p (HD)' },
};
const DEFAULT_EXPORT_FPS = 60;

export function segmentFromEvent(event, index, { zoomLevel, zoomDuration, positionMode = 'follow', type = 'zoom' }) {
    return {
        id: `seg_${index}_${event.time}`,
        type,
        startTime: event.time,
        duration: zoomDuration,
        zoomLevel,
        positionMode,
        x: event.x !== undefined ? event.x : 0.5,
        y: event.y !== undefined ? event.y : 0.5,
        absX: event.absX,
        absY: event.absY,
        viewportWidth: event.viewportWidth || 1920,
        viewportHeight: event.viewportHeight || 1080,
        trackId: 0,
        loopMode: 'none',
    };
}

export function dedupeInteractionEvents(events) {
    const deduped = [];
    let lastEventTime = -Infinity;
    for (const event of events) {
        if (event.time - lastEventTime >= MIN_SEGMENT_DISTANCE_MS) {
            deduped.push(event);
            lastEventTime = event.time;
        }
    }
    return deduped;
}

// Ensures there's a track row for every trackId referenced by segments (so
// recordings saved before multi-track existed, or with gaps, always render).
function tracksFromSegments(segments, existingTracks = []) {
    const maxTrackId = segments.reduce((max, seg) => Math.max(max, seg.trackId ?? 0), 0);
    const tracks = [...existingTracks];
    for (let i = 0; i <= maxTrackId; i++) {
        if (!tracks.some((t) => t.id === i)) tracks.push({ id: i, label: `Track ${i + 1}` });
    }
    return tracks.length > 0 ? tracks.sort((a, b) => a.id - b.id) : [{ id: 0, label: 'Track 1' }];
}

/**
 * Decides what should happen when playback time reaches the end of its
 * active window. Priority order:
 * 1. A selected segment scopes playback to its own [start, start+duration] -
 *    reaching its end either loops back to its start (loopMode:'loop') or
 *    pauses there, regardless of the global loop setting.
 * 2. With no segment selected, reaching trimEnd loops to trimStart when
 *    loopPlayback is on, otherwise pauses (previous behavior).
 * Returns { action: 'continue' | 'seek' | 'pause', time? }.
 */
export function resolvePlaybackAction(time, { segments, selectedSegmentId, trimStart, trimEnd, loopPlayback }) {
    const selectedSegment = segments.find((s) => s.id === selectedSegmentId);
    const scopedStart = selectedSegment ? selectedSegment.startTime / 1000 : null;
    const scopedEnd = selectedSegment ? (selectedSegment.startTime + selectedSegment.duration) / 1000 : null;
    const effectiveEnd = scopedEnd !== null
        ? (trimEnd > 0 ? Math.min(scopedEnd, trimEnd) : scopedEnd)
        : trimEnd;

    if (!(effectiveEnd > 0 && time >= effectiveEnd)) {
        return { action: 'continue' };
    }
    if (scopedEnd !== null && selectedSegment?.loopMode === 'loop') {
        return { action: 'seek', time: scopedStart };
    }
    if (scopedEnd !== null) {
        return { action: 'pause', time: effectiveEnd };
    }
    if (loopPlayback) {
        return { action: 'seek', time: trimStart };
    }
    return { action: 'pause', time: effectiveEnd };
}

export function formatTime(seconds) {
    return formatTimeWithPrecision(seconds, { centiseconds: true });
}

/**
 * Owns every piece of editor state (playback, zoom/framing/trim settings,
 * segments + undo/redo history, export) plus the load/save/keyboard-shortcut
 * side effects. editor.jsx composes this hook with presentational panels.
 */
export function useEditorState() {
    const [recording, setRecording] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportResolution, setExportResolution] = useState('source');
    const [exportFps, setExportFps] = useState(DEFAULT_EXPORT_FPS);
    const [exportFormat, setExportFormat] = useState('mp4');
    const [conversionService, setConversionService] = useState('local');
    // Quality tier -> bitrate model in utils/export-codec.js ('best' | 'balanced' | 'smallest').
    const [exportQuality, setExportQuality] = useState('best');
    const { showToast } = useToast();

    const [zoomLevel, setZoomLevel] = useState(2);
    const [zoomDuration, setZoomDuration] = useState(800);
    // Slower by default: a short ramp reads as an abrupt cut, especially with
    // easeInOutQuart's steep midsection. 600ms gives the zoom-in/out motion
    // enough room to actually read as eased rather than snappy.
    const [transitionDuration, setTransitionDuration] = useState(600);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [autoZoomIntensity, setAutoZoomIntensity] = useState('medium'); // 'subtle' | 'medium' | 'strong'

    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [backgroundMode, setBackgroundMode] = useState('hidden');
    const [backgroundColor, setBackgroundColor] = useState('#1a2e3b');
    const [backgroundValue, setBackgroundValue] = useState('');
    const [backgroundBlur, setBackgroundBlur] = useState('none');
    const [insetPadding, setInsetPadding] = useState(40);
    const [cropToFill, setCropToFill] = useState(false);
    const [cropPanX, setCropPanX] = useState(0.5);
    const [cropPanY, setCropPanY] = useState(0.5);
    const [cropZoom, setCropZoom] = useState(1);
    const [showShadow, setShowShadow] = useState(true);
    const [showBorder, setShowBorder] = useState(false);
    const [borderRadius, setBorderRadius] = useState(12);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [showFollowCursor, setShowFollowCursor] = useState(false);
    const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SMOOTHING);

    const [clickAnimationStyle, setClickAnimationStyle] = useState('ripple');
    const [clickAnimationOpacity, setClickAnimationOpacity] = useState('med');
    const [clickSound, setClickSound] = useState('click');
    const [clickAnimationInRecording, setClickAnimationInRecording] = useState(true);

    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);
    const [confirmResetOpen, setConfirmResetOpen] = useState(false);

    // Captions: per-recording transcript data (source-time seconds). Not part
    // of presets. `captionsEnabled`/`burnInCaptions` are per-recording UI flags.
    const [captions, setCaptions] = useState([]);
    const [captionsEnabled, setCaptionsEnabled] = useState(true);
    const [burnInCaptions, setBurnInCaptions] = useState(false);

    // Caption appearance is a cross-recording style preference (captured by
    // presets, like clickAnimationStyle), separate from the caption content.
    const [captionFontScale, setCaptionFontScale] = useState(DEFAULT_CAPTION_STYLE.fontScale);
    const [captionFontFamily, setCaptionFontFamily] = useState(DEFAULT_CAPTION_STYLE.fontFamily);
    const [captionColor, setCaptionColor] = useState(DEFAULT_CAPTION_STYLE.color);
    const [captionBackground, setCaptionBackground] = useState(DEFAULT_CAPTION_STYLE.background);
    const [captionPosition, setCaptionPosition] = useState(DEFAULT_CAPTION_STYLE.position);

    const [segments, setSegments] = useState([]);
    const [tracks, setTracks] = useState([{ id: 0, label: 'Track 1' }]);
    const [loopPlayback, setLoopPlayback] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [videoDimensions, setVideoDimensions] = useState({ width: 1920, height: 1080 });
    const [hasPendingEdits, setHasPendingEdits] = useState(false);
    const [savedSegments, setSavedSegments] = useState([]);
    const [selectedSegmentId, setSelectedSegmentId] = useState(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    const canvasPlayerRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const hasInitializedSegments = useRef(false);

    // Stable bag of the preset-field setters (useState setters never change),
    // so applyPresetSettings can drive them from load/preset-apply paths.
    const editorSetters = useMemo(() => ({
        setZoomLevel, setAutoZoomIntensity, setZoomDuration, setTransitionDuration,
        setPlaybackSpeed, setAspectRatio, setCropToFill, setCropZoom, setCropPanX, setCropPanY,
        setInsetPadding, setShowShadow, setShowBorder, setBorderRadius,
        setBackgroundMode, setBackgroundColor, setBackgroundValue, setBackgroundBlur,
        setShowFollowCursor, setCursorSmoothing, setIsMuted, setVolume,
        setClickAnimationStyle, setClickAnimationOpacity, setClickSound, setClickAnimationInRecording,
        setExportResolution, setExportFps, setExportFormat, setConversionService,
        setCaptionFontScale, setCaptionFontFamily, setCaptionColor, setCaptionBackground, setCaptionPosition,
    }), []);

    // Bundle the caption style pieces for the renderer/export (stable identity
    // while the individual values are unchanged).
    const captionStyle = useMemo(() => ({
        fontScale: captionFontScale,
        fontFamily: captionFontFamily,
        color: captionColor,
        background: captionBackground,
        position: captionPosition,
    }), [captionFontScale, captionFontFamily, captionColor, captionBackground, captionPosition]);

    const saveHistory = useCallback((newSegments) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.stringify(newSegments));
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setSegments(JSON.parse(history[newIndex]));
        }
    }, [history, historyIndex]);

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setSegments(JSON.parse(history[newIndex]));
        }
    }, [history, historyIndex]);

    const loadRecording = useCallback(async () => {
        try {
            const params = new URLSearchParams(window.location.search);
            const recordingId = params.get('id');

            if (!recordingId) {
                setLoading(false);
                return;
            }

            const { getRecording } = await import('../../../storage/indexeddb.js');
            const rec = await getRecording(recordingId);
            if (!rec) throw new Error('Recording not found');

            setRecording(rec);

            if (Array.isArray(rec.captions)) {
                setCaptions(sortCaptions(rec.captions));
            }

            if (rec.segments && rec.segments.length > 0) {
                const segmentsWithZoom = rec.segments.map((seg) => ({
                    ...seg,
                    zoomLevel: seg.zoomLevel !== undefined ? seg.zoomLevel : 2,
                    positionMode: seg.positionMode || 'follow',
                    trackId: seg.trackId !== undefined ? seg.trackId : 0,
                    loopMode: seg.loopMode || 'none',
                }));
                setSegments(segmentsWithZoom);
                setTracks((prev) => tracksFromSegments(segmentsWithZoom, rec.editorSettings?.tracks || prev));
                setHistory([JSON.stringify(segmentsWithZoom)]);
                setHistoryIndex(0);
                hasInitializedSegments.current = true;
            }

            if (rec.editorSettings) {
                const s = rec.editorSettings;
                // Shared preset fields via the descriptor (setters are stable).
                applyPresetSettings(s, editorSetters);
                // Per-recording fields (not part of presets).
                if (s.trimStart !== undefined) setTrimStart(s.trimStart);
                if (s.trimEnd !== undefined) setTrimEnd(s.trimEnd);
                if (s.loopPlayback !== undefined) setLoopPlayback(s.loopPlayback);
                if (s.captionsEnabled !== undefined) setCaptionsEnabled(s.captionsEnabled);
                if (s.burnInCaptions !== undefined) setBurnInCaptions(s.burnInCaptions);
            }
            setLoading(false);
        } catch (err) {
            console.error('Error loading recording:', err);
            setError(err.message);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadRecording();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Build sustained auto-zoom sessions from the recording's interaction events.
    // Auto-zoom segments always land on track 0 - trackId only matters once the
    // user manually stacks a segment onto another track.
    const buildAutoZoomSegments = useCallback((events) => {
        const { zoomLevel: zl, idleReleaseMs } = resolveIntensity(autoZoomIntensity, zoomLevel);
        return generateAutoZoomSegments(events || [], { zoomLevel: zl, idleReleaseMs })
            .map((seg) => ({ ...seg, trackId: 0, loopMode: 'none' }));
    }, [autoZoomIntensity, zoomLevel]);

    // Initialize segments from recording events (only once when recording loads)
    useEffect(() => {
        if (recording?.events && duration > 0 && segments.length === 0 && !hasInitializedSegments.current) {
            const initialSegments = buildAutoZoomSegments(recording.events);

            setSegments(initialSegments);
            setHistory([JSON.stringify(initialSegments)]);
            setHistoryIndex(0);
            hasInitializedSegments.current = true;

            if (trimEnd === 0) setTrimEnd(duration);
        }
    }, [recording, duration, segments.length, trimEnd, buildAutoZoomSegments]);

    const handleFileUpload = useCallback(async (e) => {
        e.preventDefault();
        const file = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('video/')) {
            showToast({ type: 'error', message: 'Please upload a valid video file (.webm, .mp4, .mov).' });
            return;
        }
        if (file.size > 2 * 1024 * 1024 * 1024) {
            showToast({ type: 'error', message: 'File is too large. Please upload a file smaller than 2GB.' });
            return;
        }

        setLoading(true);
        try {
            const { saveRecording, saveChunk } = await import('../../../storage/indexeddb.js');
            const newId = `upload_${Date.now()}`;
            await saveChunk(newId, file);

            await saveRecording({
                id: newId,
                startTime: Date.now(),
                duration: 0,
                mimeType: file.type,
                events: [],
                size: file.size,
                isUploaded: true,
            });

            window.location.search = `?id=${newId}`;
        } catch (err) {
            console.error('Upload failed:', err);
            setError('Upload failed: ' + err.message);
            setLoading(false);
        }
    }, [showToast]);

    const handlePlayPause = useCallback(() => setIsPlaying((prev) => !prev), []);

    const handleTimeUpdate = useCallback((time) => {
        if (!Number.isFinite(time)) return;
        setCurrentTime(time);

        const result = resolvePlaybackAction(time, { segments, selectedSegmentId, trimStart, trimEnd, loopPlayback });
        if (result.action === 'seek') {
            setCurrentTime(result.time);
            canvasPlayerRef.current?.seekTo(result.time);
        } else if (result.action === 'pause') {
            setIsPlaying(false);
            setCurrentTime(result.time);
        }
    }, [trimEnd, trimStart, loopPlayback, segments, selectedSegmentId]);

    // Defensive backstop for the last-blob `onended` edge case in multi-blob
    // sequential playback, where floating point can mean `ontimeupdate` never
    // samples a value >= trimEnd before the video naturally ends.
    const handlePlaybackEnded = useCallback(() => {
        handleTimeUpdate(trimEnd || duration);
    }, [handleTimeUpdate, trimEnd, duration]);

    const handleDurationChange = useCallback((dur) => {
        if (Number.isFinite(dur)) {
            setDuration(dur);
            if (trimEnd === 0) setTrimEnd(dur);
        }
    }, [trimEnd]);

    const handleVideoDimensions = useCallback((dims) => setVideoDimensions(dims), []);

    const handleSeek = useCallback((time) => {
        if (Number.isFinite(time)) {
            const clampedTime = Math.max(0, Math.min(duration, time));
            setCurrentTime(clampedTime);
            setIsPlaying(false);
            canvasPlayerRef.current?.seekTo(clampedTime);
        }
    }, [duration]);

    const handleSkip = useCallback((seconds) => {
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        if (Number.isFinite(newTime)) {
            setCurrentTime(newTime);
            canvasPlayerRef.current?.seekTo(newTime);
        }
    }, [currentTime, duration]);

    const addSegment = useCallback((type = 'zoom', trackId = 0) => {
        const newSegment = {
            id: `seg_custom_${Date.now()}`,
            type,
            source: 'manual',
            startTime: currentTime * 1000,
            duration: zoomDuration,
            zoomLevel,
            positionMode: 'fixed',
            x: 0.5,
            y: 0.5,
            viewportWidth: videoDimensions.width,
            viewportHeight: videoDimensions.height,
            trackId,
            loopMode: 'none',
        };
        const newSegments = [...segments, newSegment].sort((a, b) => a.startTime - b.startTime);
        setSegments(newSegments);
        setHasPendingEdits(true);
        saveHistory(newSegments);
        setSelectedSegmentId(newSegment.id);
    }, [currentTime, zoomDuration, zoomLevel, segments, videoDimensions, saveHistory]);

    const addTrack = useCallback(() => {
        setTracks((prev) => {
            const nextId = prev.length ? Math.max(...prev.map((t) => t.id)) + 1 : 0;
            return [...prev, { id: nextId, label: `Track ${nextId + 1}` }];
        });
    }, []);

    const removeTrack = useCallback((trackId) => {
        if (segments.some((seg) => (seg.trackId ?? 0) === trackId)) {
            showToast({ type: 'error', message: 'Move or delete the segments on this track before removing it.' });
            return;
        }
        setTracks((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== trackId) : prev));
    }, [segments, showToast]);

    // Selecting a segment jumps the playhead to its start and pauses, so the
    // user immediately sees/hears the moment the segment governs. Deselecting
    // (id === null) leaves the playhead where it is.
    const selectSegment = useCallback((id) => {
        setSelectedSegmentId(id);
        if (!id) return;
        const seg = segments.find((s) => s.id === id);
        if (!seg) return;
        const startSec = seg.startTime / 1000;
        setCurrentTime(startSec);
        setIsPlaying(false);
        canvasPlayerRef.current?.seekTo(startSec);
    }, [segments]);

    const updateSegment = useCallback((id, updates, shouldSaveToHistory = false) => {
        const newSegments = segments.map((seg) => (seg.id === id ? { ...seg, ...updates } : seg));
        setSegments(newSegments);
        setHasPendingEdits(true);
        if (shouldSaveToHistory) saveHistory(newSegments);
    }, [segments, saveHistory]);

    const updateCropPan = useCallback((x, y) => {
        setCropPanX(x);
        setCropPanY(y);
        setHasPendingEdits(true);
    }, []);

    const deleteSegment = useCallback(() => {
        if (selectedSegmentId) {
            const newSegments = segments.filter((seg) => seg.id !== selectedSegmentId);
            setSegments(newSegments);
            setSelectedSegmentId(null);
            setHasPendingEdits(true);
            saveHistory(newSegments);
        } else if (segments.length > 0) {
            const newSegments = segments.slice(0, -1);
            setSegments(newSegments);
            setHasPendingEdits(true);
            saveHistory(newSegments);
        }
    }, [segments, selectedSegmentId, saveHistory]);

    const requestResetTimeline = useCallback(() => setConfirmResetOpen(true), []);

    const performResetTimeline = useCallback(() => {
        setConfirmResetOpen(false);
        if (recording?.events) {
            const initialSegments = buildAutoZoomSegments(recording.events);
            setSegments(initialSegments);
            saveHistory(initialSegments);
        }
        setTrimStart(0);
        setTrimEnd(duration);
    }, [recording, duration, saveHistory, buildAutoZoomSegments]);

    // Regenerate auto-zoom sessions from the recording, preserving any manual
    // segments the user added (source:'manual'). Used by the toolbar action and
    // when the intensity setting changes.
    const regenerateAutoZoom = useCallback(() => {
        if (!recording?.events) return;
        const manual = segments.filter((s) => s.source === 'manual');
        const auto = buildAutoZoomSegments(recording.events);
        const merged = [...auto, ...manual].sort((a, b) => a.startTime - b.startTime);
        setSegments(merged);
        setHasPendingEdits(true);
        saveHistory(merged);
    }, [recording, segments, buildAutoZoomSegments, saveHistory]);

    // --- Caption CRUD (source-time seconds; keeps the list sorted) ---
    const clampCaptionTimes = useCallback((start, end) => {
        const max = duration || Math.max(start, end);
        const s = Math.max(0, Math.min(start, max));
        const e = Math.max(s + 0.1, Math.min(end, max || end));
        return { start: s, end: e };
    }, [duration]);

    const addCaptionAtPlayhead = useCallback(() => {
        const start = currentTime;
        const end = Math.min((duration || start + 2), start + 2);
        const caption = createCaption({ start, end, text: 'New caption' });
        setCaptions((prev) => sortCaptions([...prev, caption]));
        setHasPendingEdits(true);
        return caption.id;
    }, [currentTime, duration]);

    const updateCaption = useCallback((id, updates) => {
        setCaptions((prev) => sortCaptions(prev.map((c) => {
            if (c.id !== id) return c;
            const next = { ...c, ...updates };
            if (updates.start !== undefined || updates.end !== undefined) {
                const { start, end } = clampCaptionTimes(
                    updates.start !== undefined ? updates.start : c.start,
                    updates.end !== undefined ? updates.end : c.end,
                );
                next.start = start;
                next.end = end;
            }
            return next;
        })));
        setHasPendingEdits(true);
    }, [clampCaptionTimes]);

    const deleteCaption = useCallback((id) => {
        setCaptions((prev) => prev.filter((c) => c.id !== id));
        setHasPendingEdits(true);
    }, []);

    const setAllCaptions = useCallback((list) => {
        const normalized = sortCaptions((list || []).map((c) => createCaption(c)));
        setCaptions(normalized);
        setHasPendingEdits(true);
    }, []);

    const handleSaveChanges = useCallback(async () => {
        setSavedSegments([...segments]);
        setHasPendingEdits(false);

        try {
            const params = new URLSearchParams(window.location.search);
            const recordingId = params.get('id');
            if (recordingId) {
                const { updateRecording } = await import('../../../storage/indexeddb.js');
                await updateRecording(recordingId, {
                    segments,
                    // Per-recording transcript data, sibling of `segments`.
                    captions,
                    editorSettings: {
                        // Shared preset fields (single source of truth).
                        ...capturePresetSettings({
                            zoomLevel, autoZoomIntensity, zoomDuration, transitionDuration,
                            playbackSpeed, aspectRatio, cropToFill, cropZoom, cropPanX, cropPanY,
                            insetPadding, showShadow, showBorder, borderRadius,
                            backgroundMode, backgroundColor, backgroundValue, backgroundBlur,
                            showFollowCursor, cursorSmoothing, isMuted, volume,
                            clickAnimationStyle, clickAnimationOpacity, clickSound, clickAnimationInRecording,
                            exportResolution, exportFps, exportFormat, conversionService, exportQuality,
                        }),
                        // Per-recording fields (not part of presets).
                        trimStart,
                        trimEnd,
                        tracks,
                        loopPlayback,
                        captionsEnabled,
                        burnInCaptions,
                    },
                });
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
        }

        canvasPlayerRef.current?.seekTo(currentTime);
    }, [segments, captions, captionsEnabled, burnInCaptions, currentTime, zoomLevel, zoomDuration, transitionDuration, autoZoomIntensity, playbackSpeed, aspectRatio,
        backgroundMode, backgroundColor, backgroundValue, backgroundBlur, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom,
        showShadow, showBorder, borderRadius, isMuted, volume, showFollowCursor, cursorSmoothing,
        clickAnimationStyle, clickAnimationOpacity, clickSound, clickAnimationInRecording,
        exportResolution, exportFps, exportFormat, conversionService, exportQuality, trimStart, trimEnd, tracks, loopPlayback]);

    const handleTrimChange = useCallback((start, end) => {
        setTrimStart(start);
        setTrimEnd(end);
        setHasPendingEdits(true);
    }, []);

    const markTrimStart = useCallback((time) => {
        setTrimStart(time);
        setHasPendingEdits(true);
    }, []);

    const markTrimEnd = useCallback((time) => {
        setTrimEnd(time);
        setHasPendingEdits(true);
    }, []);

    const handleExport = useCallback(async (overrides = {}) => {
        setIsExporting(true);
        setExportProgress(0);
        try {
            const { exportVideoMP4 } = await import('../utils/export.js');
            // Shared config via the descriptor, with optional overrides (e.g. a
            // preset's export settings) winning over current state.
            const merged = {
                ...capturePresetSettings({
                    zoomLevel, autoZoomIntensity, zoomDuration, transitionDuration,
                    playbackSpeed, aspectRatio, cropToFill, cropZoom, cropPanX, cropPanY,
                    insetPadding, showShadow, showBorder, borderRadius,
                    backgroundMode, backgroundColor, backgroundValue, backgroundBlur,
                    showFollowCursor, cursorSmoothing, isMuted, volume,
                    clickAnimationStyle, clickAnimationOpacity, clickSound, clickAnimationInRecording,
                    exportResolution, exportFps, exportFormat, conversionService, exportQuality,
                }),
                ...overrides,
            };
            const preset = RESOLUTION_PRESETS[merged.exportResolution] || RESOLUTION_PRESETS['1080'];

            const result = await exportVideoMP4(
                recording,
                {
                    ...merged,
                    segments, trimStart, trimEnd,
                    captions, burnInCaptions, captionStyle,
                    targetResolution: preset.resolution,
                    // Capture frame rate, so export.js can cap fps to it.
                    sourceFps: recording?.frameRate,
                    fps: merged.exportFps, format: merged.exportFormat,
                    exportQuality: merged.exportQuality || 'best',
                },
                (progress) => setExportProgress(progress)
            );
            showToast({ type: 'success', message: 'Video exported' });
            if (result?.warning) {
                showToast({ type: 'warning', message: result.warning });
            }
        } catch (err) {
            console.error('Export error:', err);
            showToast({ type: 'error', message: 'Export failed: ' + err.message });
        } finally {
            setIsExporting(false);
        }
    }, [recording, zoomLevel, autoZoomIntensity, zoomDuration, transitionDuration, segments, trimStart, trimEnd, playbackSpeed,
        isMuted, volume, exportResolution, exportFps, exportFormat, conversionService, exportQuality, aspectRatio, backgroundColor,
        backgroundMode, backgroundValue, backgroundBlur, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom,
        showShadow, showBorder, borderRadius, showFollowCursor, cursorSmoothing,
        clickAnimationStyle, clickAnimationOpacity, clickSound, clickAnimationInRecording,
        captions, burnInCaptions, captionStyle, showToast]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    setIsPlaying((prev) => !prev);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    handleSkip(e.shiftKey ? -10 : -5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    handleSkip(e.shiftKey ? 10 : 5);
                    break;
                case 'KeyI':
                    markTrimStart(currentTime);
                    break;
                case 'KeyO':
                    markTrimEnd(currentTime);
                    break;
                case 'KeyZ':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) handleRedo(); else handleUndo();
                    }
                    break;
                case 'KeyY':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        handleRedo();
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    if (selectedSegmentId) {
                        e.preventDefault();
                        deleteSegment();
                    }
                    break;
                case 'KeyS':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        handleSaveChanges();
                    }
                    break;
                case 'Slash':
                    if (e.shiftKey) {
                        e.preventDefault();
                        setShortcutsOpen((prev) => !prev);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentTime, handleUndo, handleRedo, deleteSegment, selectedSegmentId, handleSaveChanges, handleSkip, markTrimStart, markTrimEnd]);

    // Smooth timeline playhead: CanvasPlayer reports a frame-accurate global
    // time every rAF frame; we move the playhead DOM node's `left` directly (no
    // React re-render) so it glides at 60fps instead of stuttering off the
    // media element's coarse timeupdate. `left` as a percentage keeps it correct
    // under timeline zoom without measuring widths. The coarse `currentTime`
    // state still drives text/trim logic via handleTimeUpdate.
    const playheadElRef = useRef(null);
    const durationRef = useRef(0);
    useEffect(() => { durationRef.current = duration; }, [duration]);

    const registerPlayhead = useCallback((el) => { playheadElRef.current = el; }, []);

    const setPlayheadTime = useCallback((t) => {
        const el = playheadElRef.current;
        const dur = durationRef.current;
        if (!el || !dur) return;
        el.style.left = `${Math.max(0, Math.min(100, (t / dur) * 100))}%`;
    }, []);

    // While playing, the rAF frame loop owns the playhead position.
    const handleFrameTime = useCallback((t) => setPlayheadTime(t), [setPlayheadTime]);

    // While paused/seeking, keep the playhead synced to the coarse currentTime.
    useEffect(() => {
        if (isPlaying) return;
        setPlayheadTime(currentTime);
    }, [currentTime, isPlaying, duration, setPlayheadTime]);

    /**
     * The full scene layout for the current framing (shared math with the
     * renderer). Used by the overlays so their handles line up with the
     * rendered frame under crop + zoom.
     */
    const getSceneLayout = useCallback(() => {
        const videoW = videoDimensions.width || 1920;
        const videoH = videoDimensions.height || 1080;
        const base = computeSceneLayout({
            videoWidth: videoW,
            videoHeight: videoH,
            aspectRatio,
            backgroundMode,
            insetPadding,
            cropToFill,
            cropPanX,
            cropPanY,
            cropZoom,
        });
        return { ...base, videoW, videoH };
    }, [videoDimensions, aspectRatio, backgroundMode, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom]);

    /**
     * On-screen rect of the *visible* video area (the destination rect the
     * camera pans within) — the box under crop, the contain rect otherwise.
     * The zoom-target overlay lives in this rect so its handle can only be
     * placed where the camera can actually reach.
     */
    const getVisibleVideoRect = useCallback(() => {
        if (!canvasContainerRef.current) return { x: 0, y: 0, width: 0, height: 0 };
        const container = canvasContainerRef.current.getBoundingClientRect();
        return mapSceneRectToContainer(getSceneLayout(), container.width, container.height);
    }, [getSceneLayout]);

    /**
     * On-screen rect of the full source video within the canvas container,
     * for the zoom-target overlay (segment x/y are normalized over the full
     * video). When cropping, the video is cover-scaled and panned, so it's
     * larger than - and can extend past - the box it fills; this returns
     * that oversized rect, not the box itself (see getFrameRect).
     */
    const getVideoRect = useCallback(() => {
        if (!canvasContainerRef.current) return { x: 0, y: 0, width: 0, height: 0 };
        const container = canvasContainerRef.current.getBoundingClientRect();
        const sceneLayout = computeSceneLayout({
            videoWidth: videoDimensions.width || 1920,
            videoHeight: videoDimensions.height || 1080,
            aspectRatio,
            backgroundMode,
            insetPadding,
            cropToFill,
            cropPanX,
            cropPanY,
            cropZoom,
        });
        if (cropToFill) {
            const coverRect = computeCoverVideoRect(sceneLayout, videoDimensions.width || 1920, videoDimensions.height || 1080);
            return mapSceneRectToContainer(coverRect, container.width, container.height);
        }
        return mapSceneRectToContainer(sceneLayout, container.width, container.height);
    }, [videoDimensions, aspectRatio, backgroundMode, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom]);

    /**
     * On-screen rect of the box the video fits into: the full canvas when
     * the background is hidden, or the padded inset box otherwise. Forcing
     * cropToFill here is just a trick to read that box back out of
     * computeSceneLayout (its destination rect always equals the box when
     * cropToFill is set, regardless of pan) - it does not reflect the
     * actual current fit mode.
     */
    const getFrameRect = useCallback(() => {
        if (!canvasContainerRef.current) return { x: 0, y: 0, width: 0, height: 0 };
        const container = canvasContainerRef.current.getBoundingClientRect();
        const sceneLayout = computeSceneLayout({
            videoWidth: videoDimensions.width || 1920,
            videoHeight: videoDimensions.height || 1080,
            aspectRatio,
            backgroundMode,
            insetPadding,
            cropToFill: true,
        });
        return mapSceneRectToContainer(sceneLayout, container.width, container.height);
    }, [videoDimensions, aspectRatio, backgroundMode, insetPadding]);

    return {
        // refs
        canvasPlayerRef, canvasContainerRef,
        // load state
        recording, loading, error,
        // playback
        isPlaying, currentTime, duration, videoDimensions,
        handlePlayPause, handleTimeUpdate, handlePlaybackEnded, handleFrameTime, registerPlayhead,
        handleDurationChange, handleVideoDimensions, handleSeek, handleSkip,
        // zoom settings
        zoomLevel, setZoomLevel, zoomDuration, setZoomDuration, transitionDuration, setTransitionDuration,
        autoZoomIntensity, setAutoZoomIntensity, regenerateAutoZoom,
        // playback speed
        playbackSpeed, setPlaybackSpeed,
        // framing
        aspectRatio, setAspectRatio, backgroundMode, setBackgroundMode, backgroundColor, setBackgroundColor,
        backgroundValue, setBackgroundValue, backgroundBlur, setBackgroundBlur, insetPadding, setInsetPadding,
        cropToFill, setCropToFill, cropPanX, setCropPanX, cropPanY, setCropPanY, updateCropPan,
        cropZoom, setCropZoom,
        showShadow, setShowShadow, showBorder, setShowBorder, borderRadius, setBorderRadius,
        isMuted, setIsMuted, volume, setVolume, showFollowCursor, setShowFollowCursor,
        cursorSmoothing, setCursorSmoothing,
        // click effects
        clickAnimationStyle, setClickAnimationStyle, clickAnimationOpacity, setClickAnimationOpacity,
        clickSound, setClickSound, clickAnimationInRecording, setClickAnimationInRecording,
        // trim
        trimStart, setTrimStart, trimEnd, setTrimEnd, handleTrimChange, markTrimStart, markTrimEnd,
        // captions
        captions, captionsEnabled, setCaptionsEnabled, burnInCaptions, setBurnInCaptions,
        addCaptionAtPlayhead, updateCaption, deleteCaption, setAllCaptions,
        // caption style
        captionStyle,
        captionFontScale, setCaptionFontScale, captionFontFamily, setCaptionFontFamily,
        captionColor, setCaptionColor, captionBackground, setCaptionBackground,
        captionPosition, setCaptionPosition,
        // segments + history
        segments, selectedSegmentId, setSelectedSegmentId, selectSegment, addSegment, updateSegment, deleteSegment,
        requestResetTimeline, performResetTimeline, confirmResetOpen, setConfirmResetOpen, handleUndo, handleRedo, saveHistory,
        // tracks + loop
        tracks, addTrack, removeTrack, loopPlayback, setLoopPlayback,
        // pending edits
        hasPendingEdits, setHasPendingEdits, savedSegments, handleSaveChanges,
        // shortcuts help
        shortcutsOpen, setShortcutsOpen,
        // export
        isExporting, exportProgress, exportResolution, setExportResolution, exportFps, setExportFps,
        exportFormat, setExportFormat, conversionService, setConversionService,
        exportQuality, setExportQuality, handleExport,
        // upload
        handleFileUpload,
        // derived
        getVideoRect, getFrameRect, getVisibleVideoRect, getSceneLayout,
    };
}
