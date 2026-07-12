/**
 * Beunta Logger — structured logging for the Chrome extension.
 *
 * Features:
 *  - Colour-coded, tagged console output  [SW] [Popup] [Widget] [Bridge] etc.
 *  - Timestamps on every line
 *  - Persists the last MAX_ENTRIES log lines to chrome.storage.session
 *    so you can retrieve them from any extension context or DevTools.
 *  - Exposes window.__beuntaLogs() / chrome.storage.session for cross-context reading
 *
 * Usage:
 *   import { createLogger } from '../shared/utils/logger.js';
 *   const log = createLogger('SW');     // or 'Popup', 'Widget', 'Bridge', etc.
 *   log.info('Starting...');
 *   log.warn('Port missing', { detail });
 *   log.error('Failed', err);
 *   log.debug('raw msg', payload);       // debug hidden in production by default
 */

const MAX_ENTRIES = 200;
const DEBUG_ENABLED = true; // flip to false to silence debug logs in prod

// ─── Colours per level (ANSI-style via %c CSS in DevTools) ──────────────────
const LEVEL_STYLES = {
    debug: 'color: #888; font-weight: normal',
    info:  'color: #4fc3f7; font-weight: bold',
    warn:  'color: #ffb74d; font-weight: bold',
    error: 'color: #ef5350; font-weight: bold',
};

// Per-component accent colours
const TAG_STYLES = {
    SW:      'background:#1a237e;color:#e3f2fd;padding:1px 5px;border-radius:3px;font-weight:bold',
    Popup:   'background:#1b5e20;color:#e8f5e9;padding:1px 5px;border-radius:3px;font-weight:bold',
    Widget:  'background:#4a148c;color:#f3e5f5;padding:1px 5px;border-radius:3px;font-weight:bold',
    Bridge:  'background:#e65100;color:#fff3e0;padding:1px 5px;border-radius:3px;font-weight:bold',
    Offscreen:'background:#004d40;color:#e0f2f1;padding:1px 5px;border-radius:3px;font-weight:bold',
    Native:  'background:#37474f;color:#eceff1;padding:1px 5px;border-radius:3px;font-weight:bold',
};
const DEFAULT_TAG_STYLE = 'background:#333;color:#fff;padding:1px 5px;border-radius:3px;font-weight:bold';

// ─── In-memory ring buffer (shared across all logger instances) ───────────────
let _buffer = [];

function _timestamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function _persist(entry) {
    _buffer.push(entry);
    if (_buffer.length > MAX_ENTRIES) _buffer.shift();

    // Write to chrome.storage.session if available (service worker / popup)
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            chrome.storage.session.set({ __beuntaLogs: _buffer }).catch(() => {});
        }
    } catch { /* context may not support storage */ }
}

function _write(tag, level, args) {
    if (level === 'debug' && !DEBUG_ENABLED) return;

    const ts = _timestamp();
    const prefix = `${ts} [${tag}]`;

    // Build a serialisable entry for persistence
    const serialisable = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    });
    const entry = { ts, tag, level, msg: serialisable.join(' ') };
    _persist(entry);

    // Console output with colours
    const tagStyle = TAG_STYLES[tag] || DEFAULT_TAG_STYLE;
    const levelStyle = LEVEL_STYLES[level];
    const consoleFn = level === 'error' ? console.error
                    : level === 'warn'  ? console.warn
                    : level === 'debug' ? console.debug
                    : console.info;

    consoleFn(`%c${tag}%c [${level.toUpperCase()}] ${ts}`, tagStyle, levelStyle, ...args);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a logger scoped to a component name.
 * @param {string} tag  e.g. 'SW', 'Popup', 'Widget', 'Bridge', 'Offscreen'
 */
export function createLogger(tag) {
    return {
        debug: (...args) => _write(tag, 'debug', args),
        info:  (...args) => _write(tag, 'info',  args),
        warn:  (...args) => _write(tag, 'warn',  args),
        error: (...args) => _write(tag, 'error', args),
    };
}

/**
 * Retrieve the in-memory log buffer (useful from DevTools console).
 * Also available from any context via:
 *   chrome.storage.session.get('__beuntaLogs', console.log)
 */
export function getLogs() {
    return [..._buffer];
}

/**
 * Print all buffered logs to the console in a readable table.
 * Call from DevTools: window.__beuntaLogs?.()
 */
export function printLogs() {
    console.table(_buffer.map(e => ({
        time: e.ts,
        tag: e.tag,
        level: e.level,
        message: e.msg.slice(0, 120),
    })));
}

// Expose on window for easy DevTools access (content/popup contexts)
if (typeof window !== 'undefined') {
    window.__beuntaLogs = printLogs;
    window.__beuntaGetLogs = getLogs;
}
