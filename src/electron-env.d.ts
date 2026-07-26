// Renderer-side type for the bridge exposed by electron/preload.ts.
// Present only in the desktop shell; always optional in the web build.

export interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface MediaItemRef {
  relPath: string;
  kind: 'image' | 'video';
}

export interface DownloadToLibraryResult {
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

/** Metadata scraped from a captured web page (og:/article:/twitter: tags). */
export interface PageMeta {
  title?: string;
  author?: string;
  publishDate?: string;
  siteName?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  language?: string;
  /** Heuristic main-content text, used when Readability finds too little. */
  fallbackText?: string;
  wordCount?: number;
}

/** Result of archiving a plain web page (PDF + screenshot + HTML). */
export interface CapturePageResult {
  ok: boolean;
  /** "<projectId>/<snapshotId>.pdf", relative to the media library root. */
  pdfPath?: string;
  imagePath?: string;
  htmlPath?: string;
  /** Rendered HTML, returned inline so the renderer can run Readability on it. */
  html?: string;
  meta?: PageMeta;
  error?: string;
}

/** What the main window is currently looking at — drives the capture target. */
export interface QuickNoteContext {
  projectId: string | null;
  projectTitle: string | null;
  locale: string;
}

/** A note relayed from the floating capture window into the main renderer. */
export interface QuickNotePayload {
  text: string;
  kind: 'note' | 'quote' | 'idea' | 'word';
  /** null → the project-less inbox. */
  projectId: string | null;
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
  capture: {
    page: (args: {
      url: string;
      projectId: string;
      snapshotId: string;
    }) => Promise<CapturePageResult>;
    cancel: (snapshotId: string) => Promise<void>;
  };
  instagram: {
    login: () => Promise<{ connected: boolean }>;
    status: () => Promise<{ connected: boolean }>;
    logout: () => Promise<void>;
  };
  exporter: {
    scriptToPdf: (html: string, suggestedName: string) => Promise<SaveResult>;
  };
  quickNote: {
    setContext: (ctx: QuickNoteContext) => void;
    getContext: () => Promise<QuickNoteContext>;
    submit: (payload: QuickNotePayload) => Promise<{ ok: boolean }>;
    close: () => void;
    onCapture: (callback: (payload: QuickNotePayload) => void) => () => void;
    onOpenInline: (callback: () => void) => () => void;
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
