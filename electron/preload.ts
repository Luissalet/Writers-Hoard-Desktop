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

/** Result of a native "save file" flow. */
interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

/** Result of downloading a link's media into the managed scrapper library. */
interface MediaItemRef {
  relPath: string;
  kind: 'image' | 'video';
}

interface DownloadToLibraryResult {
  ok: boolean;
  /** Path relative to the media root, e.g. "<projectId>/<snapshotId>.mp4". */
  relPath?: string;
  /** All downloaded items (carousel/photos); single video → one item. */
  items?: MediaItemRef[];
  filename?: string;
  sizeBytes?: number;
  kind?: 'video' | 'audio' | 'image';
  description?: string;
  uploader?: string;
  uploadDate?: string;
  title?: string;
  error?: string;
}

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

  // Export pipelines that need native muscle (ffmpeg, PDF printing, save dialog).
  media: {
    /** Transcode a WebM capture to MP4 and prompt the user to save it. */
    saveTeleprompterMp4: (webm: ArrayBuffer, suggestedName: string): Promise<SaveResult> =>
      ipcRenderer.invoke('media:saveTeleprompterMp4', webm, suggestedName),
    /** Download a link's media into the managed library; resolves with its relative path. */
    downloadToLibrary: (args: {
      url: string;
      format: 'video' | 'audio';
      projectId: string;
      snapshotId: string;
    }): Promise<DownloadToLibraryResult> => ipcRenderer.invoke('media:downloadToLibrary', args),
    /** Cancel an in-flight download for a snapshot (kills its yt-dlp/ffmpeg). */
    cancelDownload: (snapshotId: string): Promise<void> =>
      ipcRenderer.invoke('media:cancelDownload', snapshotId),
    /** Delete a downloaded media file by its relative library path. */
    deleteLibraryFile: (relPath: string): Promise<void> =>
      ipcRenderer.invoke('media:deleteLibraryFile', relPath),
  },

  // Instagram session for photo/carousel downloads (embedded login window).
  instagram: {
    /** Open the embedded Instagram login; resolves once a session is saved. */
    login: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('ig:login'),
    status: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('ig:status'),
    logout: (): Promise<void> => ipcRenderer.invoke('ig:logout'),
  },
  exporter: {
    /** Render a styled HTML script to PDF and prompt the user to save it. */
    scriptToPdf: (html: string, suggestedName: string): Promise<SaveResult> =>
      ipcRenderer.invoke('export:scriptToPdf', html, suggestedName),
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
