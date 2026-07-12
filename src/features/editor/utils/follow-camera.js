// Follow-cursor camera model.
//
// The old follow mode chased *every* cursor sample at a fixed 1.5x zoom, which
// made the viewport lurch after each hand tremor and left viewers dizzy. This
// module reframes follow mode around meaningful interactions instead:
//
//   - Each click / keystroke opens a 1.5x "anchor" centered on where the action
//     happened. The camera holds there while the cursor roams *inside* the
//     zoomed viewport — small movements no longer move the camera.
//   - When the cursor leaves the anchor's viewport (and stays out past a short
//     debounce), the anchor ends and the camera eases back to the full frame.
//   - The next interaction opens the next anchor.
//
// Rather than accumulate runtime chase state (which would drift between the
// live preview's variable frame cadence and the exporter's fixed one), we
// precompute the anchor segments once from the event log — exactly like
// auto-zoom does — and hand them to the existing zoom-phase machinery in
// camera.js. Camera-at-time-T stays a pure function of the events, so preview
// and export render identically and the whole thing is unit-testable at a
// single timestamp.

// Follow anchors zoom in less aggressively than a click auto-zoom so the
// surrounding context stays visible.
export const FOLLOW_ZOOM_LEVEL = 1.5;

// How long the cursor must stay outside the viewport before we treat it as a
// real exit rather than an edge flicker.
export const BOUNDARY_EXIT_DEBOUNCE_MS = 100;

// Max cursor speed (normalized scene units per ms) that still counts as the
// cursor having "settled". Fast flicks and instant/teleport jumps move well
// above this; while the cursor is moving faster than this we don't react at all
// — the camera only zooms out once the cursor arrives somewhere and slows down,
// so a quick sweep across the frame (browser or native) never yanks the view.
// 0.002 ≈ two full frame-widths per second; deliberate navigation stays under
// it, flicks blow past it.
export const MAX_SETTLE_SPEED = 0.002;

// Follow modes. 'boundary' (default) adds the zoom-out-on-exit behavior;
// 'interactions' holds each anchor until the next interaction regardless of
// where the cursor wanders. Only 'boundary' is wired to the UI today, but the
// interactions-only path keeps the model simple to reason about and test.
export const FOLLOW_MODES = { INTERACTIONS: 'interactions', BOUNDARY: 'boundary' };

// Consecutive interactions closer than this (in normalized scene distance) are
// treated as the same anchor, so a rapid double-tap in one spot doesn't emit a
// redundant second segment that would micro-pan the camera.
const MICRO_PAN_THRESHOLD = 0.05;

// A large finite sentinel duration: the final anchor (and any anchor with no
// following interaction/exit) holds "indefinitely". Using a number rather than
// Infinity keeps the downstream duration arithmetic (time + duration + ...)
// finite and comparable.
const HOLD_SENTINEL_MS = 1e12;

// The normalized (0-1), clamped viewport rect the camera occupies while holding
// an anchor at (x, y) at `zoom`. Mirrors the centered-and-clamped rect math in
// camera.js `resolveEventRect`, but in normalized space (both axes span 1/zoom
// of the frame regardless of aspect ratio, since each axis is normalized
// independently). This is the box the cursor is considered "inside".
export const computeAnchorRect = (x, y, zoom) => {
	const w = 1 / zoom;
	const h = 1 / zoom;
	const rx = Math.max(0, Math.min(x - w / 2, 1 - w));
	const ry = Math.max(0, Math.min(y - h / 2, 1 - h));
	return { x: rx, y: ry, w, h };
};

const isInside = (sample, rect) =>
	sample.x >= rect.x && sample.x <= rect.x + rect.w &&
	sample.y >= rect.y && sample.y <= rect.y + rect.h;

// Scans time-sorted `samples` within [fromTime, untilTime) for the first moment
// the cursor leaves `rect`, has *settled* (is moving slower than `maxSpeed`),
// and *stays* out for at least `debounceMs`. Returns the time that settled exit
// run began (the caller ends the anchor at that time plus the debounce), or
// null if the cursor never sustained a settled exit.
//
// The run resets on any sample that is (a) back inside the rect — a quick
// out-and-back flicker doesn't count — or (b) still moving faster than
// `maxSpeed`: a fast flick or instant/teleport jump is ignored while in transit,
// so the camera doesn't chase it; only once the cursor arrives and slows outside
// does the exit register. A run still outside (and settled) when the scan window
// ends also counts (a parked cursor, or a teleport whose trailing samples are
// sparse, should still zoom out).
export const findBoundaryExitTime = (samples, fromTime, untilTime, rect, debounceMs, maxSpeed = MAX_SETTLE_SPEED) => {
	if (!samples || samples.length === 0) return null;
	let exitStart = null;
	let prev = null;
	for (const s of samples) {
		if (s.time < fromTime) { prev = s; continue; }
		if (s.time >= untilTime) break;
		// Instantaneous speed vs the previous sample (normalized units / ms). The
		// dt is floored at 1ms to stay finite for sub-ms / same-timestamp native
		// samples — a big jump in ~0ms then reads as very fast (correct).
		const speed = prev ? Math.hypot(s.x - prev.x, s.y - prev.y) / Math.max(1, s.time - prev.time) : 0;
		prev = s;
		if (isInside(s, rect) || speed > maxSpeed) {
			exitStart = null;
			continue;
		}
		if (exitStart === null) exitStart = s.time;
		if (s.time - exitStart >= debounceMs) return exitStart;
	}
	return exitStart;
};

// Builds the follow anchor segments from the interaction log. Each segment is
// shaped like a zoom-type event so camera.js can resolve it with the same
// window/phase/crossfade logic as auto-zoom:
//
//   { type:'zoom', source:'follow', time, duration, x, y, zoomLevel }
//
//   interactions      - time-sorted {time, x, y} for clicks/typing/etc., in
//                       normalized scene space.
//   cursorSamples     - time-sorted raw {time, x, y} cursor samples for
//                       boundary + velocity checks (raw, not the smoothed dot
//                       path — smoothing would flatten the fast moves we filter).
//   zoomWindows       - [{start, end}] spans already owned by real zoom/crop
//                       segments; interactions inside them are skipped and open
//                       anchors truncate at the next window's start.
//   transitionDuration- the global ease duration; also how long we wait after
//                       an anchor's zoom-in settles before scanning for exits,
//                       so the zoom-in pan itself can't trip the boundary.
//   mode              - FOLLOW_MODES.BOUNDARY (default) or .INTERACTIONS.
export const buildFollowCameraSegments = ({
	interactions,
	cursorSamples,
	zoomWindows = [],
	transitionDuration = 600,
	mode = FOLLOW_MODES.BOUNDARY,
} = {}) => {
	if (!interactions || interactions.length === 0) return [];

	const windows = [...zoomWindows].sort((a, b) => a.start - b.start);
	const isInZoomWindow = (t) => windows.some((w) => t >= w.start && t < w.end);
	const nextZoomWindowStart = (t) => {
		let best = Infinity;
		for (const w of windows) {
			if (w.start > t && w.start < best) best = w.start;
		}
		return best;
	};

	// Surviving anchors: drop interactions a real zoom segment already covers,
	// then collapse micro-pans (a later interaction too close to the one we just
	// kept doesn't open its own anchor).
	const anchors = [];
	for (const it of [...interactions].sort((a, b) => a.time - b.time)) {
		if (isInZoomWindow(it.time)) continue;
		const prev = anchors[anchors.length - 1];
		if (prev && Math.hypot(it.x - prev.x, it.y - prev.y) < MICRO_PAN_THRESHOLD) continue;
		anchors.push(it);
	}
	if (anchors.length === 0) return [];

	const segments = [];
	for (let i = 0; i < anchors.length; i++) {
		const a = anchors[i];
		const nextAnchorTime = i + 1 < anchors.length ? anchors[i + 1].time : HOLD_SENTINEL_MS;
		const endBase = Math.min(nextAnchorTime, nextZoomWindowStart(a.time), HOLD_SENTINEL_MS);

		let endTime = endBase;
		if (mode === FOLLOW_MODES.BOUNDARY && cursorSamples && cursorSamples.length) {
			const rect = computeAnchorRect(a.x, a.y, FOLLOW_ZOOM_LEVEL);
			const scanFrom = a.time + transitionDuration;
			const exit = findBoundaryExitTime(cursorSamples, scanFrom, endBase, rect, BOUNDARY_EXIT_DEBOUNCE_MS);
			if (exit !== null) endTime = Math.min(endBase, exit + BOUNDARY_EXIT_DEBOUNCE_MS);
		}

		segments.push({
			id: `follow-${a.time}`,
			type: 'zoom',
			source: 'follow',
			time: a.time,
			duration: Math.max(0, endTime - a.time),
			x: a.x,
			y: a.y,
			zoomLevel: FOLLOW_ZOOM_LEVEL,
		});
	}
	return segments;
};
