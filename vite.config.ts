import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Desktop app: the bundle is read off local disk, not downloaded. The
    // "chunk is larger than 500 kB" nag is advice for websites.
    chunkSizeWarningLimit: Number.POSITIVE_INFINITY,
    rollupOptions: {
      input: {
        // The app itself…
        main: path.resolve(__dirname, 'index.html'),
        // …and the standalone floating capture window the global Ctrl+Shift+N
        // opens (electron/main.ts loads dist/quick-note.html directly).
        'quick-note': path.resolve(__dirname, 'quick-note.html'),
      },
      output: {
        // three.js is only reachable from the lazy 3D view, and it is ~80% of
        // that view's chunk. Its own vendor chunk keeps both halves under the
        // lazy-chunk budget without changing when anything loads: the entry
        // never imports it, and it is fetched alongside World3D.
        manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  server: {
    port: 5174,
  },
})
