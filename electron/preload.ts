// ============================================================================
// Writers Hoard — preload bridge
// ============================================================================
//
// Runs in an isolated, sandboxed context. The ONLY thing it does is expose a
// narrow, typed `window.electronAPI` surface to the renderer via contextBridge.
// No Node internals leak to the page. Keep this surface small on purpose.
//
// The matching renderer-side type declaration lives in src/electron-env.d.ts.

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  /** Always true when running inside the desktop shell. */
  isDesktop: true as const,

  app: {
    platform: process.platform,
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    getDataPath: (): Promise<string> => ipcRenderer.invoke('app:getDataPath'),
    /** Base URL of the embedded media-downloader service (e.g. http://127.0.0.1:8765). */
    getMediaServerUrl: (): Promise<string> => ipcRenderer.invoke('app:getMediaServerUrl'),
  },

  // Native filesystem access for the "hoard" — exports, backups, asset folders.
  // Intentionally minimal; expand as engines start writing real files.
  fs: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('fs:pickFolder'),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, data: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', filePath, data),
    exists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
  },

  updates: {
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updates:quitAndInstall'),
    /** Fires once an update has finished downloading. Returns an unsubscribe fn. */
    onDownloaded: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('updates:downloaded', listener);
      return () => ipcRenderer.removeListener('updates:downloaded', listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
