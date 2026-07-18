import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import {
    Plus, ZoomIn, Scissors, Trash2, RotateCcw, RotateCw,
    RefreshCw, ZoomOut, Crop, ChevronDown, Layers, X, Captions
} from 'lucide-react';
import { formatTime } from '../utils/time.js';

const Timeline = React.memo(function Timeline({
    duration,
    currentTime,
    registerPlayhead,
    segments = [],
    tracks = [{ id: 0, label: 'Track 1' }],
    selectedSegmentId,
    onSeek,
    onAddSegment,
    onAddTrack,
    onRemoveTrack,
    onUpdateSegment,
    onSelectSegment,
    onDeleteSegment,
    onResetTimeline,
    trimStart = 0,
    trimEnd,
    onTrimChange,
    onUndo,
    onRedo,
    captions = [],
    onUpdateCaption,
    onSelectCaption
}) {
    const rulerTrackRef = useRef(null);
    const segmentsTrackRef = useRef(null);
    const captionsTrackRef = useRef(null);
    const [timelineZoom, setTimelineZoom] = useState(1);
    const [isTrimMode, setIsTrimMode] = useState(false);
    const [trimDragging, setTrimDragging] = useState(null);
    const [showSegmentTypeMenu, setShowSegmentTypeMenu] = useState(false);
    const [activeTrackId, setActiveTrackId] = useState(tracks[0]?.id ?? 0);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowSegmentTypeMenu(false);
            }
        };

        if (showSegmentTypeMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showSegmentTypeMenu]);

    // Generate time markers based on duration
    const timeMarkers = useMemo(() => {
        if (!duration || duration <= 0) return [];

        const markers = [];
        let interval = 1;
        if (duration > 60) interval = 5;
        if (duration > 300) interval = 10;
        if (duration > 600) interval = 30;

        interval = Math.max(1, Math.floor(interval / timelineZoom));

        for (let t = 0; t <= duration; t += interval) {
            markers.push(t);
        }
        return markers;
    }, [duration, timelineZoom]);

    const getPositionPercent = useCallback((time) => {
        if (!duration || duration <= 0) return 0;
        return Math.max(0, Math.min(100, (time / duration) * 100));
    }, [duration]);

    const getTimeFromPosition = useCallback((clientX) => {
        if (!rulerTrackRef.current || !duration) return 0;
        const rect = rulerTrackRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        return percent * duration;
    }, [duration]);

    const handleTimelineClick = useCallback((e) => {
        if (trimDragging) return;
        // Deselect current segment when clicking timeline background
        if (onSelectSegment) onSelectSegment(null);
        
        const time = getTimeFromPosition(e.clientX);
        if (Number.isFinite(time) && onSeek) {
            onSeek(time);
        }
    }, [trimDragging, getTimeFromPosition, onSeek, onSelectSegment]);

    const handleTrimMouseDown = useCallback((e, edge) => {
        e.stopPropagation();
        e.preventDefault();
        setTrimDragging(edge);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!rulerTrackRef.current) return;

            if (trimDragging && onTrimChange) {
                const time = getTimeFromPosition(e.clientX);
                const actualTrimEnd = trimEnd || duration;
                if (trimDragging === 'start') {
                    onTrimChange(Math.max(0, Math.min(time, actualTrimEnd - 0.5)), actualTrimEnd);
                } else if (trimDragging === 'end') {
                    onTrimChange(trimStart, Math.min(duration, Math.max(time, trimStart + 0.5)));
                }
            }
        };

        const handleMouseUp = () => {
            setTrimDragging(null);
        };

        if (trimDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [trimDragging, segments, duration, trimStart, trimEnd, onTrimChange, getTimeFromPosition]);

    const actualTrimEnd = trimEnd || duration;

    // Browsers report a Mac trackpad pinch gesture as a wheel event with
    // ctrlKey set (there's no dedicated pinch event on the web platform).
    // Plain two-finger scroll (no ctrlKey) is left alone so it still scrolls
    // the timeline horizontally via the container's native overflow.
    const handleWheelZoom = useCallback((e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = -e.deltaY * 0.01;
        setTimelineZoom((z) => Math.max(0.5, Math.min(4, z + delta)));
    }, []);

    return (
        <div className="timeline-editor">
            {/* Toolbar */}
            <div className="timeline-toolbar">
                <div className="toolbar-left">
                    <div className="toolbar-dropdown" ref={dropdownRef}>
                        <button
                            className="toolbar-btn dropdown-trigger"
                            onClick={() => setShowSegmentTypeMenu(!showSegmentTypeMenu)}
                            title="Add segment at current time"
                        >
                            <Plus size={16} />
                            <span>Add Segment</span>
                            <ChevronDown size={14} />
                        </button>
                        {showSegmentTypeMenu && (
                            <div className="dropdown-menu">
                                <button
                                    className="dropdown-item"
                                    onClick={() => {
                                        onAddSegment && onAddSegment('zoom', activeTrackId);
                                        setShowSegmentTypeMenu(false);
                                    }}
                                >
                                    <ZoomIn size={14} />
                                    <span>Zoom</span>
                                </button>
                                <button
                                    className="dropdown-item"
                                    onClick={() => {
                                        onAddSegment && onAddSegment('crop', activeTrackId);
                                        setShowSegmentTypeMenu(false);
                                    }}
                                >
                                    <Crop size={14} />
                                    <span>Crop</span>
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        className={`toolbar-btn ${isTrimMode ? 'active' : ''}`}
                        onClick={() => {
                            setIsTrimMode(!isTrimMode);
                        }}
                        title="Toggle trim mode - Resize timeline to trim video"
                    >
                        <Crop size={16} />
                        <span>{isTrimMode ? 'Trim Mode' : 'Trim'}</span>
                    </button>

                    <button
                        className="toolbar-btn"
                        onClick={() => {
                            onDeleteSegment && onDeleteSegment();
                        }}
                        title="Delete segment"
                    >
                        <Trash2 size={16} />
                    </button>

                    <div className="toolbar-divider" />

                    <button
                        className="toolbar-btn"
                        onClick={() => {
                            onUndo && onUndo();
                        }}
                        title="Undo (Ctrl+Z)"
                    >
                        <RotateCcw size={16} />
                    </button>
                    <button
                        className="toolbar-btn"
                        onClick={() => {
                            onRedo && onRedo();
                        }}
                        title="Redo (Ctrl+Y)"
                    >
                        <RotateCw size={16} />
                    </button>

                    <button
                        className="toolbar-btn"
                        onClick={() => {
                            onResetTimeline && onResetTimeline();
                        }}
                        title="Reset timeline"
                    >
                        <RefreshCw size={16} />
                        <span>Reset</span>
                    </button>
                </div>

                <div className="timeline-legend" title="Segment colors on the tracks below">
                    <span className="legend-item"><span className="legend-swatch legend-swatch-zoom" /> Zoom segment</span>
                    <span className="legend-item"><span className="legend-swatch legend-swatch-crop" /> Crop segment</span>
                    <span className="legend-item"><span className="legend-swatch legend-swatch-trim" /> Trimmed region</span>
                </div>

                <div className="toolbar-right">
                    <div className="zoom-control">
                        <button
                            className="zoom-btn"
                            onClick={() => setTimelineZoom(Math.max(0.5, timelineZoom - 0.5))}
                            title="Zoom out timeline (or Ctrl+scroll)"
                        >
                            <ZoomOut size={14} />
                        </button>
                        <input
                            type="range"
                            min="0.5"
                            max="4"
                            step="0.25"
                            value={timelineZoom}
                            onChange={(e) => setTimelineZoom(parseFloat(e.target.value))}
                            className="zoom-slider"
                            title="Timeline zoom (or Ctrl+scroll)"
                        />
                        <span className="zoom-label">{timelineZoom.toFixed(1)}x</span>
                        <button
                            className="zoom-btn"
                            onClick={() => setTimelineZoom(Math.min(4, timelineZoom + 0.5))}
                            title="Zoom in timeline (or Ctrl+scroll)"
                        >
                            <ZoomIn size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable Timeline Area */}
            <div
                className="timeline-scroll-area"
                style={{ overflowX: 'auto', overflowY: 'hidden' }}
                onWheel={handleWheelZoom}
            >
                <div
                    className="tracks-wrapper"
                    style={{
                        width: `${timelineZoom * 100}%`,
                        minWidth: '100%',
                        position: 'relative' // Ensure absolute children are relative to this
                    }}
                >
                    {/* Time Ruler */}
                    <div className="time-ruler">
                        <div className="segments-track" style={{ gap: '8px' }}>
                            <div className="track-label" style={{ opacity: 0 }}>
                                <ZoomIn size={14} />
                            </div>
                            <div className="ruler-track" ref={rulerTrackRef} onClick={handleTimelineClick} style={{ flex: 1 }}>
                                {/* Time markers */}
                                {timeMarkers.map((time) => (
                                    <div
                                        key={time}
                                        className="time-marker"
                                        style={{ left: `${getPositionPercent(time)}%` }}
                                    >
                                        <div className="marker-line" />
                                        <span className="marker-label">{formatTime(time)}</span>
                                    </div>
                                ))}

                                {/* Auto-zoom indicators */}
                                {segments.filter(s => s.type === 'zoom').map((segment) => (
                                    <div
                                        key={`indicator-${segment.id}`}
                                        className="zoom-indicator"
                                        style={{
                                            left: `${getPositionPercent(segment.startTime / 1000)}%`,
                                            width: `${Math.max((segment.duration / 1000 / duration) * 100, 0.5)}%`
                                        }}
                                        title={`Auto-zoom at ${formatTime(segment.startTime / 1000)}`}
                                    />
                                ))}

                                {/* Trim regions */}
                                {trimStart > 0 && (
                                    <div
                                        className="trim-region trim-start"
                                        style={{ width: `${getPositionPercent(trimStart)}%` }}
                                    />
                                )}
                                {actualTrimEnd < duration && (
                                    <div
                                        className="trim-region trim-end"
                                        style={{
                                            left: `${getPositionPercent(actualTrimEnd)}%`,
                                            width: `${getPositionPercent(duration - actualTrimEnd)}%`
                                        }}
                                    />
                                )}

                                {/* Trim handles */}
                                {isTrimMode && (
                                    <>
                                        <div
                                            className="trim-handle start"
                                            style={{ left: `${getPositionPercent(trimStart)}%` }}
                                            onMouseDown={(e) => handleTrimMouseDown(e, 'start')}
                                        />
                                        <div
                                            className="trim-handle end"
                                            style={{ left: `${getPositionPercent(actualTrimEnd)}%` }}
                                            onMouseDown={(e) => handleTrimMouseDown(e, 'end')}
                                        />
                                    </>
                                )}

                                {/* Playhead — position driven imperatively via
                                    registerPlayhead (rAF while playing, currentTime
                                    sync while paused) for smooth 60fps motion. */}
                                <div
                                    ref={registerPlayhead}
                                    className="playhead"
                                    style={{
                                        left: `${getPositionPercent(currentTime)}%`,
                                        display: duration > 0 ? 'block' : 'none'
                                    }}
                                >
                                    <div className="playhead-head" />
                                    <div className="playhead-line" />
                                </div>
                            </div>
                            <div className="track-label" style={{ opacity: 0 }}>
                                <Scissors size={14} />
                            </div>
                        </div>
                    </div>

                    {/* Segment Tracks — one row per track, so segments on different
                        tracks can occupy the same time range (stacking). */}
                    {tracks.map((track, trackIdx) => {
                        const trackSegments = segments.filter((s) => (s.trackId ?? 0) === track.id);
                        return (
                            <div
                                className={`segments-track ${activeTrackId === track.id ? 'track-active' : ''}`}
                                key={track.id}
                            >
                                <div className="track-label" title={track.label}>
                                    <Layers size={14} />
                                    {tracks.length > 1 && (
                                        <button
                                            className="track-remove-btn"
                                            title={`Remove ${track.label}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveTrack && onRemoveTrack(track.id);
                                            }}
                                        >
                                            <X size={10} />
                                        </button>
                                    )}
                                </div>
                                <div
                                    className="track-content"
                                    ref={trackIdx === 0 ? segmentsTrackRef : undefined}
                                    onClick={() => {
                                        setActiveTrackId(track.id);
                                        onSelectSegment && onSelectSegment(null);
                                    }}
                                >
                                    {trackSegments.map((segment) => {
                                        const leftPercent = getPositionPercent(segment.startTime / 1000);
                                        const widthPercent = (segment.duration / 1000 / duration) * 100;
                                        const trackWidth = segmentsTrackRef.current?.getBoundingClientRect().width || 1000;

                                        const minWidthPx = Math.max(2, (0.2 / duration) * trackWidth); // Minimum 0.2s visible or 2px

                                        return (
                                            <Rnd
                                                key={segment.id}
                                                position={{
                                                    x: (leftPercent / 100) * trackWidth,
                                                    y: 4
                                                }}
                                                size={{
                                                    width: Math.max((widthPercent / 100) * trackWidth, minWidthPx),
                                                    height: 32
                                                }}
                                                onDragStop={(e, d) => {
                                                    const newLeftPercent = (d.x / trackWidth) * 100;
                                                    const newTime = (newLeftPercent / 100) * duration * 1000;
                                                    onUpdateSegment(segment.id, { startTime: Math.max(0, newTime) }, true);
                                                }}
                                                onResizeStop={(e, direction, ref, delta, position) => {
                                                    const newWidth = parseInt(ref.style.width);
                                                    const newLeftPercent = (position.x / trackWidth) * 100;
                                                    const widthPercent = (newWidth / trackWidth) * 100;

                                                    const updates = {};
                                                    if (direction.includes('left')) {
                                                        const newTime = (newLeftPercent / 100) * duration * 1000;
                                                        const oldEndTime = segment.startTime + segment.duration;
                                                        updates.startTime = Math.max(0, newTime);
                                                        updates.duration = oldEndTime - updates.startTime;
                                                    } else if (direction.includes('right')) {
                                                        updates.duration = (widthPercent / 100) * duration * 1000;
                                                    }

                                                    onUpdateSegment(segment.id, updates, true);
                                                }}
                                                bounds="parent"
                                                enableResizing={{
                                                    left: true,
                                                    right: true,
                                                    top: false,
                                                    bottom: false
                                                }}
                                                resizeHandleStyles={{
                                                    left: { width: '8px', cursor: 'ew-resize' },
                                                    right: { width: '8px', cursor: 'ew-resize' }
                                                }}
                                                dragAxis="x"
                                                className={`segment-rnd segment-${segment.type || 'zoom'} ${selectedSegmentId === segment.id ? 'segment-selected' : ''
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveTrackId(track.id);
                                                    onSelectSegment && onSelectSegment(segment.id);
                                                }}
                                            >
                                                <div className="segment-content">
                                                    {segment.type === 'crop' ? <Crop size={12} /> : <ZoomIn size={12} />}
                                                    <span>
                                                        {segment.type === 'crop' ? 'Crop' :
                                                            segment.type === 'typing' ? 'Type' :
                                                                segment.type === 'selection' ? 'Select' :
                                                                    segment.type === 'dblclick' ? 'DblClick' :
                                                                        segment.type === 'click' ? 'Click' : 'Zoom'}
                                                    </span>
                                                </div>
                                            </Rnd>
                                        );
                                    })}
                                </div>
                                <div className="track-label" style={{ opacity: 0 }}>
                                    <Scissors size={14} />
                                </div>
                            </div>
                        );
                    })}

                    {/* Caption track — blocks are in seconds (source time). */}
                    {captions.length > 0 && (
                        <div className="segments-track caption-track">
                            <div className="track-label" title="Captions">
                                <Captions size={14} />
                            </div>
                            <div
                                className="track-content"
                                ref={captionsTrackRef}
                                onClick={() => onSelectCaption && onSelectCaption(null)}
                            >
                                {captions.map((caption) => {
                                    const leftPercent = getPositionPercent(caption.start);
                                    const widthPercent = ((caption.end - caption.start) / duration) * 100;
                                    const trackWidth = captionsTrackRef.current?.getBoundingClientRect().width || 1000;
                                    const minWidthPx = Math.max(2, (0.2 / duration) * trackWidth);

                                    return (
                                        <Rnd
                                            key={caption.id}
                                            position={{ x: (leftPercent / 100) * trackWidth, y: 4 }}
                                            size={{
                                                width: Math.max((widthPercent / 100) * trackWidth, minWidthPx),
                                                height: 32
                                            }}
                                            onDragStop={(e, d) => {
                                                const newStart = Math.max(0, (d.x / trackWidth) * duration);
                                                const dur = caption.end - caption.start;
                                                onUpdateCaption && onUpdateCaption(caption.id, { start: newStart, end: newStart + dur });
                                            }}
                                            onResizeStop={(e, direction, ref, delta, position) => {
                                                const newWidth = parseInt(ref.style.width);
                                                const newLeft = (position.x / trackWidth) * duration;
                                                const newWidthSec = (newWidth / trackWidth) * duration;
                                                if (direction.includes('left')) {
                                                    onUpdateCaption && onUpdateCaption(caption.id, { start: Math.max(0, newLeft) });
                                                } else if (direction.includes('right')) {
                                                    onUpdateCaption && onUpdateCaption(caption.id, { end: caption.start + newWidthSec });
                                                }
                                            }}
                                            bounds="parent"
                                            enableResizing={{ left: true, right: true, top: false, bottom: false }}
                                            resizeHandleStyles={{
                                                left: { width: '8px', cursor: 'ew-resize' },
                                                right: { width: '8px', cursor: 'ew-resize' }
                                            }}
                                            dragAxis="x"
                                            className="segment-rnd segment-caption"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSeek && onSeek(caption.start);
                                                onSelectCaption && onSelectCaption(caption.id);
                                            }}
                                            title={caption.text}
                                        >
                                            <div className="segment-content">
                                                <Captions size={12} />
                                                <span>{caption.text || 'Caption'}</span>
                                            </div>
                                        </Rnd>
                                    );
                                })}
                            </div>
                            <div className="track-label" style={{ opacity: 0 }}>
                                <Scissors size={14} />
                            </div>
                        </div>
                    )}

                    <button className="add-track-btn" onClick={() => onAddTrack && onAddTrack()}>
                        <Plus size={12} />
                        <span>Add Track</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

export default Timeline;
