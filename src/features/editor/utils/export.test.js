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
});
