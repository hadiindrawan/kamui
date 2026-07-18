import React from 'react';
import { createRoot } from 'react-dom/client';
import { Video, FolderOpen } from 'lucide-react';
import RecordingsList from '../popup/components/RecordingsList';
import { useSettings } from '../../shared/hooks/useSettings.js';
import { useRecording } from '../../shared/hooks/useRecording.js';
import { useRecordingsList } from '../../shared/hooks/useRecordingsList.js';
import { openEditor } from '../../core/services/recording-service.js';
import './recordings.css';

export default function Recordings() {
    const settings = useSettings();
    const { recordings, loadRecordings, deleteRecording, recoverRecording } = useRecordingsList();
    const { resumeRecording } = useRecording({
        settings,
        onRecordingStopped: loadRecordings,
    });

    return (
        <div className="recordings-page">
            <header className="recordings-header">
                <div className="recordings-header-logo">
                    <Video size={24} />
                    <h1>Kamui Recordings</h1>
                </div>
            </header>

            <div className="recordings-body">
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
    root.render(<Recordings />);
}
