// Renderer-side type for the bridge exposed by electron/preload.ts.
// Present only in the desktop shell; always optional in the web build.
import type { DesktopUpdateState } from './types/updates';

import type {
  AiChatRequest,
  AiCompleteResult,
  AiConnectionInput,
  AiConnectionSummary,
  AiDefaults,
  AiDiscoveredServer,
  AiImageRequest,
  AiImageResult,
  AiModelDescriptor,
  AiProbeResult,
  AiRouteSelection,
  AiStreamEvent,
  HardwareProfile,
} from '@/services/aiRuntime/types';
import type { CopilotEvent, CopilotRunRequest } from '@/services/aiRuntime/copilot';
import type { SdBackend, SdOpResult, SdProgress, SdRuntimeStatus } from '@/services/aiRuntime/sdServer';
import type { GeocodeResponse } from '@/engines/real-atlas/geocode';

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

export interface MediaDownloaderHealthResult {
  ok: true;
  platforms: string[];
}

export interface MediaPlatformResult {
  ok: boolean;
  platform?: string;
  error?: string;
}

export interface DownloadToFileResult {
  ok: boolean;
  canceled?: boolean;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

/** Outcome of writing an automatic backup archive into userData. */
export interface BackupWriteResult {
  ok: boolean;
  /** Absolute path of the archive that now exists on disk. */
  path?: string;
  sizeBytes?: number;
  /** How many older archives rotation removed after this write. */
  removed?: number;
  code?: 'invalid-name' | 'invalid-payload' | 'insufficient-space' | 'write-failed';
  /** Bytes free on the target volume, when the write was skipped for space. */
  freeBytes?: number;
  requiredBytes?: number;
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

/**
 * The same note as it reaches the main renderer, tagged so the renderer can
 * tell main which capture it just finished writing.
 */
export interface QuickNoteRelay extends QuickNotePayload {
  requestId: string;
}

/** The main renderer's verdict on one relayed capture. */
export interface QuickNoteAck {
  requestId: string;
  ok: boolean;
  /** Short machine-readable reason when `ok` is false. */
  error?: string;
}

/** What the floating window gets back from `submit` — true only once written. */
export interface QuickNoteSubmitResult {
  ok: boolean;
  error?: string;
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

/**
 * Copy for the native dialog the main process shows when the renderer stops
 * answering a window close. Translated in the renderer and handed over,
 * because the main process has no `t()`. See src/services/closeGuard.ts.
 */
export interface ShutdownWarning {
  title: string;
  message: string;
  closeAnyway: string;
  keepOpen: string;
}

export interface ElectronAPI {
  isDesktop: true;
  platform: string;
  openWindowMenu: () => void;
  media: {
    saveTeleprompterMp4: (webm: ArrayBuffer, suggestedName: string) => Promise<SaveResult>;
    downloaderHealth: () => Promise<MediaDownloaderHealthResult>;
    detectDownloadPlatform: (url: string) => Promise<MediaPlatformResult>;
    downloadToFile: (args: {
      requestId: string;
      url: string;
      format: 'video' | 'audio';
    }) => Promise<DownloadToFileResult>;
    cancelFileDownload: (requestId: string) => Promise<void>;
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

  /**
   * Automatic backup: write finished archive bytes into `<userData>/backups`
   * with no dialog and no transformation, and rotate older copies away.
   * See src/services/autoBackup.ts.
   */
  backup: {
    writeArchive: (
      bytes: ArrayBuffer,
      suggestedName: string,
      copies: number,
    ) => Promise<BackupWriteResult>;
    revealFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  };
  quickNote: {
    setContext: (ctx: QuickNoteContext) => void;
    getContext: () => Promise<QuickNoteContext>;
    open: () => Promise<void>;
    submit: (payload: QuickNotePayload) => Promise<QuickNoteSubmitResult>;
    close: () => void;
    onCapture: (callback: (payload: QuickNoteRelay) => void) => () => void;
    ack: (ack: QuickNoteAck) => void;
    onOpenInline: (callback: () => void) => () => void;
  };
  /**
   * Closing the window while a document is unsaved. `beforeunload` cannot ask
   * this in Electron — its `preventDefault()` cancels the close silently — so
   * the main process owns the veto and asks the renderer here. See
   * src/services/closeGuard.ts and electron/main.ts.
   */
  /**
   * Absent on a desktop build whose preload predates the close guard, and on
   * the web build entirely — so every caller reaches it through `?.`.
   */
  shutdown?: {
    setWarning: (warning: ShutdownWarning | null) => void;
    onRequest: (callback: (requestId: number) => void) => () => void;
    reply: (requestId: number, proceed: boolean) => void;
    closeNow: () => void;
    keepOpen: () => void;
  };
  updates: {
    getState: () => Promise<DesktopUpdateState>;
    download: () => Promise<void>;
    openReleases: () => Promise<void>;
    onState: (callback: (state: DesktopUpdateState) => void) => () => void;
    onOpen: (callback: () => void) => () => void;
    check: () => Promise<void>;
    quitAndInstall: () => Promise<void>;
  };
  /**
   * Real atlas geocoding through Nominatim, made from main so the app keeps
   * the usage policy (electron/atlasGeocode.ts). Absent on a desktop build
   * whose preload predates it and on the web build, so the editor shows the
   * button only when it is there.
   */
  atlas?: {
    geocode: (q: string, locale: string) => Promise<GeocodeResponse>;
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

  /** AI runtime: connections by IP/URL, models, hardware fit, streaming. See electron/ai/. */
  ai: {
    listConnections: () => Promise<AiConnectionSummary[]>;
    saveConnection: (
      input: AiConnectionInput,
    ) => Promise<{ ok: true; connection: AiConnectionSummary } | { ok: false; code: string; error: string }>;
    deleteConnection: (id: string) => Promise<boolean>;
    setSecret: (
      id: string,
      secret: string,
    ) => Promise<{ ok: true; connection: AiConnectionSummary } | { ok: false; code: string; error: string }>;
    probe: (id: string) => Promise<AiProbeResult>;
    listModels: (
      connectionId: string,
      refresh?: boolean,
    ) => Promise<{ ok: boolean; models: AiModelDescriptor[]; code?: string; error?: string }>;
    discoverLocal: () => Promise<AiDiscoveredServer[]>;
    hardware: (force?: boolean) => Promise<HardwareProfile>;
    getDefaults: () => Promise<AiDefaults>;
    setDefault: (kind: 'chat' | 'image', route: AiRouteSelection | null) => Promise<AiDefaults>;
    setModelOverride: (
      connectionId: string,
      modelId: string,
      override: { tools?: boolean; vision?: boolean; image?: boolean } | null,
    ) => Promise<void>;
    legacyMigrated: (mark?: boolean) => Promise<boolean>;
    chat: (requestId: string, request: AiChatRequest) => Promise<{ ok: boolean; requestId?: string; error?: string }>;
    complete: (request: AiChatRequest) => Promise<AiCompleteResult>;
    cancel: (requestId: string) => Promise<boolean>;
    generateImage: (
      requestId: string,
      request: AiImageRequest,
    ) => Promise<{ ok: boolean; requestId?: string; error?: string }>;
    onStream: (callback: (payload: { requestId: string; event: AiStreamEvent }) => void) => () => void;
    onImageDone: (callback: (payload: { requestId: string; result: AiImageResult }) => void) => () => void;
  };

  /** Managed local image runtime (stable-diffusion.cpp). See electron/ai/sdRuntime.ts. */
  sd: {
    status: () => Promise<SdRuntimeStatus>;
    installRuntime: (backend?: SdBackend) => Promise<SdOpResult>;
    cancelInstall: () => Promise<void>;
    removeRuntime: () => Promise<SdOpResult>;
    downloadModel: (id: string) => Promise<SdOpResult>;
    cancelDownload: (id: string) => Promise<void>;
    deleteModel: (id: string) => Promise<SdOpResult>;
    /**
     * ControlNets and upscalers. Pinned and fetched exactly as a model is; the
     * difference is that installing one can change the server's launch profile
     * and so cost a restart — see `SdRuntimeStatus.profile`.
     */
    downloadCompanion: (id: string) => Promise<SdOpResult>;
    cancelCompanionDownload: (id: string) => Promise<void>;
    deleteCompanion: (id: string) => Promise<SdOpResult>;
    stop: () => Promise<SdRuntimeStatus>;
    onStatus: (callback: (status: SdRuntimeStatus) => void) => () => void;
    onProgress: (callback: (progress: SdProgress) => void) => () => void;
  };

  /** In-app copilot: one turn per run, events streamed back. See electron/ai/agentLoop.ts. */
  copilot: {
    run: (request: CopilotRunRequest) => Promise<{ ok: boolean; runId?: string; error?: string }>;
    cancel: (runId: string) => Promise<boolean>;
    approve: (runId: string, callId: string, approved: boolean) => Promise<boolean>;
    onEvent: (callback: (payload: { runId: string; event: CopilotEvent }) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
