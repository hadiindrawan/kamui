import { openDB } from 'idb';

const DB_NAME = 'KamuiRecordings';
const LEGACY_DB_NAME = 'BeuntaRecordings'; // pre-rebrand name — see migrateLegacyDatabase()
const DB_VERSION = 4;
const STORE_NAME = 'recordings';
const CHUNKS_STORE = 'chunks';
const EVENT_LOGS_STORE = 'event_logs';
const PRESETS_STORE = 'presets';

function createStores(db) {
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
    if (!db.objectStoreNames.contains(PRESETS_STORE)) {
        db.createObjectStore(PRESETS_STORE, { keyPath: 'id' });
    }
}

// Cached across calls so the migration only runs once per service-worker
// lifetime (it's also self-terminating: once the legacy DB is deleted,
// indexedDB.databases() no longer lists it, so later SW restarts skip it).
let migrationPromise = null;

/** One-time migration from the pre-rebrand 'BeuntaRecordings' database to
 * 'KamuiRecordings' so existing local recordings/presets aren't orphaned by
 * the rename. Copies every object store's contents, then deletes the legacy
 * database. Best-effort: a failure here must not block the app from using
 * the new (possibly empty) database. */
async function migrateLegacyDatabase() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
        if (!('databases' in indexedDB)) return; // can't enumerate — skip detection
        const existing = await indexedDB.databases();
        if (!existing.some((d) => d.name === LEGACY_DB_NAME)) return;

        // No explicit version — open at whatever version the legacy DB is
        // already at, so this read-only copy can't trigger a schema upgrade.
        const legacyDb = await openDB(LEGACY_DB_NAME);
        const newDb = await openDB(DB_NAME, DB_VERSION, { upgrade: createStores });

        for (const storeName of [STORE_NAME, CHUNKS_STORE, EVENT_LOGS_STORE, PRESETS_STORE]) {
            if (!legacyDb.objectStoreNames.contains(storeName)) continue;
            const tx = newDb.transaction(storeName, 'readwrite');
            let cursor = await legacyDb.transaction(storeName).store.openCursor();
            while (cursor) {
                // autoIncrement stores (chunks/event_logs) have no keyPath in
                // the value, so re-add to let the new DB assign fresh keys;
                // sessionId references inside the value are untouched, so
                // relationships to their parent recording still resolve.
                if (storeName === CHUNKS_STORE || storeName === EVENT_LOGS_STORE) {
                    await tx.store.add(cursor.value);
                } else {
                    await tx.store.put(cursor.value);
                }
                cursor = await cursor.continue();
            }
            await tx.done;
        }

        legacyDb.close();
        newDb.close();
        await indexedDB.deleteDatabase(LEGACY_DB_NAME);
    })().catch((e) => {
        console.error('[KamuiRecordings] Legacy DB migration failed (continuing with new DB):', e);
    });
    return migrationPromise;
}

// Initialize database
export async function initDB() {
    await migrateLegacyDatabase();
    return openDB(DB_NAME, DB_VERSION, { upgrade: createStores });
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

// --- Presets ---

// Get all saved editor presets
export async function getAllPresets() {
    const db = await initDB();
    return db.getAll(PRESETS_STORE);
}

// Get a single preset by id
export async function getPreset(id) {
    const db = await initDB();
    return db.get(PRESETS_STORE, id);
}

// Create or update a preset (keyPath: id)
export async function savePreset(preset) {
    const db = await initDB();
    return db.put(PRESETS_STORE, preset);
}

// Delete a preset by id
export async function deletePreset(id) {
    const db = await initDB();
    return db.delete(PRESETS_STORE, id);
}
