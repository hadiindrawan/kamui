import React from 'react';
import { Pencil, Trash2, Clock, HardDrive, Zap } from 'lucide-react';

export default function RecordingsList({ recordings, onDelete, onOpen }) {
    function formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // Less than 1 minute
        if (diff < 60000) return 'Just now';
        // Less than 1 hour
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        // Less than 24 hours
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        // Otherwise show date
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatSize(bytes) {
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(0)} KB`;
        }
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    return (
        <div className="recordings-list">
            {recordings.map((recording) => (
                <div key={recording.id} className="recording-item">
                    <div className="recording-info">
                        <div className="recording-title">
                            Recording #{recording.id.split('_')[1]?.slice(-4) || recording.id.slice(-4)}
                        </div>
                        <div className="recording-meta">
                            <span>
                                <Clock size={10} />
                                {formatDate(recording.startTime)}
                            </span>
                            <span>
                                <HardDrive size={10} />
                                {formatSize(recording.size)}
                            </span>
                            <span>
                                <Zap size={10} />
                                {recording.events?.length || 0} events
                            </span>
                        </div>
                    </div>

                    <div className="recording-actions">
                        <button
                            className="btn-icon btn-edit"
                            onClick={() => onOpen(recording.id)}
                            title="Open in editor"
                        >
                            <Pencil size={16} />
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
