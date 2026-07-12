import { useState, useEffect, useCallback } from 'react';
import { fetchAllRecordings, deleteRecordingById, recoverRecording as recoverRecordingRequest } from '../../core/services/recording-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RecordingsList');

/** Loads and mutates the popup's recordings list (completed + interrupted). */
export function useRecordingsList() {
    const [recordings, setRecordings] = useState([]);

    const loadRecordings = useCallback(async () => {
        try {
            setRecordings(await fetchAllRecordings());
        } catch (e) {
            log.error('Error loading recordings:', e);
        }
    }, []);

    useEffect(() => {
        loadRecordings();
    }, [loadRecordings]);

    const deleteRecording = useCallback(async (recordingId) => {
        if (!confirm('Delete this recording?')) return;
        try {
            await deleteRecordingById(recordingId);
            await loadRecordings();
        } catch (e) {
            log.error('Error deleting:', e);
            alert('Failed to delete recording');
        }
    }, [loadRecordings]);

    const recoverRecording = useCallback(async (recordingId) => {
        if (!confirm('Recover this interrupted recording?')) return;
        try {
            await recoverRecordingRequest(recordingId);
            alert('Successfully recovered! You can now open it in the editor.');
            await loadRecordings();
        } catch (e) {
            log.error('Error recovering:', e);
            alert(e.message === 'No data found to recover' ? e.message : 'Failed to recover recording');
        }
    }, [loadRecordings]);

    return { recordings, loadRecordings, deleteRecording, recoverRecording };
}
