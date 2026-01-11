// Content script for tracking cursor movements and events
// Inspired by Cursorful.com architecture

(function () {
    'use strict';

    let isTracking = false;
    let sessionId = null;
    let startTime = null;
    let events = [];

    // Throttled cursor tracking using requestAnimationFrame
    let rafId = null;
    let lastMousePosition = { x: 0, y: 0 };
    let lastKeyPressTime = 0;
    let keyPressCount = 0;
    let lastSelectionTime = 0;

    // Smart zoom detection - cluster analysis
    let recentClicks = []; // Track clicks in the last 3 seconds
    const CLICK_CLUSTER_THRESHOLD = 3000; // 3 seconds
    const MIN_CLICKS_FOR_ZOOM = 2; // Need at least 2 clicks to trigger zoom

    // Follow-cursor mode
    let followCursorEnabled = true;
    let lastFollowTime = 0;
    const FOLLOW_THROTTLE = 100; // Follow cursor every 100ms

    // Helper: Normalize coordinates to percentages (0-1)
    function normalizeCoordinates(x, y, viewportWidth, viewportHeight) {
        return {
            x: x / viewportWidth,
            y: y / viewportHeight,
            // Also store absolute values for backward compatibility
            absX: x,
            absY: y,
            viewportWidth,
            viewportHeight
        };
    }

    function onMouseMove(e) {
        lastMousePosition = { x: e.clientX, y: e.clientY };

        if (!rafId && isTracking) {
            rafId = requestAnimationFrame(recordMousePosition);
        }
    }

    function recordMousePosition() {
        if (!isTracking) {
            rafId = null;
            return;
        }

        const now = Date.now();
        const coords = normalizeCoordinates(
            lastMousePosition.x,
            lastMousePosition.y,
            window.innerWidth,
            window.innerHeight
        );

        const event = {
            type: 'move',
            time: now - startTime,
            ...coords
        };

        events.push(event);

        // Send event to background (batching could be added for performance)
        chrome.runtime.sendMessage({
            type: 'CURSOR_EVENT',
            sessionId: sessionId,
            event: event
        });

        // Follow-cursor mode: Create smooth follow events
        if (followCursorEnabled && now - lastFollowTime > FOLLOW_THROTTLE) {
            const followEvent = {
                type: 'follow',
                time: now - startTime,
                ...coords
            };
            events.push(followEvent);
            lastFollowTime = now;
        }

        rafId = requestAnimationFrame(recordMousePosition);
    }

    function onClick(e) {
        if (!isTracking) return;

        const now = Date.now();
        const coords = normalizeCoordinates(
            e.clientX,
            e.clientY,
            window.innerWidth,
            window.innerHeight
        );

        // Add to recent clicks for cluster detection
        recentClicks.push({ time: now, x: coords.x, y: coords.y });

        // Remove clicks older than threshold
        recentClicks = recentClicks.filter(click =>
            now - click.time < CLICK_CLUSTER_THRESHOLD
        );

        // Detect if this is a "focus moment" worthy of auto-zoom
        const shouldAutoZoom = detectFocusMoment(e, coords, now);

        const event = {
            type: shouldAutoZoom ? 'click' : 'click-minor', // Major vs minor clicks
            time: now - startTime,
            ...coords,
            target: e.target.tagName,
            button: e.button,
            isInCluster: recentClicks.length >= MIN_CLICKS_FOR_ZOOM,
            clusterSize: recentClicks.length,
            // Focus context
            isInputFocus: e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA',
            isContentEditable: e.target.isContentEditable || false
        };

        events.push(event);

        chrome.runtime.sendMessage({
            type: 'CURSOR_EVENT',
            sessionId: sessionId,
            event: event
        });
    }

    // Smart heuristic: Detect if this is a meaningful interaction
    function detectFocusMoment(e, coords, now) {
        // Rule 1: Click on input/textarea = always zoom
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return true;
        }

        // Rule 2: Click on contentEditable = always zoom
        if (e.target.isContentEditable) {
            return true;
        }

        // Rule 3: Click on button/link = zoom
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') {
            return true;
        }

        // Rule 4: Part of a click cluster (rapid clicks in same area)
        if (recentClicks.length >= MIN_CLICKS_FOR_ZOOM) {
            // Check if clicks are clustered spatially (within 20% of viewport)
            const avgX = recentClicks.reduce((sum, c) => sum + c.x, 0) / recentClicks.length;
            const avgY = recentClicks.reduce((sum, c) => sum + c.y, 0) / recentClicks.length;
            const distance = Math.sqrt(Math.pow(coords.x - avgX, 2) + Math.pow(coords.y - avgY, 2));

            if (distance < 0.2) { // Within 20% of viewport
                return true;
            }
        }

        // Rule 5: Single clicks on generic elements = no zoom (reduces noise)
        return false;
    }

    function onDoubleClick(e) {
        if (!isTracking) return;

        const coords = normalizeCoordinates(
            e.clientX,
            e.clientY,
            window.innerWidth,
            window.innerHeight
        );

        const event = {
            type: 'dblclick',
            time: Date.now() - startTime,
            ...coords,
            target: e.target.tagName
        };

        events.push(event);

        chrome.runtime.sendMessage({
            type: 'CURSOR_EVENT',
            sessionId: sessionId,
            event: event
        });
    }

    function onKeyPress(e) {
        if (!isTracking) return;

        const now = Date.now();
        const timeSinceLastKey = now - lastKeyPressTime;

        // Throttle: only record typing events every 500ms (group keypresses)
        if (timeSinceLastKey < 500) {
            keyPressCount++;
            return;
        }

        // Reset counter and record event
        keyPressCount = 1;
        lastKeyPressTime = now;

        // Get cursor position from active element
        const activeElement = document.activeElement;
        let x = lastMousePosition.x;
        let y = lastMousePosition.y;

        if (activeElement && (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable)) {
            const rect = activeElement.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }

        const coords = normalizeCoordinates(x, y, window.innerWidth, window.innerHeight);

        const event = {
            type: 'typing',
            time: now - startTime,
            ...coords,
            key: e.key,
            isInputFocus: true
        };

        events.push(event);

        chrome.runtime.sendMessage({
            type: 'CURSOR_EVENT',
            sessionId: sessionId,
            event: event
        });
    }

    function onTextSelection(e) {
        if (!isTracking) return;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.toString().length < 3) {
            return; // No meaningful selection
        }

        const now = Date.now();
        const timeSinceLastSelection = now - lastSelectionTime;

        // Throttle: only record selection events every 800ms
        if (timeSinceLastSelection < 800) {
            return;
        }

        lastSelectionTime = now;

        // Get selection position
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const coords = normalizeCoordinates(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            window.innerWidth,
            window.innerHeight
        );

        const event = {
            type: 'selection',
            time: now - startTime,
            ...coords,
            textLength: selection.toString().length
        };

        events.push(event);

        chrome.runtime.sendMessage({
            type: 'CURSOR_EVENT',
            sessionId: sessionId,
            event: event
        });
    }

    function onFocus(e) {
        if (!isTracking) return;

        // Only track focus on input elements
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            const rect = e.target.getBoundingClientRect();
            const coords = normalizeCoordinates(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
                window.innerWidth,
                window.innerHeight
            );

            const event = {
                type: 'focus',
                time: Date.now() - startTime,
                ...coords,
                target: e.target.tagName,
                inputType: e.target.type
            };

            events.push(event);

            chrome.runtime.sendMessage({
                type: 'CURSOR_EVENT',
                sessionId: sessionId,
                event: event
            });
        }
    }

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'START_TRACKING') {
            startTracking(message.sessionId);
            sendResponse({ success: true });
        } else if (message.type === 'STOP_TRACKING') {
            stopTracking();
            sendResponse({ success: true, eventCount: events.length });
        }
    });

    function startTracking(sid) {
        sessionId = sid;
        isTracking = true;
        startTime = Date.now();
        events = [];
        recentClicks = []; // Reset click cluster tracking
        lastFollowTime = 0;

        // Add event listeners
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('click', onClick, true);
        document.addEventListener('dblclick', onDoubleClick, true);
        document.addEventListener('focusin', onFocus, true);
        document.addEventListener('keydown', onKeyPress, true);
        document.addEventListener('selectionchange', onTextSelection, true);

        // Start RAF loop
        rafId = requestAnimationFrame(recordMousePosition);

        // Show recording widget
        if (window.recordingWidget) {
            window.recordingWidget.show();
        } else if (typeof RecordingWidget !== 'undefined') {
            window.recordingWidget = new RecordingWidget();
            window.recordingWidget.show();
        }
    }

    function stopTracking() {
        isTracking = false;

        // Remove event listeners
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('dblclick', onDoubleClick, true);
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('keydown', onKeyPress, true);
        document.removeEventListener('selectionchange', onTextSelection, true);

        // Cancel RAF
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        // Send final batch of events
        chrome.runtime.sendMessage({
            type: 'TRACKING_COMPLETE',
            sessionId: sessionId,
            events: events
        });

        // Reset
        sessionId = null;
        startTime = null;
        events = [];

        // Hide recording widget
        if (window.recordingWidget) {
            window.recordingWidget.stop();
        }
    }

})(); // End IIFE
