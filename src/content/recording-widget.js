// Floating recording widget that appears during recording
// Shows elapsed time and stop button

class RecordingWidget {
    constructor() {
        this.container = null;
        this.startTime = null;
        this.timerInterval = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }

    create() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'garaga-recording-widget';
        this.container.className = 'garaga-widget';

        // Set initial position (bottom-right corner)
        this.container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        // Widget HTML
        this.container.innerHTML = `
            <div class="garaga-widget-inner">
                <div class="garaga-widget-header">
                    <div class="garaga-recording-indicator">
                        <div class="garaga-pulse"></div>
                        <span class="garaga-rec-text">REC</span>
                    </div>
                    <div class="garaga-timer">00:00</div>
                </div>
                <button class="garaga-stop-btn" title="Stop Recording">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="6" y="6" width="12" height="12" />
                    </svg>
                    <span>Stop</span>
                </button>
            </div>
        `;

        // Add styles
        this.injectStyles();

        // Add event listeners
        this.setupDragging();
        this.setupStopButton();

        // Append to body
        document.body.appendChild(this.container);
    }

    injectStyles() {
        if (document.getElementById('garaga-widget-styles')) return;

        const style = document.createElement('style');
        style.id = 'garaga-widget-styles';
        style.textContent = `
            .garaga-widget {
                cursor: move;
                user-select: none;
                -webkit-user-select: none;
            }

            .garaga-widget-inner {
                background: rgba(35, 61, 77, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                padding: 12px 16px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                min-width: 200px;
                transition: all 0.2s ease;
            }

            .garaga-widget:hover .garaga-widget-inner {
                background: rgba(35, 61, 77, 1);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
            }

            .garaga-widget-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                gap: 12px;
            }

            .garaga-recording-indicator {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .garaga-pulse {
                width: 8px;
                height: 8px;
                background: #ff3b3b;
                border-radius: 50%;
                animation: garaga-pulse 1.5s ease-in-out infinite;
            }

            @keyframes garaga-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.6; transform: scale(1.2); }
            }

            .garaga-rec-text {
                color: #ff3b3b;
                font-weight: 600;
                font-size: 12px;
                letter-spacing: 0.5px;
            }

            .garaga-timer {
                font-family: 'SF Mono', 'Consolas', monospace;
                font-size: 16px;
                font-weight: 600;
                color: white;
                letter-spacing: 1px;
            }

            .garaga-stop-btn {
                width: 100%;
                padding: 10px 16px;
                background: #fe6d73;
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.2s ease;
            }

            .garaga-stop-btn:hover {
                background: #ff8589;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(254, 109, 115, 0.3);
            }

            .garaga-stop-btn:active {
                transform: translateY(0);
            }

            .garaga-widget.dragging {
                cursor: grabbing !important;
            }

            .garaga-widget.dragging .garaga-widget-inner {
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
            }
        `;
        document.head.appendChild(style);
    }

    setupDragging() {
        const header = this.container.querySelector('.garaga-widget-header');

        header.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.container.classList.add('dragging');

            const rect = this.container.getBoundingClientRect();
            this.dragOffset = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;

            // Keep within viewport bounds
            const maxX = window.innerWidth - this.container.offsetWidth;
            const maxY = window.innerHeight - this.container.offsetHeight;

            this.container.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            this.container.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.container.classList.remove('dragging');
            }
        });
    }

    setupStopButton() {
        const stopBtn = this.container.querySelector('.garaga-stop-btn');
        stopBtn.addEventListener('click', () => {
            this.stop();
            // Send message to background to stop recording
            chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        });
    }

    start() {
        this.startTime = Date.now();
        this.updateTimer();
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    updateTimer() {
        if (!this.startTime) return;

        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;

        const timerEl = this.container.querySelector('.garaga-timer');
        if (timerEl) {
            timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }

    stop() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.hide();
    }

    hide() {
        if (this.container && this.container.parentNode) {
            this.container.remove();
        }
    }

    show() {
        if (!this.container) {
            this.create();
        }
        this.start();
    }
}

// Export singleton instance
window.recordingWidget = new RecordingWidget();
