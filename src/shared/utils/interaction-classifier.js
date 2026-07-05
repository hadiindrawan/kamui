/**
 * Interaction classifier — shared between the web content-script cursor
 * tracker (core/content/cursor-tracker.js) and the native cursor/click
 * tracker (ingested in core/background/service-worker.js), so a rapid click
 * on a webpage and a rapid click on the desktop are judged "zoom-worthy" by
 * the same rule and produce the same event shape for the editor's auto-zoom.
 */

export const CLICK_CLUSTER_THRESHOLD_MS = 3000;
export const MIN_CLICKS_FOR_CLUSTER = 2;
export const CLUSTER_DISTANCE_THRESHOLD = 0.2; // normalized viewport/screen distance

/** Drop clicks older than the cluster threshold relative to `now`. */
export function pruneClickCluster(recentClicks, now) {
    return recentClicks.filter((click) => now - click.time < CLICK_CLUSTER_THRESHOLD_MS);
}

function clusterDistance(recentClicks, x, y) {
    const avgX = recentClicks.reduce((sum, c) => sum + c.x, 0) / recentClicks.length;
    const avgY = recentClicks.reduce((sum, c) => sum + c.y, 0) / recentClicks.length;
    return Math.sqrt((x - avgX) ** 2 + (y - avgY) ** 2);
}

/**
 * Decide whether a click is "zoom-worthy" (vs noise, tagged 'click-minor').
 *
 * @param {Object} params
 * @param {number} params.x - normalized 0-1
 * @param {number} params.y - normalized 0-1
 * @param {Array<{time:number,x:number,y:number}>} params.recentClicks - cluster window, already pruned
 * @param {boolean} [params.hasInteractiveTarget] - true if the click hit a
 *   DOM input/button/link/contentEditable (web), or if there's no DOM
 *   context to judge at all (native OS clicks) — either way the click is
 *   inherently meaningful and always zoom-worthy, skipping the cluster check.
 */
export function isZoomWorthyClick({ x, y, recentClicks, hasInteractiveTarget = false }) {
    if (hasInteractiveTarget) return true;
    if (recentClicks.length >= MIN_CLICKS_FOR_CLUSTER) {
        return clusterDistance(recentClicks, x, y) < CLUSTER_DISTANCE_THRESHOLD;
    }
    return false;
}
