import { calculateCanvasSize } from './export.js';

describe('calculateCanvasSize', () => {
    it('uses fixed standard resolutions for social presets, regardless of source size', () => {
        // A 1920x1080 source reframed to 9:16 must export at the standard
        // 1080x1920 vertical resolution TikTok/Shorts expect — not a
        // resolution derived from the source's short side (~608x1080).
        expect(calculateCanvasSize(1920, 1080, '9:16')).toEqual({ width: 1080, height: 1920 });
        expect(calculateCanvasSize(1920, 1080, '1:1')).toEqual({ width: 1080, height: 1080 });
        expect(calculateCanvasSize(1920, 1080, '4:5')).toEqual({ width: 1080, height: 1350 });
        expect(calculateCanvasSize(1920, 1080, '16:9')).toEqual({ width: 1920, height: 1080 });
    });

    it('produces the same standard resolution no matter the source resolution', () => {
        expect(calculateCanvasSize(640, 360, '9:16')).toEqual({ width: 1080, height: 1920 });
        expect(calculateCanvasSize(3840, 2160, '9:16')).toEqual({ width: 1080, height: 1920 });
    });

    it('keeps the source dimensions for Native', () => {
        expect(calculateCanvasSize(1280, 720, 'Native')).toEqual({ width: 1280, height: 720 });
    });

    it('reaches a higher resolution preset (e.g. 4K) by scaling the standard resolution', () => {
        expect(calculateCanvasSize(1920, 1080, '9:16', 2160)).toEqual({ width: 2160, height: 3840 });
        expect(calculateCanvasSize(1920, 1080, '16:9', 2160)).toEqual({ width: 3840, height: 2160 });
    });

    it('scales down to a lower resolution preset (e.g. 720p)', () => {
        expect(calculateCanvasSize(1920, 1080, '16:9', 720)).toEqual({ width: 1280, height: 720 });
    });

    it('never upscales Native beyond the source resolution', () => {
        // Source is only 720p; requesting 4K on Native must not fabricate pixels.
        expect(calculateCanvasSize(1280, 720, 'Native', 2160)).toEqual({ width: 1280, height: 720 });
    });

    it('downscales Native when the requested resolution is smaller than the source', () => {
        expect(calculateCanvasSize(1920, 1080, 'Native', 720)).toEqual({ width: 1280, height: 720 });
    });

    it('floors dimensions to even numbers (required by most video codecs)', () => {
        expect(calculateCanvasSize(641, 361, 'Native', 1080)).toEqual({ width: 640, height: 360 });
    });

    describe("'source' resolution (match recording)", () => {
        it('keeps a 4K 16:9 recording at its full resolution', () => {
            // The regression this fixes: a 4K capture must not be downscaled to
            // 1080p by default. 'source' resolves to the source short edge (2160).
            expect(calculateCanvasSize(3840, 2160, '16:9', 'source')).toEqual({ width: 3840, height: 2160 });
        });

        it('is a no-op passthrough for Native (full source dimensions)', () => {
            expect(calculateCanvasSize(2992, 1870, 'Native', 'source')).toEqual({ width: 2992, height: 1870 });
        });

        it('reframes a preset to the source-class short edge', () => {
            // 4K source, reframed to vertical 9:16 at source-class resolution:
            // short edge = 2160, so height scales to 2160 * (16/9)-tall canvas.
            expect(calculateCanvasSize(3840, 2160, '9:16', 'source')).toEqual({ width: 2160, height: 3840 });
        });

        it('keeps a 1080p recording at 1080p (no upscaling)', () => {
            expect(calculateCanvasSize(1920, 1080, '16:9', 'source')).toEqual({ width: 1920, height: 1080 });
        });
    });
});
