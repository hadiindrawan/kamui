import React from 'react';
import { Film, Monitor, Youtube, Smartphone, Square, Instagram } from 'lucide-react';

// Solid quick-picks tuned for content: near-black/white for a clean studio
// look, plus a couple of muted creator-friendly tones. The lavender swatch
// doubles as an on-brand option for Beunta-made content.
const COLOR_PRESETS = ['#010102', '#ffffff', '#1a1a2e', '#16161d', '#5e6ad2', '#233d4d'];

const GRADIENT_PRESETS = [
    'linear-gradient(135deg, #0f1011 0%, #010102 100%)',
    'linear-gradient(135deg, #5e6ad2 0%, #1a1a2e 100%)',
    'linear-gradient(to top, #232526 0%, #414345 100%)',
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(to right, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    'linear-gradient(to top, #30cfd0 0%, #330867 100%)',
];

const IMAGE_PRESETS = [
    'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=400&h=250&q=80',
    'https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=400&h=250&q=80',
    'https://images.unsplash.com/photo-1620121692029-d088224ddc74?auto=format&fit=crop&w=400&h=250&q=80',
    'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=400&h=250&q=80',
];

const ASPECT_RATIO_PRESETS = [
    { value: 'Native', label: 'Native', hint: 'Match video', boxRatio: null, icon: Monitor },
    { value: '16:9', label: 'YouTube', hint: '16:9', boxRatio: 16 / 9, icon: Youtube },
    { value: '9:16', label: 'Shorts / TikTok', hint: '9:16', boxRatio: 9 / 16, icon: Smartphone },
    { value: '1:1', label: 'Square', hint: '1:1', boxRatio: 1, icon: Square },
    { value: '4:5', label: 'Instagram', hint: '4:5', boxRatio: 4 / 5, icon: Instagram },
];

export default function FramingPanel({
    aspectRatio, setAspectRatio,
    backgroundMode, setBackgroundMode, backgroundColor, setBackgroundColor,
    backgroundValue, setBackgroundValue, backgroundBlur, setBackgroundBlur,
    cropToFill, setCropToFill, cropZoom, setCropZoom,
    insetPadding, setInsetPadding, showShadow, setShowShadow, showBorder, setShowBorder,
    borderRadius, setBorderRadius, showFollowCursor, setShowFollowCursor,
    setHasPendingEdits,
}) {
    const markEdited = (setter) => (value) => {
        setter(value);
        setHasPendingEdits(true);
    };

    return (
        <div className="sidebar-section">
            <h3><Film size={14} /> Framing</h3>

            <div className="setting-row">
                <div className="setting-label">
                    <span>Frame for</span>
                </div>
                <div className="aspect-preset-grid">
                    {ASPECT_RATIO_PRESETS.map((preset) => (
                        <button
                            key={preset.value}
                            className={`aspect-preset-card ${aspectRatio === preset.value ? 'active' : ''}`}
                            onClick={() => markEdited(setAspectRatio)(preset.value)}
                            title={`${preset.label} (${preset.hint})`}
                        >
                            <span className="aspect-preset-swatch">
                                <span
                                    className="aspect-preset-shape"
                                    style={preset.boxRatio ? { aspectRatio: preset.boxRatio } : { width: '100%', height: '100%' }}
                                >
                                    <preset.icon size={16} strokeWidth={2} />
                                </span>
                            </span>
                            <span className="aspect-preset-label">{preset.label}</span>
                            <span className="aspect-preset-hint">{preset.hint}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="setting-row">
                <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={cropToFill}
                        onChange={(e) => markEdited(setCropToFill)(e.target.checked)}
                    />
                    <span>Crop to fill (no bars)</span>
                </label>
                {cropToFill && (
                    <p className="setting-hint">Drag on the preview to choose which part of the video is visible.</p>
                )}
            </div>

            {cropToFill && (
                <div className="setting-row">
                    <div className="setting-label">
                        <span>Crop Zoom</span>
                        <span className="setting-value">{(cropZoom || 1).toFixed(2)}x</span>
                    </div>
                    <input
                        type="range"
                        className="setting-slider"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropZoom || 1}
                        onChange={(e) => markEdited(setCropZoom)(parseFloat(e.target.value))}
                    />
                    <p className="setting-hint">Zoom into the source so you can reposition freely on both axes.</p>
                </div>
            )}

            <div className="setting-row">
                <div className="setting-label">
                    <span>Background</span>
                </div>
                <div className="bg-checkered-preview">
                    <div
                        className="bg-preview-fill"
                        style={{
                            background: backgroundMode === 'image' && backgroundValue ? `url(${backgroundValue}) center/cover` :
                                backgroundMode === 'gradient' ? backgroundValue :
                                    backgroundMode === 'color' ? backgroundColor : '#1a2e3b',
                        }}
                    />
                </div>
            </div>

            <div className="bg-mode-selector">
                {['hidden', 'color', 'gradient', 'image'].map((mode) => (
                    <button
                        key={mode}
                        className={`bg-mode-btn ${backgroundMode === mode ? 'active' : ''}`}
                        onClick={() => markEdited(setBackgroundMode)(mode)}
                    >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                ))}
            </div>

            {backgroundMode === 'color' && (
                <>
                    <div className="presets-grid">
                        {COLOR_PRESETS.map((color) => (
                            <button
                                key={color}
                                className={`preset-btn ${backgroundColor === color ? 'active' : ''}`}
                                style={{ background: color }}
                                onClick={() => markEdited(setBackgroundColor)(color)}
                                title={color}
                            />
                        ))}
                    </div>
                    <div className="setting-row">
                        <span className="setting-sublabel">Custom Color</span>
                        <input
                            type="color"
                            className="color-picker"
                            value={backgroundColor}
                            onChange={(e) => markEdited(setBackgroundColor)(e.target.value)}
                        />
                    </div>
                </>
            )}

            {backgroundMode === 'gradient' && (
                <div className="presets-grid">
                    {GRADIENT_PRESETS.map((grad, i) => (
                        <button
                            key={i}
                            className="preset-btn"
                            style={{ background: grad }}
                            onClick={() => markEdited(setBackgroundValue)(grad)}
                        />
                    ))}
                </div>
            )}

            {backgroundMode === 'image' && (
                <div className="presets-grid">
                    {IMAGE_PRESETS.map((img, i) => (
                        <button
                            key={i}
                            className="preset-btn"
                            style={{ backgroundImage: `url(${img})` }}
                            onClick={() => markEdited(setBackgroundValue)(img)}
                        />
                    ))}
                </div>
            )}

            {backgroundMode !== 'hidden' && (
                <>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Background Blur</span>
                        </div>
                        <div className="bg-mode-selector">
                            {['none', 'light', 'moderate', 'strong'].map((level) => (
                                <button
                                    key={level}
                                    className={`bg-mode-btn ${backgroundBlur === level ? 'active' : ''}`}
                                    onClick={() => markEdited(setBackgroundBlur)(level)}
                                >
                                    {level.charAt(0).toUpperCase() + level.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Padding</span>
                            <span className="setting-value">{insetPadding}px</span>
                        </div>
                        <input
                            type="range"
                            className="setting-slider"
                            min="0"
                            max="200"
                            step="10"
                            value={insetPadding}
                            onChange={(e) => markEdited(setInsetPadding)(parseInt(e.target.value))}
                        />
                    </div>
                    <div className="checkbox-group">
                        <label className="checkbox-label">
                            <input type="checkbox" checked={showShadow} onChange={(e) => markEdited(setShowShadow)(e.target.checked)} />
                            <span>Shadow</span>
                        </label>
                        <label className="checkbox-label">
                            <input type="checkbox" checked={showBorder} onChange={(e) => markEdited(setShowBorder)(e.target.checked)} />
                            <span>Border</span>
                        </label>
                    </div>
                    <div className="setting-row">
                        <div className="setting-label">
                            <span>Border Radius</span>
                            <span className="setting-value">{borderRadius}px</span>
                        </div>
                        <input
                            type="range"
                            className="setting-slider"
                            min="0"
                            max="100"
                            step="4"
                            value={borderRadius}
                            onChange={(e) => markEdited(setBorderRadius)(parseInt(e.target.value))}
                        />
                    </div>
                </>
            )}

            <div className="setting-row">
                <label className="checkbox-label">
                    <input type="checkbox" checked={showFollowCursor} onChange={(e) => markEdited(setShowFollowCursor)(e.target.checked)} />
                    <span>Follow Cursor Mode</span>
                </label>
            </div>
        </div>
    );
}
