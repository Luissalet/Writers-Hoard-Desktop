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
import type { DesktopUpdateState } from '../src/types/updates';
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
import type { WikidataRequest, WikidataResponse } from '@/engines/inquiry/wikidata';
import type { FamilySearchRequest, FamilySearchResponse } from '@/engines/inquiry/familySearch';
import type { FamilyCallRequest, FamilyCallResponse, FamilyRefsRequest } from '@/services/familyBridge/protocol';

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

interface MediaDownloaderHealthResult {
  ok: true;
  platforms: string[];
}

interface MediaPlatformResult {
  ok: boolean;
  platform?: string;
  error?: string;
}

interface DownloadToFileResult {
  ok: boolean;
  canceled?: boolean;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

/** Outcome of writing an automatic backup archive into userData. */
interface BackupWriteResult {
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

/** One post surfaced by `instagram.listCollection` — metadata only, nothing downloaded. Mirrors electron/media/gallerydl.ts. */
interface CollectionItem {
  url: string;
  shortcode: string;
  description?: string;
  uploader?: string;
  uploadDate?: string;
  type?: string;
}

/** Result of listing an Instagram saved collection. */
interface ListCollectionResult {
  ok: boolean;
  items?: CollectionItem[];
  error?: string;
}

/** Metadata scraped from a captured web page (og:/article:/twitter: tags). */
interface PageMeta {
  title?: string;
  author?: string;
  publishDate?: string;
  siteName?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  language?: string;
  fallbackText?: string;
  wordCount?: number;
}

/** Result of archiving a plain web page (PDF + screenshot + HTML). */
interface CapturePageResult {
  ok: boolean;
  pdfPath?: string;
  imagePath?: string;
  htmlPath?: string;
  html?: string;
  meta?: PageMeta;
  error?: string;
}

/** What the main window is currently looking at — drives the capture target. */
interface QuickNoteContext {
  /** Active project id, or null when the user isn't inside a project. */
  projectId: string | null;
  projectTitle: string | null;
  locale: string;
}

/** A note relayed from the floating capture window into the main renderer. */
interface QuickNotePayload {
  text: string;
  kind: 'note' | 'quote' | 'idea' | 'word';
  /** null → the project-less inbox. */
  projectId: string | null;
}

/**
 * The same note as it reaches the main renderer, tagged so the renderer can
 * tell main which capture it just finished writing.
 */
interface QuickNoteRelay extends QuickNotePayload {
  requestId: string;
}

/** The main renderer's verdict on one relayed capture. */
interface QuickNoteAck {
  requestId: string;
  ok: boolean;
  /** Short machine-readable reason when `ok` is false. */
  error?: string;
}

/** What the floating window gets back from `submit` — true only once written. */
interface QuickNoteSubmitResult {
  ok: boolean;
  error?: string;
}

// ── Local AI (embedded Ollama) — mirrors electron/ollama.ts ─────────────────

type OllamaState =
  | 'absent'
  | 'downloading-runtime'
  | 'extracting'
  | 'starting'
  | 'running'
  | 'external'
  | 'error';

interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
}

interface OllamaStatus {
  state: OllamaState;
  supported: boolean;
  runtimeInstalled: boolean;
  url: string | null;
  models: OllamaModelInfo[];
  pulling: string | null;
  runtimeBytes?: number;
  error?: string;
}

interface OllamaOpResult {
  ok: boolean;
  error?: string;
}

interface OllamaRuntimeProgress {
  phase: 'downloading' | 'extracting' | 'starting';
  receivedBytes: number;
  totalBytes: number | null;
}

interface OllamaPullProgress {
  tag: string;
  status: string;
  completedBytes: number;
  totalBytes: number;
  /** 0..1, monotonic within a pull. */
  percent: number;
}

interface OllamaChatRequest {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

interface OllamaChatResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/** One managed media file, read back through IPC as base64. */
interface ReadLibraryFileResult {
  ok: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
}

/** One tool call relayed from the local AI-bridge port. */
interface AiBridgeRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface AiBridgeReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

interface AiBridgeInfo {
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

interface AiBridgeAuditEntry {
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

interface AiBridgeUndoResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

/**
 * Copy for the native dialog main shows when this renderer stops answering a
 * close. Translated here and shipped over, because the main process has no
 * `t()` and a second copy of the strings there would drift from the locales.
 */
interface ShutdownWarning {
  title: string;
  message: string;
  closeAnyway: string;
  keepOpen: string;
}

const api = {
  /** Always true when running inside the desktop shell. */
  isDesktop: true as const,
  platform: process.platform,
  openWindowMenu: (): void => ipcRenderer.send('window:openMenu'),

  // Export pipelines that need native muscle (ffmpeg, PDF printing, save dialog).
  media: {
    /** Transcode a WebM capture to MP4 and prompt the user to save it. */
    saveTeleprompterMp4: (webm: ArrayBuffer, suggestedName: string): Promise<SaveResult> =>
      ipcRenderer.invoke('media:saveTeleprompterMp4', webm, suggestedName),
    /** Probe the bundled downloader without revealing its loopback auth token. */
    downloaderHealth: (): Promise<MediaDownloaderHealthResult> =>
      ipcRenderer.invoke('media:downloaderHealth'),
    detectDownloadPlatform: (url: string): Promise<MediaPlatformResult> =>
      ipcRenderer.invoke('media:detectDownloadPlatform', url),
    /** Download through main's shared process queue, then show a native save dialog. */
    downloadToFile: (args: {
      requestId: string;
      url: string;
      format: 'video' | 'audio';
    }): Promise<DownloadToFileResult> => ipcRenderer.invoke('media:downloadToFile', args),
    cancelFileDownload: (requestId: string): Promise<void> =>
      ipcRenderer.invoke('media:cancelFileDownload', requestId),
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
    /** Read one managed file as base64 — custom schemes cannot be fetched. */
    readLibraryFile: (relPath: string): Promise<ReadLibraryFileResult> =>
      ipcRenderer.invoke('media:readLibraryFile', relPath),
    listLibraryFiles: (projectId?: string): Promise<{
      root: string;
      files: Array<{ relPath: string; sizeBytes: number; modifiedAt: number }>;
    }> => ipcRenderer.invoke('media:listLibraryFiles', projectId),
    relocateLibrary: (): Promise<{
      ok: boolean;
      canceled?: boolean;
      root?: string;
      previousRoot?: string;
      copiedFiles?: number;
      error?: string;
    }> => ipcRenderer.invoke('media:relocateLibrary'),
  },

  // Plain web pages: archive as PDF + full-page screenshot + rendered HTML.
  capture: {
    /** Render the URL in a hidden window; resolves with the saved file paths. */
    page: (args: {
      url: string;
      projectId: string;
      snapshotId: string;
    }): Promise<CapturePageResult> => ipcRenderer.invoke('capture:page', args),
    /** Cancel an in-flight capture for a snapshot. */
    cancel: (snapshotId: string): Promise<void> =>
      ipcRenderer.invoke('capture:cancel', snapshotId),
  },

  // Instagram session for photo/carousel downloads (embedded login window).
  instagram: {
    /** Open the embedded Instagram login; resolves once a session is saved. */
    login: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('ig:login'),
    status: (): Promise<{ connected: boolean }> => ipcRenderer.invoke('ig:status'),
    logout: (): Promise<void> => ipcRenderer.invoke('ig:logout'),
    /** List every post in a saved collection (metadata only, nothing downloaded). */
    listCollection: (url: string): Promise<ListCollectionResult> =>
      ipcRenderer.invoke('ig:listCollection', url),
    /** Cancel an in-flight collection listing. */
    cancelListCollection: (): Promise<void> => ipcRenderer.invoke('ig:cancelListCollection'),
  },
  exporter: {
    /** Render a styled HTML script to PDF and prompt the user to save it. */
    scriptToPdf: (html: string, suggestedName: string): Promise<SaveResult> =>
      ipcRenderer.invoke('export:scriptToPdf', html, suggestedName),
  },

  // Automatic backup — the one door that writes the renderer's own bytes to
  // disk with no dialog and no transformation. Everything else here either
  // asks the user where to put a file or reshapes what it writes, which is
  // why an unattended archive was impossible before this.
  backup: {
    /**
     * Write a finished archive into the app's backup folder inside userData,
     * then keep only the `copies` most recent ones. The name is a suggestion:
     * the main process sanitises it and owns the directory.
     */
    writeArchive: (
      bytes: ArrayBuffer,
      suggestedName: string,
      copies: number,
    ): Promise<BackupWriteResult> =>
      ipcRenderer.invoke('backup:writeArchive', bytes, suggestedName, copies),
    /** Open the backup folder in the OS file manager. */
    revealFolder: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('backup:revealFolder'),
  },

  // Quick note capture. Two consumers share this namespace:
  //   • the main window — reports what project it's on, listens for captures
  //   • the floating capture window (quick-note.html) — reads the target,
  //     submits, closes itself
  // The floating window never touches Dexie: it hands the text to the main
  // process, which relays it to the main renderer. One writer, one database
  // connection, no cross-window refresh problem.
  quickNote: {
    /** Main window → main process: what the user is currently looking at. */
    setContext: (ctx: QuickNoteContext): void => {
      ipcRenderer.send('quick-note:set-context', ctx);
    },
    /** Floating window → main process: the cached context (target + locale). */
    getContext: (): Promise<QuickNoteContext> => ipcRenderer.invoke('quick-note:get-context'),
    open: (): Promise<void> => ipcRenderer.invoke('quick-note:open'),
    /**
     * Floating window → main process: save this note. Resolves `ok: true`
     * only after the main renderer has reported the write done — never on the
     * mere fact that the message was handed to a webContents.
     */
    submit: (payload: QuickNotePayload): Promise<QuickNoteSubmitResult> =>
      ipcRenderer.invoke('quick-note:submit', payload),
    /** Floating window → main process: dismiss without saving. */
    close: (): void => {
      ipcRenderer.send('quick-note:close');
    },
    /** Main window: a note arrived from the floating window. */
    onCapture: (callback: (payload: QuickNoteRelay) => void): (() => void) => {
      const listener = (_e: unknown, payload: QuickNoteRelay) => callback(payload);
      ipcRenderer.on('quick-note:add', listener);
      return () => ipcRenderer.removeListener('quick-note:add', listener);
    },
    /** Main window → main process: that capture is written (or it isn't). */
    ack: (ack: QuickNoteAck): void => {
      ipcRenderer.send('quick-note:ack', ack);
    },
    /**
     * Main window: the global shortcut fired while the app was focused, so
     * the in-app composer should open instead of the floating window.
     */
    onOpenInline: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('quick-note:open-inline', listener);
      return () => ipcRenderer.removeListener('quick-note:open-inline', listener);
    },
  },

  // Closing the window while something is unsaved.
  //
  // `beforeunload` is the wrong lever in Electron: `preventDefault()` there
  // cancels the close and shows nothing at all, so the X appears dead. Main
  // owns the veto instead (see electron/main.ts) and asks here, because the
  // renderer is the only side that knows whether a chapter is dirty and the
  // only side that can flush it.
  shutdown: {
    /**
     * Report unsaved work — and, because main has no `t()`, the already
     * translated words for the native dialog it may have to show if this
     * renderer stops answering. `null` clears it, which is also what tells
     * main it may close instantly and skip the round trip entirely.
     */
    setWarning: (warning: ShutdownWarning | null): void => {
      ipcRenderer.send('shutdown:setWarning', warning);
    },
    /** Main is trying to close the window and wants this renderer's answer. */
    onRequest: (callback: (requestId: number) => void): (() => void) => {
      const listener = (_e: unknown, requestId: number) => callback(requestId);
      ipcRenderer.on('shutdown:request', listener);
      return () => ipcRenderer.removeListener('shutdown:request', listener);
    },
    /**
     * Answer one request. `proceed` closes the window; `false` means the
     * question has been put to the writer on screen, which is what stops main
     * from putting its own dialog on top of it.
     */
    reply: (requestId: number, proceed: boolean): void => {
      ipcRenderer.send('shutdown:reply', { requestId, proceed });
    },
    /**
     * Close the window now — the writer answered "close anyway" in the
     * renderer's own dialog. Deliberately not tied to a request id: main may
     * have stood down in the meantime, and a button that stops working because
     * of that is the bug this whole channel exists to remove.
     */
    closeNow: (): void => {
      ipcRenderer.send('shutdown:reply', { requestId: null, proceed: true });
    },
    /**
     * The writer chose to stay. The round is over, so the next press of the X
     * starts a fresh one — which means it retries the save rather than going
     * straight to main's own dialog about a save nobody has re-attempted.
     */
    keepOpen: (): void => {
      ipcRenderer.send('shutdown:reply', { requestId: null, proceed: false });
    },
  },

  // ---- Real atlas ---------------------------------------------------------
  // "Find coordinates" in the place editor: one Nominatim query, made from
  // main (electron/atlasGeocode.ts) so the app keeps the usage policy.
  atlas: {
    geocode: (q: string, locale: string): Promise<GeocodeResponse> =>
      ipcRenderer.invoke('atlas:geocode', { q, locale }),
  },

  // ---- Investigation ------------------------------------------------------
  // Wikidata lookups for codex enrichment, made from main
  // (electron/wikidata.ts). The renderer checks the privacy guard first.
  wikidata: {
    request: (request: WikidataRequest): Promise<WikidataResponse> =>
      ipcRenderer.invoke('wikidata:request', request),
  },
  // Library search in the user's other local apps, through the hub
  // (electron/familySearch.ts). The renderer redacts private people first.
  family: {
    search: (request: FamilySearchRequest): Promise<FamilySearchResponse> =>
      ipcRenderer.invoke('family:search', request),
    // Hand work to another family app through the hub (electron/familyCall.ts).
    call: (request: FamilyCallRequest): Promise<FamilyCallResponse> =>
      ipcRenderer.invoke('family:call', request),
    link: (request: FamilyRefsRequest): Promise<{ ok: true } | { ok: false; code: string; error: string }> =>
      ipcRenderer.invoke('family:link', request),
  },

  updates: {
    getState: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('updates:getState'),
    download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('updates:openReleases'),
    onState: (callback: (state: DesktopUpdateState) => void): (() => void) => {
      const listener = (_e: unknown, state: DesktopUpdateState) => callback(state);
      ipcRenderer.on('updates:state', listener);
      return () => ipcRenderer.removeListener('updates:state', listener);
    },
    onOpen: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on('updates:open', listener);
      return () => ipcRenderer.removeListener('updates:open', listener);
    },
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updates:quitAndInstall'),
  },

  // Local AI — a portable Ollama runtime managed by the main process. ALL
  // Ollama HTTP happens in main: the packaged renderer is file:// (null
  // origin) and Ollama's CORS would reject it (tasks/desktop-transition.md).
  ollama: {
    getStatus: (): Promise<OllamaStatus> => ipcRenderer.invoke('ollama:getStatus'),
    start: (): Promise<OllamaOpResult> => ipcRenderer.invoke('ollama:start'),
    downloadRuntime: (): Promise<OllamaOpResult> => ipcRenderer.invoke('ollama:downloadRuntime'),
    cancelRuntimeDownload: (): Promise<void> =>
      ipcRenderer.invoke('ollama:cancelRuntimeDownload'),
    pullModel: (tag: string): Promise<OllamaOpResult> => ipcRenderer.invoke('ollama:pullModel', tag),
    cancelPull: (tag: string): Promise<void> => ipcRenderer.invoke('ollama:cancelPull', tag),
    deleteModel: (tag: string): Promise<OllamaOpResult> =>
      ipcRenderer.invoke('ollama:deleteModel', tag),
    chat: (req: OllamaChatRequest): Promise<OllamaChatResult> =>
      ipcRenderer.invoke('ollama:chat', req),
    onRuntimeProgress: (callback: (p: OllamaRuntimeProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: OllamaRuntimeProgress) => callback(p);
      ipcRenderer.on('ollama:runtime-progress', listener);
      return () => ipcRenderer.removeListener('ollama:runtime-progress', listener);
    },
    onPullProgress: (callback: (p: OllamaPullProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: OllamaPullProgress) => callback(p);
      ipcRenderer.on('ollama:pull-progress', listener);
      return () => ipcRenderer.removeListener('ollama:pull-progress', listener);
    },
    onStatus: (callback: (s: OllamaStatus) => void): (() => void) => {
      const listener = (_e: unknown, s: OllamaStatus) => callback(s);
      ipcRenderer.on('ollama:status', listener);
      return () => ipcRenderer.removeListener('ollama:status', listener);
    },
  },

  // ---- AI bridge ---------------------------------------------------------
  // The only main→renderer request/response lane in the app: main relays a
  // tool call from the local HTTP port, this window answers it from Dexie.
  aiBridge: {
    onRequest: (callback: (request: AiBridgeRequest) => void): (() => void) => {
      const listener = (_e: unknown, request: AiBridgeRequest) => callback(request);
      ipcRenderer.on('aibridge:request', listener);
      return () => ipcRenderer.removeListener('aibridge:request', listener);
    },
    reply: (reply: AiBridgeReply): Promise<void> => ipcRenderer.invoke('aibridge:reply', reply),
    getInfo: (): Promise<AiBridgeInfo> => ipcRenderer.invoke('aibridge:getInfo'),
    setEnabled: (enabled: boolean): Promise<AiBridgeInfo> =>
      ipcRenderer.invoke('aibridge:setEnabled', enabled),
    setWritesEnabled: (enabled: boolean): Promise<AiBridgeInfo> =>
      ipcRenderer.invoke('aibridge:setWritesEnabled', enabled),
    regenerateToken: (): Promise<AiBridgeInfo> => ipcRenderer.invoke('aibridge:regenerateToken'),
    readAudit: (limit?: number): Promise<AiBridgeAuditEntry[]> =>
      ipcRenderer.invoke('aibridge:readAudit', limit),
    undo: (index: number): Promise<AiBridgeUndoResult> =>
      ipcRenderer.invoke('aibridge:undo', index),
  },

  // ---- AI runtime --------------------------------------------------------
  // Connections by IP/URL, model discovery, hardware fit and streaming
  // inference. The renderer names a connection id; main holds the URL and
  // the (encrypted) key. Streams: pick a request id, subscribe, then invoke.
  ai: {
    subscriptionLogin: (kind: 'claude-subscription' | 'codex-subscription'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ai:subscriptionLogin', kind),
    listConnections: (): Promise<AiConnectionSummary[]> => ipcRenderer.invoke('ai:listConnections'),
    saveConnection: (
      input: AiConnectionInput,
    ): Promise<{ ok: true; connection: AiConnectionSummary } | { ok: false; code: string; error: string }> =>
      ipcRenderer.invoke('ai:saveConnection', input),
    deleteConnection: (id: string): Promise<boolean> => ipcRenderer.invoke('ai:deleteConnection', id),
    setSecret: (
      id: string,
      secret: string,
    ): Promise<{ ok: true; connection: AiConnectionSummary } | { ok: false; code: string; error: string }> =>
      ipcRenderer.invoke('ai:setSecret', { id, secret }),
    probe: (id: string): Promise<AiProbeResult> => ipcRenderer.invoke('ai:probe', id),
    listModels: (
      connectionId: string,
      refresh?: boolean,
    ): Promise<{ ok: boolean; models: AiModelDescriptor[]; code?: string; error?: string }> =>
      ipcRenderer.invoke('ai:listModels', { connectionId, refresh: refresh === true }),
    discoverLocal: (): Promise<AiDiscoveredServer[]> => ipcRenderer.invoke('ai:discoverLocal'),
    hardware: (force?: boolean): Promise<HardwareProfile> => ipcRenderer.invoke('ai:hardware', force === true),
    getDefaults: (): Promise<AiDefaults> => ipcRenderer.invoke('ai:getDefaults'),
    setDefault: (kind: 'chat' | 'image', route: AiRouteSelection | null): Promise<AiDefaults> =>
      ipcRenderer.invoke('ai:setDefault', { kind, route }),
    setModelOverride: (
      connectionId: string,
      modelId: string,
      override: { tools?: boolean; vision?: boolean; image?: boolean } | null,
    ): Promise<void> => ipcRenderer.invoke('ai:setModelOverride', { connectionId, modelId, override }),
    legacyMigrated: (mark?: boolean): Promise<boolean> => ipcRenderer.invoke('ai:legacyMigrated', mark === true),
    chat: (requestId: string, request: AiChatRequest): Promise<{ ok: boolean; requestId?: string; error?: string }> =>
      ipcRenderer.invoke('ai:chat', { requestId, request }),
    complete: (request: AiChatRequest): Promise<AiCompleteResult> => ipcRenderer.invoke('ai:complete', request),
    cancel: (requestId: string): Promise<boolean> => ipcRenderer.invoke('ai:cancel', requestId),
    generateImage: (
      requestId: string,
      request: AiImageRequest,
    ): Promise<{ ok: boolean; requestId?: string; error?: string }> =>
      ipcRenderer.invoke('ai:generateImage', { requestId, request }),
    onStream: (callback: (payload: { requestId: string; event: AiStreamEvent }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { requestId: string; event: AiStreamEvent }) => callback(payload);
      ipcRenderer.on('ai:stream', listener);
      return () => ipcRenderer.removeListener('ai:stream', listener);
    },
    onImageDone: (callback: (payload: { requestId: string; result: AiImageResult }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { requestId: string; result: AiImageResult }) => callback(payload);
      ipcRenderer.on('ai:image-done', listener);
      return () => ipcRenderer.removeListener('ai:image-done', listener);
    },
  },

  // ---- Local image runtime -----------------------------------------------
  // The managed stable-diffusion.cpp server: pinned binaries, catalogue
  // weights, one loaded model. Everything downloads into userData; nothing
  // here takes a URL from the renderer.
  sd: {
    status: (): Promise<SdRuntimeStatus> => ipcRenderer.invoke('sd:status'),
    installRuntime: (backend?: SdBackend): Promise<SdOpResult> => ipcRenderer.invoke('sd:installRuntime', backend),
    cancelInstall: (): Promise<void> => ipcRenderer.invoke('sd:cancelInstall'),
    removeRuntime: (): Promise<SdOpResult> => ipcRenderer.invoke('sd:removeRuntime'),
    downloadModel: (id: string): Promise<SdOpResult> => ipcRenderer.invoke('sd:downloadModel', id),
    cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke('sd:cancelDownload', id),
    deleteModel: (id: string): Promise<SdOpResult> => ipcRenderer.invoke('sd:deleteModel', id),
    downloadCompanion: (id: string): Promise<SdOpResult> => ipcRenderer.invoke('sd:downloadCompanion', id),
    cancelCompanionDownload: (id: string): Promise<void> => ipcRenderer.invoke('sd:cancelCompanionDownload', id),
    deleteCompanion: (id: string): Promise<SdOpResult> => ipcRenderer.invoke('sd:deleteCompanion', id),
    stop: (): Promise<SdRuntimeStatus> => ipcRenderer.invoke('sd:stop'),
    onStatus: (callback: (status: SdRuntimeStatus) => void): (() => void) => {
      const listener = (_e: unknown, status: SdRuntimeStatus) => callback(status);
      ipcRenderer.on('sd:status', listener);
      return () => ipcRenderer.removeListener('sd:status', listener);
    },
    onProgress: (callback: (progress: SdProgress) => void): (() => void) => {
      const listener = (_e: unknown, progress: SdProgress) => callback(progress);
      ipcRenderer.on('sd:progress', listener);
      return () => ipcRenderer.removeListener('sd:progress', listener);
    },
  },

  // ---- Copilot -----------------------------------------------------------
  // One user turn → a run in main (agent loop + shared tool executor) → a
  // stream of events back. Approvals for writes answer through `approve`.
  copilot: {
    run: (request: CopilotRunRequest): Promise<{ ok: boolean; runId?: string; error?: string }> =>
      ipcRenderer.invoke('copilot:run', request),
    cancel: (runId: string): Promise<boolean> => ipcRenderer.invoke('copilot:cancel', runId),
    approve: (runId: string, callId: string, approved: boolean): Promise<boolean> =>
      ipcRenderer.invoke('copilot:approve', { runId, callId, approved }),
    onEvent: (callback: (payload: { runId: string; event: CopilotEvent }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { runId: string; event: CopilotEvent }) => callback(payload);
      ipcRenderer.on('copilot:event', listener);
      return () => ipcRenderer.removeListener('copilot:event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

// ---------------------------------------------------------------------------
// La Forja — hand the renderer a direct line to worldgen OS processes
// ---------------------------------------------------------------------------
// MessagePorts cannot cross the contextBridge, so the handshake is: renderer
// calls spawn(kind, token) → this preload makes a channel, ships one end to
// the main process (which forks the utilityProcess and wires it), and posts
// the other end into the page via window.postMessage — the one lane that
// carries transferables into an isolated world. The renderer's shim matches
// the token and speaks plain Worker from there.
contextBridge.exposeInMainWorld('whForge', {
  available: true,
  memoryBytes: ipcRenderer.sendSync('forge:memory') as number,
  spawn(kind: 'region' | 'worldgen', token: string): void {
    const channel = new MessageChannel();
    ipcRenderer.postMessage('forge:spawn', { kind, token }, [channel.port2]);
    window.postMessage({ __forgePort: token }, '*', [channel.port1]);
  },
});
// A forge that died: main is the only side that sees its exit code, and it
// travels into the page the same way the port did.
ipcRenderer.on('forge:exited', (_event, payload: { token?: unknown; code?: unknown }) => {
  if (typeof payload?.token !== 'string' || typeof payload.code !== 'number') return;
  window.postMessage({ __forgeExit: payload.token, code: payload.code }, '*');
});
