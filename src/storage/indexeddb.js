import { openDB } from 'idb';

const DB_NAME = 'BeuntaRecordings';
const DB_VERSION = 2;
const STORE_NAME = 'recordings';
const CHUNKS_STORE = 'chunks';

// Initialize database
export async function initDB() {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('startTime', 'startTime');
            }
            if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
                const chunkStore = db.createObjectStore(CHUNKS_STORE, { autoIncrement: true });
                chunkStore.createIndex('sessionId', 'sessionId');
            }
        }
    });
}

// Save a chunk of video data
export async function saveChunk(sessionId, blob) {
    const db = await initDB();
    return db.add(CHUNKS_STORE, {
        sessionId,
        blob,
        timestamp: Date.now()
    });
}

// Get all chunks for a session
export async function getChunks(sessionId) {
    const db = await initDB();
    return db.getAllFromIndex(CHUNKS_STORE, 'sessionId', sessionId);
}

// Delete all chunks for a session
export async function deleteChunks(sessionId) {
    const db = await initDB();
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const index = tx.store.index('sessionId');
    let cursor = await index.openCursor(IDBKeyRange.only(sessionId));
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;
}

// Save a new recording
export async function saveRecording(recording) {
    const db = await initDB();
    return db.put(STORE_NAME, recording);
}

// Get a specific recording
export async function getRecording(id, loadVideo = true) {
    const db = await initDB();
    const recording = await db.get(STORE_NAME, id);
    
    if (recording && loadVideo && !recording.videoBlob) {
        const chunks = await getChunks(id);
        if (chunks.length > 0) {
            // Reconstruct blob from consistent IDB chunks
            recording.videoBlob = new Blob(chunks.map(c => c.blob), { 
                type: recording.mimeType || 'video/webm' 
            });
        }
    }
    
    return recording;
}

// Global cleanup: Remove any chunks that don't belong to an existing recording
export async function cleanupOrphanedChunks() {
    const db = await initDB();
    const recordings = await db.getAll(STORE_NAME);
    const validIds = new Set(recordings.map(r => r.id));
    
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    let cursor = await tx.store.openCursor();
    
    while (cursor) {
        if (!validIds.has(cursor.value.sessionId)) {
            await cursor.delete();
        }
        cursor = await cursor.continue();
    }
    await tx.done;
}

// Identify recordings that have chunks but no main entry (crash victims)
export async function getInterruptedRecordings() {
    const db = await initDB();
    const recordings = await db.getAll(STORE_NAME);
    const validIds = new Set(recordings.map(r => r.id));
    
    const allChunks = await db.getAll(CHUNKS_STORE);
    const interruptedMap = new Map();
    
    for (const chunk of allChunks) {
        if (!validIds.has(chunk.sessionId)) {
            if (!interruptedMap.has(chunk.sessionId)) {
                interruptedMap.set(chunk.sessionId, {
                    id: chunk.sessionId,
                    startTime: chunk.timestamp,
                    isInterrupted: true,
                    chunkCount: 0
                });
            }
            interruptedMap.get(chunk.sessionId).chunkCount++;
        }
    }
    
    return Array.from(interruptedMap.values());
}

// Get all recordings
export async function getAllRecordings() {
    const db = await initDB();
    return db.getAll(STORE_NAME);
}

// Delete a recording
export async function deleteRecording(id) {
    const db = await initDB();
    await deleteChunks(id);
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
