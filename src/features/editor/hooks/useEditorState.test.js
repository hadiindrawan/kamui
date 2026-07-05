import { segmentFromEvent, dedupeInteractionEvents, formatTime, INTERACTION_TYPES } from './useEditorState.js';

describe('INTERACTION_TYPES', () => {
    it('flags major interactions but not cursor movement or minor clicks', () => {
        expect(INTERACTION_TYPES.has('click')).toBe(true);
        expect(INTERACTION_TYPES.has('dblclick')).toBe(true);
        expect(INTERACTION_TYPES.has('typing')).toBe(true);
        expect(INTERACTION_TYPES.has('selection')).toBe(true);
        expect(INTERACTION_TYPES.has('click-minor')).toBe(false);
        expect(INTERACTION_TYPES.has('move')).toBe(false);
        expect(INTERACTION_TYPES.has('follow')).toBe(false);
    });
});

describe('dedupeInteractionEvents', () => {
    it('keeps the first event of each cluster within the minimum distance window', () => {
        const events = [
            { time: 0 }, { time: 400 }, { time: 900 }, // all within 1000ms of the first -> collapse to one
            { time: 2000 }, // far enough from the cluster -> kept
        ];
        const result = dedupeInteractionEvents(events);
        expect(result.map((e) => e.time)).toEqual([0, 2000]);
    });

    it('keeps events that are each at least the minimum distance apart', () => {
        const events = [{ time: 0 }, { time: 1000 }, { time: 2000 }];
        expect(dedupeInteractionEvents(events)).toHaveLength(3);
    });

    it('returns an empty array for no events', () => {
        expect(dedupeInteractionEvents([])).toEqual([]);
    });
});

describe('segmentFromEvent', () => {
    it('builds a zoom segment from a normalized-coordinate event', () => {
        const event = { time: 1500, x: 0.25, y: 0.75, viewportWidth: 1920, viewportHeight: 1080 };
        const segment = segmentFromEvent(event, 2, { zoomLevel: 2.5, zoomDuration: 800 });

        expect(segment).toMatchObject({
            id: 'seg_2_1500',
            type: 'zoom',
            startTime: 1500,
            duration: 800,
            zoomLevel: 2.5,
            positionMode: 'follow',
            x: 0.25,
            y: 0.75,
            viewportWidth: 1920,
            viewportHeight: 1080,
        });
    });

    it('defaults to center coordinates when the event has no x/y', () => {
        const segment = segmentFromEvent({ time: 0 }, 0, { zoomLevel: 2, zoomDuration: 800 });
        expect(segment.x).toBe(0.5);
        expect(segment.y).toBe(0.5);
    });

    it('falls back to 1920x1080 viewport dimensions when missing', () => {
        const segment = segmentFromEvent({ time: 0 }, 0, { zoomLevel: 2, zoomDuration: 800 });
        expect(segment.viewportWidth).toBe(1920);
        expect(segment.viewportHeight).toBe(1080);
    });

    it('respects an explicit positionMode and type override (used by resetTimeline)', () => {
        const segment = segmentFromEvent(
            { time: 0, x: 0.1, y: 0.1 },
            0,
            { zoomLevel: 2, zoomDuration: 800, positionMode: 'fixed', type: 'typing' }
        );
        expect(segment.positionMode).toBe('fixed');
        expect(segment.type).toBe('typing');
    });
});

describe('formatTime', () => {
    it('formats whole seconds as mm:ss.ms', () => {
        expect(formatTime(65)).toBe('01:05.00');
    });

    it('formats sub-second precision', () => {
        expect(formatTime(1.5)).toBe('00:01.50');
    });

    it('falls back to 00:00.00 for non-finite input', () => {
        expect(formatTime(NaN)).toBe('00:00.00');
        expect(formatTime(Infinity)).toBe('00:00.00');
    });
});
