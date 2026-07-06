import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Download, Repeat } from 'lucide-react';

export default function ExportPanel({
    isPlaying, onPlayPause, onSkip,
    isMuted, setIsMuted,
    loopPlayback, setLoopPlayback,
    isExporting, exportProgress,
    exportQuality, setExportQuality,
    exportFormat, setExportFormat,
    exportScale, setExportScale,
    conversionService, setConversionService,
    onExport,
}) {
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
                            value={exportQuality}
                            onChange={(e) => setExportQuality(e.target.value)}
                            title="Export quality"
                        >
                            <option value="best-performance">Best Performance & Speed</option>
                            <option value="best-quality">Best Quality (High Bitrate)</option>
                        </select>
                        <select
                            className="quality-select"
                            value={exportFormat}
                            onChange={(e) => setExportFormat(e.target.value)}
                            title="Export format"
                        >
                            <option value="mp4">MP4</option>
                            <option value="webm">WebM</option>
                        </select>
                        <select
                            className="quality-select"
                            value={exportScale}
                            onChange={(e) => setExportScale(parseInt(e.target.value))}
                            title="Resolution scale"
                        >
                            <option value="1">1x (Original)</option>
                            <option value="2">2x (Double)</option>
                        </select>
                        {exportFormat === 'mp4' && (
                            <select
                                className="quality-select"
                                value={conversionService}
                                onChange={(e) => setConversionService(e.target.value)}
                                title="Conversion service"
                            >
                                <option value="local">Local (Browser)</option>
                                <option value="cloud">Cloud (Backend)</option>
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
