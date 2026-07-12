import { buildSceneModel, drawSceneFrame } from './scene-renderer.js';

// Minimal 2D-context spy that records drawImage calls and honors save/restore
// of the current transform enough for geometry assertions.
function makeCtxSpy() {
    const calls = { drawImage: [], scale: [], translate: [], arc: [] };
    const ctx = {
        canvas: { width: 0, height: 0 },
        save() {}, restore() {}, clearRect() {},
        beginPath() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
        fillRect() {}, strokeRect() {},
        arc(...args) { calls.arc.push(args); },
        createRadialGradient() { return { addColorStop() {} }; },
        set fillStyle(_) {}, get fillStyle() { return ''; },
        set strokeStyle(_) {}, get strokeStyle() { return ''; },
        set lineWidth(_) {}, get lineWidth() { return 0; },
        set shadowColor(_) {}, set shadowBlur(_) {}, set shadowOffsetY(_) {},
        scale(sx, sy) { calls.scale.push([sx, sy]); },
        translate(tx, ty) { calls.translate.push([tx, ty]); },
        drawImage(...args) { calls.drawImage.push(args); },
    };
    return { ctx, calls };
}

const baseSettings = {
    aspectRatio: '9:16', backgroundMode: 'hidden', insetPadding: 0,
    cropToFill: true, cropPanX: 0.5, cropPanY: 0.5, cropZoom: 1,
    backgroundColor: '#000', zoomLevel: 2, zoomDuration: 800, transitionDuration: 300,
    showFollowCursor: false,
};

describe('buildSceneModel', () => {
    it('crops a 1920x1080 source into a fixed 1080x1920 TikTok scene', () => {
        const model = buildSceneModel({ videoWidth: 1920, videoHeight: 1080, settings: baseSettings, segments: [] });
        expect(model.layout.width).toBe(1080);
        expect(model.layout.height).toBe(1920);
        // Cover-fit picks a 607.5x1080 source sub-rect, centered.
        expect(model.layout.sW).toBeCloseTo(607.5, 1);
        expect(model.layout.sH).toBeCloseTo(1080, 1);
        expect(model.layout.sx).toBeCloseTo((1920 - 607.5) / 2, 1);
        // Destination fills the whole scene (background hidden).
        expect(model.layout.vW).toBe(1080);
        expect(model.layout.vH).toBe(1920);
    });

    it('maps a segment target into scene-normalized space accounting for crop', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080, settings: baseSettings,
            segments: [{ id: 's', startTime: 0, x: 0.5, y: 0.5, zoomLevel: 2 }],
        });
        // The centre of the source maps to the centre of the scene.
        expect(model.events[0].x).toBeCloseTo(0.5, 6);
        expect(model.events[0].y).toBeCloseTo(0.5, 6);
    });

    it('builds a smoothed cursorPath for the rendered dot when smoothing is on', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080,
            settings: { ...baseSettings, showFollowCursor: true, cursorSmoothing: 'medium' },
            segments: [],
            recordingEvents: [
                { type: 'move', time: 0, x: 0.1, y: 0.5 },
                { type: 'move', time: 16, x: 0.2, y: 0.4 },
                { type: 'move', time: 32, x: 0.3, y: 0.6 },
                { type: 'move', time: 48, x: 0.4, y: 0.5 },
            ],
        });
        expect(model.cursorPath).not.toBeNull();
        // Time-sorted.
        for (let i = 1; i < model.cursorPath.length; i++) {
            expect(model.cursorPath[i].time).toBeGreaterThan(model.cursorPath[i - 1].time);
        }
        // The camera no longer chases the cursor path — it consumes precomputed
        // follow anchors instead (no interactions here, so none are emitted).
        expect(model.cameraConfig.cursorPath).toBeUndefined();
        expect(model.cameraConfig.followSegments).toEqual([]);
    });

    it('leaves cursorPath null when smoothing is off (raw dot fallback)', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080,
            settings: { ...baseSettings, showFollowCursor: true, cursorSmoothing: 'off' },
            segments: [],
            recordingEvents: [{ type: 'move', time: 0, x: 0.1, y: 0.5 }],
        });
        expect(model.cursorPath).toBeNull();
        expect(model.cameraConfig.cursorPath).toBeUndefined();
    });

    it('builds follow anchor segments from interactions (clicks + typing) when follow is on', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080,
            settings: { ...baseSettings, showFollowCursor: true, cursorSmoothing: 'off' },
            segments: [],
            recordingEvents: [
                { type: 'click', time: 1000, x: 0.5, y: 0.5 },
                { type: 'typing', time: 3000, x: 0.3, y: 0.3 },
                { type: 'move', time: 3500, x: 0.9, y: 0.9 }, // movement is not an anchor
            ],
        });
        expect(model.cameraConfig.followSegments).toHaveLength(2);
        expect(model.cameraConfig.followSegments[0]).toMatchObject({ source: 'follow', type: 'zoom', time: 1000 });
        expect(model.cameraConfig.followSegments[1]).toMatchObject({ source: 'follow', type: 'zoom', time: 3000 });
    });

    it('omits follow segments entirely when follow mode is off', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080,
            settings: baseSettings,
            segments: [],
            recordingEvents: [{ type: 'click', time: 1000, x: 0.5, y: 0.5 }],
        });
        expect(model.cameraConfig.followSegments).toBeNull();
    });

    it('collects recorded clicks into clickEvents, deduped and scene-mapped', () => {
        const model = buildSceneModel({
            videoWidth: 1920, videoHeight: 1080, settings: baseSettings,
            segments: [],
            recordingEvents: [
                { type: 'click', time: 0, x: 0.5, y: 0.5 },
                { type: 'click', time: 100, x: 0.5, y: 0.5 },   // < 250ms after t=0 -> dropped
                { type: 'dblclick', time: 400, x: 0.5, y: 0.5 },
                { type: 'move', time: 500, x: 0.1, y: 0.1 },    // not a click -> ignored
            ],
        });
        expect(model.clickEvents.map((e) => e.time)).toEqual([0, 400]);
        // Source centre maps to scene centre under the 9:16 crop.
        expect(model.clickEvents[0].x).toBeCloseTo(0.5, 6);
        expect(model.clickEvents[0].y).toBeCloseTo(0.5, 6);
    });
});

describe('drawSceneFrame — crop + zoom compositing (export-stretch regression)', () => {
    const model = buildSceneModel({ videoWidth: 1920, videoHeight: 1080, settings: baseSettings, segments: [] });
    const source = { width: 1920, height: 1080 }; // stand-in drawable

    it('draws the source sub-rect exactly once, into the scene rect, when not zoomed', () => {
        const { ctx, calls } = makeCtxSpy();
        const camera = { srcX: 0, srcY: 0, srcW: model.layout.width, srcH: model.layout.height, zoom: 1 };
        drawSceneFrame(ctx, source, 0, model, { camera, backgroundMode: 'hidden' });

        // Exactly one non-background drawImage: the video frame (no background buffer passed).
        const videoDraw = calls.drawImage.find(a => a[0] === source);
        expect(videoDraw).toBeDefined();
        // drawImage(source, sx, sy, sW, sH, vX, vY, vW, vH) — crop applied once.
        expect(videoDraw.slice(1)).toEqual([
            model.layout.sx, model.layout.sy, model.layout.sW, model.layout.sH,
            model.layout.vX, model.layout.vY, model.layout.vW, model.layout.vH,
        ]);
    });

    it('applies the camera zoom in scene space, leaving the source sub-rect unchanged', () => {
        const { ctx, calls } = makeCtxSpy();
        // A 2x zoom centered: camera shows half the scene.
        const camera = { srcX: 270, srcY: 480, srcW: 540, srcH: 960, zoom: 2 };
        drawSceneFrame(ctx, source, 0, model, { camera, backgroundMode: 'hidden' });

        // Scene-space camera transform: scale = sceneW/camera.srcW.
        expect(calls.scale[0][0]).toBeCloseTo(model.layout.width / camera.srcW, 6);
        expect(calls.scale[0][1]).toBeCloseTo(model.layout.height / camera.srcH, 6);
        // Crucially the video is still drawn from the SAME source sub-rect —
        // the zoom must not re-crop or stretch the frame.
        const videoDraw = calls.drawImage.find(a => a[0] === source);
        expect(videoDraw.slice(1, 5)).toEqual([model.layout.sx, model.layout.sy, model.layout.sW, model.layout.sH]);
        expect(videoDraw.slice(5)).toEqual([model.layout.vX, model.layout.vY, model.layout.vW, model.layout.vH]);
    });
});

describe('drawSceneFrame — cursor highlight (smoothed vs raw)', () => {
    const settings = { ...baseSettings, showFollowCursor: true, cursorSmoothing: 'off' };
    const model = buildSceneModel({
        videoWidth: 1080, videoHeight: 1080, settings,
        segments: [],
        recordingEvents: [
            { type: 'move', time: 0, x: 0.2, y: 0.2 },
            { type: 'move', time: 1000, x: 0.8, y: 0.8 },
        ],
    });
    const source = { width: 1080, height: 1080 };
    const identityCamera = { srcX: 0, srcY: 0, srcW: model.layout.width, srcH: model.layout.height, zoom: 1 };
    const sceneW = model.layout.width;
    const sceneH = model.layout.height;

    it('draws the dot at the raw last-event-before-time when no cursorPath', () => {
        const { ctx, calls } = makeCtxSpy();
        drawSceneFrame(ctx, source, 500, model, {
            camera: identityCamera, backgroundMode: 'hidden',
            showCursorHighlight: true, showClickAnimations: false,
        });
        // Step lookup at t=500 returns the t=0 event (0.2, 0.2) in scene space.
        const outer = calls.arc[0];
        expect(outer[0]).toBeCloseTo(model.events[0].x * sceneW, 3);
        expect(outer[1]).toBeCloseTo(model.events[0].y * sceneH, 3);
    });

    it('draws the dot at the spline-sampled position when a cursorPath is given', () => {
        const { ctx, calls } = makeCtxSpy();
        const cursorPath = [
            { time: 0, x: 0.2, y: 0.2 },
            { time: 1000, x: 0.8, y: 0.8 },
        ];
        drawSceneFrame(ctx, source, 1000, model, {
            camera: identityCamera, backgroundMode: 'hidden',
            showCursorHighlight: true, showClickAnimations: false,
            cursorPath,
        });
        // At t=1000 the spline passes exactly through the last knot (0.8, 0.8).
        const outer = calls.arc[0];
        expect(outer[0]).toBeCloseTo(0.8 * sceneW, 3);
        expect(outer[1]).toBeCloseTo(0.8 * sceneH, 3);
    });
});
