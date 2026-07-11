// The service keeps module-level state (in-memory fallback + degraded flag), so
// each test re-imports it fresh via jest.isolateModulesAsync with its own mock
// of the storage layer.

const loadService = async (indexeddbMock) => {
    let service;
    await jest.isolateModulesAsync(async () => {
        jest.doMock('../../../storage/indexeddb.js', () => indexeddbMock);
        service = await import('./preset-service.js');
    });
    return service;
};

const workingStore = () => {
    const rows = new Map();
    return {
        rows,
        getAllPresets: jest.fn(async () => Array.from(rows.values())),
        savePreset: jest.fn(async (p) => { rows.set(p.id, p); }),
        deletePreset: jest.fn(async (id) => { rows.delete(id); }),
        getPreset: jest.fn(async (id) => rows.get(id) || null),
    };
};

describe('preset-service', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('creates a preset with generated id and timestamps', async () => {
        const store = workingStore();
        const svc = await loadService(store);
        const preset = await svc.createPreset({ name: 'TikTok', settings: { zoomLevel: 2 } });

        expect(preset.id).toMatch(/^preset_/);
        expect(preset.name).toBe('TikTok');
        expect(preset.createdAt).toBeGreaterThan(0);
        expect(preset.settings).toEqual({ zoomLevel: 2 });
        expect(store.savePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'TikTok' }));
    });

    it('rejects an empty name', async () => {
        const svc = await loadService(workingStore());
        await expect(svc.createPreset({ name: '   ', settings: {} })).rejects.toThrow(svc.PresetNameError);
    });

    it('rejects a duplicate name case-insensitively', async () => {
        const svc = await loadService(workingStore());
        await svc.createPreset({ name: 'Demo', settings: {} });
        await expect(svc.createPreset({ name: 'demo', settings: {} })).rejects.toThrow(svc.PresetNameError);
    });

    it('lists presets sorted by createdAt', async () => {
        const svc = await loadService(workingStore());
        await svc.createPreset({ name: 'A', settings: {} });
        await svc.createPreset({ name: 'B', settings: {} });
        const list = await svc.listPresets();
        expect(list.map((p) => p.name)).toEqual(['A', 'B']);
    });

    it('deletes a preset', async () => {
        const store = workingStore();
        const svc = await loadService(store);
        const p = await svc.createPreset({ name: 'Gone', settings: {} });
        await svc.removePreset(p.id);
        expect(store.deletePreset).toHaveBeenCalledWith(p.id);
        expect(await svc.listPresets()).toHaveLength(0);
    });

    it('falls back to in-memory storage when IndexedDB throws', async () => {
        const throwing = {
            getAllPresets: jest.fn(async () => { throw new Error('DB unavailable'); }),
            savePreset: jest.fn(async () => { throw new Error('DB unavailable'); }),
            deletePreset: jest.fn(async () => { throw new Error('DB unavailable'); }),
            getPreset: jest.fn(async () => { throw new Error('DB unavailable'); }),
        };
        const svc = await loadService(throwing);

        expect(svc.isStorageDegraded()).toBe(false);
        const p = await svc.createPreset({ name: 'Local', settings: { volume: 0.5 } });
        // Degraded now, but the preset is still usable from memory.
        expect(svc.isStorageDegraded()).toBe(true);
        const list = await svc.listPresets();
        expect(list.map((x) => x.name)).toEqual(['Local']);
        expect(list[0].id).toBe(p.id);
    });
});
