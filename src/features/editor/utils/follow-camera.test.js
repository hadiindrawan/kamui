import {
	computeAnchorRect,
	findBoundaryExitTime,
	buildFollowCameraSegments,
	FOLLOW_ZOOM_LEVEL,
	BOUNDARY_EXIT_DEBOUNCE_MS,
	FOLLOW_MODES,
} from './follow-camera.js';

describe('computeAnchorRect', () => {
	it('is 1/zoom wide and tall, centered on the anchor', () => {
		const rect = computeAnchorRect(0.5, 0.5, 1.5);
		expect(rect.w).toBeCloseTo(1 / 1.5);
		expect(rect.h).toBeCloseTo(1 / 1.5);
		expect(rect.x).toBeCloseTo(0.5 - (1 / 1.5) / 2);
		expect(rect.y).toBeCloseTo(0.5 - (1 / 1.5) / 2);
	});

	it('clamps to the frame at the edges', () => {
		const rect = computeAnchorRect(0.05, 0.05, 1.5);
		expect(rect.x).toBe(0);
		expect(rect.y).toBe(0);
		// A cursor near the far corner clamps the rect flush to the far edge.
		const far = computeAnchorRect(0.99, 0.99, 1.5);
		expect(far.x).toBeCloseTo(1 - 1 / 1.5);
		expect(far.y).toBeCloseTo(1 - 1 / 1.5);
	});
});

describe('findBoundaryExitTime', () => {
	const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }; // centered box

	it('returns null when the cursor never leaves the rect', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 100, x: 0.4, y: 0.6 },
			{ time: 200, x: 0.5, y: 0.5 },
		];
		expect(findBoundaryExitTime(samples, 0, 1000, rect, 100)).toBeNull();
	});

	it('reports the exit start once the cursor stays out past the debounce', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 500, x: 0.9, y: 0.9 }, // exits here
			{ time: 620, x: 0.95, y: 0.95 }, // still out, 120ms >= 100ms debounce
		];
		expect(findBoundaryExitTime(samples, 0, 2000, rect, 100)).toBe(500);
	});

	it('ignores a brief out-and-back flicker (under the debounce)', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 500, x: 0.9, y: 0.9 }, // out
			{ time: 540, x: 0.5, y: 0.5 }, // back in after 40ms < 100ms -> resets
			{ time: 800, x: 0.5, y: 0.5 },
		];
		expect(findBoundaryExitTime(samples, 0, 2000, rect, 100)).toBeNull();
	});

	it('counts a run still outside when the scan window ends (teleport / parked cursor)', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 900, x: 0.95, y: 0.95 }, // out, but no later sample to confirm debounce
		];
		expect(findBoundaryExitTime(samples, 0, 1000, rect, 100)).toBe(900);
	});

	it('only considers samples within [fromTime, untilTime)', () => {
		const samples = [
			{ time: 100, x: 0.95, y: 0.95 }, // before fromTime -> ignored
			{ time: 500, x: 0.5, y: 0.5 },
			{ time: 900, x: 0.95, y: 0.95 }, // at/after untilTime -> ignored
		];
		expect(findBoundaryExitTime(samples, 300, 900, rect, 100)).toBeNull();
	});

	it('ignores a fast transit and registers only once the cursor settles outside', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 20, x: 0.99, y: 0.99 }, // flick: ~0.69 in 20ms -> way over maxSpeed
			{ time: 200, x: 0.99, y: 0.99 }, // arrived + slowed -> settled exit starts here
			{ time: 300, x: 0.99, y: 0.99 }, // still out, 100ms since settle
		];
		expect(findBoundaryExitTime(samples, 0, 2000, rect, 100)).toBe(200);
	});

	it('never registers an exit while the cursor keeps moving fast', () => {
		const samples = [
			{ time: 0, x: 0.5, y: 0.5 },
			{ time: 20, x: 0.95, y: 0.95 }, // fast
			{ time: 40, x: 0.05, y: 0.95 }, // fast, opposite corner
			{ time: 60, x: 0.95, y: 0.05 }, // fast
		];
		expect(findBoundaryExitTime(samples, 0, 2000, rect, 100)).toBeNull();
	});
});

describe('buildFollowCameraSegments', () => {
	const clicks = [
		{ type: 'click', time: 1000, x: 0.5, y: 0.5 },
		{ type: 'click', time: 5000, x: 0.2, y: 0.2 },
	];

	it('emits a 1.5x anchor segment per interaction', () => {
		const segs = buildFollowCameraSegments({ interactions: clicks, cursorSamples: [], transitionDuration: 300 });
		expect(segs).toHaveLength(2);
		expect(segs[0]).toMatchObject({ type: 'zoom', source: 'follow', time: 1000, x: 0.5, y: 0.5, zoomLevel: FOLLOW_ZOOM_LEVEL });
	});

	it('interactions-only mode ignores wandering cursor samples entirely', () => {
		// The cursor leaves the anchor rect, but interactions mode never zooms out.
		const wander = [{ time: 1500, x: 0.99, y: 0.99 }, { time: 2000, x: 0.99, y: 0.99 }];
		const segs = buildFollowCameraSegments({
			interactions: [clicks[0]],
			cursorSamples: wander,
			transitionDuration: 300,
			mode: FOLLOW_MODES.INTERACTIONS,
		});
		// Single anchor holds indefinitely (huge sentinel duration).
		expect(segs).toHaveLength(1);
		expect(segs[0].duration).toBeGreaterThan(1e6);
	});

	it('boundary mode ends the anchor at exitStart + debounce on a sustained exit', () => {
		// Anchor at (0.5,0.5) rect spans [0.167, 0.833]; cursor exits at t=1800.
		const samples = [
			{ time: 1400, x: 0.5, y: 0.5 },
			{ time: 1800, x: 0.99, y: 0.99 }, // out
			{ time: 2000, x: 0.99, y: 0.99 }, // still out (200ms >= 100ms)
		];
		const segs = buildFollowCameraSegments({
			interactions: [clicks[0]],
			cursorSamples: samples,
			transitionDuration: 300,
			mode: FOLLOW_MODES.BOUNDARY,
		});
		// endTime = 1800 + 100 = 1900 -> duration = 1900 - 1000 = 900.
		expect(segs[0].duration).toBe(1800 + BOUNDARY_EXIT_DEBOUNCE_MS - 1000);
	});

	it('does not scan for exits during the zoom-in settle window', () => {
		// A sample outside the rect at t=1100 (< time + transitionDuration = 1300)
		// is before the scan window, so it must not trigger an exit.
		const samples = [
			{ time: 1100, x: 0.99, y: 0.99 }, // inside the settle window -> ignored
			{ time: 1400, x: 0.5, y: 0.5 }, // back inside
		];
		// Two interactions so the hold is bounded by the next anchor (5000),
		// proving the settle-window out-sample did NOT shorten it.
		const segs = buildFollowCameraSegments({
			interactions: clicks,
			cursorSamples: samples,
			transitionDuration: 300,
			mode: FOLLOW_MODES.BOUNDARY,
		});
		expect(segs[0].duration).toBe(5000 - 1000);
	});

	it('does not zoom out on a fast flick across the viewport (holds the anchor)', () => {
		// Cursor flicks out fast and keeps whizzing — no settled exit, so the
		// lone anchor holds indefinitely instead of yanking to full frame.
		const flick = [
			{ time: 1400, x: 0.5, y: 0.5 },
			{ time: 1420, x: 0.99, y: 0.99 },
			{ time: 1440, x: 0.05, y: 0.99 },
			{ time: 1460, x: 0.99, y: 0.05 },
		];
		const segs = buildFollowCameraSegments({
			interactions: [clicks[0]],
			cursorSamples: flick,
			transitionDuration: 300,
			mode: FOLLOW_MODES.BOUNDARY,
		});
		expect(segs[0].duration).toBeGreaterThan(1e6);
	});

	it('degrades to interactions-only behavior when there are no cursor samples', () => {
		const segs = buildFollowCameraSegments({ interactions: [clicks[0]], cursorSamples: [], transitionDuration: 300 });
		expect(segs[0].duration).toBeGreaterThan(1e6);
	});

	it('drops interactions covered by a zoom window and truncates anchors at the next window', () => {
		const interactions = [
			{ type: 'click', time: 1000, x: 0.5, y: 0.5 },
			{ type: 'click', time: 3000, x: 0.7, y: 0.7 }, // inside the zoom window below
		];
		const zoomWindows = [{ start: 2500, end: 4000 }];
		const segs = buildFollowCameraSegments({ interactions, cursorSamples: [], zoomWindows, transitionDuration: 300 });
		// The t=3000 interaction is dropped (inside the window); the t=1000 anchor
		// truncates at the window start (2500) -> duration 1500.
		expect(segs).toHaveLength(1);
		expect(segs[0].time).toBe(1000);
		expect(segs[0].duration).toBe(2500 - 1000);
	});

	it('collapses a micro-pan (near-duplicate interaction) into the first anchor', () => {
		const interactions = [
			{ type: 'click', time: 1000, x: 0.5, y: 0.5 },
			{ type: 'click', time: 1200, x: 0.51, y: 0.51 }, // < 0.05 away -> collapsed
		];
		const segs = buildFollowCameraSegments({ interactions, cursorSamples: [], transitionDuration: 300 });
		expect(segs).toHaveLength(1);
		expect(segs[0].time).toBe(1000);
	});

	it('returns an empty array with no interactions', () => {
		expect(buildFollowCameraSegments({ interactions: [], cursorSamples: [] })).toEqual([]);
	});
});
