// Codec selection + fps/codec-aware bitrate model for the export pipeline.
//
// The goal is a 4K@120fps MP4 under 100MB per minute (~14 Mbps total budget)
// while staying visually near-lossless for screen content. mediabunny already
// supports HEVC/VP9 encoding via WebCodecs, so this module picks the best codec
// the platform can actually encode and computes a bitrate that fits the budget,
// instead of the old fixed per-resolution bitrates (which were tuned only for
// 60fps H.264 and blew ~3.4x past the budget at 4K).
//
// All numbers are pure functions of {codec, resolution, fps, tier}; the async
// selectExportCodec probes the browser (via mediabunny's canEncodeVideo) and is
// injectable so tests never touch WebCodecs.

// Base video bitrates (bps) at 60fps, 'best' tier, keyed by resolution
// short-edge preset (see calculateCanvasSize) then codec. Non-16:9 aspect
// ratios at the same preset have equal-or-fewer pixels, so these are safe
// upper bounds. HEVC and VP9 share numbers (~0.6 the AVC bitrate for equal
// quality on screen content); AVC needs ~1.75x.
//
// These target a *visually transparent* re-encode of a screen recording: the
// capture itself is stored at a comparable bitrate (see recorder.js), so
// exporting materially below these numbers throws away detail the source
// actually has and shows up as mushy text. An earlier revision of this table
// was tuned to fit a 100MB/min budget (4K hevc was 8 Mbps ≈ 13 Mbps
// AVC-equivalent, roughly half the source) which made 4K exports visibly
// blurrier than the pre-budget behaviour (mediabunny QUALITY_HIGH ≈ 22 Mbps
// AVC at 4K). Quality wins over the size target now; the tiers below and the
// 'smallest' budget cap are how users opt into smaller files.
export const BASE_VIDEO_BITRATES_60FPS = {
    2160: { hevc: 15_000_000, avc: 25_000_000, vp9: 15_000_000 },
    1080: { hevc: 5_500_000, avc: 9_000_000, vp9: 5_500_000 },
    720: { hevc: 2_700_000, avc: 4_500_000, vp9: 2_700_000 },
};

export const QUALITY_TIERS = {
    best: { label: 'Best quality', videoFactor: 1.0 },
    balanced: { label: 'Balanced', videoFactor: 0.7 },
    smallest: { label: 'Smallest file', videoFactor: 0.45 },
};

// Audio bitrates (bps) by container codec × tier.
export const AUDIO_BITRATES = {
    aac: { best: 192_000, balanced: 160_000, smallest: 128_000 },
    opus: { best: 128_000, balanced: 112_000, smallest: 96_000 },
};

// Container/muxing overhead multiplier used for both size estimation and the
// AVC budget cap, so they stay consistent.
export const SIZE_OVERHEAD = 1.01;

// 100MB per minute target. This is only *enforced* on the 'smallest' tier —
// for 'best'/'balanced' it stays advisory (used for the post-export size
// readout/warning), because capping 4K to this budget is what made exports
// blurry. See BASE_VIDEO_BITRATES_60FPS.
export const SIZE_BUDGET_BYTES_PER_MIN = 100 * 1024 * 1024;

// Tiers whose bitrate is hard-capped to SIZE_BUDGET_BYTES_PER_MIN.
export const BUDGET_ENFORCED_TIERS = new Set(['smallest']);

// fps scaling: at 120fps the source screen recording's duplicated content
// frames (getDisplayMedia only emits ~60fps of real frames) compress to almost
// nothing; only the camera zoom/pan animation adds genuinely new information.
// So 2x fps costs ~1.52x bitrate, not 2x. (fps/60)^0.6 → 30:0.66, 60:1.0,
// 90:1.28, 120:1.52.
export const scaleBitrateForFps = (baseBitrate, fps) =>
    Math.round(baseBitrate * Math.pow((fps || 60) / 60, 0.6));

// Snap an arbitrary output short-edge (e.g. a "source" export at 1440 or 2160,
// or a non-preset capture size) up to the smallest bitrate bucket that covers
// it, so source-resolution exports never get under-budgeted. Non-numeric or
// missing values fall back to 1080.
export const bucketForResolution = (resolution) => {
    const n = Number(resolution);
    if (!Number.isFinite(n)) return 1080;
    if (n <= 720) return 720;
    if (n <= 1080) return 1080;
    return 2160;
};

// Uncapped model bitrate for a codec at a resolution/fps/tier. Pure.
export const computeVideoBitrate = ({ codec, resolution, fps, tier = 'best' }) => {
    const row = BASE_VIDEO_BITRATES_60FPS[bucketForResolution(resolution)] || BASE_VIDEO_BITRATES_60FPS[1080];
    const base = row[codec] ?? row.avc;
    const videoFactor = (QUALITY_TIERS[tier] || QUALITY_TIERS.best).videoFactor;
    return scaleBitrateForFps(Math.round(base * videoFactor), fps);
};

export const computeAudioBitrate = ({ format, tier = 'best' }) => {
    const codec = format === 'webm' ? 'opus' : 'aac';
    const row = AUDIO_BITRATES[codec];
    return row[tier] ?? row.best;
};

export const estimateFileSizeBytes = ({ videoBitrate, audioBitrate, durationSec }) =>
    Math.round(((videoBitrate + audioBitrate) / 8) * (durationSec || 0) * SIZE_OVERHEAD);

// The total bitrate (video + audio) that keeps a 1-minute file under budget,
// accounting for container overhead.
export const budgetTotalBitrate = () =>
    Math.floor((SIZE_BUDGET_BYTES_PER_MIN * 8) / 60 / SIZE_OVERHEAD);

// Cap a video bitrate so video + audio fits the 100MB/min budget. Returns the
// input unchanged when it already fits.
export const capBitrateToBudget = (videoBitrate, audioBitrate) => {
    const videoBudget = Math.max(0, budgetTotalBitrate() - audioBitrate);
    return Math.min(videoBitrate, videoBudget);
};

// Codec preference per container: MP4 prefers HEVC (best compression, hardware
// on Chrome 130+) then falls back to H.264; WebM only supports VP9 here (AV1
// software encode is far too slow for 4K@120, VP8 is strictly worse). Player
// compatibility is why VP9-in-MP4 is deliberately skipped.
const CODEC_PREFERENCE = {
    mp4: ['hevc', 'avc'],
    webm: ['vp9'],
};

const defaultProbe = async (codec, options) => {
    const { canEncodeVideo } = await import('mediabunny');
    return canEncodeVideo(codec, options);
};

/**
 * Pick the best encodable codec for the given output and compute its bitrate.
 *
 * Probes each candidate (in preference order) with the exact width/height/fps/
 * bitrate we'd encode at — passing `framerate` is what catches AVC hardware
 * encoders capped at level 5.2 (4K@60) when asked for 4K@120. Returns every
 * candidate that passed, so the caller can retry down the list if
 * Conversion.init later disagrees with the probe (isConfigSupported race).
 *
 * When only H.264 is available its bitrate is capped to the 100MB/min budget
 * (accepting some quality loss) rather than blowing past the target, and a
 * warning explains the trade-off. HEVC/VP9 keep their full model bitrate.
 *
 * @returns {Promise<{ attempts: Array<{codec: string, bitrate: number, capped: boolean}>, warning: string|null }>}
 */
export const selectExportCodec = async ({
    format = 'mp4',
    width,
    height,
    resolution,
    fps,
    tier = 'best',
    probe = defaultProbe,
}) => {
    const candidates = CODEC_PREFERENCE[format] || CODEC_PREFERENCE.mp4;
    const audioBitrate = computeAudioBitrate({ format, tier });
    const attempts = [];

    for (const codec of candidates) {
        let bitrate = computeVideoBitrate({ codec, resolution, fps, tier });
        let capped = false;
        // Only the 'smallest' tier trades quality for the size budget. 'best'
        // and 'balanced' keep their full model bitrate on every codec —
        // capping AVC here unconditionally is what made 4K exports blurry.
        if (BUDGET_ENFORCED_TIERS.has(tier)) {
            const cappedBitrate = capBitrateToBudget(bitrate, audioBitrate);
            capped = cappedBitrate < bitrate;
            bitrate = cappedBitrate;
        }
        const ok = await probe(codec, { width, height, bitrate, framerate: fps });
        if (ok) {
            attempts.push({ codec, bitrate, capped });
        }
    }

    if (attempts.length === 0) {
        throw new Error(`No supported video encoder for ${format} at ${width}x${height}@${fps}fps`);
    }

    const selected = attempts[0];
    let warning = null;
    // MP4 fell back from HEVC to H.264.
    if (format !== 'webm' && selected.codec === 'avc' && candidates.includes('hevc')) {
        const mbps = (selected.bitrate / 1_000_000).toFixed(1);
        warning = selected.capped
            ? `HEVC unavailable — using H.264 capped at ${mbps} Mbps to stay under 100MB/min; quality may be reduced.`
            : 'HEVC unavailable — using H.264.';
    }

    return { attempts, warning };
};

// Codec id → short human label for the UI readout.
export const CODEC_LABELS = {
    hevc: 'HEVC',
    avc: 'H.264',
    vp9: 'VP9',
    av1: 'AV1',
    vp8: 'VP8',
};
