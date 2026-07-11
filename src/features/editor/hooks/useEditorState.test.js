import { segmentFromEvent, dedupeInteractionEvents, formatTime, INTERACTION_TYPES, resolvePlaybackAction, RESOLUTION_PRESETS } from './useEditorState.js';

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

describe('resolvePlaybackAction', () => {
    const base = { segments: [], selectedSegmentId: null, trimStart: 0, trimEnd: 10 };

    it('continues playback before the effective end is reached', () => {
        expect(resolvePlaybackAction(5, { ...base, loopPlayback: false })).toEqual({ action: 'continue' });
    });

    it('pauses at trimEnd with no segment selected and loop off (previous behavior)', () => {
        const result = resolvePlaybackAction(10, { ...base, loopPlayback: false });
        expect(result).toEqual({ action: 'pause', time: 10 });
    });

    it('loops back to trimStart with no segment selected and global loop on', () => {
        const result = resolvePlaybackAction(10, { ...base, trimStart: 2, loopPlayback: true });
        expect(result).toEqual({ action: 'seek', time: 2 });
    });

    it('pauses at a selected segment\'s own end even though global loop is on (selection scopes playback)', () => {
        const segments = [{ id: 'a', startTime: 1000, duration: 2000, loopMode: 'none' }];
        const result = resolvePlaybackAction(3, { segments, selectedSegmentId: 'a', trimStart: 0, trimEnd: 10, loopPlayback: true });
        expect(result).toEqual({ action: 'pause', time: 3 });
    });

    it('loops within a selected segment\'s own bounds when its loopMode is "loop"', () => {
        const segments = [{ id: 'a', startTime: 1000, duration: 2000, loopMode: 'loop' }];
        const result = resolvePlaybackAction(3, { segments, selectedSegmentId: 'a', trimStart: 0, trimEnd: 10, loopPlayback: false });
        expect(result).toEqual({ action: 'seek', time: 1 });
    });

    it('clamps a selected segment\'s scoped end to trimEnd when the segment runs past the trim', () => {
        const segments = [{ id: 'a', startTime: 1000, duration: 20000, loopMode: 'none' }];
        const result = resolvePlaybackAction(10, { segments, selectedSegmentId: 'a', trimStart: 0, trimEnd: 10, loopPlayback: false });
        expect(result).toEqual({ action: 'pause', time: 10 });
    });
});

describe('RESOLUTION_PRESETS', () => {
    it('carries only resolution + label — bitrate is now computed per codec/fps/tier at export time', () => {
        for (const key of Object.keys(RESOLUTION_PRESETS)) {
            const preset = RESOLUTION_PRESETS[key];
            expect(preset).toHaveProperty('resolution');
            expect(preset).toHaveProperty('label');
            expect(preset).not.toHaveProperty('bitrate');
        }
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
