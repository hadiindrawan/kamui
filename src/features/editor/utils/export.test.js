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

    it('applies the export scale multiplier on top of the standard resolution', () => {
        expect(calculateCanvasSize(1920, 1080, '9:16', 2)).toEqual({ width: 2160, height: 3840 });
    });

    it('floors dimensions to even numbers (required by most video codecs)', () => {
        expect(calculateCanvasSize(641, 361, 'Native', 1)).toEqual({ width: 640, height: 360 });
    });
});
