import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Rnd } from 'react-rnd';
import {
    Film, Play, Pause, SkipBack, SkipForward,
    Download, Zap, HardDrive, Settings,
    ZoomIn, Gauge, Scissors, Lock, MousePointer2,
    Volume2, VolumeX
} from 'lucide-react';
import CanvasPlayer from './CanvasPlayer.jsx';
import Timeline from './Timeline.jsx';
import './editor.css';

function Editor() {
    const [recording, setRecording] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [exportQuality, setExportQuality] = useState('best-quality'); // best-performance, best-quality
    const [exportScale, setExportScale] = useState(1); // 1x, 2x, 3x, 4x
    const [exportFormat, setExportFormat] = useState('mp4'); // mp4, webm
    const [conversionService, setConversionService] = useState('local'); // local, cloud

    // Zoom settings
    const [zoomLevel, setZoomLevel] = useState(2);
    const [zoomDuration, setZoomDuration] = useState(800);
    const [transitionDuration, setTransitionDuration] = useState(300);

    // Playback speed
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // Aspect ratio and framing (Cursorful-style)
    const [aspectRatio, setAspectRatio] = useState('16:9'); // 16:9, 9:16, 1:1, 4:5
    const [backgroundMode, setBackgroundMode] = useState('hidden'); // hidden, color, gradient, image
    const [backgroundColor, setBackgroundColor] = useState('#1a2e3b'); // This acts as 'color' value
    const [backgroundValue, setBackgroundValue] = useState(''); // specialized value (gradient string or image url)
    const [backgroundBlur, setBackgroundBlur] = useState('none');
    const [insetPadding, setInsetPadding] = useState(40);
    const [showShadow, setShowShadow] = useState(true);
    const [showBorder, setShowBorder] = useState(false);
    const [borderRadius, setBorderRadius] = useState(12);
    const [isMuted, setIsMuted] = useState(false);
    const [showFollowCursor, setShowFollowCursor] = useState(false);

    // Trim
    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);

    // Segments with undo/redo history
    const [segments, setSegments] = useState([]);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const canvasPlayerRef = useRef(null);
    const hasInitializedSegments = useRef(false);
    const canvasContainerRef = useRef(null);

    // Video Dimensions for overlay calculation
    const [videoDimensions, setVideoDimensions] = useState({ width: 1920, height: 1080 });

    // Track if there are unsaved edits
    const [hasPendingEdits, setHasPendingEdits] = useState(false);
    const [savedSegments, setSavedSegments] = useState([]);
    const [selectedSegmentId, setSelectedSegmentId] = useState(null);

    // Save to history for undo/redo
    const saveHistory = useCallback((newSegments) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.stringify(newSegments));
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    // Undo function
    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setSegments(JSON.parse(history[newIndex]));
        }
    }, [history, historyIndex]);

    // Redo function
    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setSegments(JSON.parse(history[newIndex]));
        }
    }, [history, historyIndex]);



    useEffect(() => {
        loadRecording();
    }, []);

    // Initialize segments from recording events (only once when recording loads)
    useEffect(() => {
        // Only initialize once when recording loads, never reset after user edits
        if (recording?.events && duration > 0 && segments.length === 0 && !hasInitializedSegments.current) {
            // Filter for interaction events: major clicks (not minor), typing, and selections
            // This implements Cursorful's smart heuristic: not every click triggers zoom
            const interactionEvents = recording.events.filter(e => {
                // Include: regular clicks, dblclick, typing, selection
                // Exclude: click-minor, move, follow
                return (
                    e.type === 'click' ||
                    e.type === 'dblclick' ||
                    e.type === 'typing' ||
                    e.type === 'selection'
                );
            });

            // Deduplicate: merge events that are too close together (within 1 second)
            const MIN_SEGMENT_DISTANCE = 1000; // 1 second
            const dedupedEvents = [];
            let lastEventTime = -Infinity;

            for (const event of interactionEvents) {
                if (event.time - lastEventTime >= MIN_SEGMENT_DISTANCE) {
                    dedupedEvents.push(event);
                    lastEventTime = event.time;
                }
            }

            const initialSegments = dedupedEvents.map((event, i) => ({
                id: `seg_${i}_${event.time}`,
                type: 'zoom',
                startTime: event.time,
                duration: zoomDuration,
                zoomLevel: zoomLevel, // Each segment has its own zoom level
                positionMode: 'follow', // Default auto segments to follow cursor
                // Use normalized coordinates if available, fallback to absolute
                x: event.x !== undefined ? event.x : 0.5,
                y: event.y !== undefined ? event.y : 0.5,
                // Store both normalized and absolute for compatibility
                absX: event.absX,
                absY: event.absY,
                viewportWidth: event.viewportWidth || 1920,
                viewportHeight: event.viewportHeight || 1080
            }));

            setSegments(initialSegments);
            setHistory([JSON.stringify(initialSegments)]);
            setHistoryIndex(0);
            hasInitializedSegments.current = true; // Mark as initialized

            if (trimEnd === 0) setTrimEnd(duration);
        }
    }, [recording, duration, segments.length, zoomDuration, trimEnd]);

    async function loadRecording() {
        try {
            const params = new URLSearchParams(window.location.search);
            const recordingId = params.get('id');

            if (!recordingId) throw new Error('No recording ID provided');

            const { getRecording } = await import('../storage/indexeddb.js');
            const rec = await getRecording(recordingId);

            if (!rec) throw new Error('Recording not found');

            setRecording(rec);

            // Load saved segments if they exist
            if (rec.segments && rec.segments.length > 0) {
                // Ensure backward compatibility: add default zoomLevel to segments that don't have it
                const segmentsWithZoom = rec.segments.map(seg => ({
                    ...seg,
                    zoomLevel: seg.zoomLevel !== undefined ? seg.zoomLevel : 2, // Default to 2x if missing
                    positionMode: seg.positionMode || 'follow' // Default to follow if missing
                }));
                setSegments(segmentsWithZoom);
                setHistory([JSON.stringify(segmentsWithZoom)]);
                setHistoryIndex(0);
                hasInitializedSegments.current = true; // Mark as already initialized
            }

            // Sync export quality with recording intent
            if (rec.quality) {
                setExportQuality(rec.quality);
            }

            // Load saved editor settings if they exist
            if (rec.editorSettings) {
                const settings = rec.editorSettings;
                if (settings.zoomLevel !== undefined) setZoomLevel(settings.zoomLevel);
                if (settings.zoomDuration !== undefined) setZoomDuration(settings.zoomDuration);
                if (settings.transitionDuration !== undefined) setTransitionDuration(settings.transitionDuration);
                if (settings.playbackSpeed !== undefined) setPlaybackSpeed(settings.playbackSpeed);
                if (settings.aspectRatio !== undefined) setAspectRatio(settings.aspectRatio);
                if (settings.backgroundMode !== undefined) setBackgroundMode(settings.backgroundMode);
                if (settings.backgroundColor !== undefined) setBackgroundColor(settings.backgroundColor);
                if (settings.backgroundValue !== undefined) setBackgroundValue(settings.backgroundValue);
                if (settings.backgroundBlur !== undefined) setBackgroundBlur(settings.backgroundBlur);
                if (settings.insetPadding !== undefined) setInsetPadding(settings.insetPadding);
                if (settings.showShadow !== undefined) setShowShadow(settings.showShadow);
                if (settings.showBorder !== undefined) setShowBorder(settings.showBorder);
                if (settings.borderRadius !== undefined) setBorderRadius(settings.borderRadius);
                if (settings.isMuted !== undefined) setIsMuted(settings.isMuted);
                if (settings.trimStart !== undefined) setTrimStart(settings.trimStart);
                if (settings.trimEnd !== undefined) setTrimEnd(settings.trimEnd);
            }
            setLoading(false);
        } catch (err) {
            console.error('Error loading recording:', err);
            setError(err.message);
            setLoading(false);
        }
    }

    const handlePlayPause = useCallback(() => {
        setIsPlaying(!isPlaying);
    }, [isPlaying]);

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

    const handleVideoDimensions = useCallback((dims) => {
        setVideoDimensions(dims);
    }, []);

    const handleSeek = useCallback((time) => {
        if (Number.isFinite(time)) {
            const clampedTime = Math.max(0, Math.min(duration, time));
            setCurrentTime(clampedTime);
            setIsPlaying(false);
            if (canvasPlayerRef.current) {
                canvasPlayerRef.current.seekTo(clampedTime);
            }
        }
    }, [duration]);

    const handleSkip = useCallback((seconds) => {
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        if (Number.isFinite(newTime)) {
            setCurrentTime(newTime);
            if (canvasPlayerRef.current) {
                canvasPlayerRef.current.seekTo(newTime);
            }
        }
    }, [currentTime, duration]);

    // Segment management with history
    const addSegment = useCallback((type = 'zoom') => {
        const newSegment = {
            id: `seg_custom_${Date.now()}`,
            type: type,
            startTime: currentTime * 1000,
            duration: zoomDuration,
            zoomLevel: zoomLevel, // Use current global zoom level as default
            positionMode: 'fixed', // Default to fixed for manual segments
            x: 0.5, // Normalized center
            y: 0.5,
            viewportWidth: videoDimensions.width,
            viewportHeight: videoDimensions.height
        };
        const newSegments = [...segments, newSegment].sort((a, b) => a.startTime - b.startTime);
        setSegments(newSegments);
        setHasPendingEdits(true); // Mark as having pending edits
        saveHistory(newSegments);
        setSelectedSegmentId(newSegment.id); // Select the new segment
    }, [currentTime, zoomDuration, zoomLevel, segments, saveHistory, videoDimensions]);

    const updateSegment = useCallback((id, updates, saveToHistory = false) => {
        const newSegments = segments.map(seg =>
            seg.id === id ? { ...seg, ...updates } : seg
        );
        setSegments(newSegments);
        setHasPendingEdits(true); // Mark as having pending edits
        if (saveToHistory) {
            saveHistory(newSegments);
        }
    }, [segments, saveHistory]);

    const deleteSegment = useCallback(() => {
        if (selectedSegmentId) {
            // Delete the selected segment
            const newSegments = segments.filter(seg => seg.id !== selectedSegmentId);
            setSegments(newSegments);
            setSelectedSegmentId(null); // Clear selection
            setHasPendingEdits(true);
            saveHistory(newSegments);
        } else {
            // If no segment selected, delete the last one (backward compatibility)
            if (segments.length > 0) {
                const newSegments = segments.slice(0, -1);
                setSegments(newSegments);
                setHasPendingEdits(true);
                saveHistory(newSegments);
            }
        }
    }, [segments, selectedSegmentId, saveHistory]);



    const resetTimeline = useCallback(() => {
        const confirmed = window.confirm(
            'Reset timeline to original? This will restore all auto-detected zoom segments and remove manual edits.'
        );

        if (!confirmed) return;

        if (recording?.events) {
            const interactionEvents = recording.events.filter(e =>
                e.type === 'click' ||
                e.type === 'dblclick' ||
                e.type === 'typing' ||
                e.type === 'selection'
            );

            const initialSegments = interactionEvents.map((event, i) => ({
                id: `seg_${i}_${event.time}`,
                type: event.type, // Preserve original event type (typing, selection, dblclick, click)
                startTime: event.time,
                duration: zoomDuration,
                zoomLevel: 2, // Default zoom level for reset
                positionMode: 'follow', // Reset to follow cursor
                // Use normalized coordinates if available, fallback to absolute
                x: event.x !== undefined ? event.x : 0.5,
                y: event.y !== undefined ? event.y : 0.5,
                // Store both normalized and absolute for compatibility
                absX: event.absX,
                absY: event.absY,
                viewportWidth: event.viewportWidth || 1920,
                viewportHeight: event.viewportHeight || 1080
            }));

            setSegments(initialSegments);
            saveHistory(initialSegments);
        }
        setTrimStart(0);
        setTrimEnd(duration);
    }, [recording, zoomDuration, duration, saveHistory]);

    // Save changes and apply to playback
    const handleSaveChanges = useCallback(async () => {
        setSavedSegments([...segments]);
        setHasPendingEdits(false);

        // Save all editor settings to IndexedDB for persistence
        try {
            const params = new URLSearchParams(window.location.search);
            const recordingId = params.get('id');
            if (recordingId) {
                const { updateRecording } = await import('../storage/indexeddb.js');
                await updateRecording(recordingId, {
                    segments,
                    editorSettings: {
                        zoomLevel,
                        zoomDuration,
                        transitionDuration,
                        playbackSpeed,
                        aspectRatio,
                        backgroundMode,
                        backgroundColor,
                        backgroundValue,
                        backgroundBlur,
                        insetPadding,
                        showShadow,
                        showBorder,
                        borderRadius,
                        isMuted,
                        trimStart,
                        trimEnd
                    }
                });
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
        }

        // Force re-render by seeking to current position
        if (canvasPlayerRef.current) {
            canvasPlayerRef.current.seekTo(currentTime);
        }
    }, [segments, currentTime, zoomLevel, zoomDuration, transitionDuration, playbackSpeed, aspectRatio, backgroundColor, trimStart, trimEnd, borderRadius, isMuted]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    setIsPlaying(prev => !prev);
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
                        if (e.shiftKey) {
                            handleRedo();
                        } else {
                            handleUndo();
                        }
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
                    // Only delete if not in an input/textarea (already handled at top of function)
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
    }, [currentTime, handleUndo, handleRedo, deleteSegment, selectedSegmentId, handleSaveChanges]); // Added handleSaveChanges dependency

    const handleTrimChange = useCallback((start, end) => {
        setTrimStart(start);
        setTrimEnd(end);
        setHasPendingEdits(true); // Mark as having pending edits
    }, []);

    async function handleExport() {
        setIsExporting(true);
        setExportProgress(0);

        try {
            const { exportVideoMP4 } = await import('./export.js');

            // Quality presets - Binary Model
            const qualitySettings = {
                'best-quality': { bitrate: 12000000, fps: 30, preset: 'medium' },
                'best-performance': { bitrate: 2500000, fps: 30, preset: 'ultrafast' }
            };

            const quality = qualitySettings[exportQuality] || qualitySettings['best-quality'];

            await exportVideoMP4(
                recording,
                {
                    zoomLevel,
                    zoomDuration,
                    transitionDuration,
                    segments,
                    trimStart,
                    trimEnd,
                    playbackSpeed,
                    isMuted,
                    exportQuality, // Pass quality for FFmpeg conversion
                    exportScale, // Pass scale for resolution upscaling
                    format: exportFormat,
                    conversionService, // Use selected conversion service
                    aspectRatio,
                    backgroundColor,
                    backgroundMode,
                    backgroundValue,
                    backgroundBlur,
                    insetPadding,
                    showShadow,
                    showBorder,
                    borderRadius,
                    showFollowCursor,
                    ...quality
                },
                (progress) => setExportProgress(progress)
            );
        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        } finally {
            setIsExporting(false);
        }
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '00:00.00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    // Helper to calculate visual video rect on the canvas logic

    function getVideoRect() {
        if (!canvasContainerRef.current) return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
        const container = canvasContainerRef.current.getBoundingClientRect();

        const videoW = videoDimensions.width || 1920;
        const videoH = videoDimensions.height || 1080;
        const videoRatio = videoW / videoH;

        const aspectRatios = {
            'Native': videoRatio,
            '16:9': 16 / 9,
            '9:16': 9 / 16,
            '1:1': 1,
            '4:5': 4 / 5
        };
        const targetRatio = aspectRatios[aspectRatio] || 16 / 9;

        // 1. Calculate the Visual Canvas Size (The area that the <canvas> element occupies)
        // With Global Scene Zoom, the Camera Zooms into the SCENE used as the "Source Video"
        // But the `mouse events` and `overlay position` logic in `react-rnd`:
        // We set `Rnd` position based on `segment.x` (0-1).
        // AND in Global Zoom, `segment.x` is normalized to the SCENE.
        // Wait, `updateSegment` logic earlier assumed 0-1 relative to Video Content for "Follow".
        // In `CanvasPlayer`:
        //   x: (seg.x * videoRectW + videoRectX) / canvasW
        // This means `seg.x` is still stored relative to the VIDEO CONTENT (1920x1080).
        // This is GOOD. We don't want to break existing data or "Follow" logic.

        // So `Rnd` overlay should overlay the VIDEO CONTENT portion of the scene.
        // We need to calculate `renderX, renderY, renderW, renderH` which represents the VIDEO CONTENT
        // VISUALLY on the screen.

        // BUT `CanvasPlayer` now renders the SCENE (Background + Video) into the `canvas`.
        // The `canvas` (DOM Element) is what we see.
        // We can overlay `Rnd` on top of the canvas container.
        // The `canvas` element is fitted into `container` via `getVideoRect` part 1 (visualCanvasW/H).

        // Inside that `canvas` element (the Scene), the video is placed at `videoRectX/Y/W/H` (Scene coordinates).
        // We need to map [Video Rect in Scene] -> [Visual Screen Coordinates].

        const containerW = container.width;
        const containerH = container.height;
        const containerRatio = containerW / containerH;

        let canvasRatio = targetRatio;

        let visualCanvasW, visualCanvasH;
        if (containerRatio > canvasRatio) {
            visualCanvasH = containerH;
            visualCanvasW = containerH * canvasRatio;
        } else {
            visualCanvasW = containerW;
            visualCanvasH = containerW / canvasRatio;
        }

        const visualCanvasX = (containerW - visualCanvasW) / 2;
        const visualCanvasY = (containerH - visualCanvasH) / 2;

        // Now calculate Video Rect relative to Scene (Normalized 0-1)
        let sceneVideoX, sceneVideoY, sceneVideoW, sceneVideoH;
        // Logic duplicated from CanvasPlayer (ideally shared, but sim is okay)

        // Canvas Dimensions (Virtual Scene Resolution)
        // We need this to calculate accurate "Inset" padding scale?
        // Actually we just need ratios.

        // Scene W/H logic from CanvasPlayer:
        let sceneW = videoW;
        let sceneH = videoH;
        if (aspectRatio !== 'Native') {
            if (targetRatio >= 1) {
                sceneH = videoH;
                sceneW = sceneH * targetRatio;
            } else {
                sceneW = videoH; // 9:16 logic
                sceneH = sceneW / targetRatio;
            }
        }

        // Video Placement in Scene
        let vrX = 0, vrY = 0, vrW = sceneW, vrH = sceneH;

        if (backgroundMode === 'hidden') {
            // Contain with bars
            const sceneRatio = sceneW / sceneH;
            if (sceneRatio > videoRatio) {
                vrH = sceneH;
                vrW = vrH * videoRatio;
                vrX = (sceneW - vrW) / 2;
            } else {
                vrW = sceneW;
                vrH = vrW / videoRatio;
                vrY = (sceneH - vrH) / 2;
                vrX = 0; // Fix X centering?
                // Wait, logic in CanvasPlayer:
                // else { videoRectW = canvasW; videoRectH = videoRectW / videoRatio; videoRectX = 0; videoRectY = ... }
                // Yes.
            }
        } else {
            // Inset
            const scaleBase = Math.min(sceneW, sceneH) / 1080;
            const scaledPadding = insetPadding * scaleBase;
            const safeW = sceneW - (scaledPadding * 2);
            const safeH = sceneH - (scaledPadding * 2);
            const fitScale = Math.min(safeW / videoW, safeH / videoH);

            vrW = videoW * fitScale;
            vrH = videoH * fitScale;
            vrX = (sceneW - vrW) / 2;
            vrY = (sceneH - vrH) / 2;
        }

        // Map Scene Video Rect to Visual Canvas Rect
        // Visual Canvas is the Scene.
        const renderX = visualCanvasX + (vrX / sceneW) * visualCanvasW;
        const renderY = visualCanvasY + (vrY / sceneH) * visualCanvasH;
        const renderW = (vrW / sceneW) * visualCanvasW;
        const renderH = (vrH / sceneH) * visualCanvasH;

        return {
            x: renderX,
            y: renderY,
            width: renderW,
            height: renderH
        };
    }

    const videoRect = getVideoRect();
    const selectedSegment = segments.find(s => s.id === selectedSegmentId);

    // We only show overlay if Position Mode is Fixed
    const showZoomOverlay = selectedSegment && selectedSegment.positionMode === 'fixed';

    if (loading) {
        return (
            <div className="editor-loading">
                <div className="spinner"></div>
                <p>Loading recording...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="editor-error">
                <h1>Error</h1>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="editor">
            <header className="editor-header">
                <div className="header-left">
                    <h1 className="header-title">
                        <Film size={22} />
                        Beunta Editor
                    </h1>
                    <div className="header-info">
                        <span><Zap size={14} /> {segments.length} segments</span>
                        <span><HardDrive size={14} /> {(recording.size / 1024 / 1024).toFixed(1)} MB</span>
                    </div>
                </div>
                <div className="header-right">
                    {hasPendingEdits && (
                        <button
                            className="btn-save-changes-header"
                            onClick={handleSaveChanges}
                            title="Save timeline edits (Cmd+s)"
                        >
                            Save Changes (Cmd+s)
                        </button>
                    )}

                    <div className="time-display">
                        <Play size={14} />
                        <span className="time-current">{formatTime(currentTime)}</span>
                        <span className="time-separator">/</span>
                        <span className="time-duration">{formatTime(duration)}</span>
                    </div>
                </div>
            </header>

            <main className="editor-main">
                <div className="canvas-section" onClick={() => setSelectedSegmentId(null)}>
                    <div className="canvas-container" ref={canvasContainerRef}>
                        <CanvasPlayer
                            ref={canvasPlayerRef}
                            recording={recording}
                            isPlaying={isPlaying}
                            currentTime={currentTime}
                            segments={segments}
                            zoomLevel={zoomLevel}
                            zoomDuration={zoomDuration}
                            transitionDuration={transitionDuration}
                            playbackSpeed={playbackSpeed}
                            aspectRatio={aspectRatio}
                            backgroundColor={backgroundColor}
                            backgroundMode={backgroundMode}
                            backgroundValue={backgroundValue}
                            backgroundBlur={backgroundBlur}
                            insetPadding={insetPadding}
                            showShadow={showShadow}
                            showBorder={showBorder}
                            borderRadius={borderRadius}
                            isMuted={isMuted}
                            showFollowCursor={showFollowCursor}
                            onTimeUpdate={handleTimeUpdate}
                            onDurationChange={handleDurationChange}
                            onVideoDimensions={handleVideoDimensions}
                            onSeek={handleSeek}
                        />

                        {/* Custom Zoom Overlay */}
                        {showZoomOverlay && (
                            <div
                                className="zoom-overlay-container"
                                style={{
                                    position: 'absolute',
                                    left: videoRect.x,
                                    top: videoRect.y,
                                    width: videoRect.width,
                                    height: videoRect.height,
                                    pointerEvents: 'none', // Allow clicks to pass through to video controls if not hitting drag box
                                    zIndex: 10
                                }}
                            >
                                <Rnd
                                    position={{
                                        x: selectedSegment.x * videoRect.width - ((videoRect.width / selectedSegment.zoomLevel) / 2),
                                        y: selectedSegment.y * videoRect.height - ((videoRect.height / selectedSegment.zoomLevel) / 2)
                                    }}
                                    size={{
                                        width: videoRect.width / selectedSegment.zoomLevel,
                                        height: videoRect.height / selectedSegment.zoomLevel
                                    }}
                                    enableResizing={false}
                                    onDragStop={(e, d) => {
                                        // Calculate center point from top-left drag position
                                        const halfW = (videoRect.width / selectedSegment.zoomLevel) / 2;
                                        const halfH = (videoRect.height / selectedSegment.zoomLevel) / 2;

                                        const centerX = d.x + halfW;
                                        const centerY = d.y + halfH;

                                        // Normalize to 0-1
                                        const normX = Math.max(0, Math.min(1, centerX / videoRect.width));
                                        const normY = Math.max(0, Math.min(1, centerY / videoRect.height));

                                        updateSegment(selectedSegment.id, { x: normX, y: normY }, true);
                                    }}
                                    bounds="parent"
                                    style={{
                                        border: '2px solid #FE6D73',
                                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', // Dim surroundings
                                        pointerEvents: 'auto',
                                        cursor: 'move'
                                    }}
                                >
                                    <div className="zoom-target-label">
                                        Zoom Target
                                    </div>
                                </Rnd>
                            </div>
                        )}
                    </div>
                </div>

                <aside className="sidebar">
                    <div className="sidebar-section">
                        <h3><Settings size={14} /> Zoom Settings</h3>

                        {selectedSegmentId ? (
                            // Show per-segment zoom level when a segment is selected
                            <>
                                <div className="setting-info">
                                    <span>Selected Segment Settings</span>
                                </div>

                                {/* Position Mode Selector */}
                                <div className="setting-row">
                                    <div className="setting-label">
                                        <span>Position Mode</span>
                                    </div>
                                    <div className="segment-mode-toggle">
                                        <button
                                            className={`mode-btn ${segments.find(s => s.id === selectedSegmentId)?.positionMode !== 'fixed' ? 'active' : ''}`}
                                            onClick={() => updateSegment(selectedSegmentId, { positionMode: 'follow' }, true)}
                                            title="Camera follows cursor (auto)"
                                        >
                                            <MousePointer2 size={14} /> Follow
                                        </button>
                                        <button
                                            className={`mode-btn ${segments.find(s => s.id === selectedSegmentId)?.positionMode === 'fixed' ? 'active' : ''}`}
                                            onClick={() => updateSegment(selectedSegmentId, { positionMode: 'fixed' }, true)}
                                            title="Fixed position (manual)"
                                        >
                                            <Lock size={14} /> Fixed
                                        </button>
                                    </div>
                                </div>

                                <div className="setting-row">
                                    <div className="setting-label">
                                        <span>Zoom Level</span>
                                        <span className="setting-value">
                                            {segments.find(s => s.id === selectedSegmentId)?.zoomLevel?.toFixed(1) || '2.0'}x
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        className="setting-slider"
                                        min="1.2"
                                        max="4"
                                        step="0.1"
                                        value={segments.find(s => s.id === selectedSegmentId)?.zoomLevel || 2}
                                        onChange={(e) => {
                                            updateSegment(selectedSegmentId, { zoomLevel: parseFloat(e.target.value) }, false);
                                        }}
                                        onMouseUp={() => {
                                            // Save to history when done dragging
                                            const newSegments = [...segments];
                                            saveHistory(newSegments);
                                        }}
                                    />
                                </div>
                            </>
                        ) : (
                            // Show global default zoom level when no segment is selected
                            <>
                                <div className="setting-info">
                                    <span>Default for New Segments</span>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-label">
                                        <span>Zoom Level</span>
                                        <span className="setting-value">{zoomLevel}x</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="setting-slider"
                                        min="1.2"
                                        max="4"
                                        step="0.1"
                                        value={zoomLevel}
                                        onChange={(e) => {
                                            setZoomLevel(parseFloat(e.target.value));
                                            setHasPendingEdits(true);
                                        }}
                                    />
                                </div>
                            </>
                        )}

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Hold Duration</span>
                                <span className="setting-value">{zoomDuration}ms</span>
                            </div>
                            <input
                                type="range"
                                className="setting-slider"
                                min="200"
                                max="2000"
                                step="100"
                                value={zoomDuration}
                                onChange={(e) => {
                                    setZoomDuration(parseInt(e.target.value));
                                    setHasPendingEdits(true);
                                }}
                            />
                        </div>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Transition Speed</span>
                                <span className="setting-value">{transitionDuration}ms</span>
                            </div>
                            <input
                                type="range"
                                className="setting-slider"
                                min="100"
                                max="800"
                                step="50"
                                value={transitionDuration}
                                onChange={(e) => {
                                    setTransitionDuration(parseInt(e.target.value));
                                    setHasPendingEdits(true);
                                }}
                            />
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3><Gauge size={14} /> Playback</h3>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Speed</span>
                                <span className="setting-value">{playbackSpeed}x</span>
                            </div>
                            <input
                                type="range"
                                className="setting-slider"
                                min="0.25"
                                max="2"
                                step="0.25"
                                value={playbackSpeed}
                                onChange={(e) => {
                                    setPlaybackSpeed(parseFloat(e.target.value));
                                    setHasPendingEdits(true);
                                }}
                            />
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3><Film size={14} /> Framing</h3>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Aspect Ratio</span>
                            </div>
                            <select
                                className="setting-select"
                                value={aspectRatio}
                                onChange={(e) => {
                                    setAspectRatio(e.target.value);
                                    setHasPendingEdits(true);
                                }}
                            >
                                <option value="Native">Native (Match Video)</option>
                                <option value="16:9">Landscape (16:9)</option>
                                <option value="9:16">TiKTok / Reel (9:16)</option>
                                <option value="1:1">Square (1:1)</option>
                                <option value="4:5">Instagram (4:5)</option>
                            </select>
                        </div>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Background</span>
                            </div>
                            <div className="bg-checkered-preview">
                                <div
                                    className="bg-preview-fill"
                                    style={{
                                        background: backgroundMode === 'image' && backgroundValue ? `url(${backgroundValue}) center/cover` :
                                            backgroundMode === 'gradient' ? backgroundValue :
                                                backgroundMode === 'color' ? backgroundColor : '#1a2e3b'
                                    }}
                                />
                            </div>
                        </div>

                        <div className="bg-mode-selector">
                            {['hidden', 'color', 'gradient', 'image'].map(mode => (
                                <button
                                    key={mode}
                                    className={`bg-mode-btn ${backgroundMode === mode ? 'active' : ''}`}
                                    onClick={() => {
                                        setBackgroundMode(mode);
                                        setHasPendingEdits(true);
                                    }}
                                >
                                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                </button>
                            ))}
                        </div>

                        {backgroundMode === 'color' && (
                            <div className="setting-row">
                                <span className="setting-sublabel">Color</span>
                                <input
                                    type="color"
                                    className="color-picker"
                                    value={backgroundColor}
                                    onChange={(e) => {
                                        setBackgroundColor(e.target.value);
                                        setHasPendingEdits(true);
                                    }}
                                />
                            </div>
                        )}

                        {backgroundMode === 'gradient' && (
                            <div className="presets-grid">
                                {['linear-gradient(to right, #ff7e5f, #feb47b)',
                                    'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
                                    'linear-gradient(to top, #cfd9df 0%, #e2ebf0 100%)',
                                    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    'linear-gradient(to right, #43e97b 0%, #38f9d7 100%)',
                                    'linear-gradient(to top, #30cfd0 0%, #330867 100%)'
                                ].map((grad, i) => (
                                    <button
                                        key={i}
                                        className="preset-btn"
                                        style={{ background: grad }}
                                        onClick={() => {
                                            setBackgroundValue(grad);
                                            setHasPendingEdits(true);
                                        }}
                                    />
                                ))}
                            </div>
                        )}

                        {backgroundMode === 'image' && (
                            <div className="presets-grid">
                                {['https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=400&h=250&q=80',
                                    'https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=400&h=250&q=80',
                                    'https://images.unsplash.com/photo-1620121692029-d088224ddc74?auto=format&fit=crop&w=400&h=250&q=80',
                                    'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=400&h=250&q=80'
                                ].map((img, i) => (
                                    <button
                                        key={i}
                                        className="preset-btn"
                                        style={{ backgroundImage: `url(${img})` }}
                                        onClick={() => {
                                            setBackgroundValue(img);
                                            setHasPendingEdits(true);
                                        }}
                                    />
                                ))}
                            </div>
                        )}

                        {backgroundMode !== 'hidden' && (
                            <>
                                <div className="setting-row">
                                    <div className="setting-label">
                                        <span>Padding</span>
                                        <span className="setting-value">{insetPadding}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="setting-slider"
                                        min="0"
                                        max="200"
                                        step="10"
                                        value={insetPadding}
                                        onChange={(e) => {
                                            setInsetPadding(parseInt(e.target.value));
                                            setHasPendingEdits(true);
                                        }}
                                    />
                                </div>
                                <div className="checkbox-group">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={showShadow}
                                            onChange={(e) => setShowShadow(e.target.checked)}
                                        />
                                        <span>Shadow</span>
                                    </label>
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={showBorder}
                                            onChange={(e) => setShowBorder(e.target.checked)}
                                        />
                                        <span>Border</span>
                                    </label>
                                </div>
                                <div className="setting-row">
                                    <div className="setting-label">
                                        <span>Border Radius</span>
                                        <span className="setting-value">{borderRadius}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="setting-slider"
                                        min="0"
                                        max="100"
                                        step="4"
                                        value={borderRadius}
                                        onChange={(e) => {
                                            setBorderRadius(parseInt(e.target.value));
                                            setHasPendingEdits(true);
                                        }}
                                    />
                                </div>
                            </>
                        )}


                        <div className="setting-row">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={showFollowCursor}
                                    onChange={(e) => setShowFollowCursor(e.target.checked)}
                                />
                                <span>Follow Cursor Mode</span>
                            </label>
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3><Scissors size={14} /> Trim</h3>

                        <div className="trim-controls">
                            <div className="trim-input">
                                <label>In</label>
                                <input
                                    type="text"
                                    value={formatTime(trimStart)}
                                    readOnly
                                />
                                <button
                                    className="trim-btn"
                                    onClick={() => setTrimStart(currentTime)}
                                    title="Set to current time (I)"
                                >
                                    Set
                                </button>
                            </div>
                            <div className="trim-input">
                                <label>Out</label>
                                <input
                                    type="text"
                                    value={formatTime(trimEnd || duration)}
                                    readOnly
                                />
                                <button
                                    className="trim-btn"
                                    onClick={() => setTrimEnd(currentTime)}
                                    title="Set to current time (O)"
                                >
                                    Set
                                </button>
                            </div>
                        </div>

                        <div className="keyboard-hints">
                            <span><kbd>Space</kbd> Play</span>
                            <span><kbd>I</kbd> In</span>
                            <span><kbd>O</kbd> Out</span>
                            <span><kbd>Ctrl+Z</kbd> Undo</span>
                        </div>
                    </div>

                </aside>
            </main>

            {/* Timeline */}
            <div className="timeline-section">
                <Timeline
                    duration={duration}
                    currentTime={currentTime}
                    segments={segments}
                    selectedSegmentId={selectedSegmentId}
                    trimStart={trimStart}
                    trimEnd={trimEnd || duration}
                    onSeek={handleSeek}
                    onAddSegment={addSegment}
                    onUpdateSegment={updateSegment}
                    onSelectSegment={setSelectedSegmentId}
                    onDeleteSegment={deleteSegment}
                    onResetTimeline={resetTimeline}
                    onTrimChange={handleTrimChange}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                />
            </div>

            <footer className="editor-controls">
                <div className="playback-controls">
                    <button className="btn-control btn-small" onClick={() => handleSkip(-5)}>
                        <SkipBack size={18} />
                    </button>
                    <button className="btn-control btn-play" onClick={handlePlayPause}>
                        {isPlaying ? <Pause size={22} /> : <Play size={22} />}
                    </button>
                    <button className="btn-control btn-small" onClick={() => handleSkip(5)}>
                        <SkipForward size={18} />
                    </button>
                    <button 
                        className="btn-control btn-small" 
                        onClick={() => setIsMuted(!isMuted)}
                        title={isMuted ? "Unmute" : "Mute"}
                    >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                </div>

                <div className="export-controls">
                    {isExporting ? (
                        <div className="export-progress">
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${exportProgress}%` }}></div>
                            </div>
                            <span className="progress-text">{Math.round(exportProgress)}%</span>
                        </div>
                    ) : (
                        <>
                            <select
                                className="quality-select"
                                value={exportQuality}
                                onChange={(e) => setExportQuality(e.target.value)}
                                title="Export quality"
                            >
                                <option value="best-performance">Best Performance & Speed</option>
                                <option value="best-quality">Best Quality (High Bitrate)</option>
                            </select>
                            <select
                                className="quality-select"
                                value={exportFormat}
                                onChange={(e) => setExportFormat(e.target.value)}
                                title="Export format"
                            >
                                <option value="mp4">MP4</option>
                                <option value="webm">WebM</option>
                            </select>
                            <select
                                className="quality-select"
                                value={exportScale}
                                onChange={(e) => setExportScale(parseInt(e.target.value))}
                                title="Resolution scale"
                            >
                                <option value="1">1x (Original)</option>
                                <option value="2">2x (Double)</option>
                            </select>
                            {exportFormat === 'mp4' && (
                                <select
                                    className="quality-select"
                                    value={conversionService}
                                    onChange={(e) => setConversionService(e.target.value)}
                                    title="Conversion service"
                                >
                                    <option value="local">Local (Browser)</option>
                                    <option value="cloud">Cloud (Backend)</option>
                                </select>
                            )}
                            <button className="btn-export" onClick={handleExport}>
                                <Download size={18} />
                                Export Video
                            </button>
                        </>
                    )}
                </div>
            </footer>
        </div >
    );
}

const root = createRoot(document.getElementById('root'));
root.render(<Editor />);
