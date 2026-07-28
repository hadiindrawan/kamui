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
        expect(computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 60, tier: 'best' })).toBe(15_000_000);
        expect(computeVideoBitrate({ codec: 'avc', resolution: 1080, fps: 60, tier: 'best' })).toBe(9_000_000);
        expect(computeVideoBitrate({ codec: 'vp9', resolution: 720, fps: 60, tier: 'best' })).toBe(2_700_000);
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
    // Regression guard for the "blurry 4K export" bug: the bitrate model was
    // once tuned down to fit 100MB/min, which put 4K at ~8 Mbps HEVC — about
    // half the source recording's own bitrate, so the re-encode visibly lost
    // detail. 'best' must stay at least as good as the pre-budget behaviour
    // (mediabunny QUALITY_HIGH ≈ 22.4 Mbps AVC at 4K).
    const OLD_QUALITY_HIGH_4K_AVC = 22_400_000;
    const HEVC_EFFICIENCY = 0.6; // HEVC bitrate ≈ 0.6x AVC for equal quality

    it('keeps 4K "best" at least as sharp as the pre-budget QUALITY_HIGH baseline', () => {
        const hevc = computeVideoBitrate({ codec: 'hevc', resolution: 2160, fps: 60, tier: 'best' });
        const avcEquivalent = hevc / HEVC_EFFICIENCY;
        expect(avcEquivalent).toBeGreaterThanOrEqual(OLD_QUALITY_HIGH_4K_AVC);
    });

    it('does not cap "best" or "balanced" to the size budget (quality wins)', () => {
        const audio = computeAudioBitrate({ format: 'mp4', tier: 'best' });
        for (const tier of ['best', 'balanced']) {
            const video = computeVideoBitrate({ codec: 'avc', resolution: 2160, fps: 120, tier });
            // Deliberately over the 100MB/min budget — that is the point.
            expect(video + audio).toBeGreaterThan(budgetTotalBitrate());
        }
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

    it('the "smallest" tier still enforces the 100MB/min budget at 4K@120', async () => {
        const probe = async () => true;
        const { attempts } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'smallest', probe,
        });
        const audio = computeAudioBitrate({ format: 'mp4', tier: 'smallest' });
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

    it('falls back to H.264 at full quality (uncapped) when HEVC fails at 4K@120', async () => {
        const probe = async (codec) => codec === 'avc';
        const { attempts, warning } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'best', probe,
        });
        expect(attempts.map((a) => a.codec)).toEqual(['avc']);
        // 'best' is never budget-capped — the old unconditional AVC cap is what
        // made 4K H.264 fallbacks look blurry.
        expect(attempts[0].capped).toBe(false);
        expect(warning).toMatch(/H\.264/);
    });

    it('caps the H.264 fallback only on the "smallest" tier', async () => {
        const probe = async (codec) => codec === 'avc';
        const { attempts, warning } = await selectExportCodec({
            format: 'mp4', width: 3840, height: 2160, resolution: 2160, fps: 120, tier: 'smallest', probe,
        });
        expect(attempts[0].capped).toBe(true);
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
