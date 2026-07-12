/**
 * Click sounds, synthesized with the Web Audio API instead of shipping bundled
 * mp3s — zero asset weight, zero decode latency, and they can never 404. The
 * sound id can also be a URL (myinstants / custom upload, future UI): remote
 * buffers are fetched + decoded once and cached, and any failure falls back to
 * the static 'click' synth per spec.
 *
 * Two consumers share the SAME synths so the exported video sounds like the
 * preview:
 *   - `playClickSound` — realtime, in the editor preview render loop.
 *   - `scheduleClickSound` — offline, mixing blips into an OfflineAudioContext
 *     for the exporter (see export.js `mixClickAudioIntoBlob`).
 *
 * Realtime playback rate-limits (min gap between plays) as a backstop for
 * scrubbing/seek edge cases; the offline path is already fed pre-deduped clicks.
 */

export const CLICK_SOUND_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'click', label: 'Click' },
    { value: 'pop', label: 'Pop' },
    { value: 'whoosh', label: 'Whoosh' },
];

const MIN_PLAY_GAP_MS = 200;
// Synth output is intentionally quiet next to recording audio. Exported and
// realtime clicks scale by this same factor (× volume) so loudness matches.
export const CLICK_MASTER_GAIN = 0.4;

let audioCtx = null;
let lastPlayTs = -Infinity;
const remoteBufferCache = new Map(); // url -> Promise<AudioBuffer|null>

const isUrl = (id) => /^(https?|data|blob):/.test(id);

function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) {
        try {
            audioCtx = new Ctor();
        } catch {
            return null;
        }
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

// --- Static synths ---------------------------------------------------------
// Each takes (ctx, destination, t0) and schedules a short one-shot sound.

// Bright, short tick: square blip with a fast exponential decay.
function synthClick(ctx, dest, t0) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2000, t0);
    gain.gain.setValueAtTime(0.6, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
    osc.connect(gain).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.05);
}

// Rounded pop: sine with a quick downward pitch bend.
function synthPop(ctx, dest, t0) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t0);
    osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.09);
    gain.gain.setValueAtTime(0.9, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
    osc.connect(gain).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.12);
}

// Airy whoosh: filtered noise with an upward band-pass sweep.
function synthWhoosh(ctx, dest, t0) {
    const durationS = 0.25;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * durationS), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(300, t0);
    filter.frequency.exponentialRampToValueAtTime(2500, t0 + durationS);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.8, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationS);
    src.connect(filter).connect(gain).connect(dest);
    src.start(t0);
    src.stop(t0 + durationS);
}

const SYNTHS = { click: synthClick, pop: synthPop, whoosh: synthWhoosh };

// --- Remote (custom URL) path ----------------------------------------------

function loadRemoteBuffer(ctx, url) {
    if (!remoteBufferCache.has(url)) {
        const promise = fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.arrayBuffer();
            })
            .then((buf) => ctx.decodeAudioData(buf))
            .catch(() => null); // cache the failure too — no refetch storms
        remoteBufferCache.set(url, promise);
    }
    return remoteBufferCache.get(url);
}

async function playRemote(ctx, url, dest) {
    const buffer = await loadRemoteBuffer(ctx, url);
    if (!buffer) {
        // Graceful fallback: the static click still gives tactile feedback.
        synthClick(ctx, dest, ctx.currentTime);
        return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start(ctx.currentTime);
}

/**
 * Play a click sound. `sound` is 'none' | 'click' | 'pop' | 'whoosh' | a URL.
 * Silently no-ops when sound is off, volume is zero, Web Audio is
 * unavailable, or a play landed less than MIN_PLAY_GAP_MS ago.
 */
export function playClickSound(sound, { volume = 1 } = {}) {
    if (!sound || sound === 'none' || volume <= 0) return;

    const now = Date.now();
    if (now - lastPlayTs < MIN_PLAY_GAP_MS) return;

    const ctx = getAudioContext();
    if (!ctx) return;
    lastPlayTs = now;

    try {
        const master = ctx.createGain();
        master.gain.value = Math.max(0, Math.min(1, volume)) * CLICK_MASTER_GAIN;
        master.connect(ctx.destination);

        if (isUrl(sound)) {
            playRemote(ctx, sound, master);
        } else {
            (SYNTHS[sound] || SYNTHS.click)(ctx, master, ctx.currentTime);
        }
    } catch {
        // Audio is best-effort; never let it break the render loop.
    }
}

/**
 * Offline counterpart of playClickSound for the exporter: schedules ONE click
 * blip into `destination` at time `when` (seconds, on the ctx's timeline). Used
 * with an OfflineAudioContext so preview and export share the exact same synths.
 * Static sounds resolve synchronously; a URL is fetched + decoded (with the same
 * silent fallback to the click synth on any failure), so callers should await.
 */
export async function scheduleClickSound(ctx, destination, sound, when) {
    if (!sound || sound === 'none') return;

    if (isUrl(sound)) {
        try {
            const res = await fetch(sound);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(destination);
            src.start(when);
            return;
        } catch {
            synthClick(ctx, destination, when); // graceful fallback
            return;
        }
    }

    (SYNTHS[sound] || SYNTHS.click)(ctx, destination, when);
}
