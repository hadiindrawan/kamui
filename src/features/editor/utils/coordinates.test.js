import {
    getAspectRatioValue, computeSceneLayout, mapSceneRectToContainer,
    mapVideoPointToFrame, mapFramePointToVideo, getZoomRegionFrameSize, interpolateSceneLayout,
} from './coordinates.js';

describe('getAspectRatioValue', () => {
    it('returns the fallback ratio for Native', () => {
        expect(getAspectRatioValue('Native', 1.5)).toBe(1.5);
    });

    it('returns known preset ratios', () => {
        expect(getAspectRatioValue('16:9', 1)).toBeCloseTo(16 / 9);
        expect(getAspectRatioValue('9:16', 1)).toBeCloseTo(9 / 16);
        expect(getAspectRatioValue('1:1', 1)).toBe(1);
        expect(getAspectRatioValue('4:5', 1)).toBeCloseTo(4 / 5);
    });

    it('falls back to 16:9 for an unknown ratio', () => {
        expect(getAspectRatioValue('unknown', 1)).toBeCloseTo(16 / 9);
    });
});

describe('computeSceneLayout', () => {
    it('matches the video exactly when aspect ratio is Native', () => {
        const layout = computeSceneLayout({
            videoWidth: 1920,
            videoHeight: 1080,
            aspectRatio: 'Native',
            backgroundMode: 'hidden',
            insetPadding: 40,
        });
        expect(layout.width).toBe(1920);
        expect(layout.height).toBe(1080);
        expect(layout.vX).toBe(0);
        expect(layout.vY).toBe(0);
        expect(layout.vW).toBe(1920);
        expect(layout.vH).toBe(1080);
    });

    it('letterboxes a landscape video into a 9:16 frame when background is hidden', () => {
        const layout = computeSceneLayout({
            videoWidth: 1920,
            videoHeight: 1080,
            aspectRatio: '9:16',
            backgroundMode: 'hidden',
            insetPadding: 40,
        });
        // Scene is 9:16 sized to the video height (per the width>=1 branch fallback).
        expect(layout.width / layout.height).toBeCloseTo(9 / 16, 2);
        // Video is contained (no cropping): full video width fits, height is centered with bars.
        expect(layout.vW).toBeCloseTo(layout.width);
        expect(layout.vY).toBeGreaterThan(0);
        expect(layout.vX).toBeCloseTo(0);
    });

    it('insets the video with padding when background is not hidden', () => {
        const layout = computeSceneLayout({
            videoWidth: 1920,
            videoHeight: 1080,
            aspectRatio: '16:9',
            backgroundMode: 'color',
            insetPadding: 100,
        });
        // Video should be centered and smaller than the full scene due to padding.
        expect(layout.vW).toBeLessThan(layout.width);
        expect(layout.vH).toBeLessThan(layout.height);
        expect(layout.vX).toBeCloseTo((layout.width - layout.vW) / 2, 1);
        expect(layout.vY).toBeCloseTo((layout.height - layout.vH) / 2, 1);
    });

    it('scales padding relative to scene size so it stays visually consistent', () => {
        // Native mode derives scene size from the source, so this is where the
        // relative-padding formula actually varies; every fixed social preset
        // below intentionally shares a 1080px short side (see next test).
        const small = computeSceneLayout({
            videoWidth: 640, videoHeight: 360, aspectRatio: 'Native', backgroundMode: 'color', insetPadding: 40,
        });
        const large = computeSceneLayout({
            videoWidth: 3840, videoHeight: 2160, aspectRatio: 'Native', backgroundMode: 'color', insetPadding: 40,
        });
        // Larger scene -> larger absolute inset in pixels for the same padding setting.
        expect(large.vX).toBeGreaterThan(small.vX);
    });

    it('uses fixed standard resolutions for social presets regardless of source size', () => {
        const fromSmallSource = computeSceneLayout({
            videoWidth: 640, videoHeight: 360, aspectRatio: '9:16', backgroundMode: 'hidden', insetPadding: 40,
        });
        const fromLargeSource = computeSceneLayout({
            videoWidth: 3840, videoHeight: 2160, aspectRatio: '9:16', backgroundMode: 'hidden', insetPadding: 40,
        });
        expect(fromSmallSource.width).toBe(1080);
        expect(fromSmallSource.height).toBe(1920);
        expect(fromLargeSource.width).toBe(1080);
        expect(fromLargeSource.height).toBe(1920);
    });
});

describe('computeSceneLayout cropZoom', () => {
    it('leaves only one axis pannable at cropZoom 1 (cover-fit)', () => {
        // 16:9 source into a 9:16 frame overflows horizontally only.
        const layout = computeSceneLayout({
            videoWidth: 1920, videoHeight: 1080, aspectRatio: '9:16',
            backgroundMode: 'hidden', insetPadding: 0, cropToFill: true, cropZoom: 1,
        });
        const overflowX = 1920 - layout.sW;
        const overflowY = 1080 - layout.sH;
        expect(overflowX).toBeGreaterThan(1);
        expect(overflowY).toBeCloseTo(0, 3);
    });

    it('opens both axes to panning at cropZoom > 1', () => {
        const layout = computeSceneLayout({
            videoWidth: 1920, videoHeight: 1080, aspectRatio: '9:16',
            backgroundMode: 'hidden', insetPadding: 0, cropToFill: true, cropZoom: 2,
        });
        const overflowX = 1920 - layout.sW;
        const overflowY = 1080 - layout.sH;
        expect(overflowX).toBeGreaterThan(1);
        expect(overflowY).toBeGreaterThan(1);
    });

    it('cropZoom 1 reproduces the un-zoomed crop rect (regression)', () => {
        const base = computeSceneLayout({
            videoWidth: 1920, videoHeight: 1080, aspectRatio: '9:16',
            backgroundMode: 'hidden', insetPadding: 0, cropToFill: true,
        });
        const z1 = computeSceneLayout({
            videoWidth: 1920, videoHeight: 1080, aspectRatio: '9:16',
            backgroundMode: 'hidden', insetPadding: 0, cropToFill: true, cropZoom: 1,
        });
        expect(z1.sW).toBeCloseTo(base.sW);
        expect(z1.sH).toBeCloseTo(base.sH);
    });
});

describe('frame <-> video point converters', () => {
    // 1920x1080 source into 9:16 cropToFill: cover picks a 607.5x1080 sub-rect.
    const layout = { ...computeSceneLayout({
        videoWidth: 1920, videoHeight: 1080, aspectRatio: '9:16',
        backgroundMode: 'hidden', insetPadding: 0, cropToFill: true,
    }), videoW: 1920, videoH: 1080 };

    it('round-trips a point through video->frame->video', () => {
        const src = { x: 0.55, y: 0.4 };
        const frame = mapVideoPointToFrame(src.x, src.y, layout);
        const back = mapFramePointToVideo(frame.x, frame.y, layout);
        expect(back.x).toBeCloseTo(src.x, 6);
        expect(back.y).toBeCloseTo(src.y, 6);
    });

    it('is the identity when not cropping (sx=0, sW=videoW)', () => {
        const full = { width: 1920, height: 1080, vX: 0, vY: 0, vW: 1920, vH: 1080, sx: 0, sy: 0, sW: 1920, sH: 1080, videoW: 1920, videoH: 1080 };
        const frame = mapVideoPointToFrame(0.3, 0.7, full);
        expect(frame.x).toBeCloseTo(0.3);
        expect(frame.y).toBeCloseTo(0.7);
    });

    it('sizes the zoom region as a fraction of the visible frame', () => {
        const region = getZoomRegionFrameSize(layout, 2);
        // At 2x zoom the camera shows half the scene width/height.
        expect(region.w).toBeCloseTo((layout.width / 2) / layout.vW, 6);
        expect(region.h).toBeCloseTo((layout.height / 2) / layout.vH, 6);
    });
});

describe('interpolateSceneLayout', () => {
    const a = { width: 1920, height: 1080, vX: 0, vY: 0, vW: 1920, vH: 1080, sx: 0, sy: 0, sW: 1920, sH: 1080, videoW: 1920, videoH: 1080 };
    const b = { width: 1080, height: 1920, vX: 0, vY: 0, vW: 1080, vH: 1920, sx: 0, sy: 0, sW: 1080, sH: 1080, videoW: 1920, videoH: 1080 };

    it('returns the from-layout endpoint at t=0', () => {
        const r = interpolateSceneLayout(a, b, 0);
        expect(r.width).toBe(a.width);
        expect(r.height).toBe(a.height);
    });

    it('returns the to-layout endpoint at t=1', () => {
        const r = interpolateSceneLayout(a, b, 1);
        expect(r.width).toBe(b.width);
        expect(r.height).toBe(b.height);
    });

    it('produces an intermediate layout between the two at t=0.5', () => {
        const r = interpolateSceneLayout(a, b, 0.5);
        expect(r.width).toBeGreaterThan(Math.min(a.width, b.width));
        expect(r.width).toBeLessThan(Math.max(a.width, b.width));
    });
});

describe('mapSceneRectToContainer', () => {
    it('maps a full-bleed scene rect onto a same-ratio container without offset', () => {
        const sceneLayout = { width: 1920, height: 1080, vX: 0, vY: 0, vW: 1920, vH: 1080 };
        const rect = mapSceneRectToContainer(sceneLayout, 960, 540);
        expect(rect.x).toBeCloseTo(0);
        expect(rect.y).toBeCloseTo(0);
        expect(rect.width).toBeCloseTo(960);
        expect(rect.height).toBeCloseTo(540);
    });

    it('centers the visual canvas when the container is wider than the scene ratio', () => {
        const sceneLayout = { width: 1080, height: 1920, vX: 0, vY: 0, vW: 1080, vH: 1920 };
        // Wide container, tall (9:16) scene -> pillarboxed within the container.
        const rect = mapSceneRectToContainer(sceneLayout, 1600, 900);
        expect(rect.x).toBeGreaterThan(0);
        expect(rect.width).toBeLessThan(1600);
    });

    it('proportionally maps an inset video rect within the scene', () => {
        const sceneLayout = { width: 1000, height: 1000, vX: 100, vY: 200, vW: 800, vH: 600 };
        const rect = mapSceneRectToContainer(sceneLayout, 500, 500);
        expect(rect.x).toBeCloseTo(50);
        expect(rect.y).toBeCloseTo(100);
        expect(rect.width).toBeCloseTo(400);
        expect(rect.height).toBeCloseTo(300);
    });
});
