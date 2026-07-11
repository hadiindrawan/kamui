import { renderHook, act, waitFor } from '@testing-library/react';
import { PRESET_FIELDS } from '../utils/preset-fields.js';

// Controllable preset-service mock.
const mockListPresets = jest.fn();
const mockCreatePreset = jest.fn();
const mockUpdatePreset = jest.fn();
const mockRemovePreset = jest.fn();
jest.mock('../services/preset-service.js', () => ({
    listPresets: (...a) => mockListPresets(...a),
    createPreset: (...a) => mockCreatePreset(...a),
    updatePreset: (...a) => mockUpdatePreset(...a),
    removePreset: (...a) => mockRemovePreset(...a),
    isStorageDegraded: () => false,
    PresetNameError: class PresetNameError extends Error {},
}));

const mockShowToast = jest.fn();
jest.mock('../../../shared/hooks/useToast.js', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

// eslint-disable-next-line import/first
import { usePresets } from './usePresets.js';

const makeEditorState = (over = {}) => {
    const state = { loading: false, isExporting: false, handleExport: jest.fn(), setHasPendingEdits: jest.fn() };
    for (const { setter } of PRESET_FIELDS) state[setter] = jest.fn();
    return { ...state, ...over };
};

describe('usePresets', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockListPresets.mockResolvedValue([]);
        global.chrome.storage.local.get.mockResolvedValue({});
        global.chrome.storage.local.set.mockResolvedValue();
    });

    it('applies a preset: sets state, marks pending, persists active id', async () => {
        const preset = { id: 'p1', name: 'Vertical', autoExport: false, settings: { zoomLevel: 3 } };
        mockListPresets.mockResolvedValue([preset]);
        const editorState = makeEditorState();

        const { result } = renderHook(() => usePresets(editorState));
        await waitFor(() => expect(result.current.presets).toHaveLength(1));

        await act(async () => { await result.current.applyPreset('p1'); });

        expect(editorState.setZoomLevel).toHaveBeenCalledWith(3);
        expect(editorState.setHasPendingEdits).toHaveBeenCalledWith(true);
        expect(result.current.activePresetId).toBe('p1');
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ activePresetId: 'p1' });
    });

    it('starts a 5s countdown then auto-exports for an auto-export preset', async () => {
        jest.useFakeTimers();
        const preset = { id: 'p1', name: 'Auto', autoExport: true, settings: { exportResolution: '720', exportFps: 30, exportQuality: 'smallest' } };
        mockListPresets.mockResolvedValue([preset]);
        const editorState = makeEditorState();

        const { result } = renderHook(() => usePresets(editorState));
        await act(async () => { await Promise.resolve(); }); // flush init effect

        await act(async () => { await result.current.applyPreset('p1'); });
        expect(result.current.countdown).toMatchObject({ presetName: 'Auto', secondsLeft: 5 });
        expect(editorState.handleExport).not.toHaveBeenCalled();

        act(() => { jest.advanceTimersByTime(1000); });
        expect(result.current.countdown.secondsLeft).toBe(4);
        // Tick down the remaining 4 seconds.
        for (let i = 0; i < 4; i++) {
            act(() => { jest.advanceTimersByTime(1000); });
        }

        expect(editorState.handleExport).toHaveBeenCalledWith(
            expect.objectContaining({ exportResolution: '720', exportFps: 30, exportQuality: 'smallest' })
        );
        expect(result.current.countdown).toBeNull();
        jest.useRealTimers();
    });

    it('cancelling the countdown prevents the export', async () => {
        jest.useFakeTimers();
        const preset = { id: 'p1', name: 'Auto', autoExport: true, settings: {} };
        mockListPresets.mockResolvedValue([preset]);
        const editorState = makeEditorState();

        const { result } = renderHook(() => usePresets(editorState));
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.applyPreset('p1'); });
        act(() => { jest.advanceTimersByTime(1000); });
        act(() => { result.current.cancelCountdown(); });
        act(() => { jest.advanceTimersByTime(5000); });

        expect(editorState.handleExport).not.toHaveBeenCalled();
        expect(result.current.countdown).toBeNull();
        jest.useRealTimers();
    });

    it('does NOT auto-apply the active preset when the recording already has saved settings', async () => {
        const preset = { id: 'p1', name: 'Def', autoExport: false, settings: { zoomLevel: 9 } };
        mockListPresets.mockResolvedValue([preset]);
        global.chrome.storage.local.get.mockResolvedValue({ activePresetId: 'p1' });
        const editorState = makeEditorState({ recording: { editorSettings: { zoomLevel: 2 } } });

        renderHook(() => usePresets(editorState));
        await waitFor(() => expect(mockListPresets).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });

        // Recording is already customized — its settings must be respected.
        expect(editorState.setZoomLevel).not.toHaveBeenCalled();
    });

    it('auto-applies the active preset for a fresh recording with no saved settings', async () => {
        const preset = { id: 'p1', name: 'Def', autoExport: false, settings: { zoomLevel: 9 } };
        mockListPresets.mockResolvedValue([preset]);
        global.chrome.storage.local.get.mockResolvedValue({ activePresetId: 'p1' });
        const editorState = makeEditorState({ recording: {} });

        renderHook(() => usePresets(editorState));
        await waitFor(() => expect(editorState.setZoomLevel).toHaveBeenCalledWith(9));
    });

    it('applies the global cursor-smoothing default when neither saved nor preset set it', async () => {
        global.chrome.storage.local.get.mockResolvedValue({ globalCursorSmoothing: 'high' });
        const editorState = makeEditorState({ recording: {} });

        const { result } = renderHook(() => usePresets(editorState));
        await waitFor(() => expect(editorState.setCursorSmoothing).toHaveBeenCalledWith('high'));
        expect(result.current.globalCursorSmoothing).toBe('high');
    });

    it('lets a saved recording value win over the global cursor-smoothing default', async () => {
        global.chrome.storage.local.get.mockResolvedValue({ globalCursorSmoothing: 'high' });
        const editorState = makeEditorState({ recording: { editorSettings: { cursorSmoothing: 'low' } } });

        renderHook(() => usePresets(editorState));
        await waitFor(() => expect(mockListPresets).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });

        // Saved settings own the field — the global default must not overwrite it.
        expect(editorState.setCursorSmoothing).not.toHaveBeenCalled();
    });

    it('lets an auto-applied preset value win over the global cursor-smoothing default', async () => {
        const preset = { id: 'p1', name: 'Def', autoExport: false, settings: { cursorSmoothing: 'low' } };
        mockListPresets.mockResolvedValue([preset]);
        global.chrome.storage.local.get.mockResolvedValue({ activePresetId: 'p1', globalCursorSmoothing: 'high' });
        const editorState = makeEditorState({ recording: {} });

        renderHook(() => usePresets(editorState));
        // The preset defines the field, so it (low), not the global (high), applies.
        await waitFor(() => expect(editorState.setCursorSmoothing).toHaveBeenCalledWith('low'));
        expect(editorState.setCursorSmoothing).not.toHaveBeenCalledWith('high');
    });

    it('persists a global cursor-smoothing default via setGlobalCursorSmoothing', async () => {
        const editorState = makeEditorState();
        const { result } = renderHook(() => usePresets(editorState));
        await act(async () => { await Promise.resolve(); });

        act(() => { result.current.setGlobalCursorSmoothing('medium'); });
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ globalCursorSmoothing: 'medium' });
        expect(result.current.globalCursorSmoothing).toBe('medium');

        act(() => { result.current.setGlobalCursorSmoothing(''); });
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ globalCursorSmoothing: null });
    });

    it('applies a preset when a PRESET_APPLIED message arrives', async () => {
        const preset = { id: 'p2', name: 'Remote', autoExport: false, settings: { zoomLevel: 4 } };
        mockListPresets.mockResolvedValue([preset]);
        const editorState = makeEditorState();

        renderHook(() => usePresets(editorState));
        await waitFor(() => expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled());

        // Grab the registered listener and fire the tray broadcast.
        const calls = global.chrome.runtime.onMessage.addListener.mock.calls;
        const listener = calls[calls.length - 1][0];
        await act(async () => { listener({ type: 'PRESET_APPLIED', presetId: 'p2' }); await Promise.resolve(); });

        await waitFor(() => expect(editorState.setZoomLevel).toHaveBeenCalledWith(4));
    });
});
