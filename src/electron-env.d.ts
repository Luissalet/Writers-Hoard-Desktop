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

/** One post surfaced by `instagram.listCollection` — metadata only, nothing downloaded. */
export interface CollectionItem {
  url: string;
  shortcode: string;
  description?: string;
  uploader?: string;
  uploadDate?: string;
  type?: string;
}

/** Result of listing an Instagram saved collection. */
export interface ListCollectionResult {
  ok: boolean;
  items?: CollectionItem[];
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

/** One managed media file, read back through IPC as base64. */
export interface ReadLibraryFileResult {
  ok: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
}

/** One tool call relayed from the local AI-bridge port. */
export interface AiBridgeRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface AiBridgeReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

export interface AiBridgeInfo {
  enabled: boolean;
  writesEnabled: boolean;
  running: boolean;
  port: number;
  url: string;
  token: string;
  /** Absolute path of the MCP stdio adapter, for the client's config. */
  adapterPath: string;
  auditPath: string;
  toolCount: number;
}

export interface AiBridgeAuditEntry {
  /** Line number in the log — what undo addresses an entry by. */
  index: number;
  at: number;
  tool: string;
  client?: string;
  projectId?: string;
  entityId?: string;
  summary?: string;
  kind?: 'create' | 'update' | 'delete' | 'undo';
  undone?: boolean;
  ok: boolean;
  error?: string;
}

export interface AiBridgeUndoResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
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
    readLibraryFile: (relPath: string) => Promise<ReadLibraryFileResult>;
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
    listCollection: (url: string) => Promise<ListCollectionResult>;
    cancelListCollection: () => Promise<void>;
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

  /** Local AI bridge: see electron/aibridge/ and src/services/aiBridge/. */
  aiBridge: {
    onRequest: (callback: (request: AiBridgeRequest) => void) => () => void;
    reply: (reply: AiBridgeReply) => Promise<void>;
    getInfo: () => Promise<AiBridgeInfo>;
    setEnabled: (enabled: boolean) => Promise<AiBridgeInfo>;
    setWritesEnabled: (enabled: boolean) => Promise<AiBridgeInfo>;
    regenerateToken: () => Promise<AiBridgeInfo>;
    readAudit: (limit?: number) => Promise<AiBridgeAuditEntry[]>;
    undo: (index: number) => Promise<AiBridgeUndoResult>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
