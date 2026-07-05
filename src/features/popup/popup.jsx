import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Video,
    Circle,
    Square,
    FolderOpen,
    Mic,
    MicOff,
    Zap,
    Cpu,
    Globe,
} from 'lucide-react';
import RecordingsList from './components/RecordingsList';
import NativeSetupGuide from './components/NativeSetupGuide';
import { useSettings } from '../../shared/hooks/useSettings.js';
import { useRecording } from '../../shared/hooks/useRecording.js';
import { useRecordingsList } from '../../shared/hooks/useRecordingsList.js';
import { openEditor, openStandaloneEditor, selectRegionAndRecord } from '../../core/services/recording-service.js';
import { Crop } from 'lucide-react';
import './popup.css';

export default function Popup() {
    const settings = useSettings();
    const { recordings, loadRecordings, deleteRecording, recoverRecording } = useRecordingsList();
    const { isRecording, startRecording, stopRecording, resumeRecording, nativeTrackerWarning } = useRecording({
        settings,
        onRecordingStopped: loadRecordings,
    });

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && !isRecording) {
                startRecording();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isRecording, startRecording]);

    const { recordingMode, nativeAvailability, nativeAvailable, showNativeSetup, os, micEnabled, quality } = settings;

    const handleRecordRegion = async () => {
        try {
            const res = await selectRegionAndRecord({ micEnabled, quality });
            if (res && res.success) {
                window.close(); // let the user interact with the on-page selector
            } else if (res && res.error) {
                alert(res.error);
            }
        } catch (e) {
            alert('Could not start area selection: ' + e.message);
        }
    };

    return (
        <div className="popup">
            <header className="header">
                <div className="header-logo">
                    <Video size={24} />
                    <h1>Beunta</h1>
                </div>
                <p className="subtitle">Smart Screen Recorder</p>
            </header>

            <div className="controls">
                {/* Recording Mode Toggle */}
                <div className="mode-toggle">
                    <button
                        className={`mode-btn ${recordingMode === 'browser' ? 'active' : ''}`}
                        onClick={() => settings.setRecordingMode('browser')}
                        disabled={isRecording}
                    >
                        <Globe size={14} />
                        <span>Browser</span>
                    </button>
                    <button
                        className={`mode-btn ${recordingMode === 'native' ? 'active' : ''}`}
                        onClick={() => settings.setRecordingMode('native')}
                        disabled={isRecording}
                        title="Precision cursor tracking anywhere on the desktop, not just in the browser"
                    >
                        <Cpu size={14} />
                        <span>Precision Cursor</span>
                    </button>
                </div>

                {/* While probing, show a stable placeholder (same height as the
                    hint) so the setup guide never flashes during the switch. */}
                {recordingMode === 'native' && (nativeAvailability === 'checking' || nativeAvailability === 'unknown') && (
                    <p className="mode-hint">Checking for Beunta helper…</p>
                )}

                {/* Native Setup Guide — only on a confirmed-unavailable result. */}
                {recordingMode === 'native' && nativeAvailability === 'unavailable' && showNativeSetup && (
                    <NativeSetupGuide
                        isAvailable={nativeAvailable}
                        os={os}
                        onCheck={settings.checkNativeAvailability}
                        onDismiss={() => settings.setShowNativeSetup(false)}
                    />
                )}

                {recordingMode === 'native' && nativeAvailability === 'available' && (
                    <p className="mode-hint">
                        Share "Entire Screen" when prompted so clicks line up with the recording.
                    </p>
                )}

                {recordingMode === 'native' && nativeTrackerWarning && (
                    <p className="mode-hint" style={{ color: 'var(--danger)' }}>
                        ⚠ {nativeTrackerWarning}
                    </p>
                )}

                {!isRecording ? (
                    <>
                        <button
                            className={`btn ${recordingMode === 'native' ? 'btn-native' : 'btn-primary'}`}
                            onClick={startRecording}
                        >
                            <Circle size={16} fill="currentColor" />
                            {recordingMode === 'native' ? 'Start Native Recording' : 'Start Recording'}
                        </button>
                        {recordingMode !== 'native' && (
                            <button className="btn btn-secondary" onClick={handleRecordRegion} style={{ marginTop: '8px', background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--hairline-strong)' }}>
                                <Crop size={16} />
                                Record Area
                            </button>
                        )}
                        <button className="btn btn-secondary" onClick={openStandaloneEditor} style={{ marginTop: '8px', background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--hairline-strong)' }}>
                            <FolderOpen size={16} />
                            Upload Video
                        </button>
                    </>
                ) : (
                    <div className="recording-status">
                        <button className="btn btn-danger" onClick={stopRecording}>
                            <Square size={16} fill="currentColor" />
                            {recordingMode === 'native' ? 'Stop Native Recording' : 'Stop Recording'}
                        </button>
                        <div className="recording-indicator">
                            <span className="pulse"></span>
                            {recordingMode === 'native' ? 'Native recording in progress...' : 'Recording in progress...'}
                        </div>
                    </div>
                )}

                {/* Quality and Microphone Selectors */}
                <div className="selector-grid">
                    <div className="mic-toggle">
                        <button
                            className={`btn-toggle ${micEnabled ? 'active' : ''}`}
                            onClick={settings.toggleMicrophone}
                            disabled={isRecording}
                            title={micEnabled ? 'Microphone ON' : 'Microphone OFF'}
                        >
                            {micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                            <span>{micEnabled ? 'Mic ON' : 'Mic OFF'}</span>
                        </button>
                    </div>

                    <div className="quality-toggle">
                        <div className="quality-options">
                            <button
                                className={`quality-chip ${quality === 'best-performance' ? 'active' : ''}`}
                                onClick={() => settings.setQuality('best-performance')}
                                disabled={isRecording}
                            >
                                <Zap size={14} />
                                Performance
                            </button>
                            <button
                                className={`quality-chip ${quality === 'best-quality' ? 'active' : ''}`}
                                onClick={() => settings.setQuality('best-quality')}
                                disabled={isRecording}
                            >
                                <Video size={14} />
                                Quality
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="recordings-section">
                <div className="section-header">
                    <h2 className="section-title">
                        <FolderOpen size={16} />
                        Recordings
                    </h2>
                    <span className="count-badge">{recordings.length}</span>
                </div>

                {recordings.length === 0 ? (
                    <div className="empty-state">
                        <Video size={40} strokeWidth={1.5} />
                        <p>No recordings yet</p>
                        <p className="hint">Click "Start Recording" to begin</p>
                    </div>
                ) : (
                    <RecordingsList
                        recordings={recordings}
                        onDelete={deleteRecording}
                        onOpen={openEditor}
                        onRecover={recoverRecording}
                        onResume={resumeRecording}
                    />
                )}
            </div>
        </div>
    );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<Popup />);
}
