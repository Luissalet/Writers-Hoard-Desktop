// Renderer-side type for the bridge exposed by electron/preload.ts.
// Present only in the desktop shell; always optional in the web build.

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
