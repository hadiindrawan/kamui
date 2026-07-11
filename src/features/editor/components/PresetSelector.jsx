import React from 'react';
import { Settings2 } from 'lucide-react';

/**
 * Inline preset dropdown for the editor toolbar. Selecting a preset applies it
 * immediately; the gear button opens the full preset manager.
 */
export default function PresetSelector({ presets, activePresetId, onApplyPreset, onOpenManager }) {
    const activeName = presets.find((p) => p.id === activePresetId)?.name;
    return (
        <div className="preset-selector">
            <select
                className="preset-select"
                // Kept as a reset-on-pick action selector (value always '') so
                // re-selecting the already-active preset still fires onChange and
                // re-applies it (and re-triggers auto-export). The active preset
                // is surfaced via the placeholder label instead.
                value=""
                onChange={(e) => {
                    if (e.target.value) onApplyPreset(e.target.value);
                }}
                title="Apply a preset"
            >
                <option value="">{activeName ? `Preset: ${activeName}` : 'Presets…'}</option>
                {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
            <button
                className="btn-preset-manage"
                onClick={onOpenManager}
                title="Manage presets"
            >
                <Settings2 size={16} />
            </button>
        </div>
    );
}
