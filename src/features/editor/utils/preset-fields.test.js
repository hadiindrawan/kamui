import { PRESET_FIELDS, capturePresetSettings, applyPresetSettings } from './preset-fields.js';

// A fake state bag exposing every preset value + a jest.fn setter, mirroring
// the shape of the useEditorState return object.
const makeStateBag = (values = {}) => {
    const bag = {};
    for (const { key, setter } of PRESET_FIELDS) {
        bag[key] = values[key] !== undefined ? values[key] : `val_${key}`;
        bag[setter] = jest.fn();
    }
    return bag;
};

describe('preset-fields', () => {
    it('descriptor covers the documented preset scope', () => {
        const keys = PRESET_FIELDS.map((f) => f.key);
        // Spot-check one field from each category is present.
        for (const expected of [
            'zoomLevel', 'autoZoomIntensity', 'zoomDuration', 'transitionDuration',
            'playbackSpeed', 'aspectRatio', 'cropToFill', 'insetPadding', 'showShadow',
            'showBorder', 'borderRadius', 'backgroundMode', 'backgroundBlur',
            'showFollowCursor', 'cursorSmoothing', 'isMuted', 'volume',
            'clickAnimationStyle', 'clickAnimationOpacity', 'clickSound', 'clickAnimationInRecording',
            'exportResolution', 'exportFps', 'exportFormat', 'conversionService', 'exportQuality',
        ]) {
            expect(keys).toContain(expected);
        }
    });

    it('captures exactly the preset-field keys', () => {
        const bag = makeStateBag({ zoomLevel: 3, volume: 0.5, aspectRatio: '9:16' });
        const captured = capturePresetSettings(bag);
        expect(Object.keys(captured).sort()).toEqual(PRESET_FIELDS.map((f) => f.key).sort());
        expect(captured.zoomLevel).toBe(3);
        expect(captured.volume).toBe(0.5);
        expect(captured.aspectRatio).toBe('9:16');
    });

    it('omits undefined values on capture', () => {
        const bag = makeStateBag();
        bag.volume = undefined;
        const captured = capturePresetSettings(bag);
        expect(captured).not.toHaveProperty('volume');
    });

    it('capture → apply round-trips through every setter', () => {
        const source = makeStateBag({ zoomLevel: 2.5, isMuted: true, volume: 0.3 });
        const settings = capturePresetSettings(source);

        const target = makeStateBag();
        applyPresetSettings(settings, target);

        for (const { key, setter } of PRESET_FIELDS) {
            expect(target[setter]).toHaveBeenCalledWith(settings[key]);
        }
    });

    it('apply skips fields absent from the settings object', () => {
        const target = makeStateBag();
        applyPresetSettings({ zoomLevel: 4 }, target);
        expect(target.setZoomLevel).toHaveBeenCalledWith(4);
        expect(target.setVolume).not.toHaveBeenCalled();
        expect(target.setAspectRatio).not.toHaveBeenCalled();
    });

    it('apply is a no-op for null/undefined settings', () => {
        const target = makeStateBag();
        expect(() => applyPresetSettings(null, target)).not.toThrow();
        expect(target.setZoomLevel).not.toHaveBeenCalled();
    });
});
