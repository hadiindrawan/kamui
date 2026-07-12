import React from 'react';
import { MousePointer2, Lock, Repeat, Trash2, ZoomIn, Crop } from 'lucide-react';
import { formatTime } from '../hooks/useEditorState.js';
import Button from '../../../shared/components/Button.jsx';

const TYPE_LABELS = {
    zoom: 'Zoom', crop: 'Crop', typing: 'Typing', selection: 'Selection', dblclick: 'Double Click', click: 'Click',
};

export default function SegmentInspector({
    segment, segments, updateSegment, saveHistory, tracks = [], onDeleteSegment, onClose,
}) {
    if (!segment) return null;
    const isCrop = segment.type === 'crop';
    const label = TYPE_LABELS[segment.type] || 'Segment';

    // Live-preview updates skip history (matches the existing slider pattern);
    // commit on mouse-up / discrete choices so undo captures one step per edit.
    const commit = (updates) => updateSegment(segment.id, updates, true);
    const live = (updates) => updateSegment(segment.id, updates, false);
    const commitHistory = () => saveHistory(segments);

    return (
        <div className="sidebar-section">
            <div className="segment-inspector-header">
                <span className={`segment-type-badge ${isCrop ? 'segment-type-crop' : 'segment-type-zoom'}`}>
                    {isCrop ? <Crop size={14} /> : <ZoomIn size={14} />} {label} Segment
                </span>
                <Button variant="ghost" size="sm" onClick={onClose} title="Done editing this segment">
                    Done
                </Button>
            </div>

            <div className="setting-row">
                <div className="setting-label"><span>Track</span></div>
                <select
                    className="setting-select"
                    value={segment.trackId ?? 0}
                    onChange={(e) => commit({ trackId: parseInt(e.target.value, 10) })}
                >
                    {tracks.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                </select>
            </div>

            <div className="setting-row">
                <div className="setting-label">
                    <span>Start</span>
                    <span className="setting-value">{formatTime(segment.startTime / 1000)}</span>
                </div>
            </div>

            <div className="setting-row">
                <div className="setting-label">
                    <span>Duration</span>
                    <span className="setting-value">{(segment.duration / 1000).toFixed(2)}s</span>
                </div>
                <input
                    type="range"
                    className="setting-slider"
                    min="200"
                    max="10000"
                    step="100"
                    value={segment.duration}
                    onChange={(e) => live({ duration: parseInt(e.target.value, 10) })}
                    onMouseUp={commitHistory}
                />
            </div>

            {!isCrop && (
                <>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Cursor Follow</span>
                        </div>
                        <div className="segment-mode-toggle">
                            <button
                                className={`mode-btn ${segment.positionMode !== 'fixed' ? 'active' : ''}`}
                                onClick={() => commit({ positionMode: 'follow' })}
                                title="Camera follows the cursor while this segment is active"
                            >
                                <MousePointer2 size={14} /> Follow
                            </button>
                            <button
                                className={`mode-btn ${segment.positionMode === 'fixed' ? 'active' : ''}`}
                                onClick={() => commit({ positionMode: 'fixed' })}
                                title="Fixed position (manual target)"
                            >
                                <Lock size={14} /> Fixed
                            </button>
                        </div>
                    </div>

                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Zoom Level</span>
                            <span className="setting-value">{(segment.zoomLevel || 2).toFixed(1)}x</span>
                        </div>
                        <input
                            type="range"
                            className="setting-slider"
                            min="1.2"
                            max="4"
                            step="0.1"
                            value={segment.zoomLevel || 2}
                            onChange={(e) => live({ zoomLevel: parseFloat(e.target.value) })}
                            onMouseUp={commitHistory}
                        />
                    </div>
                </>
            )}

            {isCrop && (
                <>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Crop Width</span>
                            <span className="setting-value">{segment.cropWidth || 640}px</span>
                        </div>
                        <input
                            type="range"
                            className="setting-slider"
                            min="100"
                            max="1920"
                            step="10"
                            value={segment.cropWidth || 640}
                            onChange={(e) => live({ cropWidth: parseInt(e.target.value, 10) })}
                            onMouseUp={commitHistory}
                        />
                    </div>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Crop Height</span>
                            <span className="setting-value">{segment.cropHeight || 360}px</span>
                        </div>
                        <input
                            type="range"
                            className="setting-slider"
                            min="100"
                            max="1080"
                            step="10"
                            value={segment.cropHeight || 360}
                            onChange={(e) => live({ cropHeight: parseInt(e.target.value, 10) })}
                            onMouseUp={commitHistory}
                        />
                    </div>
                </>
            )}

            <div className="setting-row">
                <div className="setting-label"><span>Loop</span></div>
                <div className="segment-mode-toggle">
                    <button
                        className={`mode-btn ${segment.loopMode !== 'loop' ? 'active' : ''}`}
                        onClick={() => commit({ loopMode: 'none' })}
                        title="Play through once and stop at this segment's end"
                    >
                        Once
                    </button>
                    <button
                        className={`mode-btn ${segment.loopMode === 'loop' ? 'active' : ''}`}
                        onClick={() => commit({ loopMode: 'loop' })}
                        title="Repeat within this segment's own bounds while selected"
                    >
                        <Repeat size={14} /> Loop
                    </button>
                </div>
            </div>

            <Button
                variant="danger"
                className="segment-delete-btn"
                onClick={onDeleteSegment}
                title="Delete segment (Delete/Backspace)"
                icon={<Trash2 size={13} />}
            >
                Delete Segment
            </Button>
        </div>
    );
}
