import React from 'react';
import { Film, Play, Zap, HardDrive, Keyboard } from 'lucide-react';
import { formatTime } from '../hooks/useEditorState.js';
import PresetSelector from './PresetSelector.jsx';
import Button from '../../../shared/components/Button.jsx';
import Tooltip from '../../../shared/components/Tooltip.jsx';

export default function EditorToolbar({
    segmentCount, recordingSizeBytes, hasPendingEdits, onSaveChanges, currentTime, duration,
    presets, activePresetId, onApplyPreset, onOpenPresetManager, onOpenShortcuts,
}) {
    return (
        <header className="editor-header">
            <div className="header-left">
                <h1 className="header-title">
                    <Film size={22} />
                    Beunta Editor
                </h1>
                <div className="header-info">
                    <span><Zap size={14} /> {segmentCount} segments</span>
                    <span><HardDrive size={14} /> {(recordingSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                </div>
            </div>
            <div className="header-right">
                <PresetSelector
                    presets={presets}
                    activePresetId={activePresetId}
                    onApplyPreset={onApplyPreset}
                    onOpenManager={onOpenPresetManager}
                />
                {hasPendingEdits && (
                    <Button variant="primary" onClick={onSaveChanges} title="Save timeline edits (Cmd+s)">
                        Save Changes (Cmd+s)
                    </Button>
                )}
                <Tooltip content="Keyboard shortcuts" shortcut="?">
                    <Button
                        variant="ghost"
                        iconOnly
                        onClick={onOpenShortcuts}
                        aria-label="Keyboard shortcuts"
                        icon={<Keyboard size={16} />}
                    />
                </Tooltip>
                <div className="time-display">
                    <Play size={14} />
                    <span className="time-current">{formatTime(currentTime)}</span>
                    <span className="time-separator">/</span>
                    <span className="time-duration">{formatTime(duration)}</span>
                </div>
            </div>
        </header>
    );
}
