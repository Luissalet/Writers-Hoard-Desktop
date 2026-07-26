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
    rollupOptions: {
      input: {
        // The app itself…
        main: path.resolve(__dirname, 'index.html'),
        // …and the standalone floating capture window the global Ctrl+Shift+N
        // opens (electron/main.ts loads dist/quick-note.html directly).
        'quick-note': path.resolve(__dirname, 'quick-note.html'),
      },
    },
  },
  server: {
    port: 5174,
  },
})
