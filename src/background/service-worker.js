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

        // Update state
        recordingState = {
            isRecording: true,
            currentSessionId: sessionId,
            tabId: tab.id
        };

        // Start recording in offscreen document
        await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_RECORDING',
            sessionId: sessionId,
            tabId: tab.id,
            micEnabled: message.micEnabled || false
        });

        // Inject content script if not already injected
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['recording-widget.js', 'cursor-tracker.js']
            });
        } catch (e) {
            console.log('Content script already injected or cannot inject');
        }

        // Notify content script to start tracking
        await chrome.tabs.sendMessage(tab.id, {
            type: 'START_TRACKING',
            sessionId: sessionId
        });

        sendResponse({ success: true, sessionId });
    } catch (error) {
        console.error('Error starting recording:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleStopRecording(message, sender, sendResponse) {
    try {
        if (!recordingState.isRecording) {
            throw new Error('No active recording');
        }

        const sessionId = recordingState.currentSessionId;

        // Stop tracking in content script
        if (recordingState.tabId) {
            try {
                await chrome.tabs.sendMessage(recordingState.tabId, {
                    type: 'STOP_TRACKING'
                });
            } catch (e) {
                console.log('Could not notify content script');
            }
        }

        // Stop recording in offscreen
        const result = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_STOP_RECORDING'
        });

        const recordingId = result?.recordingId || sessionId;

        // Reset state
        recordingState = {
            isRecording: false,
            currentSessionId: null,
            tabId: null
        };

        // Open editor page in new tab
        await chrome.tabs.create({
            url: `src/editor/index.html?id=${recordingId}`
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
        url: 'src/offscreen/index.html',
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

// Clean up on extension startup
chrome.runtime.onStartup.addListener(() => {
    recordingState = {
        isRecording: false,
        currentSessionId: null,
        tabId: null
    };
});
