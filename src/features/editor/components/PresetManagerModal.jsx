import React, { useState } from 'react';
import { Check, Trash2, AlertTriangle, Star } from 'lucide-react';
import Modal from '../../../shared/components/Modal.jsx';
import { PresetNameError } from '../services/preset-service.js';
import { CURSOR_SMOOTHING_LEVELS } from '../utils/cursor-smoothing.js';

const formatDate = (ts) => {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
};

/**
 * Full preset manager: save the current config as a new preset, and list /
 * apply / toggle auto-export / delete existing presets. Also hosts the global
 * auto-export toggle and the active-default indicator.
 */
export default function PresetManagerModal({
    open,
    onClose,
    presets,
    activePresetId,
    storageDegraded,
    globalAutoExport,
    onSetGlobalAutoExport,
    globalCursorSmoothing,
    onSetGlobalCursorSmoothing,
    onSaveCurrentAsPreset,
    onApplyPreset,
    onSetPresetAutoExport,
    onDeletePreset,
    onClearActive,
}) {
    const [name, setName] = useState('');
    const [newAutoExport, setNewAutoExport] = useState(false);
    const [nameError, setNameError] = useState('');
    const [saving, setSaving] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const handleSave = async () => {
        setNameError('');
        setSaving(true);
        try {
            await onSaveCurrentAsPreset(name, newAutoExport);
            setName('');
            setNewAutoExport(false);
        } catch (err) {
            if (err instanceof PresetNameError) {
                setNameError(err.message);
            } else {
                setNameError('Failed to save preset');
                console.error(err);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Presets" width={520}>
            {storageDegraded && (
                <div className="preset-warning">
                    <AlertTriangle size={16} />
                    <span>Storage unavailable — presets are kept for this session only.</span>
                </div>
            )}

            <div className="preset-save-form">
                <div className="preset-save-row">
                    <input
                        type="text"
                        className="preset-name-input"
                        placeholder="New preset name"
                        value={name}
                        onChange={(e) => { setName(e.target.value); setNameError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
                    />
                    <button
                        className="btn-preset-save"
                        onClick={handleSave}
                        disabled={saving || !name.trim()}
                    >
                        Save current
                    </button>
                </div>
                <label className="preset-checkbox-label">
                    <input
                        type="checkbox"
                        checked={newAutoExport}
                        onChange={(e) => setNewAutoExport(e.target.checked)}
                    />
                    Auto-export when applied
                </label>
                {nameError && <div className="preset-name-error">{nameError}</div>}
            </div>

            <div className="preset-list">
                {presets.length === 0 && (
                    <div className="preset-empty">No presets yet. Save your current settings above.</div>
                )}
                {presets.map((p) => (
                    <div key={p.id} className={`preset-row ${p.id === activePresetId ? 'active' : ''}`}>
                        <div className="preset-row-info">
                            <span className="preset-row-name">
                                {p.id === activePresetId && <Star size={12} className="preset-active-icon" />}
                                {p.name}
                            </span>
                            <span className="preset-row-date">{formatDate(p.updatedAt)}</span>
                        </div>
                        {confirmDeleteId === p.id ? (
                            <div className="preset-row-actions">
                                <span className="preset-confirm-text">Delete?</span>
                                <button
                                    className="btn-preset-action danger"
                                    onClick={async () => { await onDeletePreset(p.id); setConfirmDeleteId(null); }}
                                >
                                    Confirm
                                </button>
                                <button className="btn-preset-action" onClick={() => setConfirmDeleteId(null)}>
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <div className="preset-row-actions">
                                <label className="preset-checkbox-label small" title="Auto-export when applied">
                                    <input
                                        type="checkbox"
                                        checked={!!p.autoExport}
                                        onChange={(e) => onSetPresetAutoExport(p, e.target.checked)}
                                    />
                                    Auto
                                </label>
                                <button className="btn-preset-action" onClick={() => onApplyPreset(p.id)}>
                                    <Check size={14} /> Apply
                                </button>
                                <button
                                    className="btn-preset-action danger"
                                    onClick={() => setConfirmDeleteId(p.id)}
                                    title="Delete preset"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="preset-footer">
                <label className="preset-checkbox-label">
                    <input
                        type="checkbox"
                        checked={globalAutoExport}
                        onChange={(e) => onSetGlobalAutoExport(e.target.checked)}
                    />
                    Auto-export for every applied preset
                </label>
                <label className="preset-select-label">
                    <span>Default cursor smoothing</span>
                    <select
                        className="setting-select"
                        value={globalCursorSmoothing || ''}
                        onChange={(e) => onSetGlobalCursorSmoothing(e.target.value || null)}
                    >
                        <option value="">No global default</option>
                        {CURSOR_SMOOTHING_LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>{level.label}</option>
                        ))}
                    </select>
                </label>
                {activePresetId && (
                    <button className="btn-preset-clear" onClick={onClearActive}>
                        Clear default
                    </button>
                )}
            </div>
        </Modal>
    );
}
