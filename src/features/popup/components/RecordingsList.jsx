import React from 'react';
import { Pencil, Trash2, Clock, HardDrive, Zap, RotateCcw, AlertCircle, Video, Play, PlayCircle } from 'lucide-react';

export default function RecordingsList({ recordings, onDelete, onOpen, onRecover, onResume }) {
    function formatDate(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatDuration(seconds) {
        if (!seconds) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return (
        <div className="recordings-list">
            {recordings.map((recording) => (
                <div key={recording.id} className={`recording-item ${recording.isInterrupted ? 'interrupted' : ''}`}>
                    {/* Thumbnail Preview */}
                    <div className="recording-thumbnail" onClick={() => !recording.isInterrupted && onOpen(recording.id)}>
                        {recording.thumbnail ? (
                            <img src={recording.thumbnail} alt="Preview" />
                        ) : (
                            <div className="thumbnail-fallback">
                                <Video size={24} />
                            </div>
                        )}
                        {!recording.isInterrupted && <div className="thumbnail-overlay"><Play size={16} fill="white" /></div>}
                    </div>

                    <div className="recording-info">
                        <div className="recording-title">
                            {recording.isInterrupted ? 'Lost Recording' : `Recording #${recording.id.split('_')[1]?.slice(-4) || recording.id.slice(-4)}`}
                        </div>
                        <div className="recording-meta">
                            <span>
                                <Clock size={10} />
                                {formatDate(recording.startTime)}
                            </span>
                            {recording.isInterrupted ? (
                                <span className="status-warning">
                                    <AlertCircle size={10} />
                                    {recording.chunkCount} parts (Interrupted)
                                </span>
                            ) : (
                                <>
                                    <span>
                                        <Clock size={10} />
                                        {formatDuration(recording.duration)}
                                    </span>
                                    <span>
                                        <Zap size={10} />
                                        {recording.events?.length || 0} events
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="recording-actions">
                        {recording.isInterrupted ? (
                            <button
                                className="btn-icon btn-recover"
                                onClick={() => onRecover(recording.id)}
                                title="Recover data"
                                style={{ backgroundColor: '#f97316', color: 'white' }}
                            >
                                <RotateCcw size={16} />
                            </button>
                        ) : (
                            <button
                                className="btn-icon btn-edit"
                                onClick={() => onOpen(recording.id)}
                                title="Open in editor"
                            >
                                <Pencil size={16} />
                            </button>
                        )}
                        <button
                            className="btn-icon btn-resume"
                            onClick={() => onResume(recording.id)}
                            title="Resume recording"
                        >
                            <PlayCircle size={16} />
                        </button>
                        <button
                            className="btn-icon btn-delete"
                            onClick={() => onDelete(recording.id)}
                            title="Delete"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
