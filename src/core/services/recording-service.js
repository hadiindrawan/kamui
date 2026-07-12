/**
 * RecordingService — wraps chrome.runtime messaging, chrome.storage, and
 * IndexedDB access for the recording lifecycle. Keeps popup.jsx presentational
 * by centralizing every side-effecting call in one place.
 */
import { createLogger } from '../../shared/utils/logger.js';

const log = createLogger('RecordingService');

export async function getRecordingState() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return response?.state || null;
}

export async function isNativeAppAvailable() {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_NATIVE_AVAILABLE' });
    return !!response?.available;
}

// Cache the last-known native availability so switching to native mode can seed
// the UI instantly instead of flashing the setup guide during the ~2s PING probe.
export async function loadCachedNativeAvailability() {
    const result = await chrome.storage.local.get('nativeAvailabilityCache');
    return typeof result.nativeAvailabilityCache === 'boolean' ? result.nativeAvailabilityCache : null;
}

export async function persistNativeAvailability(available) {
    await chrome.storage.local.set({ nativeAvailabilityCache: !!available });
}

export async function startBrowserRecording({ micEnabled, quality }) {
    return chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        micEnabled,
        quality,
    });
}

export async function startNativeRecording({ micEnabled, quality }) {
    return chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        recordingMode: 'native',
        micEnabled,
        quality,
    });
}

export async function stopRecording(recordingMode) {
    return chrome.runtime.sendMessage({ type: 'STOP_RECORDING', recordingMode });
}

export async function selectRegionAndRecord({ micEnabled, quality }) {
    return chrome.runtime.sendMessage({ type: 'SELECT_REGION', micEnabled, quality });
}

export async function resumeRecording({ sessionId, segmentId, micEnabled, quality }) {
    return chrome.runtime.sendMessage({
        type: 'RESUME_RECORDING',
        sessionId,
        segmentId,
        micEnabled,
        quality,
    });
}

export async function getNextResumeSegmentId(recordingId) {
    const { getChunks } = await import('../../storage/indexeddb.js');
    const chunks = await getChunks(recordingId);
    const segments = new Set(chunks.map((c) => c.segmentId || 1));
    return segments.size + 1;
}

export async function persistRecordingMode(mode) {
    await chrome.storage.local.set({ recordingMode: mode });
    await chrome.runtime.sendMessage({ type: 'SET_RECORDING_MODE', mode });
}

export async function loadPersistedSettings() {
    const result = await chrome.storage.local.get(['micEnabled', 'quality', 'recordingMode']);
    return {
        micEnabled: result.micEnabled || false,
        quality: result.quality || 'best-quality',
        recordingMode: result.recordingMode || 'browser',
    };
}

export async function persistMicSetting(micEnabled) {
    await chrome.storage.local.set({ micEnabled });
}

export async function persistQualitySetting(quality) {
    await chrome.storage.local.set({ quality });
}

export async function fetchAllRecordings() {
    const { getAllRecordings, getInterruptedRecordings } = await import('../../storage/indexeddb.js');
    const [allRecordings, interrupted] = await Promise.all([getAllRecordings(), getInterruptedRecordings()]);
    return [...allRecordings, ...interrupted].sort((a, b) => b.startTime - a.startTime);
}

export async function deleteRecordingById(recordingId) {
    const { deleteRecording } = await import('../../storage/indexeddb.js');
    await deleteRecording(recordingId);
}

export async function recoverRecording(recordingId) {
    const { updateRecording, getChunks, getEventLogs } = await import('../../storage/indexeddb.js');
    const chunks = await getChunks(recordingId);
    if (chunks.length === 0) {
        throw new Error('No data found to recover');
    }
    const events = await getEventLogs(recordingId);
    await updateRecording(recordingId, {
        status: 'completed',
        duration: Math.round((chunks[chunks.length - 1].timestamp - chunks[0].timestamp) / 1000),
        events: events || [],
    });
}

export function openEditor(recordingId) {
    chrome.tabs.create({
        url: chrome.runtime.getURL(`src/features/editor/index.html?id=${recordingId}`),
    });
}

export function openStandaloneEditor() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/features/editor/index.html') });
}

export { log };
