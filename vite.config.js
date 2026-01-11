import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'public/icons',
          dest: '.'
        },
        {
          src: 'public/ffmpeg',
          dest: '.'
        }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        editor: resolve(__dirname, 'src/editor/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.js'),
        'cursor-tracker': resolve(__dirname, 'src/content/cursor-tracker.js'),
        'recording-widget': resolve(__dirname, 'src/content/recording-widget.js')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Service worker and content scripts at root
          if (chunkInfo.name === 'service-worker' || chunkInfo.name === 'cursor-tracker' || chunkInfo.name === 'recording-widget') {
            return '[name].js';
          }
          // Other JS in assets
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';

          // HTML files go to root with proper names
          if (name.endsWith('.html')) {
            if (name.includes('popup')) return 'popup.html';
            if (name.includes('editor')) return 'editor.html';
            if (name.includes('offscreen')) return 'offscreen.html';
          }

          // Everything else in assets
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
