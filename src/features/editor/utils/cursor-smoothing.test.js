import {
	buildSmoothedCursorPath,
	sampleCursorPath,
	CURSOR_SMOOTHING_LEVELS,
	DEFAULT_CURSOR_SMOOTHING,
} from './cursor-smoothing.js';

// A jittery path: steady rightward drift with a per-sample zig-zag in y.
const makeJitteryPath = (n = 60, stepMs = 16) => {
	const path = [];
	for (let i = 0; i < n; i++) {
		path.push({
			type: 'move',
			time: i * stepMs,
			x: i / n,
			y: 0.5 + (i % 2 === 0 ? 0.08 : -0.08), // ±0.08 tremor every frame
		});
	}
	return path;
};

// Max |y - 0.5| when sampling the path densely — a proxy for residual jitter
// amplitude around the true straight line at y=0.5.
const maxYDeviation = (path, tEnd, stepMs = 8) => {
	let max = 0;
	for (let t = 0; t <= tEnd; t += stepMs) {
		const p = sampleCursorPath(t, path);
		if (p) max = Math.max(max, Math.abs(p.y - 0.5));
	}
	return max;
};

describe('buildSmoothedCursorPath', () => {
	it('returns null for the off level, unknown levels, and empty input', () => {
		const events = makeJitteryPath();
		expect(buildSmoothedCursorPath(events, 'off')).toBeNull();
		expect(buildSmoothedCursorPath(events, 'nonsense')).toBeNull();
		expect(buildSmoothedCursorPath([], 'medium')).toBeNull();
		expect(buildSmoothedCursorPath(null, 'medium')).toBeNull();
	});

	it('the default level is a real smoothing level (on by default)', () => {
		expect(CURSOR_SMOOTHING_LEVELS.find((l) => l.value === DEFAULT_CURSOR_SMOOTHING).windowMs)
			.toBeGreaterThan(0);
	});

	it('monotonically reduces jitter amplitude from low -> medium -> high', () => {
		const events = makeJitteryPath();
		const tEnd = events[events.length - 1].time;
		const raw = maxYDeviation(events, tEnd); // spline over raw samples
		const low = maxYDeviation(buildSmoothedCursorPath(events, 'low'), tEnd);
		const med = maxYDeviation(buildSmoothedCursorPath(events, 'medium'), tEnd);
		const high = maxYDeviation(buildSmoothedCursorPath(events, 'high'), tEnd);

		expect(low).toBeLessThan(raw);
		expect(med).toBeLessThan(low);
		expect(high).toBeLessThan(med);
	});

	it('decimates to knots at least minGapMs apart, keeping first and last', () => {
		const events = makeJitteryPath(60, 16);
		const cfg = CURSOR_SMOOTHING_LEVELS.find((l) => l.value === 'high');
		const path = buildSmoothedCursorPath(events, 'high');
		// Interior knots are ≥ minGapMs apart. The final knot is force-kept and
		// may fall closer than that, so the gap into it is exempt.
		for (let i = 1; i < path.length - 1; i++) {
			expect(path[i].time - path[i - 1].time).toBeGreaterThanOrEqual(cfg.minGapMs);
		}
		// First + last source timestamps are represented (last is force-kept).
		expect(path[0].time).toBe(0);
		expect(path[path.length - 1].time).toBe(events[events.length - 1].time);
		// Fewer knots than raw samples (decimation actually happened).
		expect(path.length).toBeLessThan(events.length);
	});

	it('handles unsorted input and collapses duplicate timestamps', () => {
		const events = [
			{ time: 200, x: 0.9, y: 0.9 },
			{ time: 0, x: 0.1, y: 0.1 },
			{ time: 100, x: 0.5, y: 0.5 },
			{ time: 100, x: 0.55, y: 0.55 }, // duplicate ts -> last wins
		];
		const path = buildSmoothedCursorPath(events, 'low');
		for (let i = 1; i < path.length; i++) {
			expect(path[i].time).toBeGreaterThan(path[i - 1].time);
		}
	});

	it('injects click positions as protected knots the spline passes through', () => {
		const events = makeJitteryPath(60, 16);
		const clicks = [{ time: 500, x: 0.02, y: 0.98 }]; // far off the cursor line
		const path = buildSmoothedCursorPath(events, 'medium', clicks);
		const atClick = sampleCursorPath(500, path);
		expect(atClick.x).toBeCloseTo(0.02, 5);
		expect(atClick.y).toBeCloseTo(0.98, 5);
	});

	it('clamps to a click that lands after the last move sample', () => {
		const events = makeJitteryPath(10, 16); // ends at t=144
		const clicks = [{ time: 100000, x: 0.25, y: 0.75 }];
		const path = buildSmoothedCursorPath(events, 'medium', clicks);
		const atClick = sampleCursorPath(100000, path);
		expect(atClick.x).toBeCloseTo(0.25, 5);
		expect(atClick.y).toBeCloseTo(0.75, 5);
	});

	it('survives a sparse follow-only path (100ms cadence)', () => {
		const events = [];
		for (let i = 0; i < 10; i++) {
			events.push({ type: 'follow', time: i * 100, x: i / 10, y: 0.5 });
		}
		const path = buildSmoothedCursorPath(events, 'high');
		expect(path.length).toBeGreaterThan(0);
		const p = sampleCursorPath(450, path);
		expect(Number.isFinite(p.x)).toBe(true);
		expect(Number.isFinite(p.y)).toBe(true);
	});
});
