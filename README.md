# Cursorful Clone - Quick Start Guide

## 🚀 Load Extension in Chrome

### Step 1: Open Extensions Page
```
chrome://extensions/
```

### Step 2: Enable Developer Mode
Toggle the switch in the top-right corner

### Step 3: Load Unpacked Extension
1. Click "Load unpacked"
2. Navigate to: `/Users/hadi/Documents/Hadi/Research/garaga-record/dist`
3. Click "Select"

## 🎥 Test Recording

1. **Click extension icon** (purple camera)
2. **Click "Start Recording"**
3. **Select what to share** (entire screen/window/tab)
4. **Perform actions** (move cursor, click things)
5. **Click extension icon** → "Stop Recording"
6. **Click ✏️ icon** on recording to open editor
7. **Press ▶️** to see zoom effects on your clicks
8. **Click "Export Video"** to download

## 🐛 Troubleshooting

### Extension doesn't load
- Check that you selected the `dist/` folder (not root)
- Make sure `npm run build` completed successfully

### No zoom effects
- Verify clicks were recorded (check event count in popup)
- Try clicking more deliberately (not too fast)
- Check browser console for errors

### Audio not recording
- Grant microphone permission when prompted
- Select "Share tab audio" checkbox in Chrome's picker

### Export fails
- Don't close tab during export
- Check disk space
- Try shorter recordings first

## 📝 Development Commands

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Watch mode (auto-rebuild)
npm run dev

# After changes, reload extension in chrome://extensions/
```

## 🎯 Key Files

- **Popup**: `dist/popup.html` 
- **Editor**: `dist/editor.html`
- **Service Worker**: `dist/service-worker.js`
- **Manifest**: `dist/manifest.json`

## 💡 Tips

1. Record at least 5-10 seconds with 3-4 clicks to see zoom effects
2. Zoom starts 200ms *before* each click and lasts 800ms after
3. Exported videos are WebM format (VP9 codec)
4. IndexedDB stores videos locally (check Storage in DevTools)

---

For detailed documentation, see [walkthrough.md](file:///Users/hadi/.gemini/antigravity/brain/b8506fc1-a8fe-442e-bd3e-76a7528ed64e/walkthrough.md)
