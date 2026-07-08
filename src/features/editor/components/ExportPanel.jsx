import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Download, Repeat } from 'lucide-react';

// Explicit stops (not a raw min/step range) so every value, including the
// endpoints, is exactly reachable regardless of interaction method - a plain
// `min=30 step=20` range steps from `min`, which never lands exactly on 120.
const FPS_STOPS = [30, 60, 90, 120];

export default function ExportPanel({
    isPlaying, onPlayPause, onSkip,
    isMuted, setIsMuted,
    loopPlayback, setLoopPlayback,
    isExporting, exportProgress,
    exportResolution, setExportResolution,
    exportFps, setExportFps,
    exportFormat, setExportFormat,
    conversionService, setConversionService,
    onExport,
}) {
    const fpsIndex = FPS_STOPS.includes(exportFps) ? FPS_STOPS.indexOf(exportFps) : FPS_STOPS.indexOf(60);

    return (
        <footer className="editor-controls">
            <div className="playback-controls">
                <button className="btn-control btn-small" onClick={() => onSkip(-5)}>
                    <SkipBack size={18} />
                </button>
                <button className="btn-control btn-play" onClick={onPlayPause}>
                    {isPlaying ? <Pause size={22} /> : <Play size={22} />}
                </button>
                <button className="btn-control btn-small" onClick={() => onSkip(5)}>
                    <SkipForward size={18} />
                </button>
                <button
                    className={`btn-control btn-small ${loopPlayback ? 'active' : ''}`}
                    onClick={() => setLoopPlayback(!loopPlayback)}
                    title={loopPlayback ? 'Disable loop' : 'Loop playback'}
                >
                    <Repeat size={18} />
                </button>
                <button
                    className="btn-control btn-small"
                    onClick={() => setIsMuted(!isMuted)}
                    title={isMuted ? 'Unmute' : 'Mute'}
                >
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
            </div>

            <div className="export-controls">
                {isExporting ? (
                    <div className="export-progress">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${exportProgress}%` }}></div>
                        </div>
                        <span className="progress-text">{Math.round(exportProgress)}%</span>
                    </div>
                ) : (
                    <>
                        <select
                            className="quality-select"
                            value={exportResolution}
                            onChange={(e) => setExportResolution(e.target.value)}
                            title="Export resolution"
                        >
                            <option value="2160">4K (2160p)</option>
                            <option value="1080">1080p (Full HD)</option>
                            <option value="720">720p (HD)</option>
                        </select>
                        <div className="fps-slider-group" title="Export frame rate">
                            <span className="fps-slider-label">
                                {exportFps}fps{exportFps >= 120 ? ' (slower)' : ''}
                            </span>
                            <input
                                type="range"
                                className="fps-slider"
                                min="0"
                                max={FPS_STOPS.length - 1}
                                step="1"
                                value={fpsIndex}
                                onChange={(e) => setExportFps(FPS_STOPS[parseInt(e.target.value, 10)])}
                            />
                        </div>
                        <select
                            className="quality-select"
                            value={exportFormat}
                            onChange={(e) => setExportFormat(e.target.value)}
                            title="Export format"
                        >
                            <option value="mp4">MP4</option>
                            <option value="webm">WebM</option>
                        </select>
                        {exportFormat === 'mp4' && (
                            <select
                                className="quality-select"
                                value={conversionService}
                                onChange={(e) => setConversionService(e.target.value)}
                                title="Conversion service"
                            >
                                <option value="local">Local (Browser)</option>
                                <option value="cloud" disabled>Cloud (Coming soon)</option>
                            </select>
                        )}
                        <button className="btn-export" onClick={onExport}>
                            <Download size={18} />
                            Export Video
                        </button>
                    </>
                )}
            </div>
        </footer>
    );
}
