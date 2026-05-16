// Background service worker for managing recording lifecycle

let recordingState = {
    isRecording: false,
    currentSessionId: null,
    tabId: null
};

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_RECORDING':
            handleStartRecording(message, sender, sendResponse);
            return true; // Required for async response

        case 'STOP_RECORDING':
            handleStopRecording(message, sender, sendResponse);
            return true;

        case 'GET_STATE':
            sendResponse({ state: recordingState });
            break;

        case 'CURSOR_EVENT':
            // Forward cursor events to offscreen document
            forwardToOffscreen(message);
            break;
    }
});

async function handleStartRecording(message, sender, sendResponse) {
    try {
        // Generate session ID
        const sessionId = `rec_${Date.now()}`;

        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Create offscreen document for recording
        await createOffscreenDocument();

        // Start recording in offscreen document
        const response = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_RECORDING',
            sessionId: sessionId,
            tabId: tab.id,
            micEnabled: message.micEnabled || false,
            quality: message.quality || 'best-quality'
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to start recording');
        }

        // Update state only after successful start
        recordingState = {
            isRecording: true,
            currentSessionId: sessionId,
            tabId: tab.id,
            startTime: Date.now() // Track start time for global timer sync
        };

        // 1. Ensure content script is injected into the ACTIVE tab
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['recording-widget.js', 'cursor-tracker.js']
            });
        } catch (e) {
            console.log('[Background] Widget script injection skipped (likely already there):', e.message);
        }

        // 2. Broadcast to ALL tabs to show widget everywhere (for tabs already running the script)
        await broadcastToAllTabs({
            type: 'START_TRACKING',
            sessionId: sessionId,
            startTime: recordingState.startTime
        });

        sendResponse({ success: true, sessionId });
    } catch (error) {
        console.error('Error starting recording:', error);
        // Reset state on failure
        recordingState = {
            isRecording: false,
            currentSessionId: null,
            tabId: null
        };
        sendResponse({ success: false, error: error.message });
    }
}

async function handleStopRecording(message, sender, sendResponse) {
    try {
        if (!recordingState.isRecording) {
            throw new Error('No active recording');
        }

        const sessionId = recordingState.currentSessionId;

        // Notify ALL tabs to stop tracking and hide widgets
        await broadcastToAllTabs({
            type: 'STOP_TRACKING'
        });

        // Stop recording in offscreen with a safety timeout
        // If the offscreen doc is under heavy load (1hr+ recording), it might be slow.
        // We don't want to hang the UI.
        const stopPromise = chrome.runtime.sendMessage({
            type: 'OFFSCREEN_STOP_RECORDING'
        });

        const timeoutPromise = new Promise(r => setTimeout(() => r({ timeout: true }), 3000));
        const result = await Promise.race([stopPromise, timeoutPromise]);

        if (result?.timeout) {
            console.warn('[SW] Offscreen stop timed out, proceeding with fallback ID');
        }

        const recordingId = result?.recordingId || sessionId;

        // Reset state
        recordingState = {
            isRecording: false,
            currentSessionId: null,
            tabId: null
        };

        // Open editor page in new tab
        await chrome.tabs.create({
            url: `src/features/editor/index.html?id=${recordingId}`
        });

        sendResponse({ success: true, sessionId, recordingId });
    } catch (error) {
        console.error('Error stopping recording:', error);
        sendResponse({ success: false, error: error.message });
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
    try {
        await chrome.runtime.sendMessage(message);
    } catch (e) {
        console.error('Error forwarding to offscreen:', e);
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

// Listen for tab updates to ensure widget is there
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && recordingState.isRecording) {
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

// Refresh state when tab becomes active
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (recordingState.isRecording) {
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
});
