// Robust FFmpeg-based WebM to MP4 converter
// Handles video conversion with progress tracking and error handling

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Singleton FFmpeg instance for reuse
let ffmpegInstance = null;
let isFFmpegLoaded = false;

/**
 * Initialize FFmpeg instance
 * @param {Function} onProgress - Progress callback for FFmpeg loading
 * @returns {Promise<FFmpeg>}
 */
export async function initFFmpeg(onProgress) {
    if (ffmpegInstance && isFFmpegLoaded) {
        return ffmpegInstance;
    }

    if (!ffmpegInstance) {
        ffmpegInstance = new FFmpeg();

        // Set up logging for debugging
        ffmpegInstance.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });

        // Set up progress tracking
        if (onProgress) {
            ffmpegInstance.on('progress', ({ progress, time }) => {
                onProgress({
                    type: 'encode',
                    progress: Math.round(progress * 100),
                    time
                });
            });
        }
    }

    if (!isFFmpegLoaded) {
        try {
            // Use locally bundled FFmpeg files from extension
            const baseURL = chrome.runtime.getURL('ffmpeg');

            onProgress?.({ type: 'load', progress: 0, message: 'Loading FFmpeg core...' });

            console.log('[FFmpeg] Base URL:', baseURL);

            // Construct URLs for local files
            const coreURL = `${baseURL}/ffmpeg-core.js`;
            const wasmURL = `${baseURL}/ffmpeg-core.wasm`;

            console.log('[FFmpeg] Core URL:', coreURL);
            console.log('[FFmpeg] WASM URL:', wasmURL);

            onProgress?.({ type: 'load', progress: 30, message: 'Loading WASM module...' });

            // Try to verify the files exist
            try {
                const testFetch = await fetch(coreURL);
                if (!testFetch.ok) {
                    throw new Error(`Cannot access ffmpeg-core.js: ${testFetch.status}`);
                }
                console.log('[FFmpeg] Core file accessible');
            } catch (error) {
                console.error('[FFmpeg] File access error:', error);
                throw new Error(`FFmpeg files not accessible. Make sure they are bundled correctly. ${error.message}`);
            }

            onProgress?.({ type: 'load', progress: 60, message: 'Initializing FFmpeg...' });

            // Load FFmpeg with local files
            await ffmpegInstance.load({
                coreURL,
                wasmURL,
            });

            isFFmpegLoaded = true;
            onProgress?.({ type: 'load', progress: 100, message: 'FFmpeg ready!' });

            console.log('[FFmpeg] Successfully loaded');
        } catch (error) {
            console.error('[FFmpeg] Load error:', error);
            console.error('[FFmpeg] Error stack:', error.stack);
            ffmpegInstance = null;
            isFFmpegLoaded = false;

            // Provide more helpful error message
            const errorMsg = error.message || 'Unknown error';
            throw new Error(`Failed to load FFmpeg: ${errorMsg}\n\nPlease ensure:\n1. FFmpeg files are in dist/ffmpeg/\n2. Extension was reloaded after build\n3. Check browser console for details`);
        }
    }

    return ffmpegInstance;
}

/**
 * Convert WebM to MP4 with quality settings
 * @param {Blob} webmBlob - Input WebM blob
 * @param {Object} options - Conversion options
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Blob>}
 */
export async function convertWebMToMP4(webmBlob, options = {}, onProgress) {
    const {
        quality = 'high', // high, medium, low
        bitrate = null,    // Custom bitrate (e.g., '5M', '2M')
        fps = null,        // Target FPS
        audioCodec = 'aac', // Audio codec (aac, mp3, etc.)
        videoCodec = 'libx264', // Video codec
        preset = 'medium',   // x264 preset: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
        crf = null          // Constant Rate Factor (0-51, lower = better quality)
    } = options;

    try {
        // Initialize FFmpeg
        onProgress?.({ type: 'init', progress: 0, message: 'Initializing converter...' });
        const ffmpeg = await initFFmpeg((loadProgress) => {
            if (loadProgress.type === 'load') {
                onProgress?.({
                    type: 'init',
                    progress: Math.round(loadProgress.progress / 2),
                    message: loadProgress.message
                });
            }
        });

        onProgress?.({ type: 'prepare', progress: 50, message: 'Preparing video file...' });

        // Write input file to FFmpeg virtual filesystem
        const inputFileName = 'input.webm';
        const outputFileName = 'output.mp4';

        const webmData = await fetchFile(webmBlob);
        await ffmpeg.writeFile(inputFileName, webmData);

        onProgress?.({ type: 'prepare', progress: 60, message: 'Starting conversion...' });

        // Build FFmpeg command based on quality settings
        const ffmpegArgs = buildFFmpegArgs({
            inputFileName,
            outputFileName,
            quality,
            bitrate,
            fps,
            audioCodec,
            videoCodec,
            preset,
            crf
        });

        console.log('[FFmpeg] Command:', ffmpegArgs.join(' '));

        // Execute conversion
        onProgress?.({ type: 'convert', progress: 0, message: 'Converting to MP4...' });

        let conversionProgress = 0;
        ffmpegInstance.on('progress', ({ progress }) => {
            conversionProgress = Math.round(progress * 100);
            onProgress?.({
                type: 'convert',
                progress: conversionProgress,
                message: `Converting... ${conversionProgress}%`
            });
        });

        await ffmpeg.exec(ffmpegArgs);

        onProgress?.({ type: 'finalize', progress: 90, message: 'Reading output file...' });

        // Read output file
        const mp4Data = await ffmpeg.readFile(outputFileName);
        const mp4Blob = new Blob([mp4Data.buffer], { type: 'video/mp4' });

        // Cleanup
        await ffmpeg.deleteFile(inputFileName);
        await ffmpeg.deleteFile(outputFileName);

        onProgress?.({ type: 'complete', progress: 100, message: 'Conversion complete!' });

        return mp4Blob;

    } catch (error) {
        console.error('[FFmpeg] Conversion error:', error);
        throw new Error(`Conversion failed: ${error.message}`);
    }
}

/**
 * Build FFmpeg arguments based on quality settings
 */
function buildFFmpegArgs(options) {
    const {
        inputFileName,
        outputFileName,
        quality,
        bitrate,
        fps,
        audioCodec,
        videoCodec,
        preset,
        crf
    } = options;

    const args = [
        '-i', inputFileName,
        '-c:v', videoCodec
    ];

    // Quality presets
    const qualityPresets = {
        high: { crf: 18, audioBitrate: '192k', preset: 'slow' },
        medium: { crf: 23, audioBitrate: '128k', preset: 'medium' },
        low: { crf: 28, audioBitrate: '96k', preset: 'fast' }
    };

    const selectedPreset = qualityPresets[quality] || qualityPresets.medium;

    // Video encoding settings
    if (crf !== null) {
        args.push('-crf', String(crf));
    } else {
        args.push('-crf', String(selectedPreset.crf));
    }

    args.push('-preset', preset || selectedPreset.preset);

    // Bitrate (if specified, overrides CRF)
    if (bitrate) {
        args.push('-b:v', bitrate);
    }

    // FPS
    if (fps) {
        args.push('-r', String(fps));
    }

    // Pixel format for compatibility
    args.push('-pix_fmt', 'yuv420p');

    // Audio encoding
    args.push('-c:a', audioCodec);

    if (!bitrate) {
        args.push('-b:a', selectedPreset.audioBitrate);
    }

    // Optimize for web streaming
    args.push('-movflags', '+faststart');

    // Output file
    args.push(outputFileName);

    return args;
}

/**
 * Get video metadata using FFprobe
 * @param {Blob} videoBlob
 * @returns {Promise<Object>}
 */
export async function getVideoMetadata(videoBlob) {
    try {
        const ffmpeg = await initFFmpeg();

        const fileName = 'probe_input.webm';
        const videoData = await fetchFile(videoBlob);
        await ffmpeg.writeFile(fileName, videoData);

        // Use FFprobe to get metadata
        const probeArgs = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', fileName];
        await ffmpeg.exec(probeArgs);

        // Read the output (FFmpeg writes to stdout, which we can capture via logs)
        // For now, we'll use basic video element metadata as fallback
        await ffmpeg.deleteFile(fileName);

        // Create a temporary video element to extract metadata
        const video = document.createElement('video');
        const url = URL.createObjectURL(videoBlob);
        video.src = url;

        return new Promise((resolve, reject) => {
            video.onloadedmetadata = () => {
                const metadata = {
                    duration: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight,
                    hasAudio: video.mozHasAudio !== false,
                    size: videoBlob.size
                };
                URL.revokeObjectURL(url);
                resolve(metadata);
            };
            video.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load video metadata'));
            };
        });
    } catch (error) {
        console.error('[FFmpeg] Metadata error:', error);
        throw error;
    }
}

/**
 * Terminate FFmpeg instance and free resources
 */
export function terminateFFmpeg() {
    if (ffmpegInstance) {
        ffmpegInstance.terminate();
        ffmpegInstance = null;
        isFFmpegLoaded = false;
        console.log('[FFmpeg] Terminated');
    }
}

/**
 * Check if FFmpeg is loaded and ready
 * @returns {boolean}
 */
export function isFFmpegReady() {
    return isFFmpegLoaded && ffmpegInstance !== null;
}
