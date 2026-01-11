import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Film, Play, Pause, SkipBack, SkipForward,
    Download, Zap, HardDrive, Settings,
    ZoomIn, Gauge, Scissors
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
    const [exportQuality, setExportQuality] = useState('high'); // high, medium, low
    const [exportScale, setExportScale] = useState(1); // 1x, 2x, 3x, 4x
    const [exportFormat, setExportFormat] = useState('mp4'); // mp4, webm

    // Zoom settings
    const [zoomLevel, setZoomLevel] = useState(2);
    const [zoomDuration, setZoomDuration] = useState(800);
    const [transitionDuration, setTransitionDuration] = useState(300);

    // Playback speed
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // Aspect ratio and framing (Cursorful-style)
    const [aspectRatio, setAspectRatio] = useState('16:9'); // 16:9, 9:16, 1:1, 4:5
    const [backgroundColor, setBackgroundColor] = useState('#1a2e3b');
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
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentTime, handleUndo, handleRedo]);

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
                    zoomLevel: seg.zoomLevel !== undefined ? seg.zoomLevel : 2 // Default to 2x if missing
                }));
                setSegments(segmentsWithZoom);
                setHistory([JSON.stringify(segmentsWithZoom)]);
                setHistoryIndex(0);
                hasInitializedSegments.current = true; // Mark as already initialized
            }

            // Load saved editor settings if they exist
            if (rec.editorSettings) {
                const settings = rec.editorSettings;
                if (settings.zoomLevel !== undefined) setZoomLevel(settings.zoomLevel);
                if (settings.zoomDuration !== undefined) setZoomDuration(settings.zoomDuration);
                if (settings.transitionDuration !== undefined) setTransitionDuration(settings.transitionDuration);
                if (settings.playbackSpeed !== undefined) setPlaybackSpeed(settings.playbackSpeed);
                if (settings.aspectRatio !== undefined) setAspectRatio(settings.aspectRatio);
                if (settings.backgroundColor !== undefined) setBackgroundColor(settings.backgroundColor);
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

    const handleSeek = useCallback((time) => {
        if (Number.isFinite(time)) {
            const clampedTime = Math.max(0, Math.min(duration, time));
            setCurrentTime(clampedTime);
            setIsPlaying(false);
        }
    }, [duration]);

    const handleSkip = useCallback((seconds) => {
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        if (Number.isFinite(newTime)) {
            setCurrentTime(newTime);
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
            x: 0.5, // Normalized center
            y: 0.5,
            viewportWidth: 1920,
            viewportHeight: 1080
        };
        const newSegments = [...segments, newSegment].sort((a, b) => a.startTime - b.startTime);
        setSegments(newSegments);
        setHasPendingEdits(true); // Mark as having pending edits
        saveHistory(newSegments);
    }, [currentTime, zoomDuration, zoomLevel, segments, saveHistory]);

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
                        backgroundColor,
                        trimStart,
                        trimEnd
                    }
                });
            }
        } catch (err) {
            console.error('Failed to save settings:', err);
        }

        // Force re-render by seeking to current position
        const pos = currentTime;
        setCurrentTime(0);
        setTimeout(() => setCurrentTime(pos), 10);
    }, [segments, currentTime, zoomLevel, zoomDuration, transitionDuration, playbackSpeed, aspectRatio, backgroundColor, trimStart, trimEnd]);

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

            // Quality presets
            const qualitySettings = {
                high: { bitrate: 8000000, fps: 30 },
                medium: { bitrate: 4000000, fps: 30 },
                low: { bitrate: 2000000, fps: 24 }
            };

            const quality = qualitySettings[exportQuality] || qualitySettings.high;

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
                    exportQuality, // Pass quality for FFmpeg conversion
                    exportScale, // Pass scale for resolution upscaling
                    format: exportFormat,
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
                            title="Save timeline edits"
                        >
                            💾 Save Changes
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
                <div className="canvas-section">
                    <div className="canvas-container">
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
                            showFollowCursor={showFollowCursor}
                            onTimeUpdate={handleTimeUpdate}
                            onDurationChange={handleDurationChange}
                            onSeek={handleSeek}
                        />
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
                                <option value="16:9">Landscape (16:9)</option>
                                <option value="9:16">Mobile (9:16)</option>
                                <option value="1:1">Square (1:1)</option>
                                <option value="4:5">Instagram (4:5)</option>
                            </select>
                        </div>

                        <div className="setting-row">
                            <div className="setting-label">
                                <span>Background</span>
                            </div>
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
                                <option value="high">High Quality</option>
                                <option value="medium">Medium Quality</option>
                                <option value="low">Low Quality</option>
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
