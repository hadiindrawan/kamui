import { useState, useEffect, useRef, useCallback } from 'react';
import { computeSceneLayout, mapSceneRectToContainer, computeCoverVideoRect } from '../utils/coordinates.js';
import { generateAutoZoomSegments, resolveIntensity } from '../utils/auto-zoom.js';

export const INTERACTION_TYPES = new Set(['click', 'dblclick', 'typing', 'selection']);
const MIN_SEGMENT_DISTANCE_MS = 1000;

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

export function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
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
    const [exportQuality, setExportQuality] = useState('best-quality');
    const [exportScale, setExportScale] = useState(1);
    const [exportFormat, setExportFormat] = useState('mp4');
    const [conversionService, setConversionService] = useState('local');

    const [zoomLevel, setZoomLevel] = useState(2);
    const [zoomDuration, setZoomDuration] = useState(800);
    const [transitionDuration, setTransitionDuration] = useState(300);
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
    const [showFollowCursor, setShowFollowCursor] = useState(false);

    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);

    const [segments, setSegments] = useState([]);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [videoDimensions, setVideoDimensions] = useState({ width: 1920, height: 1080 });
    const [hasPendingEdits, setHasPendingEdits] = useState(false);
    const [savedSegments, setSavedSegments] = useState([]);
    const [selectedSegmentId, setSelectedSegmentId] = useState(null);

    const canvasPlayerRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const hasInitializedSegments = useRef(false);

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

            if (rec.segments && rec.segments.length > 0) {
                const segmentsWithZoom = rec.segments.map((seg) => ({
                    ...seg,
                    zoomLevel: seg.zoomLevel !== undefined ? seg.zoomLevel : 2,
                    positionMode: seg.positionMode || 'follow',
                }));
                setSegments(segmentsWithZoom);
                setHistory([JSON.stringify(segmentsWithZoom)]);
                setHistoryIndex(0);
                hasInitializedSegments.current = true;
            }

            if (rec.quality) {
                setExportQuality(rec.quality);
            }

            if (rec.editorSettings) {
                const s = rec.editorSettings;
                if (s.zoomLevel !== undefined) setZoomLevel(s.zoomLevel);
                if (s.zoomDuration !== undefined) setZoomDuration(s.zoomDuration);
                if (s.transitionDuration !== undefined) setTransitionDuration(s.transitionDuration);
                if (s.autoZoomIntensity !== undefined) setAutoZoomIntensity(s.autoZoomIntensity);
                if (s.playbackSpeed !== undefined) setPlaybackSpeed(s.playbackSpeed);
                if (s.aspectRatio !== undefined) setAspectRatio(s.aspectRatio);
                if (s.backgroundMode !== undefined) setBackgroundMode(s.backgroundMode);
                if (s.backgroundColor !== undefined) setBackgroundColor(s.backgroundColor);
                if (s.backgroundValue !== undefined) setBackgroundValue(s.backgroundValue);
                if (s.backgroundBlur !== undefined) setBackgroundBlur(s.backgroundBlur);
                if (s.insetPadding !== undefined) setInsetPadding(s.insetPadding);
                if (s.cropToFill !== undefined) setCropToFill(s.cropToFill);
                if (s.cropPanX !== undefined) setCropPanX(s.cropPanX);
                if (s.cropPanY !== undefined) setCropPanY(s.cropPanY);
                if (s.cropZoom !== undefined) setCropZoom(s.cropZoom);
                if (s.showShadow !== undefined) setShowShadow(s.showShadow);
                if (s.showBorder !== undefined) setShowBorder(s.showBorder);
                if (s.borderRadius !== undefined) setBorderRadius(s.borderRadius);
                if (s.isMuted !== undefined) setIsMuted(s.isMuted);
                if (s.trimStart !== undefined) setTrimStart(s.trimStart);
                if (s.trimEnd !== undefined) setTrimEnd(s.trimEnd);
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
    const buildAutoZoomSegments = useCallback((events) => {
        const { zoomLevel: zl, idleReleaseMs } = resolveIntensity(autoZoomIntensity, zoomLevel);
        return generateAutoZoomSegments(events || [], { zoomLevel: zl, idleReleaseMs });
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
            alert('Please upload a valid video file (.webm, .mp4, .mov).');
            return;
        }
        if (file.size > 2 * 1024 * 1024 * 1024) {
            alert('File is too large. Please upload a file smaller than 2GB.');
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
    }, []);

    const handlePlayPause = useCallback(() => setIsPlaying((prev) => !prev), []);

    const handleTimeUpdate = useCallback((time) => {
        if (Number.isFinite(time)) {
            setCurrentTime(time);
            if (trimEnd > 0 && time >= trimEnd) {
                setIsPlaying(false);
                setCurrentTime(trimEnd);
            }
        }
    }, [trimEnd]);

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

    const addSegment = useCallback((type = 'zoom') => {
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
        };
        const newSegments = [...segments, newSegment].sort((a, b) => a.startTime - b.startTime);
        setSegments(newSegments);
        setHasPendingEdits(true);
        saveHistory(newSegments);
        setSelectedSegmentId(newSegment.id);
    }, [currentTime, zoomDuration, zoomLevel, segments, videoDimensions, saveHistory]);

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

    const resetTimeline = useCallback(() => {
        const confirmed = window.confirm(
            'Reset timeline to original? This will restore all auto-detected zoom segments and remove manual edits.'
        );
        if (!confirmed) return;

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
                    editorSettings: {
                        zoomLevel,
                        zoomDuration,
                        transitionDuration,
                        autoZoomIntensity,
                        playbackSpeed,
                        aspectRatio,
                        backgroundMode,
                        backgroundColor,
                        backgroundValue,
                        backgroundBlur,
                        insetPadding,
                        cropToFill,
                        cropPanX,
                        cropPanY,
                        cropZoom,
                        showShadow,
                        showBorder,
                        borderRadius,
                        isMuted,
                        trimStart,
                        trimEnd,
                    },
                });
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
        }

        canvasPlayerRef.current?.seekTo(currentTime);
    }, [segments, currentTime, zoomLevel, zoomDuration, transitionDuration, autoZoomIntensity, playbackSpeed, aspectRatio,
        backgroundMode, backgroundColor, backgroundValue, backgroundBlur, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom,
        showShadow, showBorder, borderRadius, isMuted, trimStart, trimEnd]);

    const handleTrimChange = useCallback((start, end) => {
        setTrimStart(start);
        setTrimEnd(end);
        setHasPendingEdits(true);
    }, []);

    const handleExport = useCallback(async () => {
        setIsExporting(true);
        setExportProgress(0);
        try {
            const { exportVideoMP4 } = await import('../utils/export.js');
            const qualitySettings = {
                'best-quality': { bitrate: 12000000, fps: 30, preset: 'medium' },
                'best-performance': { bitrate: 2500000, fps: 30, preset: 'ultrafast' },
            };
            const quality = qualitySettings[exportQuality] || qualitySettings['best-quality'];

            await exportVideoMP4(
                recording,
                {
                    zoomLevel, zoomDuration, transitionDuration, segments, trimStart, trimEnd,
                    playbackSpeed, isMuted, exportQuality, exportScale, format: exportFormat,
                    conversionService, aspectRatio, backgroundColor, backgroundMode, backgroundValue,
                    backgroundBlur, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom, showShadow, showBorder,
                    borderRadius, showFollowCursor,
                    ...quality,
                },
                (progress) => setExportProgress(progress)
            );
        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    }, [recording, zoomLevel, zoomDuration, transitionDuration, segments, trimStart, trimEnd, playbackSpeed,
        isMuted, exportQuality, exportScale, exportFormat, conversionService, aspectRatio, backgroundColor,
        backgroundMode, backgroundValue, backgroundBlur, insetPadding, cropToFill, cropPanX, cropPanY, cropZoom,
        showShadow, showBorder, borderRadius, showFollowCursor]);

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
                    setTrimStart(currentTime);
                    break;
                case 'KeyO':
                    setTrimEnd(currentTime);
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
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentTime, handleUndo, handleRedo, deleteSegment, selectedSegmentId, handleSaveChanges, handleSkip]);

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
        handlePlayPause, handleTimeUpdate, handleFrameTime, registerPlayhead,
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
        isMuted, setIsMuted, showFollowCursor, setShowFollowCursor,
        // trim
        trimStart, setTrimStart, trimEnd, setTrimEnd, handleTrimChange,
        // segments + history
        segments, selectedSegmentId, setSelectedSegmentId, addSegment, updateSegment, deleteSegment,
        resetTimeline, handleUndo, handleRedo, saveHistory,
        // pending edits
        hasPendingEdits, setHasPendingEdits, savedSegments, handleSaveChanges,
        // export
        isExporting, exportProgress, exportQuality, setExportQuality, exportScale, setExportScale,
        exportFormat, setExportFormat, conversionService, setConversionService, handleExport,
        // upload
        handleFileUpload,
        // derived
        getVideoRect, getFrameRect, getVisibleVideoRect, getSceneLayout,
    };
}
