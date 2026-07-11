import { formatTime } from './time.js';

describe('formatTime', () => {
	it('defaults to mm:ss with no fractional part', () => {
		expect(formatTime(65)).toBe('01:05');
		expect(formatTime(1.75)).toBe('00:01');
	});

	it('includes centiseconds when requested', () => {
		expect(formatTime(65, { centiseconds: true })).toBe('01:05.00');
		expect(formatTime(1.5, { centiseconds: true })).toBe('00:01.50');
	});

	it('falls back to zero for non-finite input, respecting the centiseconds flag', () => {
		expect(formatTime(NaN)).toBe('00:00');
		expect(formatTime(Infinity, { centiseconds: true })).toBe('00:00.00');
	});
});
