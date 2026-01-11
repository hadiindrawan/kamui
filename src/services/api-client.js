/**
 * API Client for Beunta Backend
 * Handles communication with the video conversion backend service
 */

import { config } from '../config.js';

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
    constructor(message, statusCode, details = {}) {
        super(message);
        this.name = 'APIError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

/**
 * Conversion API Client
 */
export class ConversionAPI {
    constructor(baseURL = null) {
        this.baseURL = baseURL || config.backend.url;
        this.timeout = config.backend.timeout;
    }

    /**
     * Check if backend is available
     * @returns {Promise<boolean>}
     */
    async checkHealth() {
        try {
            const response = await this.fetchWithTimeout(
                `${this.baseURL}${config.backend.healthEndpoint}`,
                { method: 'GET' },
                5000 // 5 second timeout for health check
            );

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return data.status === 'healthy';
        } catch (error) {
            console.error('[API] Health check failed:', error);
            return false;
        }
    }

    /**
     * Upload video and start conversion
     * @param {Blob} webmBlob - WebM video blob
     * @param {string} quality - Quality preset (high, medium, low)
     * @param {number} scale - Resolution scale multiplier (1, 2, 3, or 4)
     * @returns {Promise<Object>} - Task details
     */
    async uploadAndConvert(webmBlob, quality = 'medium', scale = 1) {
        const formData = new FormData();
        formData.append('file', webmBlob, `recording_${Date.now()}.webm`);
        formData.append('quality', quality);
        formData.append('scale', scale.toString());

        console.log('[API] Uploading video for conversion...', {
            size: webmBlob.size,
            quality,
            scale: `${scale}x`
        });

        const response = await this.fetchWithTimeout(
            `${this.baseURL}/api/v1/conversions`,
            {
                method: 'POST',
                body: formData
            },
            this.timeout
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new APIError(
                error.message || 'Failed to upload video',
                response.status,
                error.details
            );
        }

        const data = await response.json();
        console.log('[API] Upload successful, task ID:', data.id);
        return data;
    }

    /**
     * Get conversion task status
     * @param {string} taskId - Task ID
     * @returns {Promise<Object>} - Task status
     */
    async getStatus(taskId) {
        const response = await this.fetchWithTimeout(
            `${this.baseURL}/api/v1/conversions/${taskId}`,
            { method: 'GET' },
            10000 // 10 second timeout for status check
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new APIError(
                error.message || 'Failed to get task status',
                response.status,
                error.details
            );
        }

        return await response.json();
    }

    /**
     * Download converted video
     * @param {string} taskId - Task ID
     * @returns {Promise<Blob>} - MP4 video blob
     */
    async downloadConvertedVideo(taskId) {
        console.log('[API] Downloading converted video...');

        const response = await this.fetchWithTimeout(
            `${this.baseURL}/api/v1/conversions/${taskId}/download`,
            { method: 'GET' },
            this.timeout
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new APIError(
                error.message || 'Failed to download converted video',
                response.status,
                error.details
            );
        }

        const blob = await response.blob();
        console.log('[API] Download complete, size:', blob.size);
        return blob;
    }

    /**
     * Cancel a conversion task
     * @param {string} taskId - Task ID
     * @returns {Promise<Object>} - Updated task
     */
    async cancelConversion(taskId) {
        const response = await this.fetchWithTimeout(
            `${this.baseURL}/api/v1/conversions/${taskId}/cancel`,
            { method: 'POST' },
            10000
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new APIError(
                error.message || 'Failed to cancel conversion',
                response.status,
                error.details
            );
        }

        return await response.json();
    }

    /**
     * Delete a conversion task
     * @param {string} taskId - Task ID
     * @returns {Promise<void>}
     */
    async deleteTask(taskId) {
        const response = await this.fetchWithTimeout(
            `${this.baseURL}/api/v1/conversions/${taskId}`,
            { method: 'DELETE' },
            10000
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new APIError(
                error.message || 'Failed to delete task',
                response.status,
                error.details
            );
        }
    }

    /**
     * Poll for task completion
     * @param {string} taskId - Task ID
     * @param {Function} onProgress - Progress callback (receives status object)
     * @param {number} interval - Polling interval in ms
     * @returns {Promise<Object>} - Final task status
     */
    async pollUntilComplete(taskId, onProgress = null, interval = null) {
        const pollInterval = interval || config.backend.pollingInterval;

        while (true) {
            const status = await this.getStatus(taskId);

            // Call progress callback
            if (onProgress) {
                onProgress(status);
            }

            // Check if finished
            if (status.status === 'completed') {
                console.log('[API] Conversion completed successfully');
                return status;
            }

            if (status.status === 'failed') {
                throw new APIError(
                    status.error_message || 'Conversion failed',
                    422,
                    { taskId, status: status.status }
                );
            }

            if (status.status === 'cancelled') {
                throw new APIError(
                    'Conversion was cancelled',
                    422,
                    { taskId, status: status.status }
                );
            }

            // Wait before next poll
            await this.sleep(pollInterval);
        }
    }

    /**
     * Fetch with timeout
     * @private
     */
    async fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new APIError('Request timeout', 408, { url, timeout });
            }
            throw new APIError(
                `Network error: ${error.message}`,
                0,
                { url, originalError: error.message }
            );
        }
    }

    /**
     * Sleep utility
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
export const conversionAPI = new ConversionAPI();
