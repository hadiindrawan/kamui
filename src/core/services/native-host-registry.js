/**
 * Native host manifest utilities for Beunta native companion app.
 *
 * The native host manifest must be installed at a platform-specific path
 * by the installer (.pkg on macOS, .msi on Windows) so Chrome can discover
 * the native app via NativeMessaging.
 */

export const NATIVE_HOST_NAME = 'com.beunta.native';

/**
 * Generate the native host manifest JSON.
 * This file tells Chrome where to find the native app binary and which
 * extension ID is allowed to communicate with it.
 *
 * @param {string} executablePath - Absolute path to the native app binary
 * @returns {Object} Manifest JSON
 */
export function generateHostManifest(executablePath) {
    return {
        name: NATIVE_HOST_NAME,
        description: 'Beunta native input tracker — streams global cursor position and clicks so auto-zoom works for full-desktop recordings.',
        path: executablePath,
        type: 'stdio',
        allowed_origins: ['chrome-extension://__EXTENSION_ID__/']
    };
}

/**
 * Platform-specific manifest install paths.
 * The installer copies the manifest JSON to one of these locations.
 */
export const MANIFEST_PATHS = {
    darwin: [
        // Per-user (Chrome)
        '~/Library/Application Support/Google/Chrome/NativeMessagingHosts/',
        // Per-user (Chromium)
        '~/Library/Application Support/Chromium/NativeMessagingHosts/',
        // System-wide (requires admin)
        '/Library/Google/Chrome/NativeMessagingHosts/',
    ],
    win32: [
        // Per-user (Chrome)
        '%APPDATA%\\Google\\Chrome\\NativeMessagingHosts\\',
        // Per-user (Chromium)
        '%APPDATA%\\Chromium\\NativeMessagingHosts\\',
        // System-wide (requires admin)
        '%PROGRAMFILES%\\Google\\Chrome\\NativeMessagingHosts\\',
    ],
};

/**
 * Default install paths for the native app binary.
 */
export const BINARY_PATHS = {
    darwin: '/Applications/Beunta Native.app/Contents/MacOS/beunta-native',
    win32: '%LOCALAPPDATA%\\Beunta\\beunta-native.exe',
};
