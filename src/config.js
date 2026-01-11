/**
 * Configuration for Beunta Frontend Application
 */

export const config = {
    // Backend API configuration
    backend: {
        // Backend URL - can be overridden by environment variable
        url: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',

        // Polling interval for status checks (milliseconds)
        pollingInterval: 2000,

        // Maximum retry attempts for failed requests
        maxRetries: 3,

        // Request timeout (milliseconds) - 5 minutes
        timeout: 300000,

        // Health check endpoint
        healthEndpoint: '/health'
    },

    // Video export settings
    export: {
        // Default quality preset
        defaultQuality: 'medium',

        // Whether to enable backend conversion
        useBackendConversion: true,

        // Fallback to WebM if backend fails
        fallbackToWebM: true
    }
};

/**
 * Get backend API URL
 */
export function getBackendURL() {
    return config.backend.url;
}

/**
 * Check if backend conversion is enabled
 */
export function isBackendConversionEnabled() {
    return config.export.useBackendConversion;
}
