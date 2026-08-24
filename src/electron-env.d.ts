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

// ── Local AI (embedded Ollama) — mirrors electron/ollama.ts ─────────────────

export type OllamaState =
  | 'absent'
  | 'downloading-runtime'
  | 'extracting'
  | 'starting'
  | 'running'
  | 'external'
  | 'error';

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
}

export interface OllamaStatus {
  state: OllamaState;
  /** Embedded runtime install is Windows-only; detection works everywhere. */
  supported: boolean;
  runtimeInstalled: boolean;
  url: string | null;
  models: OllamaModelInfo[];
  /** Tag currently being pulled, if any. */
  pulling: string | null;
  runtimeBytes?: number;
  error?: string;
}

export interface OllamaOpResult {
  ok: boolean;
  error?: string;
}

export interface OllamaRuntimeProgress {
  phase: 'downloading' | 'extracting' | 'starting';
  receivedBytes: number;
  totalBytes: number | null;
}

export interface OllamaPullProgress {
  tag: string;
  status: string;
  completedBytes: number;
  totalBytes: number;
  /** 0..1, monotonic within a pull. */
  percent: number;
}

export interface OllamaChatRequest {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export interface OllamaChatResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface ElectronAPI {
  isDesktop: true;
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
    listLibraryFiles: (projectId?: string) => Promise<{
      root: string;
      files: Array<{ relPath: string; sizeBytes: number; modifiedAt: number }>;
    }>;
    relocateLibrary: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      root?: string;
      previousRoot?: string;
      copiedFiles?: number;
      error?: string;
    }>;
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
    open: () => Promise<void>;
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
  ollama: {
    getStatus: () => Promise<OllamaStatus>;
    start: () => Promise<OllamaOpResult>;
    downloadRuntime: () => Promise<OllamaOpResult>;
    cancelRuntimeDownload: () => Promise<void>;
    pullModel: (tag: string) => Promise<OllamaOpResult>;
    cancelPull: (tag: string) => Promise<void>;
    deleteModel: (tag: string) => Promise<OllamaOpResult>;
    chat: (req: OllamaChatRequest) => Promise<OllamaChatResult>;
    onRuntimeProgress: (callback: (p: OllamaRuntimeProgress) => void) => () => void;
    onPullProgress: (callback: (p: OllamaPullProgress) => void) => () => void;
    onStatus: (callback: (s: OllamaStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
