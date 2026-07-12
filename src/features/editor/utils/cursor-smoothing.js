// Cursor path smoothing. Raw mousemove capture (~1 sample/frame) is jittery:
// hand tremor and irregular sampling turn into an erratic, fatiguing cursor
// path. A Catmull-Rom spline alone can't fix this — it passes exactly through
// every control point, so it interpolates jitter rather than removing it. The
// dampening therefore happens BEFORE the spline: a centered moving average
// kills the amplitude, then min-gap decimation drops redundant samples so the
// spline glides between sparse, well-averaged knots.
//
// The filtered path is built once (in buildSceneModel) and evaluated per frame
// via the shared spline, so the live preview and the export produce identical
// motion.

import { smoothCursorPosition } from './camera.js';

export const DEFAULT_CURSOR_SMOOTHING = 'medium';

// windowMs: centered moving-average span (jitter amplitude suppression).
// minGapMs: minimum spacing between retained knots (decimation strength).
// Tuned against ~16.7ms move cadence (60Hz) and ~100ms follow cadence.
export const CURSOR_SMOOTHING_LEVELS = [
	{ value: 'off', label: 'Off' },
	{ value: 'low', label: 'Low', windowMs: 80, minGapMs: 30 },
	{ value: 'medium', label: 'Medium', windowMs: 160, minGapMs: 60 },
	{ value: 'high', label: 'High', windowMs: 320, minGapMs: 120 },
];

const levelConfig = (level) =>
	CURSOR_SMOOTHING_LEVELS.find((l) => l.value === level && l.windowMs);

// Binary-insert a knot into a time-sorted array (keeps the path ordered so the
// spline's bracketing scan stays correct after click injection).
const insertSorted = (path, knot) => {
	let lo = 0;
	let hi = path.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (path[mid].time < knot.time) { lo = mid + 1; }
		else { hi = mid; }
	}
	path.splice(lo, 0, knot);
};

/**
 * Builds a smoothed, time-sorted cursor knot path from raw move/follow events.
 * Returns null when smoothing is off/unknown or there are no cursor events, so
 * callers fall back to the raw step lookup. `clickEvents` (already scene-mapped
 * + deduped) are injected as protected knots so the spline passes through each
 * click position and the cursor dot lands on the click ripple's origin.
 */
export const buildSmoothedCursorPath = (cursorEvents, level, clickEvents = []) => {
	const cfg = levelConfig(level);
	if (!cfg || !cursorEvents || cursorEvents.length === 0) return null;
	const { windowMs, minGapMs } = cfg;

	// Copy + sort by time (model.events interleaves segments first, and event
	// order is not contractual), collapsing duplicate timestamps (keep last).
	const sorted = cursorEvents
		.map((e) => ({ time: e.time, x: e.x, y: e.y }))
		.sort((a, b) => a.time - b.time);
	const deduped = [];
	for (const e of sorted) {
		if (deduped.length && deduped[deduped.length - 1].time === e.time) {
			deduped[deduped.length - 1] = e;
		} else {
			deduped.push(e);
		}
	}
	if (deduped.length === 0) return null;

	// Centered moving average via a sliding [lo, hi] window over time.
	const half = windowMs / 2;
	const averaged = new Array(deduped.length);
	let lo = 0;
	let hi = 0;
	for (let i = 0; i < deduped.length; i++) {
		const t = deduped[i].time;
		while (lo < deduped.length && deduped[lo].time < t - half) lo++;
		if (hi < lo) hi = lo;
		while (hi < deduped.length && deduped[hi].time <= t + half) hi++;
		let sx = 0;
		let sy = 0;
		for (let k = lo; k < hi; k++) { sx += deduped[k].x; sy += deduped[k].y; }
		const n = hi - lo || 1;
		averaged[i] = { time: t, x: sx / n, y: sy / n };
	}

	// Decimate: keep the first + last, and any knot ≥ minGapMs past the last
	// retained one. Sparse follow-only paths (100ms cadence) are a near no-op.
	const path = [];
	for (let i = 0; i < averaged.length; i++) {
		const isLast = i === averaged.length - 1;
		if (path.length === 0 || isLast || averaged[i].time >= path[path.length - 1].time + minGapMs) {
			path.push(averaged[i]);
		}
	}

	// Inject clicks as protected knots. filterRapidClicks already guarantees
	// clicks are ≥250ms apart, so two clicks never collide within one minGap.
	for (const c of clickEvents) {
		for (let i = path.length - 1; i >= 0; i--) {
			if (Math.abs(path[i].time - c.time) < minGapMs) path.splice(i, 1);
		}
		insertSorted(path, { time: c.time, x: c.x, y: c.y });
	}

	return path;
};

/** Evaluates a smoothed cursor path at a time via the shared centripetal spline. */
export const sampleCursorPath = (timeMs, path) => smoothCursorPosition(timeMs, path);
