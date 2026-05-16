import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Video,
    Circle,
    Square,
    FolderOpen,
    Pencil,
    Trash2,
    Clock,
    HardDrive,
    Zap,
    Mic,
    MicOff
} from 'lucide-react';
import RecordingsList from './components/RecordingsList';
import './popup.css';

export default function Popup() {
    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [micEnabled, setMicEnabled] = useState(false);
    const [quality, setQuality] = useState('best-quality');

    useEffect(() => {
        loadRecordings();
        checkRecordingState();
        loadMicSetting();
        loadQualitySetting();

        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && !isRecording) {
                handleStartRecording();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isRecording, micEnabled]);

    async function checkRecordingState() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
            if (response && response.state) {
                setIsRecording(response.state.isRecording);
                setCurrentSessionId(response.state.currentSessionId);
            }
        } catch (e) {
            console.error('Error checking state:', e);
        }
    }

    async function loadRecordings() {
        try {
            const { getAllRecordings, getInterruptedRecordings } = await import('../../storage/indexeddb.js');
            const allRecordings = await getAllRecordings();
            const interrupted = await getInterruptedRecordings();
            
            // Merge both lists
            const combined = [...allRecordings, ...interrupted];
            setRecordings(combined.sort((a, b) => b.startTime - a.startTime));
        } catch (e) {
            console.error('Error loading recordings:', e);
        }
    }

    async function loadMicSetting() {
        try {
            const result = await chrome.storage.local.get(['micEnabled']);
            setMicEnabled(result.micEnabled || false);
        } catch (e) {
            console.error('Error loading mic setting:', e);
        }
    }

    async function loadQualitySetting() {
        try {
            const result = await chrome.storage.local.get(['quality']);
            setQuality(result.quality || 'best-quality');
        } catch (e) {
            console.error('Error loading quality setting:', e);
        }
    }

    async function setQualitySetting(newQuality) {
        setQuality(newQuality);
        try {
            await chrome.storage.local.set({ quality: newQuality });
        } catch (e) {
            console.error('Error saving quality setting:', e);
        }
    }

    async function toggleMicrophone() {
        const newValue = !micEnabled;
        setMicEnabled(newValue);
        try {
            await chrome.storage.local.set({ micEnabled: newValue });
        } catch (e) {
            console.error('Error saving mic setting:', e);
        }
    }

    async function handleStartRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'START_RECORDING',
                micEnabled: micEnabled,
                quality: quality
            });
            if (response.success) {
                setIsRecording(true);
                setCurrentSessionId(response.sessionId);
            } else {
                alert('Failed to start recording: ' + response.error);
            }
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Error: ' + error.message);
        }
    }

    async function handleStopRecording() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
            if (response.success) {
                setIsRecording(false);
                setCurrentSessionId(null);
                setTimeout(() => loadRecordings(), 1000);
            } else {
                alert('Failed to stop recording: ' + response.error);
            }
        } catch (error) {
            console.error('Error stopping recording:', error);
            alert('Error: ' + error.message);
        }
    }

    async function handleDelete(recordingId) {
        if (!confirm('Delete this recording?')) return;
        try {
            const { deleteRecording } = await import('../../storage/indexeddb.js');
            await deleteRecording(recordingId);
            loadRecordings();
        } catch (e) {
            console.error('Error deleting:', e);
            alert('Failed to delete recording');
        }
    }

    async function handleRecover(recordingId) {
        if (!confirm('Recover this interrupted recording?')) return;
        try {
            const { updateRecording, getChunks, getEventLogs } = await import('../../storage/indexeddb.js');
            const chunks = await getChunks(recordingId);
            
            if (chunks.length === 0) {
                alert('No data found to recover');
                return;
            }

            const events = await getEventLogs(recordingId);

            // Estimate duration and finalize
            await updateRecording(recordingId, {
                status: 'completed',
                duration: Math.round((chunks[chunks.length - 1].timestamp - chunks[0].timestamp) / 1000),
                events: events || []
            });

            alert('Successfully recovered! You can now open it in the editor.');
            loadRecordings();
        } catch (e) {
            console.error('Error recovering:', e);
            alert('Failed to recover recording');
        }
    }

    async function handleResume(recordingId) {
        if (isRecording) {
            alert('A recording is already in progress.');
            return;
        }
        try {
            const { getChunks } = await import('../../storage/indexeddb.js');
            const chunks = await getChunks(recordingId);
            const segments = new Set(chunks.map(c => c.segmentId || 1));
            const nextSegmentId = segments.size + 1;

            const response = await chrome.runtime.sendMessage({
                type: 'RESUME_RECORDING',
                sessionId: recordingId,
                segmentId: nextSegmentId,
                micEnabled: micEnabled,
                quality: quality
            });
            if (response.success) {
                setIsRecording(true);
                setCurrentSessionId(recordingId);
            } else {
                alert('Failed to resume recording: ' + response.error);
            }
        } catch (error) {
            console.error('Error resuming recording:', error);
            alert('Error: ' + error.message);
        }
    }

    function handleOpenEditor(recordingId) {
        chrome.tabs.create({
            url: chrome.runtime.getURL(`src/features/editor/index.html?id=${recordingId}`)
        });
    }

    function handleOpenStandaloneEditor() {
        chrome.tabs.create({
            url: chrome.runtime.getURL(`src/features/editor/index.html`)
        });
    }

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
                {!isRecording ? (
                    <>
                        <button className="btn btn-primary" onClick={handleStartRecording}>
                            <Circle size={16} fill="currentColor" />
                            Start Recording
                        </button>
                        <button className="btn btn-secondary" onClick={handleOpenStandaloneEditor} style={{ marginTop: '8px', background: '#2a2a2a', color: 'white', border: '1px solid #444' }}>
                            <FolderOpen size={16} />
                            Upload Video
                        </button>
                    </>
                ) : (
                    <div className="recording-status">
                        <button className="btn btn-danger" onClick={handleStopRecording}>
                            <Square size={16} fill="currentColor" />
                            Stop Recording
                        </button>
                        <div className="recording-indicator">
                            <span className="pulse"></span>
                            Recording in progress...
                        </div>
                    </div>
                )}

                {/* Quality and Microphone Selectors */}
                <div className="selector-grid">
                    <div className="mic-toggle">
                        <button
                            className={`btn-toggle ${micEnabled ? 'active' : ''}`}
                            onClick={toggleMicrophone}
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
                                onClick={() => setQualitySetting('best-performance')}
                                disabled={isRecording}
                            >
                                <Zap size={14} />
                                Performance
                            </button>
                            <button
                                className={`quality-chip ${quality === 'best-quality' ? 'active' : ''}`}
                                onClick={() => setQualitySetting('best-quality')}
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
                        onDelete={handleDelete}
                        onOpen={handleOpenEditor}
                        onRecover={handleRecover}
                        onResume={handleResume}
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
