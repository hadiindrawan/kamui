import React from 'react';
import { Settings, Gauge, Scissors, Sparkles, RefreshCw, MousePointerClick, MousePointer2, Volume2 } from 'lucide-react';
import { formatTime } from '../hooks/useEditorState.js';
import { CLICK_ANIMATION_STYLES, CLICK_OPACITY_LEVELS } from '../utils/click-animations.js';
import { CURSOR_SMOOTHING_LEVELS } from '../utils/cursor-smoothing.js';
import { playClickSound, CLICK_SOUND_OPTIONS } from '../services/click-sound.js';
import Button from '../../../shared/components/Button.jsx';

const INTENSITIES = [
    { value: 'subtle', label: 'Subtle' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
];

export default function SidebarSettings({
    zoomLevel, setZoomLevel, zoomDuration, setZoomDuration, transitionDuration, setTransitionDuration,
    autoZoomIntensity, setAutoZoomIntensity, regenerateAutoZoom,
    setHasPendingEdits,
    playbackSpeed, setPlaybackSpeed,
    cursorSmoothing, setCursorSmoothing,
    clickAnimationStyle, setClickAnimationStyle,
    clickAnimationOpacity, setClickAnimationOpacity,
    clickSound, setClickSound,
    clickAnimationInRecording, setClickAnimationInRecording,
    trimStart, trimEnd, duration, currentTime, setTrimStart, setTrimEnd,
    onJumpToFrame, showFollowCursor, onOpenShortcuts,
}) {
    return (
        <>
            <div className="sidebar-section">
                <h3><Settings size={14} /> Zoom Settings</h3>

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

                <div className="setting-row">
                    <div className="setting-label">
                        <span><Sparkles size={12} /> Auto-Zoom Intensity</span>
                    </div>
                    <div className="segment-mode-toggle">
                        {INTENSITIES.map((it) => (
                            <button
                                key={it.value}
                                className={`mode-btn ${autoZoomIntensity === it.value ? 'active' : ''}`}
                                onClick={() => { setAutoZoomIntensity(it.value); setHasPendingEdits(true); }}
                            >
                                {it.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="secondary"
                        className="regenerate-autozoom-btn"
                        onClick={regenerateAutoZoom}
                        title="Rebuild auto-zoom sessions from your recording (keeps manual segments)"
                        icon={<RefreshCw size={13} />}
                    >
                        Regenerate Auto-Zoom
                    </Button>
                </div>

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
                        max="1500"
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
                <h3><MousePointer2 size={14} /> Cursor</h3>
                <div className="setting-row">
                    <div className="setting-label">
                        <span>Movement Smoothing</span>
                    </div>
                    <div className="segment-mode-toggle">
                        {CURSOR_SMOOTHING_LEVELS.map((level) => (
                            <button
                                key={level.value}
                                className={`mode-btn ${cursorSmoothing === level.value ? 'active' : ''}`}
                                onClick={() => { setCursorSmoothing(level.value); setHasPendingEdits(true); }}
                            >
                                {level.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="setting-info">
                    {showFollowCursor ? (
                        <span>Smooths the cursor dot and follow camera.</span>
                    ) : (
                        <span>
                            Smooths the cursor dot and follow camera. Requires Follow Cursor Mode —{' '}
                            <button type="button" className="inline-link-btn" onClick={onJumpToFrame}>
                                enable it in the Frame tab
                            </button>.
                        </span>
                    )}
                </div>
            </div>

            <div className="sidebar-section">
                <h3><MousePointerClick size={14} /> Click Effects</h3>
                <div className="setting-row">
                    <div className="setting-label">
                        <span>Animation Style</span>
                    </div>
                    <select
                        className="setting-select"
                        value={clickAnimationStyle}
                        onChange={(e) => { setClickAnimationStyle(e.target.value); setHasPendingEdits(true); }}
                    >
                        {CLICK_ANIMATION_STYLES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span>Opacity</span>
                    </div>
                    <div className="segment-mode-toggle">
                        {CLICK_OPACITY_LEVELS.map((level) => (
                            <button
                                key={level.value}
                                className={`mode-btn ${clickAnimationOpacity === level.value ? 'active' : ''}`}
                                onClick={() => { setClickAnimationOpacity(level.value); setHasPendingEdits(true); }}
                            >
                                {level.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="setting-row">
                    <div className="setting-label">
                        <span>Click Sound</span>
                    </div>
                    <div className="setting-row-inline">
                        <select
                            className="setting-select"
                            value={clickSound}
                            onChange={(e) => { setClickSound(e.target.value); setHasPendingEdits(true); }}
                        >
                            {CLICK_SOUND_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                        <Button
                            variant="secondary"
                            iconOnly
                            onClick={() => playClickSound(clickSound)}
                            disabled={clickSound === 'none'}
                            title="Preview sound"
                            aria-label="Preview sound"
                            icon={<Volume2 size={13} />}
                        />
                    </div>
                </div>

                <div className="setting-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={clickAnimationInRecording}
                            onChange={(e) => { setClickAnimationInRecording(e.target.checked); setHasPendingEdits(true); }}
                        />
                        <span>Include in exported video</span>
                    </label>
                </div>
            </div>

            <div className="sidebar-section">
                <h3><Scissors size={14} /> Trim</h3>
                <div className="trim-controls">
                    <div className="trim-input">
                        <label>In</label>
                        <input type="text" value={formatTime(trimStart)} readOnly />
                        <button className="trim-btn" onClick={() => setTrimStart(currentTime)} title="Set to current time (I)">
                            Set
                        </button>
                    </div>
                    <div className="trim-input">
                        <label>Out</label>
                        <input type="text" value={formatTime(trimEnd || duration)} readOnly />
                        <button className="trim-btn" onClick={() => setTrimEnd(currentTime)} title="Set to current time (O)">
                            Set
                        </button>
                    </div>
                </div>
                <button type="button" className="inline-link-btn shortcuts-link" onClick={onOpenShortcuts}>
                    View all shortcuts (?)
                </button>
            </div>
        </>
    );
}
