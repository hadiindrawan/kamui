import React from 'react';
import { X } from 'lucide-react';

/**
 * Fixed banner shown while a preset-triggered auto-export is counting down.
 * Cancel aborts before the export begins.
 */
export default function AutoExportCountdown({ countdown, onCancel }) {
    if (!countdown) return null;
    return (
        <div className="auto-export-countdown">
            <span className="auto-export-text">
                Applying <strong>{countdown.presetName}</strong> — exporting in {countdown.secondsLeft}s…
            </span>
            <button className="auto-export-cancel" onClick={onCancel}>
                <X size={14} /> Cancel
            </button>
        </div>
    );
}
