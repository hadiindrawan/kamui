import {
	createCaption,
	sortCaptions,
	captionAtTime,
	formatSrtTime,
	mapCaptionsToOutputTime,
	captionsToSrt,
	wrapCaptionText,
} from './captions.js';

describe('createCaption', () => {
	it('normalizes and guarantees start < end', () => {
		const c = createCaption({ start: 5, end: 3, text: 'hi' });
		expect(c.start).toBe(5);
		expect(c.end).toBeGreaterThan(c.start);
		expect(c.id).toMatch(/^cap_/);
		expect(c.text).toBe('hi');
	});

	it('clamps negative times to zero', () => {
		const c = createCaption({ start: -2, end: -1, text: '' });
		expect(c.start).toBe(0);
		expect(c.end).toBeGreaterThan(0);
	});
});

describe('sortCaptions', () => {
	it('orders by start time without mutating input', () => {
		const input = [
			{ id: 'b', start: 5, end: 6, text: '' },
			{ id: 'a', start: 1, end: 2, text: '' },
		];
		const sorted = sortCaptions(input);
		expect(sorted.map((c) => c.id)).toEqual(['a', 'b']);
		expect(input[0].id).toBe('b'); // original untouched
	});
});

describe('captionAtTime', () => {
	const caps = [
		{ id: 'a', start: 1, end: 3, text: 'A' },
		{ id: 'b', start: 2.5, end: 5, text: 'B' },
	];

	it('returns null before any caption', () => {
		expect(captionAtTime(caps, 0.5)).toBeNull();
	});

	it('is inclusive of start and exclusive of end', () => {
		expect(captionAtTime(caps, 1)).toMatchObject({ id: 'a' });
		expect(captionAtTime([{ id: 'a', start: 1, end: 3, text: 'A' }], 3)).toBeNull();
	});

	it('prefers the latest-starting caption on overlap', () => {
		expect(captionAtTime(caps, 2.7)).toMatchObject({ id: 'b' });
	});
});

describe('formatSrtTime', () => {
	it('formats zero', () => {
		expect(formatSrtTime(0)).toBe('00:00:00,000');
	});

	it('formats sub-second and rounds milliseconds', () => {
		expect(formatSrtTime(1.5)).toBe('00:00:01,500');
		expect(formatSrtTime(5.2005)).toBe('00:00:05,201');
	});

	it('formats hours', () => {
		expect(formatSrtTime(3661.25)).toBe('01:01:01,250');
	});

	it('clamps negatives to zero', () => {
		expect(formatSrtTime(-3)).toBe('00:00:00,000');
	});
});

describe('mapCaptionsToOutputTime', () => {
	const caps = [
		{ id: 'a', start: 1, end: 4, text: 'A' },
		{ id: 'b', start: 6, end: 9, text: 'B' },
		{ id: 'c', start: 20, end: 22, text: 'C' },
	];

	it('is identity (sorted) with no trim', () => {
		const out = mapCaptionsToOutputTime(caps, 0, Infinity);
		expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
		expect(out[0]).toMatchObject({ start: 1, end: 4 });
	});

	it('drops captions outside the trim window', () => {
		const out = mapCaptionsToOutputTime(caps, 5, 10);
		expect(out.map((c) => c.id)).toEqual(['b']);
	});

	it('clamps and rebases partially-overlapping captions', () => {
		// window [2, 8): 'a' clipped to [2,4)->[0,2), 'b' clipped to [6,8)->[4,6)
		const out = mapCaptionsToOutputTime(caps, 2, 8);
		expect(out).toEqual([
			expect.objectContaining({ id: 'a', start: 0, end: 2 }),
			expect.objectContaining({ id: 'b', start: 4, end: 6 }),
		]);
	});
});

describe('captionsToSrt', () => {
	const caps = [
		{ id: 'a', start: 1.5, end: 5.2, text: 'Hello world' },
		{ id: 'b', start: 6, end: 10.8, text: '  ' }, // whitespace-only -> skipped
		{ id: 'c', start: 12, end: 14, text: 'Third' },
	];

	it('numbers sequentially and skips empty text', () => {
		const srt = captionsToSrt(caps);
		expect(srt).toContain('1\n00:00:01,500 --> 00:00:05,200\nHello world');
		expect(srt).toContain('2\n00:00:12,000 --> 00:00:14,000\nThird');
		expect(srt).not.toContain('3\n');
		expect(srt.endsWith('\n')).toBe(true);
	});

	it('rebases times to the trim window', () => {
		const srt = captionsToSrt(caps, { trimStart: 1, trimEnd: 20 });
		expect(srt).toContain('1\n00:00:00,500 --> 00:00:04,200\nHello world');
	});

	it('returns empty string when nothing survives', () => {
		expect(captionsToSrt([])).toBe('');
	});
});

describe('wrapCaptionText', () => {
	// Fake ctx: each character is 10px wide.
	const ctx = { measureText: (s) => ({ width: s.length * 10 }) };

	it('wraps on word boundaries within maxWidth', () => {
		const lines = wrapCaptionText(ctx, 'one two three four', 90);
		expect(lines.length).toBeGreaterThan(1);
		lines.forEach((line) => expect(line.length * 10).toBeLessThanOrEqual(90));
	});

	it('returns empty for blank text', () => {
		expect(wrapCaptionText(ctx, '   ', 100)).toEqual([]);
	});
});
