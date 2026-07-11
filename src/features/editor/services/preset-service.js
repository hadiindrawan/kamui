/**
 * Preset persistence service.
 *
 * Wraps the raw IndexedDB preset CRUD with:
 *  - case-insensitive duplicate-name detection (throws PresetNameError)
 *  - graceful fallback to an in-memory Map when IndexedDB is unavailable
 *  - a PRESETS_CHANGED broadcast so the service worker can refresh the tray
 *
 * UI code should only ever import from here, never from indexeddb.js directly.
 */

export class PresetNameError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PresetNameError';
    }
}

// In-memory fallback used when IndexedDB throws (private mode, quota, etc.)
const memoryStore = new Map();
let degraded = false;

export function isStorageDegraded() {
    return degraded;
}

const markDegraded = (err) => {
    if (!degraded) {
        console.warn('Preset storage degraded, falling back to memory:', err);
    }
    degraded = true;
};

// Notify the service worker (and other extension pages) that presets changed
// so the native tray submenu can be rebuilt. Fire-and-forget; guarded for jsdom.
const broadcastChange = () => {
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'PRESETS_CHANGED' }).catch(() => {});
        }
    } catch {
        // no-op: service worker may be asleep or context invalid
    }
};

const readAll = async () => {
    if (degraded) {
        return Array.from(memoryStore.values());
    }
    try {
        const { getAllPresets } = await import('../../../storage/indexeddb.js');
        return await getAllPresets();
    } catch (err) {
        markDegraded(err);
        return Array.from(memoryStore.values());
    }
};

const persist = async (preset) => {
    if (degraded) {
        memoryStore.set(preset.id, preset);
        return;
    }
    try {
        const { savePreset } = await import('../../../storage/indexeddb.js');
        await savePreset(preset);
    } catch (err) {
        markDegraded(err);
        memoryStore.set(preset.id, preset);
    }
};

export async function listPresets() {
    const presets = await readAll();
    return presets.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function createPreset({ name, autoExport = false, settings }) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        throw new PresetNameError('Preset name cannot be empty');
    }
    const existing = await readAll();
    const clash = existing.some(
        (p) => (p.name || '').trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) {
        throw new PresetNameError(`A preset named "${trimmed}" already exists`);
    }
    const now = Date.now();
    const preset = {
        id: `preset_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        createdAt: now,
        updatedAt: now,
        autoExport: !!autoExport,
        settings: settings || {},
    };
    await persist(preset);
    broadcastChange();
    return preset;
}

export async function updatePreset(preset) {
    const updated = { ...preset, updatedAt: Date.now() };
    await persist(updated);
    broadcastChange();
    return updated;
}

export async function removePreset(id) {
    if (degraded) {
        memoryStore.delete(id);
        broadcastChange();
        return;
    }
    try {
        const { deletePreset } = await import('../../../storage/indexeddb.js');
        await deletePreset(id);
    } catch (err) {
        markDegraded(err);
        memoryStore.delete(id);
    }
    broadcastChange();
}
