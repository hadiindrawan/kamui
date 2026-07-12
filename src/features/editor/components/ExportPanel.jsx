import React, { useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Download, Repeat, AlertTriangle } from 'lucide-react';
import { calculateCanvasSize } from '../utils/coordinates.js';
import { selectExportCodec, computeAudioBitrate, estimateFileSizeBytes, CODEC_LABELS } from '../utils/export-codec.js';
import Tooltip from '../../../shared/components/Tooltip.jsx';

// Explicit stops (not a raw min/step range) so every value, including the
// endpoints, is exactly reachable regardless of interaction method - a plain
// `min=30 step=20` range steps from `min`, which never lands exactly on 120.
const FPS_STOPS = [30, 60, 90, 120];

const QUALITY_OPTIONS = [
    { value: 'best', label: 'Best quality' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'smallest', label: 'Smallest file' },
];

// Async estimate of the export codec + file size for the current settings.
// Probes the platform (cheap isConfigSupported calls) and guards against stale
// updates when the user changes settings mid-probe.
const useExportEstimate = ({ format, exportResolution, fps, tier, aspectRatio, videoWidth, videoHeight, durationSec }) => {
    const [estimate, setEstimate] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const resolution = Number(exportResolution) || 1080;
        const { width, height } = calculateCanvasSize(videoWidth || 1920, videoHeight || 1080, aspectRatio, resolution);

        (async () => {
            try {
                const { attempts, warning } = await selectExportCodec({ format, width, height, resolution, fps, tier });
                if (cancelled || !attempts.length) return;
                const videoBitrate = attempts[0].bitrate;
                const audioBitrate = computeAudioBitrate({ format, tier });
                const sizeBytes = estimateFileSizeBytes({ videoBitrate, audioBitrate, durationSec });
                setEstimate({ codec: attempts[0].codec, sizeBytes, warning });
            } catch {
                if (!cancelled) setEstimate(null);
            }
        })();

        return () => { cancelled = true; };
    }, [format, exportResolution, fps, tier, aspectRatio, videoWidth, videoHeight, durationSec]);

    return estimate;
};

export default function ExportPanel({
    isPlaying, onPlayPause, onSkip,
    isMuted, setIsMuted,
    volume, setVolume,
    loopPlayback, setLoopPlayback,
    isExporting, exportProgress,
    exportResolution, setExportResolution,
    exportFps, setExportFps,
    exportFormat, setExportFormat,
    conversionService, setConversionService,
    exportQuality, setExportQuality,
    aspectRatio, videoWidth, videoHeight,
    duration, trimStart, trimEnd,
    onExport,
}) {
    const fpsIndex = FPS_STOPS.includes(exportFps) ? FPS_STOPS.indexOf(exportFps) : FPS_STOPS.indexOf(60);

    const durationSec = Math.max(0, (trimEnd || duration || 0) - (trimStart || 0));
    const estimate = useExportEstimate({
        format: exportFormat,
        exportResolution,
        fps: exportFps,
        tier: exportQuality || 'best',
        aspectRatio,
        videoWidth,
        videoHeight,
        durationSec,
    });
    const estimateMB = estimate ? Math.max(1, Math.round(estimate.sizeBytes / (1024 * 1024))) : null;

    return (
        <footer className="editor-controls">
            <div className="playback-controls">
                <Tooltip content="Back 5s" shortcut="←">
                    <button className="btn-control btn-small" onClick={() => onSkip(-5)} aria-label="Back 5 seconds">
                        <SkipBack size={18} />
                    </button>
                </Tooltip>
                <Tooltip content={isPlaying ? 'Pause' : 'Play'} shortcut="Space">
                    <button className="btn-control btn-play" onClick={onPlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? <Pause size={22} /> : <Play size={22} />}
                    </button>
                </Tooltip>
                <Tooltip content="Forward 5s" shortcut="→">
                    <button className="btn-control btn-small" onClick={() => onSkip(5)} aria-label="Forward 5 seconds">
                        <SkipForward size={18} />
                    </button>
                </Tooltip>
                <Tooltip content={loopPlayback ? 'Disable loop' : 'Loop playback'}>
                    <button
                        className={`btn-control btn-small ${loopPlayback ? 'active' : ''}`}
                        onClick={() => setLoopPlayback(!loopPlayback)}
                        aria-label={loopPlayback ? 'Disable loop' : 'Loop playback'}
                    >
                        <Repeat size={18} />
                    </button>
                </Tooltip>
                <Tooltip content={isMuted ? 'Unmute' : 'Mute'}>
                    <button
                        className="btn-control btn-small"
                        onClick={() => setIsMuted(!isMuted)}
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                </Tooltip>
                <div className="volume-slider-group" title="Volume">
                    <input
                        type="range"
                        className="volume-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        disabled={isMuted}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                    />
                </div>
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
                            value={exportQuality || 'best'}
                            onChange={(e) => setExportQuality(e.target.value)}
                            title="Export quality"
                        >
                            {QUALITY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
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
                        {estimate && (
                            <span
                                className={`export-estimate${estimate.warning ? ' export-estimate-warn' : ''}`}
                                title={estimate.warning || `Estimated ${CODEC_LABELS[estimate.codec] || estimate.codec} output size`}
                            >
                                {estimate.warning && <AlertTriangle size={14} />}
                                {CODEC_LABELS[estimate.codec] || estimate.codec} · ~{estimateMB} MB
                            </span>
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
