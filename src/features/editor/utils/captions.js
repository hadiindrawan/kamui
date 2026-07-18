/**
 * Caption model + pure helpers.
 *
 * A caption is `{ id, start, end, text }` with `start`/`end` in **source-time
 * seconds** (the untrimmed recording timeline — the same base Whisper returns
 * and the same base the live preview plays in). Rebasing to trimmed/output time
 * happens only at the export boundary via `mapCaptionsToOutputTime`.
 */

// Caption appearance. These are cross-recording style preferences (captured by
// presets), separate from the per-recording caption content.
export const CAPTION_FONT_FAMILIES = {
	sans: '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif',
	serif: 'Georgia, "Times New Roman", serif',
	mono: '"SF Mono", "Consolas", ui-monospace, monospace',
	rounded: '"Arial Rounded MT Bold", "Helvetica Rounded", "Segoe UI", system-ui, sans-serif',
};

export const DEFAULT_CAPTION_STYLE = {
	fontScale: 1,        // multiplies the base font size (0.5x–2x)
	fontFamily: 'sans',  // key of CAPTION_FONT_FAMILIES
	color: '#ffffff',    // text color
	background: 'box',    // 'box' | 'shadow' | 'none'
	position: 'bottom',  // 'bottom' | 'middle' | 'top'
};

/**
 * Fill in any missing style fields with defaults.
 */
export const resolveCaptionStyle = (style) => ({ ...DEFAULT_CAPTION_STYLE, ...(style || {}) });

let captionSeq = 0;

/**
 * Create a normalized caption. Ensures `start < end` and non-negative times.
 */
export const createCaption = ({ start = 0, end = 0, text = '' } = {}) => {
	const s = Math.max(0, Number(start) || 0);
	let e = Math.max(0, Number(end) || 0);
	if (e <= s) {
		e = s + 0.5;
	}
	captionSeq += 1;
	return {
		id: `cap_${Date.now().toString(36)}_${captionSeq}`,
		start: s,
		end: e,
		text: String(text),
	};
};

/**
 * Return a new array sorted by start time (stable on ties by end).
 */
export const sortCaptions = (captions) =>
	[...captions].sort((a, b) => a.start - b.start || a.end - b.end);

/**
 * The caption active at time `tSec` (start <= t < end). On overlap the
 * latest-starting match wins, so it is deterministic.
 */
export const captionAtTime = (captions, tSec) => {
	let active = null;
	for (const c of captions) {
		if (tSec >= c.start && tSec < c.end) {
			if (!active || c.start >= active.start) {
				active = c;
			}
		}
	}
	return active;
};

const pad = (n, width) => String(n).padStart(width, '0');

/**
 * Format seconds as an SRT timestamp `HH:MM:SS,mmm`.
 */
export const formatSrtTime = (sec) => {
	const clamped = Math.max(0, sec);
	const ms = Math.round(clamped * 1000);
	const hours = Math.floor(ms / 3600000);
	const minutes = Math.floor((ms % 3600000) / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	const millis = ms % 1000;
	return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
};

/**
 * Map source-time captions into trimmed/output time: keep captions overlapping
 * `[trimStart, trimEnd]`, clamp to the window, and subtract `trimStart` so the
 * result is 0-based on the exported (trimmed) timeline. This is the single
 * source of truth shared by SRT export and burned-in captions.
 */
export const mapCaptionsToOutputTime = (captions, trimStart = 0, trimEnd = Infinity) => {
	const start = Math.max(0, trimStart || 0);
	const end = trimEnd == null ? Infinity : trimEnd;
	const out = [];
	for (const c of sortCaptions(captions)) {
		if (c.end <= start || c.start >= end) {
			continue;
		}
		const clampedStart = Math.max(c.start, start) - start;
		const clampedEnd = Math.min(c.end, end) - start;
		if (clampedEnd <= clampedStart) {
			continue;
		}
		out.push({ ...c, start: clampedStart, end: clampedEnd });
	}
	return out;
};

/**
 * Build a standard SRT string from captions, rebased for the given trim window.
 * Empty/whitespace-only captions are skipped; numbering is sequential.
 */
export const captionsToSrt = (captions, { trimStart = 0, trimEnd = Infinity } = {}) => {
	const mapped = mapCaptionsToOutputTime(captions, trimStart, trimEnd);
	const blocks = [];
	let index = 0;
	for (const c of mapped) {
		const text = c.text.trim();
		if (!text) {
			continue;
		}
		index += 1;
		blocks.push(
			`${index}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${text}`
		);
	}
	return blocks.join('\n\n') + (blocks.length ? '\n' : '');
};

/**
 * Greedy word-wrap `text` to lines no wider than `maxWidth` using the canvas
 * context's current font. Returns an array of line strings.
 */
export const wrapCaptionText = (ctx, text, maxWidth) => {
	const words = String(text).split(/\s+/).filter(Boolean);
	if (!words.length) {
		return [];
	}
	const lines = [];
	let current = words[0];
	for (let i = 1; i < words.length; i += 1) {
		const candidate = `${current} ${words[i]}`;
		if (ctx.measureText(candidate).width <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = words[i];
		}
	}
	lines.push(current);
	return lines;
};
