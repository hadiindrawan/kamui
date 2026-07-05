/**
 * Type definitions for the NativeMessaging protocol between the Beunta
 * extension and the native input tracker (beunta-native). Documentation
 * only — not enforced at runtime. Must stay in sync with
 * beunta-native/src/config.rs.
 *
 * The native app never captures or encodes video — the browser does that
 * via getDisplayMedia. Its only job is streaming global cursor position and
 * click events while a recording is in progress.
 *
 * @module native-messaging-types
 */

/* ─── Extension → Native App ─── */

/** @typedef {{ type: 'PING' }} PingMsg */
/** @typedef {{ type: 'START_TRACKING', session_id: string }} StartTrackingMsg */
/** @typedef {{ type: 'STOP_TRACKING' }} StopTrackingMsg */

/* ─── Native App → Extension ─── */

/** @typedef {{ type: 'PONG' }} PongMsg */
/** @typedef {{ type: 'TRACKING_STARTED', session_id: string }} TrackingStartedMsg */
/** @typedef {{ type: 'TRACKING_STOPPED', session_id: string }} TrackingStoppedMsg */
/** @typedef {{ type: 'CURSOR_POSITION', x: number, y: number, timestamp_ms: number }} CursorPositionMsg */
/** @typedef {{ type: 'CLICK', x: number, y: number, button: 'left'|'right'|'middle', timestamp_ms: number }} ClickMsg */
/** @typedef {{ type: 'ERROR', code: string, message: string }} ErrorMsg */

/* ─── Constants ─── */

/** Enum of all message types in the NativeMessaging protocol. */
export const MESSAGE_TYPES = {
    // Extension → Native
    PING: 'PING',
    START_TRACKING: 'START_TRACKING',
    STOP_TRACKING: 'STOP_TRACKING',

    // Native → Extension
    PONG: 'PONG',
    TRACKING_STARTED: 'TRACKING_STARTED',
    TRACKING_STOPPED: 'TRACKING_STOPPED',
    CURSOR_POSITION: 'CURSOR_POSITION',
    CLICK: 'CLICK',
    ERROR: 'ERROR',
};