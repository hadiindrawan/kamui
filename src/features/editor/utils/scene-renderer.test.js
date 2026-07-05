import { buildSceneModel, drawSceneFrame } from './scene-renderer.js';

// Minimal 2D-context spy that records drawImage calls and honors save/restore
// of the current transform enough for geometry assertions.
function makeCtxSpy() {
    const calls = { drawImage: [], scale: [], translate: [] };
    const ctx = {
        canvas: { width: 0, height: 0 },
        save() {}, restore() {}, clearRect() {},
        beginPath() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
        fillRect() {}, strokeRect() {}, arc() {},
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
