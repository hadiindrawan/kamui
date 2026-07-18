/**
 * Region selector — a macOS-screenshot-style overlay injected on demand (via
 * chrome.scripting.executeScript) before recording starts. The user draws /
 * resizes a rectangle; on confirm we report it to the service worker in
 * viewport-normalized coordinates plus the window geometry needed to map it
 * onto the captured frame. Vanilla + self-contained like recording-widget.js.
 */
(() => {
    // Guard against double-injection.
    if (window.__kamuiRegionSelectorActive) return;
    window.__kamuiRegionSelectorActive = true;

    const ACCENT = '#5e6ad2';
    const overlay = document.createElement('div');
    overlay.setAttribute('data-kamui-region', '');
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', cursor: 'crosshair',
        background: 'rgba(0,0,0,0.35)', userSelect: 'none',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        position: 'fixed', border: `2px solid ${ACCENT}`,
        boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)', display: 'none',
        boxSizing: 'border-box', cursor: 'move',
    });

    const hint = document.createElement('div');
    Object.assign(hint.style, {
        position: 'fixed', left: '50%', top: '24px', transform: 'translateX(-50%)',
        padding: '8px 14px', background: 'rgba(16,16,20,0.92)', color: '#fff',
        font: '500 13px -apple-system,system-ui,sans-serif', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)', zIndex: '2147483647', pointerEvents: 'none',
    });
    hint.textContent = 'Drag to select an area to record · Enter to start · Esc to cancel';

    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hint);

    let rect = null;          // { x, y, w, h } in viewport px
    let dragStart = null;     // drawing a new rect
    let moveStart = null;     // repositioning an existing rect

    const applyBox = () => {
        if (!rect) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        box.style.left = `${rect.x}px`;
        box.style.top = `${rect.y}px`;
        box.style.width = `${rect.w}px`;
        box.style.height = `${rect.h}px`;
    };

    const cleanup = () => {
        window.__kamuiRegionSelectorActive = false;
        overlay.remove();
        hint.remove();
        window.removeEventListener('keydown', onKey, true);
    };

    const confirm = () => {
        if (!rect || rect.w < 8 || rect.h < 8) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        chrome.runtime.sendMessage({
            type: 'REGION_SELECTED',
            // Normalized to the page viewport (== the tab-captured frame).
            rect: { x: rect.x / vw, y: rect.y / vh, w: rect.w / vw, h: rect.h / vh },
            viewport: { w: vw, h: vh },
            // Geometry for mapping onto a monitor/window capture (best-effort).
            screen: {
                screenX: window.screenX, screenY: window.screenY,
                outerW: window.outerWidth, outerH: window.outerHeight,
                innerW: vw, innerH: vh, dpr: window.devicePixelRatio || 1,
            },
        }).catch(() => {});
        cleanup();
    };

    const cancel = () => {
        chrome.runtime.sendMessage({ type: 'REGION_CANCELLED' }).catch(() => {});
        cleanup();
    };

    overlay.addEventListener('mousedown', (e) => {
        if (rect && e.target === box) {
            moveStart = { mx: e.clientX, my: e.clientY, rx: rect.x, ry: rect.y };
        } else {
            dragStart = { x: e.clientX, y: e.clientY };
            rect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
            applyBox();
        }
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (dragStart) {
            const x = Math.min(dragStart.x, e.clientX);
            const y = Math.min(dragStart.y, e.clientY);
            rect = { x, y, w: Math.abs(e.clientX - dragStart.x), h: Math.abs(e.clientY - dragStart.y) };
            applyBox();
        } else if (moveStart) {
            rect.x = Math.max(0, Math.min(window.innerWidth - rect.w, moveStart.rx + (e.clientX - moveStart.mx)));
            rect.y = Math.max(0, Math.min(window.innerHeight - rect.h, moveStart.ry + (e.clientY - moveStart.my)));
            applyBox();
        }
    }, true);

    window.addEventListener('mouseup', () => { dragStart = null; moveStart = null; }, true);

    function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirm(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    }
    window.addEventListener('keydown', onKey, true);

    // Double-click inside the box also confirms.
    box.addEventListener('dblclick', (e) => { e.preventDefault(); confirm(); });
})();
