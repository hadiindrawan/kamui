/**
 * Session-based auto-zoom generator.
 *
 * The old approach turned every interaction event into its own fixed-length
 * zoom segment, so the camera zoomed back out in the gaps between nearby
 * clicks — the "not smooth, sometimes gone" complaint. Instead we group a
 * burst of interaction into a single sustained session (à la Cursorful): the
 * zoom opens on the first strong event, stays in while activity continues, and
 * only releases after an idle gap. Panning within a held zoom is expressed as
 * keyframes rather than a zoom-out/zoom-in cycle.
 *
 * Coordinate convention: input event x/y and output segment x/y + keyframes are
 * all source-normalized (0-1 over the full recording), same as everywhere else.
 */

// Strong events open and sustain a session. 'click-minor' only sustains an
// already-open session (it never opens one — that's the anti-noise rule).
const STRONG_TYPES = new Set(['click', 'dblclick', 'typing', 'selection', 'focus']);

export const AUTO_ZOOM_INTENSITY = {
    subtle: { zoomLevel: 1.6, idleReleaseMs: 1500 },
    medium: { zoomLevel: 2.0, idleReleaseMs: 2000 },
    strong: { zoomLevel: 2.6, idleReleaseMs: 3000 },
};

export function resolveIntensity(intensity, fallbackZoomLevel) {
    const preset = AUTO_ZOOM_INTENSITY[intensity];
    if (preset) return preset;
    return { zoomLevel: fallbackZoomLevel ?? 2, idleReleaseMs: 2000 };
}

/**
 * @param {Array<{type,time,x,y}>} events - recording interaction events
 * @param {Object} options
 * @returns {Array<Segment>} v2 auto zoom segments (source:'auto')
 */
export function generateAutoZoomSegments(events, options = {}) {
    const {
        zoomLevel = 2,
        idleReleaseMs = 2000,
        minHoldMs = 1000,
        retargetDistance = 0.18,
        typingZoomBoost = 0.5,
        maxZoomLevel = 3,
    } = options;

    const anchorZoom = (type) => {
        // Typing/focus zoom a touch tighter to make the focused field readable.
        if (type === 'typing' || type === 'focus') {
            return Math.min(maxZoomLevel, zoomLevel + typingZoomBoost);
        }
        return zoomLevel;
    };

    const sorted = events
        .filter((e) => e && Number.isFinite(e.time))
        .map((e) => ({
            type: e.type,
            time: e.time,
            x: Number.isFinite(e.x) ? e.x : 0.5,
            y: Number.isFinite(e.y) ? e.y : 0.5,
        }))
        .sort((a, b) => a.time - b.time);

    const sessions = [];
    let cur = null;

    const openSession = (e) => ({
        start: e.time,
        end: e.time + idleReleaseMs,
        anchor: { x: e.x, y: e.y },
        zoomLevel: anchorZoom(e.type),
        keyframes: [{ t: 0, x: e.x, y: e.y }],
    });

    for (const e of sorted) {
        const strong = STRONG_TYPES.has(e.type);
        const sustains = strong || e.type === 'click-minor';

        if (!cur) {
            if (strong) cur = openSession(e);
            continue;
        }

        if (e.time > cur.end) {
            // Idle gap exceeded — close the session and maybe start a new one.
            sessions.push(cur);
            cur = strong ? openSession(e) : null;
            continue;
        }

        if (!sustains) continue;

        // Extend the release deadline as long as activity continues.
        cur.end = Math.max(cur.end, e.time + idleReleaseMs);

        if (strong) {
            cur.zoomLevel = Math.max(cur.zoomLevel, anchorZoom(e.type));
            const dist = Math.hypot(e.x - cur.anchor.x, e.y - cur.anchor.y);
            if (dist > retargetDistance) {
                // Pan the held zoom toward the new focus instead of releasing.
                cur.anchor = { x: e.x, y: e.y };
                cur.keyframes.push({ t: e.time - cur.start, x: e.x, y: e.y });
            }
        }
    }
    if (cur) sessions.push(cur);

    return sessions.map((s, i) => {
        const duration = Math.max(minHoldMs, s.end - s.start);
        const seg = {
            id: `autozoom_${i}_${Math.round(s.start)}`,
            type: 'zoom',
            v: 2,
            source: 'auto',
            startTime: s.start,
            duration,
            zoomLevel: s.zoomLevel,
            positionMode: 'follow',
            x: s.keyframes[0].x,
            y: s.keyframes[0].y,
        };
        // Only attach keyframes when the zoom actually pans (>1 point).
        if (s.keyframes.length > 1) seg.keyframes = s.keyframes;
        return seg;
    });
}
