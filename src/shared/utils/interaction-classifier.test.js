import { pruneClickCluster, isZoomWorthyClick, MIN_CLICKS_FOR_CLUSTER, CLICK_CLUSTER_THRESHOLD_MS } from './interaction-classifier.js';

describe('pruneClickCluster', () => {
    it('drops clicks older than the cluster threshold', () => {
        const now = 10_000;
        const clicks = [
            { time: now - CLICK_CLUSTER_THRESHOLD_MS - 1, x: 0, y: 0 },
            { time: now - 500, x: 0, y: 0 },
        ];
        expect(pruneClickCluster(clicks, now)).toHaveLength(1);
    });

    it('keeps clicks within the window', () => {
        const now = 10_000;
        const clicks = [{ time: now - 100, x: 0, y: 0 }, { time: now - 200, x: 0, y: 0 }];
        expect(pruneClickCluster(clicks, now)).toHaveLength(2);
    });
});

describe('isZoomWorthyClick', () => {
    it('is always zoom-worthy when the target is interactive (input/button/native)', () => {
        expect(isZoomWorthyClick({ x: 0.5, y: 0.5, recentClicks: [], hasInteractiveTarget: true })).toBe(true);
    });

    it('is not zoom-worthy for an isolated non-interactive click with no cluster', () => {
        expect(isZoomWorthyClick({ x: 0.5, y: 0.5, recentClicks: [] })).toBe(false);
    });

    it('is not zoom-worthy below the minimum cluster size', () => {
        const recentClicks = new Array(MIN_CLICKS_FOR_CLUSTER - 1).fill({ time: 0, x: 0.5, y: 0.5 });
        expect(isZoomWorthyClick({ x: 0.5, y: 0.5, recentClicks })).toBe(false);
    });

    it('is zoom-worthy when clustered tightly in the same area', () => {
        const recentClicks = new Array(MIN_CLICKS_FOR_CLUSTER).fill({ time: 0, x: 0.5, y: 0.5 });
        expect(isZoomWorthyClick({ x: 0.51, y: 0.51, recentClicks })).toBe(true);
    });

    it('is not zoom-worthy when the cluster is spatially spread out', () => {
        const recentClicks = new Array(MIN_CLICKS_FOR_CLUSTER).fill({ time: 0, x: 0.1, y: 0.1 });
        expect(isZoomWorthyClick({ x: 0.9, y: 0.9, recentClicks })).toBe(false);
    });
});
