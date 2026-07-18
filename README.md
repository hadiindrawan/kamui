# Kamui - Quick Start Guide

## 🚀 Load Extension in Chrome

### Step 1: Install dependencies and build
```bash
npm install
npm run build
```

### Step 2: Open Extensions Page
```
chrome://extensions/
```

### Step 3: Enable Developer Mode
Toggle the switch in the top-right corner

### Step 4: Load Unpacked Extension
1. Click "Load unpacked"
2. Navigate to this repo's `dist/` folder
3. Click "Select"

## 🎥 Test Recording (Browser mode)

1. **Click the extension icon**
2. **Click "Start Recording"**
3. **Select what to share** (entire screen/window/tab)
4. **Perform actions** (move cursor, click things)
5. **Click the extension icon** → "Stop Recording"
6. **Click ✏️ icon** on the recording to open the editor
7. **Press ▶️** to see zoom effects on your clicks
8. **Click "Export Video"** to download

## 🖥️ Native Companion (Precision Cursor mode)

Browser mode only tracks cursor/clicks *inside* the shared tab or window. For full-desktop recordings, the **Precision Cursor** mode uses a small native companion app (`kamui-native`, a sibling Rust project) to stream global cursor position and clicks — the browser still does all screen capture and encoding.

1. In the popup, switch to **Precision Cursor** mode. If the companion app isn't detected, a setup guide appears.
2. Download the installer from the [kamui-native releases page](https://github.com/hadiindrawan/kamui-native/releases/latest) (macOS: `kamui-native-macos.pkg`).
3. **Right-click → Open** the `.pkg` (one-time Gatekeeper bypass — it isn't Apple-notarized) and click through the installer.
4. Grant **Accessibility** to the installed app in System Settings → Privacy & Security → Accessibility (needed for click capture; cursor position needs no permission). Chrome will separately prompt for Screen Recording when you actually start a recording — that's the browser's own permission, unrelated to the companion app.
5. Click **Check Connection** in the popup.

If it still won't connect: confirm you rebuilt `dist/` after any change to the native host name in `src/core/background/service-worker.js`, and see the companion repo's own README troubleshooting section for manifest/extension-ID debugging.

## 🐛 Troubleshooting

### Extension doesn't load
- Check that you selected the `dist/` folder (not the repo root)
- Make sure `npm run build` completed successfully

### No zoom effects
- Verify clicks were recorded (check event count in popup)
- Try clicking more deliberately (not too fast)
- Check browser console for errors

### Audio not recording
- Grant microphone permission when prompted
- Select "Share tab audio" checkbox in Chrome's picker

### Export fails
- Don't close the tab during export
- Check disk space
- Try shorter recordings first

### "Native app not installed" / Precision Cursor won't connect
See the **Native Companion** section above, and `kamui-native`'s own README Troubleshooting section for the full checklist (manifest paths, extension ID matching, stale-build issues).

## 📝 Development Commands

```bash
# Install dependencies
npm install

# Build for production (outputs to dist/)
npm run build

# Watch mode (auto-rebuild on file changes)
npm run dev

# Run tests
npm test
npm test -- --testPathPattern=popup.test   # a single test file
npm test -- --coverage

# After changes, reload the extension in chrome://extensions/
```

## 🎯 Key Files

- **Popup**: `src/features/popup/popup.jsx` (built to `dist/src/features/popup/`)
- **Editor**: `src/features/editor/editor.jsx`
- **Service Worker**: `src/core/background/service-worker.js`
- **Manifest**: `manifest.json` (repo root — copied into `dist/` by the build)

See [CLAUDE.md](CLAUDE.md) for the full architecture breakdown and recording-flow walkthrough.

## 💡 Tips

1. Record at least 5-10 seconds with 3-4 clicks to see zoom effects
2. Zoom starts 200ms *before* each click and lasts 800ms after
3. Exports default to **MP4** (H.264/HEVC); WebM is also selectable in export settings
4. IndexedDB (`KamuiRecordings`) stores videos locally — check Storage in DevTools
