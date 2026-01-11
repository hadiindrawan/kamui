import { openDB } from 'idb';

const DB_NAME = 'CursorfulRecordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

// Initialize database
export async function initDB() {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('startTime', 'startTime');
            }
        }
    });
}

// Save a new recording
export async function saveRecording(recording) {
    const db = await initDB();
    return db.put(STORE_NAME, recording);
}

// Get a specific recording
export async function getRecording(id) {
    const db = await initDB();
    return db.get(STORE_NAME, id);
}

// Get all recordings
export async function getAllRecordings() {
    const db = await initDB();
    return db.getAll(STORE_NAME);
}

// Delete a recording
export async function deleteRecording(id) {
    const db = await initDB();
    return db.delete(STORE_NAME, id);
}

// Update recording (for adding event data)
export async function updateRecording(id, updates) {
    const db = await initDB();
    const recording = await db.get(STORE_NAME, id);
    if (!recording) {
        throw new Error('Recording not found');
    }
    const updated = { ...recording, ...updates };
    return db.put(STORE_NAME, updated);
}
