// Renderer-side type for the bridge exposed by electron/preload.ts.
// Present only in the desktop shell; always optional in the web build.

export interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface DownloadToLibraryResult {
  ok: boolean;
  /** Path relative to the media root, e.g. "<projectId>/<snapshotId>.mp4". */
  relPath?: string;
  filename?: string;
  sizeBytes?: number;
  kind?: 'video' | 'audio';
  error?: string;
}

export interface ElectronAPI {
  isDesktop: true;
  app: {
    platform: string;
    getVersion: () => Promise<string>;
    getDataPath: () => Promise<string>;
    getMediaServerUrl: () => Promise<string>;
  };
  fs: {
    pickFolder: () => Promise<string | null>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, data: string) => Promise<void>;
    exists: (filePath: string) => Promise<boolean>;
  };
  media: {
    saveTeleprompterMp4: (webm: ArrayBuffer, suggestedName: string) => Promise<SaveResult>;
    downloadToLibrary: (args: {
      url: string;
      format: 'video' | 'audio';
      projectId: string;
      snapshotId: string;
    }) => Promise<DownloadToLibraryResult>;
    cancelDownload: (snapshotId: string) => Promise<void>;
    deleteLibraryFile: (relPath: string) => Promise<void>;
  };
  exporter: {
    scriptToPdf: (html: string, suggestedName: string) => Promise<SaveResult>;
  };
  updates: {
    check: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
    onDownloaded: (callback: () => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
