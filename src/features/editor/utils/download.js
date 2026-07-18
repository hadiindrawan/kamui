/**
 * File download helpers (browser anchor-click pattern; no chrome.downloads).
 */

import { captionsToSrt } from './captions.js';

/**
 * Trigger a browser download of `blob` as `filename`.
 */
export const downloadBlob = (blob, filename) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 100);
};

/**
 * Build an SRT from captions (rebased for the trim window) and download it.
 */
export const downloadSrt = (captions, { trimStart = 0, trimEnd = Infinity, filename = 'captions.srt' } = {}) => {
	const srt = captionsToSrt(captions, { trimStart, trimEnd });
	const blob = new Blob([srt], { type: 'application/x-subrip' });
	downloadBlob(blob, filename);
};
