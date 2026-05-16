import { openDB } from 'idb';

const DB_NAME = 'BeuntaRecordings';
const DB_VERSION = 3;
const STORE_NAME = 'recordings';
const CHUNKS_STORE = 'chunks';
const EVENT_LOGS_STORE = 'event_logs';

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
            if (!db.objectStoreNames.contains(EVENT_LOGS_STORE)) {
                const eventStore = db.createObjectStore(EVENT_LOGS_STORE, { autoIncrement: true });
                eventStore.createIndex('sessionId', 'sessionId');
            }
        }
    });
}

// Save a chunk of video data
export async function saveChunk(sessionId, blob, segmentId = 1) {
    const db = await initDB();
    return db.add(CHUNKS_STORE, {
        sessionId,
        segmentId,
        blob,
        timestamp: Date.now()
    });
}

// Save batched event logs
export async function saveEventLogs(sessionId, segmentId, events) {
    if (!events || events.length === 0) return;
    const db = await initDB();
    return db.add(EVENT_LOGS_STORE, {
        sessionId,
        segmentId,
        events,
        flushTime: Date.now()
    });
}

// Get all event logs for a session
export async function getEventLogs(sessionId) {
    const db = await initDB();
    const logs = await db.getAllFromIndex(EVENT_LOGS_STORE, 'sessionId', sessionId);
    // Sort by flushTime to ensure order
    logs.sort((a, b) => a.flushTime - b.flushTime);
    // Flatten the events arrays
    return logs.flatMap(log => log.events);
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
    
    if (recording) {
        // Hydrate events from EVENT_LOGS_STORE if it exists
        const storedEvents = await getEventLogs(id);
        if (storedEvents && storedEvents.length > 0) {
            recording.events = storedEvents;
        }

        if (loadVideo && (!recording.videoBlobs || recording.videoBlobs.length === 0)) {
            const chunks = await getChunks(id);
            if (chunks.length > 0) {
                // Group by segmentId
                const segments = {};
                for (const chunk of chunks) {
                    const sid = chunk.segmentId || 1;
                    if (!segments[sid]) segments[sid] = [];
                    segments[sid].push(chunk);
                }
                
                // Sort chunks by timestamp in each segment
                for (const sid in segments) {
                    segments[sid].sort((a, b) => a.timestamp - b.timestamp);
                }

                // Create blobs per segment
                const segmentIds = Object.keys(segments).sort((a, b) => parseInt(a) - parseInt(b));
                recording.videoBlobs = segmentIds.map(sid => {
                    return new Blob(segments[sid].map(c => c.blob), { 
                        type: recording.mimeType || 'video/webm' 
                    });
                });
                
                // Fallback for older code that uses videoBlob
                recording.videoBlob = recording.videoBlobs[0];
            }
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
    
    const interrupted = recordings.filter(r => r.status === 'in-progress');
    const validIds = new Set(recordings.map(r => r.id));
    
    const allChunks = await db.getAll(CHUNKS_STORE);
    const interruptedMap = new Map();
    
    for (const r of interrupted) {
        interruptedMap.set(r.id, {
            ...r,
            isInterrupted: true,
            chunkCount: 0
        });
    }
    
    for (const chunk of allChunks) {
        if (!validIds.has(chunk.sessionId)) {
            if (!interruptedMap.has(chunk.sessionId)) {
                interruptedMap.set(chunk.sessionId, {
                    id: chunk.sessionId,
                    startTime: chunk.timestamp,
                    isInterrupted: true,
                    status: 'in-progress',
                    chunkCount: 0
                });
            }
            interruptedMap.get(chunk.sessionId).chunkCount++;
        } else if (interruptedMap.has(chunk.sessionId)) {
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
    
    // Delete events
    const tx = db.transaction(EVENT_LOGS_STORE, 'readwrite');
    const index = tx.store.index('sessionId');
    let cursor = await index.openCursor(IDBKeyRange.only(id));
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;

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
