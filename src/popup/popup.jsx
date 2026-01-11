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
import RecordingsList from './RecordingsList';
import './popup.css';

function Popup() {
    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [micEnabled, setMicEnabled] = useState(false); // Default OFF

    useEffect(() => {
        loadRecordings();
        checkRecordingState();
        loadMicSetting();
    }, []);

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
            const { getAllRecordings } = await import('../storage/indexeddb.js');
            const allRecordings = await getAllRecordings();
            setRecordings(allRecordings.sort((a, b) => b.startTime - a.startTime));
        } catch (e) {
            console.error('Error loading recordings:', e);
        }
    }

    async function loadMicSetting() {
        try {
            const result = await chrome.storage.local.get(['micEnabled']);
            setMicEnabled(result.micEnabled || false); // Default OFF
        } catch (e) {
            console.error('Error loading mic setting:', e);
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
                micEnabled: micEnabled
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
            const { deleteRecording } = await import('../storage/indexeddb.js');
            await deleteRecording(recordingId);
            loadRecordings();
        } catch (e) {
            console.error('Error deleting:', e);
            alert('Failed to delete recording');
        }
    }

    function handleOpenEditor(recordingId) {
        chrome.tabs.create({
            url: chrome.runtime.getURL(`src/editor/index.html?id=${recordingId}`)
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
                    <button className="btn btn-primary" onClick={handleStartRecording}>
                        <Circle size={16} fill="currentColor" />
                        Start Recording
                    </button>
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

                {/* Microphone Toggle */}
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
                    />
                )}
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById('root'));
root.render(<Popup />);
