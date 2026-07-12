import {
    BASE_VIDEO_BITRATES_60FPS,
    QUALITY_TIERS,
    AUDIO_BITRATES,
    SIZE_BUDGET_BYTES_PER_MIN,
    scaleBitrateForFps,
    computeVideoBitrate,
    computeAudioBitrate,
    estimateFileSizeBytes,
    budgetTotalBitrate,
    capBitrateToBudget,
    selectExportCodec,
} from './export-codec.js';

describe('bitrate model', () => {
    it('returns the table bitrate exactly at 60fps / best tier', () => {
        expect(computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 60, tier: 'best' })).toBe(8_000_000);
        expect(computeVideoBitrate({ codec: 'avc', resolution: 1080, fps: 60, tier: 'best' })).toBe(5_000_000);
        expect(computeVideoBitrate({ codec: 'vp9', resolution: 720, fps: 60, tier: 'best' })).toBe(1_600_000);
    });

    it('accepts string resolution keys (as the UI passes them)', () => {
        expect(computeVideoBitrate({ codec: 'hevc', resolution: '2160', fps: 60, tier: 'best' }))
            .toBe(computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 60, tier: 'best' }));
    });

    it('scales fps sub-linearly: 120fps costs ~1.52x, not 2x', () => {
        const at60 = scaleBitrateForFps(8_000_000, 60);
        const at120 = scaleBitrateForFps(8_000_000, 120);
        expect(at60).toBe(8_000_000);
        expect(at120 / at60).toBeCloseTo(Math.pow(2, 0.6), 3); // ~1.5157
        expect(at120 / at60).toBeLessThan(2);
    });

    it('is monotonic in fps', () => {
        const bitrates = [30, 60, 90, 120].map((fps) =>
            computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps, tier: 'best' }));
        for (let i = 1; i < bitrates.length; i++) {
            expect(bitrates[i]).toBeGreaterThan(bitrates[i - 1]);
        }
    });

    it('orders quality tiers best > balanced > smallest for every cell', () => {
        for (const resolution of Object.keys(BASE_VIDEO_BITRATES_60FPS)) {
            for (const codec of Object.keys(BASE_VIDEO_BITRATES_60FPS[resolution])) {
                const best = computeVideoBitrate({ codec, resolution: Number(resolution), fps: 120, tier: 'best' });
                const balanced = computeVideoBitrate({ codec, resolution: Number(resolution), fps: 120, tier: 'balanced' });
                const smallest = computeVideoBitrate({ codec, resolution: Number(resolution), fps: 120, tier: 'smallest' });
                expect(best).toBeGreaterThan(balanced);
                expect(balanced).toBeGreaterThan(smallest);
            }
        }
    });

    it('HEVC needs less than AVC for the same cell (efficiency)', () => {
        const hevc = computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 120, tier: 'best' });
        const avc = computeVideoBitrate({ codec: 'avc', resolution: 2160, fps: 120, tier: 'best' });
        expect(hevc).toBeLessThan(avc);
    });

    it('audio bitrates map by container codec and tier', () => {
        expect(computeAudioBitrate({ format: 'mp4', tier: 'best' })).toBe(AUDIO_BITRATES.aac.best);
        expect(computeAudioBitrate({ format: 'webm', tier: 'best' })).toBe(AUDIO_BITRATES.opus.best);
        expect(computeAudioBitrate({ format: 'mp4', tier: 'smallest' })).toBe(128_000);
    });
});

describe('budget', () => {
    it('4K@120 HEVC best (video + audio) fits the ~13.3 Mbps target', () => {
        const video = computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 120, tier: 'best' });
        const audio = computeAudioBitrate({ format: 'mp4', tier: 'best' });
        expect(video + audio).toBeLessThanOrEqual(13_300_000);
    });

    it('capBitrateToBudget only lowers bitrates that exceed the budget', () => {
        const audio = 192_000;
        const budgetVideo = budgetTotalBitrate() - audio;
        // A small bitrate is untouched.
        expect(capBitrateToBudget(5_000_000, audio)).toBe(5_000_000);
        // An over-budget bitrate is capped to fit.
        expect(capBitrateToBudget(30_000_000, audio)).toBe(budgetVideo);
        expect(capBitrateToBudget(30_000_000, audio) + audio).toBeLessThanOrEqual(budgetTotalBitrate());
    });

    it('estimateFileSizeBytes uses (v+a)/8 * seconds * overhead', () => {
        const bytes = estimateFileSizeBytes({ videoBitrate: 8_000_000, audioBitrate: 192_000, durationSec: 60 });
        // (8_192_000 / 8) * 60 * 1.01
        expect(bytes).toBe(Math.round((8_192_000 / 8) * 60 * 1.01));
    });

    it('a capped AVC 4K@120 export stays within the 100MB/min budget', async () => {
        const probe = async (codec) => codec === 'avc'; // HEVC unavailable
        const { attempts } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        });
        const audio = computeAudioBitrate({ format: 'mp4', tier: 'best' });
        const estimated = estimateFileSizeBytes({ videoBitrate: attempts[0].bitrate, audioBitrate: audio, durationSec: 60 });
        expect(estimated).toBeLessThanOrEqual(SIZE_BUDGET_BYTES_PER_MIN);
    });
});

describe('selectExportCodec', () => {
    it('prefers HEVC for MP4 when it is encodable, with no warning', async () => {
        const probe = jest.fn(async () => true);
        const { attempts, warning } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        });
        expect(attempts.map((a) => a.codec)).toEqual(['hevc', 'avc']);
        expect(attempts[0].codec).toBe('hevc');
        expect(attempts[0].bitrate).toBe(computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 120, tier: 'best' }));
        expect(warning).toBeNull();
    });

    it('falls back to H.264 (capped) with a warning when HEVC fails at 4K@120', async () => {
        const probe = async (codec) => codec === 'avc';
        const { attempts, warning } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        });
        expect(attempts.map((a) => a.codec)).toEqual(['avc']);
        expect(attempts[0].capped).toBe(true);
        expect(warning).toMatch(/H\.264/);
        expect(warning).toMatch(/capped/i);
    });

    it('warns without a cap when H.264 fits the budget (1080p fallback)', async () => {
        const probe = async (codec) => codec === 'avc';
        const { attempts, warning } = await selectExportCodec({
            format: 'mp4', width: 1920, height: 1080, resolution: 1080, fps: 60, tier: 'best', probe,
        });
        expect(attempts[0].capped).toBe(false);
        expect(warning).toBe('HEVC unavailable — using H.264.');
    });

    it('rejects when no candidate is encodable', async () => {
        const probe = async () => false;
        await expect(selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        })).rejects.toThrow(/No supported video encoder/);
    });

    it('uses only VP9 for WebM and probes with the frame rate + codec bitrate', async () => {
        const probe = jest.fn(async () => true);
        const { attempts, warning } = await selectExportCodec({
            format: 'webm', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        });
        expect(attempts.map((a) => a.codec)).toEqual(['vp9']);
        expect(warning).toBeNull();
        expect(probe).toHaveBeenCalledWith('vp9', expect.objectContaining({
            width: 3840,
            height: 2160,
            framerate: 120,
            bitrate: computeVideoBitrate({ codec: 'vp9', resolution: 2160, fps: 120, tier: 'best' }),
        }));
    });
});
