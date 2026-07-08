// Background service worker for managing recording lifecycle
import { createLogger } from '../../shared/utils/logger.js';
import { isZoomWorthyClick } from '../../shared/utils/interaction-classifier.js';
import { persistQualitySetting } from '../services/recording-service.js';
const log = createLogger('SW');

// ─── Native Bridge (inlined — MV3 service workers don't support dynamic import()) ───

const NATIVE_HOST_NAME = 'com.beunta.native';
let nativePort = null;
let nativeBridgeReconnectAttempts = 0;
const NATIVE_RECONNECT_DELAY_MS = 2000;

const nativeListeners = new Map();

// Mirrors chrome.storage.local's 'quality' key so APP_STATE messages to the
// tray always have a value on hand without an async storage read on every
// send. Seeded from storage below and kept current via storage.onChanged.
let currentQuality = 'best-quality';
chrome.storage.local.get(['quality']).then((result) => {
    if (result.quality) currentQuality = result.quality;
    sendAppStateToNative();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.quality) {
        currentQuality = changes.quality.newValue || currentQuality;
        sendAppStateToNative();
    }
});

// Persisted so a popup that reopens after a native ERROR arrived (likely,
// since starting a native recording backgrounds the popup via the
// getDisplayMedia picker) can still learn about it via GET_STATE, not just
// popups that happen to be open live when the message is broadcast.
let lastNativeError = null; // { code, message, timestamp } | null

function nativeBridgeConnect() {
    if (nativePort) return nativePort;

    try {
        nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        log.info('Native bridge connected to', NATIVE_HOST_NAME);
    } catch (e) {
        log.error('Failed to connect to native app:', e.message);
        return null;
    }

    nativePort.onMessage.addListener((message) => {
        log.debug('\u2190 Native message received:', message.type, message);

        // TRACKING_STOPPED arrives both as a reply to our own STOP_TRACKING and
        // unprompted from a tray "Stop Recording" click. finishNativeRecording()
        // is idempotent (no-ops if nothing is recording), so handling it here
        // unconditionally covers both cases without double-finalizing.
        if (message.type === 'TRACKING_STOPPED') {
            log.info('Native TRACKING_STOPPED received — finalizing recording.');
            finishNativeRecording().catch((e) => log.error('finishNativeRecording failed:', e));
        }

        if (message.type === 'ERROR') {
            log.warn('Native ERROR received:', message.code, message.message);
            lastNativeError = { code: message.code, message: message.message, timestamp: Date.now() };
        }

        // Tray-originated requests — the tray can't directly mutate extension
        // state (no shared memory across the NativeMessaging boundary), so it
        // asks us to do it and we echo the result back via APP_STATE.
        if (message.type === 'REQUEST_SET_QUALITY') {
            log.info('Native tray requested quality change:', message.quality);
            currentQuality = message.quality;
            persistQualitySetting(message.quality).catch((e) => log.error('Failed to persist tray-driven quality:', e));
            sendAppStateToNative();
        }

        if (message.type === 'REQUEST_OPEN_RECORDINGS') {
            log.info('Native tray requested Open Recordings.');
            // tabs.create() alone only makes the tab active *within* Chrome —
            // it doesn't bring the Chrome window itself to the OS foreground
            // when another app currently has focus, so also explicitly focus
            // the window the new tab landed in.
            chrome.tabs.create({ url: chrome.runtime.getURL('src/features/recordings/index.html') })
                .then((tab) => chrome.windows.update(tab.windowId, { focused: true }))
                .catch((e) => log.error('Failed to open recordings page:', e));
        }

        // Recording control from the tray "Start"/"Stop" items or the global
        // hotkey. The native app can't capture on its own (all video is the
        // browser's getDisplayMedia), so it asks us to drive the existing flow.
        if (message.type === 'REQUEST_START_RECORDING') {
            if (recordingState.isRecording) {
                log.info('Native requested Start, but already recording — ignoring.');
            } else {
                log.info('Native tray/hotkey requested Start Recording.');
                // Bring Chrome to the OS foreground so the getDisplayMedia
                // share-picker (which the start flow raises) is visible even
                // when another app had focus.
                chrome.windows.getLastFocused()
                    .then((win) => chrome.windows.update(win.id, { focused: true }))
                    .catch(() => {});
                // Reuse the existing native-mode start path — it self-resolves
                // the active tab via chrome.tabs.query, so no sender is needed
                // (same pattern as handleRegionSelected reusing handleStartRecording).
                handleNativeStartRecording(
                    { recordingMode: 'native', micEnabled: false, quality: currentQuality },
                    null,
                    () => {},
                );
                // Let an open popup (if any) reflect that recording began.
                chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' }).catch(() => {});
            }
        }

        if (message.type === 'REQUEST_STOP_RECORDING') {
            if (!recordingState.isRecording) {
                log.info('Native requested Stop, but not recording — ignoring.');
            } else {
                log.info('Native tray/hotkey requested Stop Recording.');
                // Mode-agnostic: route like the STOP_RECORDING message so a
                // browser-mode recording started from the popup can also be
                // stopped from the tray/hotkey, not just native-mode ones.
                const mode = recordingState.recordingMode || 'browser';
                if (mode === 'native') {
                    handleNativeStopRecording({}, null, () => {});
                } else {
                    handleStopRecording({}, null, () => {});
                }
            }
        }

        // Call any registered type-specific listener (cursor/click ingestion, etc.)
        const handler = nativeListeners.get(message.type);
        if (handler) handler(message);

        // Also forward to popup/other extension pages (may fail silently if popup is closed)
        chrome.runtime.sendMessage({
            type: 'NATIVE_MESSAGE',
            nativeType: message.type,
            payload: message
        }).catch(() => {}); // silently ignore if no receiver
    });

    nativePort.onDisconnect.addListener(() => {
        const lastError = chrome.runtime.lastError;
        log.warn('Native app disconnected:', lastError?.message || 'unknown');
        nativePort = null;
        chrome.runtime.sendMessage({ type: 'NATIVE_DISCONNECTED' }).catch(() => {});
        // Safety net: if the native helper crashed/quit mid-recording, we'd
        // never receive TRACKING_STOPPED — finalize so the recording isn't lost
        // and the popup doesn't hang in the recording state.
        if (recordingState.isRecording && recordingState.recordingMode === 'native') {
            log.warn('Native app disconnected during recording — finalizing.');
            finishNativeRecording()
                .then(() => chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED', reason: 'native-disconnected' }).catch(() => {}))
                .catch((e) => log.error('finishNativeRecording (disconnect) failed:', e));
        }
        // The connection is meant to be permanent (it's what keeps the
        // branded tray icon present even when nothing is recording), so keep
        // retrying indefinitely rather than giving up after a few attempts.
        // If the companion app was never installed at all, connectNative()
        // above throws synchronously instead of reaching this handler, so
        // this loop only runs when a previously-working connection dropped
        // (app crashed/updated) — not against a permanently-absent host.
        nativeBridgeReconnectAttempts++;
        log.info(`Reconnect attempt ${nativeBridgeReconnectAttempts} in ${NATIVE_RECONNECT_DELAY_MS}ms`);
        setTimeout(() => nativeBridgeConnect(), NATIVE_RECONNECT_DELAY_MS);
    });

    nativeBridgeReconnectAttempts = 0;
    sendAppStateToNative();
    return nativePort;
}

/** Pushes current recording/quality state to the native tray so it can pick
 * the idle/recording icon and sync its Quality submenu checkmarks. No-op
 * (silently) if the native app isn't connected. */
function sendAppStateToNative() {
    try {
        nativeBridgeSend({
            type: 'APP_STATE',
            is_recording: recordingState.isRecording,
            quality: currentQuality,
            // Plain browser-mode recordings replace recordingState wholesale
            // without a recordingMode field, so it can be undefined here —
            // default it since the Rust side expects a non-optional String.
            mode: recordingState.recordingMode || 'browser',
        });
    } catch (e) {
        log.debug('sendAppStateToNative skipped (native not connected):', e.message);
    }
}

function nativeBridgeDisconnect() {
    if (nativePort) {
        try { nativePort.disconnect(); } catch { /* ignore */ }
        nativePort = null;
    }
    nativeListeners.clear();
}

function nativeBridgeSend(message) {
    if (!nativePort) throw new Error('Native app not connected');
    log.debug('\u2192 Native message sent:', message.type, message);
    nativePort.postMessage(message);
}

function nativeBridgeOnMessage(type, callback) {
    nativeListeners.set(type, callback);
}

function nativeBridgeOffMessage(type) {
    nativeListeners.delete(type);
}

async function checkNativeAppAvailable() {
    let port = null;
    try {
        port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 2000);
            port.onMessage.addListener((msg) => {
                if (msg.type === 'PONG') { clearTimeout(timeout); resolve(true); }
            });
            port.onDisconnect.addListener(() => { clearTimeout(timeout); resolve(false); });
            port.postMessage({ type: 'PING' });
        });
        port.disconnect();
        return result;
    } catch {
        if (port) try { port.disconnect(); } catch { /* ignore */ }
        return false;
    }
}

// ─── Recording State ───

let recordingState = {
    isRecording: false,
    currentSessionId: null,
    tabId: null,

    // Native mode: capture is still the browser's getDisplayMedia (same as
    // 'browser' mode) — the only difference is cursor/click events come from
    // the native app's global tracker instead of a page content script, so
    // auto-zoom works for full-desktop recordings, not just in-tab ones.
    recordingMode: 'browser',  // 'browser' | 'native'
    nativeConnected: false,
};

// Open the native connection immediately and keep it open for the lifetime
// of the service worker (not just while a native-mode recording is active),
// so the companion app's tray icon is present whenever Chrome is running.
// No-ops silently if the companion app isn't installed (connectNative()
// throws synchronously, caught inside nativeBridgeConnect()).
nativeBridgeConnect();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log.debug(`→ Message received: ${message.type}`, { mode: message.recordingMode || recordingState.recordingMode, sender: sender?.id });
    switch (message.type) {
        case 'START_RECORDING': {
            // Allow popup to explicitly pass recordingMode in message, so routing
            // is robust even if the service worker was restarted (which resets state).
            const mode = message.recordingMode || recordingState.recordingMode;
            if (mode === 'native') {
                // Sync mode into state in case it was reset by SW restart
                recordingState.recordingMode = 'native';
                handleNativeStartRecording(message, sender, sendResponse);
            } else {
                handleStartRecording(message, sender, sendResponse);
            }
            return true;
        }

        case 'STOP_RECORDING': {
            const mode = message.recordingMode || recordingState.recordingMode;
            if (mode === 'native') {
                handleNativeStopRecording(message, sender, sendResponse);
            } else {
                handleStopRecording(message, sender, sendResponse);
            }
            return true;
        }

        case 'RESUME_RECORDING':
            handleResumeRecording(message, sender, sendResponse);
            return true;

        case 'GET_STATE':
            sendResponse({ state: { ...recordingState, nativeTrackerWarning: lastNativeError?.message || null } });
            break;

        case 'CURSOR_EVENT':
            // Forward cursor events to offscreen document
            forwardToOffscreen(message);
            break;

        case 'OFFSCREEN_TRACK_ENDED':
            // The display capture ended outside our control — the user clicked
            // Chrome's macOS screen-sharing "Stop" indicator, or the source went
            // away. Finalize through the normal stop path so the recording is
            // saved and the UI resets, instead of hanging.
            handleTrackEnded();
            break;

        // ─── Native mode handlers ───

        case 'SET_RECORDING_MODE':
            recordingState.recordingMode = message.mode; // 'browser' | 'native'
            sendAppStateToNative();
            sendResponse({ success: true });
            break;

        case 'CHECK_NATIVE_AVAILABLE':
            handleCheckNativeAvailable(message, sender, sendResponse);
            return true;

        // ─── Region recording ───

        case 'SELECT_REGION':
            handleSelectRegion(message, sender, sendResponse);
            return true;

        case 'REGION_SELECTED':
            handleRegionSelected(message);
            break;

        case 'REGION_CANCELLED':
            log.info('Region selection cancelled by user.');
            pendingRegionStart = null;
            break;

        // NATIVE_MESSAGE is the SW's own broadcast of native events to the
        // popup — nothing to do here on the SW side (that's handled directly
        // in nativeBridgeConnect()'s onMessage listener, which sees native
        // messages before they're re-wrapped and broadcast).
    }
});

// ─── Native Recording Handlers ───

async function handleCheckNativeAvailable(message, sender, sendResponse) {
    log.info('Checking native app availability...');
    try {
        const available = await checkNativeAppAvailable();
        log.info('Native app available:', available);
        sendResponse({ available });
    } catch (error) {
        log.error('Native availability check failed:', error);
        sendResponse({ available: false, error: error.message });
    }
}

async function handleNativeStartRecording(message, sender, sendResponse) {
    log.info('handleNativeStartRecording: starting browser capture + native cursor tracker...');
    lastNativeError = null;
    try {
        const sessionId = `rec_native_${Date.now()}`;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        await createOffscreenDocument();

        const response = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_RECORDING',
            sessionId,
            tabId: tab.id,
            micEnabled: message.micEnabled || false,
            quality: message.quality || 'best-quality'
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to start recording');
        }
        log.info('Offscreen recording started, session:', sessionId);

        recordingState = {
            isRecording: true,
            currentSessionId: sessionId,
            tabId: tab.id,
            startTime: Date.now(),
            recordingMode: 'native',
            nativeConnected: false,
        };
        sendAppStateToNative();

        // Register the native global cursor/click tracker on the already-open
        // persistent connection (nativeBridgeConnect() runs once at SW
        // startup — see above). Coordinates are screen-global, so this only
        // lines up with the captured frame when the user shares "Entire
        // Screen" in the getDisplayMedia picker.
        nativeBridgeOnMessage('CURSOR_POSITION', (msg) => handleNativeCursorEvent(sessionId, msg));
        nativeBridgeOnMessage('CLICK', (msg) => handleNativeClickEvent(sessionId, msg));
        try {
            nativeBridgeSend({ type: 'START_TRACKING', session_id: sessionId });
            recordingState.nativeConnected = true;
            log.info('Native tracker started for session:', sessionId);
        } catch (e) {
            log.warn('Native tracker unavailable, continuing without global cursor tracking:', e.message);
        }

        sendResponse({ success: true, sessionId });
    } catch (error) {
        log.error('Native start failed:', error);
        recordingState = { isRecording: false, currentSessionId: null, tabId: null };
        sendAppStateToNative();
        sendResponse({ success: false, error: error.message });
    }
}

/** Stops offscreen capture and opens the editor. Idempotent — safe to call
 * from both the explicit STOP_RECORDING path and the tray-triggered
 * TRACKING_STOPPED path without double-finalizing. */
async function finishNativeRecording() {
    if (!recordingState.isRecording) return null;
    const sessionId = recordingState.currentSessionId;

    nativeBridgeOffMessage('CURSOR_POSITION');
    nativeBridgeOffMessage('CLICK');

    const stopPromise = chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_RECORDING' });
    const timeoutPromise = new Promise((r) => setTimeout(() => r({ timeout: true }), 3000));
    const result = await Promise.race([stopPromise, timeoutPromise]);
    if (result?.timeout) {
        log.warn('Offscreen stop timed out, proceeding with fallback session ID.');
    }
    const recordingId = result?.recordingId || sessionId;

    recordingState = { isRecording: false, currentSessionId: null, tabId: null, recordingMode: 'native', nativeConnected: false };
    sendAppStateToNative();

    // tabs.create() alone only activates the tab *within* Chrome — it doesn't
    // bring the Chrome window to the OS foreground when another app (e.g. one
    // focused via a hotkey-triggered stop) currently has focus.
    const editorTab = await chrome.tabs.create({ url: `src/features/editor/index.html?id=${recordingId}` });
    chrome.windows.update(editorTab.windowId, { focused: true }).catch(() => {});
    log.info('Native recording finalized, saved as:', recordingId);
    return { sessionId, recordingId };
}

async function handleNativeStopRecording(message, sender, sendResponse) {
    log.info('handleNativeStopRecording: user requested stop.');
    try {
        if (recordingState.nativeConnected) {
            try {
                nativeBridgeSend({ type: 'STOP_TRACKING' });
            } catch (e) {
                log.warn('Failed to send STOP_TRACKING:', e.message);
            }
        }
        const result = await finishNativeRecording();
        if (!result) throw new Error('No active recording');
        sendResponse({ success: true, ...result });
    } catch (error) {
        log.error('Native stop failed:', error);
        sendResponse({ success: false, error: error.message });
    }
}

function handleNativeCursorEvent(sessionId, msg) {
    if (!recordingState.isRecording || recordingState.currentSessionId !== sessionId) return;
    const time = msg.timestamp_ms - recordingState.startTime;
    forwardToOffscreen({
        type: 'CURSOR_EVENT',
        sessionId,
        event: { type: 'move', time, x: msg.x, y: msg.y }
    });
}

function handleNativeClickEvent(sessionId, msg) {
    if (!recordingState.isRecording || recordingState.currentSessionId !== sessionId) return;
    const time = msg.timestamp_ms - recordingState.startTime;
    // Native clicks are a comparatively rare, deliberate signal — unlike web
    // clicks there's no DOM element to judge, so every click is zoom-worthy.
    const eventType = isZoomWorthyClick({ x: msg.x, y: msg.y, recentClicks: [], hasInteractiveTarget: true })
        ? 'click' : 'click-minor';
    forwardToOffscreen({
        type: 'CURSOR_EVENT',
        sessionId,
        event: { type: eventType, time, x: msg.x, y: msg.y, button: msg.button }
    });
}

// ─── Region Recording Handlers ───

// Start options captured when the user picks "Record region", consumed once the
// content-script overlay reports the chosen rectangle.
let pendingRegionStart = null;

async function handleSelectRegion(message, sender, sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')))) {
            throw new Error('Region selection is not available on this page. Open a normal website first.');
        }
        pendingRegionStart = { micEnabled: message.micEnabled || false, quality: message.quality || 'best-quality' };
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['region-selector.js'] });
        sendResponse({ success: true });
    } catch (error) {
        log.error('Failed to start region selection:', error);
        pendingRegionStart = null;
        sendResponse({ success: false, error: error.message });
    }
}

async function handleRegionSelected(message) {
    const opts = pendingRegionStart || {};
    pendingRegionStart = null;
    log.info('Region selected — starting cropped recording.', message.rect);
    await handleStartRecording(
        {
            micEnabled: opts.micEnabled,
            quality: opts.quality,
            regionSelection: { rect: message.rect, viewport: message.viewport, screen: message.screen },
        },
        null,
        () => {},
    );
    // The popup is closed during selection; tell it (if reopened) recording began.
    chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' }).catch(() => {});
}

// ─── Browser Recording Handlers ───

async function handleStartRecording(message, sender, sendResponse) {
    log.info('handleStartRecording: starting browser session...');
    try {
        const sessionId = `rec_${Date.now()}`;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        log.debug('Active tab:', { id: tab.id, url: tab.url });

        await createOffscreenDocument();

        const response = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_RECORDING',
            sessionId,
            tabId: tab.id,
            micEnabled: message.micEnabled || false,
            quality: message.quality || 'best-quality',
            regionSelection: message.regionSelection || null
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to start recording');
        }
        log.info('Offscreen recording started, session:', sessionId);

        recordingState = {
            isRecording: true,
            currentSessionId: sessionId,
            tabId: tab.id,
            startTime: Date.now()
        };
        sendAppStateToNative();

        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['recording-widget.js', 'cursor-tracker.js']
            });
        } catch (e) {
            log.debug('Widget script injection skipped (already injected):', e.message);
        }

        log.info('Broadcasting START_TRACKING to all tabs...');
        await broadcastToAllTabs({
            type: 'START_TRACKING',
            sessionId,
            startTime: recordingState.startTime
        });

        sendResponse({ success: true, sessionId });
    } catch (error) {
        log.error('Error starting browser recording:', error);
        recordingState = { isRecording: false, currentSessionId: null, tabId: null };
        sendAppStateToNative();
        sendResponse({ success: false, error: error.message });
    }
}

async function handleResumeRecording(message, sender, sendResponse) {
    try {
        const { sessionId, segmentId, micEnabled, quality } = message;

        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Create offscreen document for recording
        await createOffscreenDocument();

        // Start recording in offscreen document
        const response = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_RECORDING',
            sessionId: sessionId,
            segmentId: segmentId,
            tabId: tab.id,
            micEnabled: micEnabled || false,
            quality: quality || 'best-quality'
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to resume recording');
        }

        // Update state
        recordingState = {
            isRecording: true,
            currentSessionId: sessionId,
            tabId: tab.id,
            startTime: Date.now() // Track start time for global timer sync
        };
        sendAppStateToNative();

        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['recording-widget.js', 'cursor-tracker.js']
            });
        } catch (e) {
            console.log('[Background] Widget script injection skipped:', e.message);
        }

        await broadcastToAllTabs({
            type: 'START_TRACKING',
            sessionId: sessionId,
            startTime: recordingState.startTime
        });

        sendResponse({ success: true, sessionId, segmentId });
    } catch (error) {
        console.error('Error resuming recording:', error);
        recordingState = { isRecording: false, currentSessionId: null, tabId: null };
        sendAppStateToNative();
        sendResponse({ success: false, error: error.message });
    }
}

/** Stops browser-mode offscreen capture and opens the editor. Idempotent —
 * shared by the explicit STOP_RECORDING path and the capture-ended path. */
async function finishBrowserRecording() {
    if (!recordingState.isRecording) return null;
    const sessionId = recordingState.currentSessionId;
    log.info('Stopping session:', sessionId);

    await broadcastToAllTabs({ type: 'STOP_TRACKING' });

    const stopPromise = chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_RECORDING' });
    const timeoutPromise = new Promise(r => setTimeout(() => r({ timeout: true }), 3000));
    const result = await Promise.race([stopPromise, timeoutPromise]);
    if (result?.timeout) {
        log.warn('Offscreen stop timed out, proceeding with fallback session ID.');
    }

    const recordingId = result?.recordingId || sessionId;
    log.info('Recording saved as:', recordingId);

    recordingState = { isRecording: false, currentSessionId: null, tabId: null };
    sendAppStateToNative();
    // See the equivalent comment in finishNativeRecording() — tabs.create()
    // alone doesn't foreground the Chrome window itself.
    const editorTab = await chrome.tabs.create({ url: `src/features/editor/index.html?id=${recordingId}` });
    chrome.windows.update(editorTab.windowId, { focused: true }).catch(() => {});
    return { sessionId, recordingId };
}

async function handleStopRecording(message, sender, sendResponse) {
    log.info('handleStopRecording: stopping browser session...');
    try {
        if (!recordingState.isRecording) {
            log.warn('STOP_RECORDING called but no active recording in state.');
            throw new Error('No active recording');
        }
        const result = await finishBrowserRecording();
        sendResponse({ success: true, ...result });
    } catch (error) {
        log.error('Error stopping browser recording:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/** Handles the display capture ending outside our control (Chrome's stop
 * indicator, source closed) for both browser and native modes. */
async function handleTrackEnded() {
    if (!recordingState.isRecording) return;
    log.info('Capture ended externally — finalizing recording.');
    try {
        if (recordingState.recordingMode === 'native') {
            if (recordingState.nativeConnected) {
                try { nativeBridgeSend({ type: 'STOP_TRACKING' }); } catch (e) { log.warn('STOP_TRACKING send failed:', e.message); }
            }
            await finishNativeRecording();
        } else {
            await finishBrowserRecording();
        }
        chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED', reason: 'capture-ended' }).catch(() => {});
    } catch (error) {
        log.error('Error finalizing after capture ended:', error);
    }
}

async function createOffscreenDocument() {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create offscreen document
    await chrome.offscreen.createDocument({
        url: 'src/core/offscreen/index.html',
        reasons: ['USER_MEDIA'],
        justification: 'Recording screen and audio'
    });
}

async function forwardToOffscreen(message) {
    // Only forward if the offscreen document is actually open
    try {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        if (contexts.length === 0) {
            log.debug('forwardToOffscreen: no offscreen document open, skipping.');
            return;
        }
        await chrome.runtime.sendMessage(message);
    } catch (e) {
        log.warn('forwardToOffscreen failed:', e.message);
    }
}

async function broadcastToAllTabs(message) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        try {
            // Ignore restricted chrome:// and extension pages
            if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                try {
                    await chrome.tabs.sendMessage(tab.id, message);
                } catch (e) {
                    // Script might not be there - reactive injection
                    if (recordingState.isRecording) {
                        try {
                            await chrome.scripting.executeScript({
                                target: { tabId: tab.id },
                                files: ['recording-widget.js', 'cursor-tracker.js']
                            });
                            // Try again after injection
                            setTimeout(() => chrome.tabs.sendMessage(tab.id, message).catch(() => { }), 100);
                        } catch (err) {
                            console.log(`[Background] Failed reactive injection for tab ${tab.id}`);
                        }
                    }
                }
            }
        } catch (e) {
            // Tab might be restricted or closed
        }
    }
}

// Listen for tab updates to ensure widget is there. Browser-mode only — in
// native mode, tracking comes exclusively from the global Rust tracker; firing
// START_TRACKING here would wrongly activate the page-level DOM tracker
// (cursor-tracker.js), which can only see clicks inside the browser tab, never
// clicks elsewhere on the desktop.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && recordingState.isRecording && recordingState.recordingMode !== 'native') {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            chrome.tabs.sendMessage(tabId, {
                type: 'START_TRACKING',
                sessionId: recordingState.currentSessionId,
                startTime: recordingState.startTime
            }).catch(() => {
                // Reactive injection for new navigation
                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['recording-widget.js', 'cursor-tracker.js']
                }).catch(() => { });
            });
        }
    }
});

// Refresh state when tab becomes active. Browser-mode only (see onUpdated above).
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (recordingState.isRecording && recordingState.recordingMode !== 'native') {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url && !tab.url.startsWith('chrome://')) {
                chrome.tabs.sendMessage(activeInfo.tabId, {
                    type: 'START_TRACKING',
                    sessionId: recordingState.currentSessionId,
                    startTime: recordingState.startTime
                }).catch(() => { });
            }
        } catch (e) { }
    }
});

// Clean up on extension startup
chrome.runtime.onStartup.addListener(() => {
    recordingState = {
        isRecording: false,
        currentSessionId: null,
        tabId: null
    };
    lastNativeError = null;
    // Defensive re-connect: the module-level nativeBridgeConnect() call above
    // normally covers this (the SW script re-evaluates from scratch on
    // browser startup), but this is a cheap no-op if already connected
    // (nativeBridgeConnect() returns early when nativePort is set).
    nativeBridgeConnect();
});