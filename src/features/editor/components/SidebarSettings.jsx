import React from 'react';
import { Settings, Gauge, Scissors, Sparkles, RefreshCw } from 'lucide-react';
import { formatTime } from '../hooks/useEditorState.js';

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
    trimStart, trimEnd, duration, currentTime, setTrimStart, setTrimEnd,
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
                    <button
                        className="trim-btn"
                        style={{ marginTop: '8px', width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        onClick={regenerateAutoZoom}
                        title="Rebuild auto-zoom sessions from your recording (keeps manual segments)"
                    >
                        <RefreshCw size={13} /> Regenerate Auto-Zoom
                    </button>
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
                <div className="keyboard-hints">
                    <span><kbd>Space</kbd> Play</span>
                    <span><kbd>I</kbd> In</span>
                    <span><kbd>O</kbd> Out</span>
                    <span><kbd>Ctrl+Z</kbd> Undo</span>
                </div>
            </div>
        </>
    );
}
