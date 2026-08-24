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

const api = {
  /** Always true when running inside the desktop shell. */
  isDesktop: true as const,

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
  },
  exporter: {
    /** Render a styled HTML script to PDF and prompt the user to save it. */
    scriptToPdf: (html: string, suggestedName: string): Promise<SaveResult> =>
      ipcRenderer.invoke('export:scriptToPdf', html, suggestedName),
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
    /** Floating window → main process: save this note. */
    submit: (payload: QuickNotePayload): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('quick-note:submit', payload),
    /** Floating window → main process: dismiss without saving. */
    close: (): void => {
      ipcRenderer.send('quick-note:close');
    },
    /** Main window: a note arrived from the floating window. */
    onCapture: (callback: (payload: QuickNotePayload) => void): (() => void) => {
      const listener = (_e: unknown, payload: QuickNotePayload) => callback(payload);
      ipcRenderer.on('quick-note:add', listener);
      return () => ipcRenderer.removeListener('quick-note:add', listener);
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
    ipcRenderer.postMessage('forge:spawn', { kind }, [channel.port2]);
    window.postMessage({ __forgePort: token }, '*', [channel.port1]);
  },
});
