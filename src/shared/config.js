/**
 * Configuration for Beunta Frontend Application
 */

export const config = {
    // Backend API configuration
    backend: {
        url: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
        pollingInterval: 2000,
        maxRetries: 3,
        timeout: 300000,
        healthEndpoint: '/health'
    },

    // Video export settings
    export: {
        defaultQuality: 'medium',
        useBackendConversion: true,
        fallbackToWebM: true
    },

    // Native input tracker (cursor/click streaming, not recording) configuration
    native: {
        // Native host name registered in the manifest
        hostName: 'com.beunta.native',

        // Connection settings
        connectTimeout: 5000,
        reconnectAttempts: 3,
        reconnectDelay: 2000,
    }
};

export function getBackendURL() {
    return config.backend.url;
}

export function isBackendConversionEnabled() {
    return config.export.useBackendConversion;
}

export function getNativeConfig() {
    return config.native;
}