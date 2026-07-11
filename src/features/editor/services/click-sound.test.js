import { playClickSound, scheduleClickSound, CLICK_SOUND_OPTIONS, CLICK_MASTER_GAIN } from './click-sound.js';

// jsdom has no Web Audio: the realtime path must degrade to a silent no-op
// rather than crash the render loop that calls it every playback frame. The
// offline path (used by the exporter) is driven with a fake context here.
describe('click-sound', () => {
    it('exposes the three static fallback sounds plus none', () => {
        expect(CLICK_SOUND_OPTIONS.map((s) => s.value)).toEqual(['none', 'click', 'pop', 'whoosh']);
        expect(CLICK_MASTER_GAIN).toBeGreaterThan(0);
        expect(CLICK_MASTER_GAIN).toBeLessThanOrEqual(1);
    });

    it('is a silent no-op for "none", zero volume, and missing AudioContext', () => {
        expect(() => playClickSound('none')).not.toThrow();
        expect(() => playClickSound('click', { volume: 0 })).not.toThrow();
        expect(() => playClickSound('click')).not.toThrow(); // no AudioContext in jsdom
        expect(() => playClickSound('https://example.com/sound.mp3')).not.toThrow();
    });

    describe('scheduleClickSound (offline export path)', () => {
        // Minimal OfflineAudioContext stand-in recording scheduled node starts.
        const makeCtx = () => {
            const started = [];
            const node = () => ({
                frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
                gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
                Q: {},
                type: '',
                connect() { return this; },
                start(t) { started.push(t); },
                stop() {},
            });
            return {
                started,
                sampleRate: 48000,
                createOscillator: node,
                createGain: node,
                createBiquadFilter: node,
                createBufferSource: node,
                createBuffer: (ch, len, sr) => ({ getChannelData: () => new Float32Array(len) }),
                decodeAudioData: async () => { throw new Error('no decode'); },
            };
        };

        it('does nothing for "none"', async () => {
            const ctx = makeCtx();
            await scheduleClickSound(ctx, {}, 'none', 0);
            expect(ctx.started).toEqual([]);
        });

        it.each(['click', 'pop', 'whoosh'])('schedules the %s synth at the given time', async (sound) => {
            const ctx = makeCtx();
            await scheduleClickSound(ctx, {}, sound, 1.5);
            expect(ctx.started).toContain(1.5);
        });

        it('falls back to the click synth when a URL fails to fetch/decode', async () => {
            const ctx = makeCtx();
            global.fetch = jest.fn(async () => { throw new Error('offline'); });
            await scheduleClickSound(ctx, {}, 'https://example.com/x.mp3', 2);
            expect(ctx.started).toContain(2); // fallback synth still scheduled
            delete global.fetch;
        });
    });
});
