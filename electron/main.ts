// ============================================================================
// Writers Hoard — Electron main process
// ============================================================================
//
// Responsibilities:
//   • Create the application window with secure defaults.
//   • Load the Vite dev server (development) or the built bundle (production).
//   • Start the embedded media-downloader HTTP service (replaces the standalone
//     Python/Flask server — see electron/media/server.ts).
//   • Bridge a small, safe set of native capabilities to the renderer over IPC
//     (app info, folder picker, file read/write, auto-update).
//
// This file is bundled to CommonJS (`dist-electron/main.cjs`) by
// electron/build.mjs, so `__dirname` and `require` are available at runtime
// even though the project's package.json declares `"type": "module"`.

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  protocol,
  net,
  globalShortcut,
  utilityProcess,
} from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';
import { startMediaServer, stopMediaServer } from './media/server';
import {
  AI_BRIDGE_PORT,
  AI_BRIDGE_URL,
  isAiBridgeRunning,
  stopAiBridge,
  syncAiBridge,
  undoBridgeChange,
} from './aibridge/server';
import {
  rejectAllPendingCalls,
  resolveBridgeReply,
  setBridgeWindowResolver,
} from './aibridge/rpc';
import {
  auditPath,
  getBridgeConfig,
  getBridgeToken,
  readAudit,
  regenerateBridgeToken,
  setBridgeConfig,
  undoneIndices,
} from './aibridge/state';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { transcodeWebmToMp4 } from './media/transcode';
import { downloadMedia, type MediaFormat } from './media/ytdlp';
import { downloadGallery, listCollection, type CollectionItem } from './media/gallerydl';
import { openIgLogin, igStatus, igLogout, exportIgCookies, cleanupIgCookies, igCookiesPath } from './media/igAuth';
import { capturePage, type PageMeta } from './media/pageCapture';
import {
  isExactRendererDocumentUrl,
  isIpcChannelAllowedForRole,
  isPathContainedBy,
  isSafeNativeSegment,
  resolveExistingContainedNativePath,
  resolveWritableContainedNativePath,
  type InternalRendererRole,
} from './security';
import {
  initOllama,
  getOllamaStatus,
  startOllama,
  downloadOllamaRuntime,
  cancelRuntimeDownload,
  pullOllamaModel,
  cancelOllamaPull,
  deleteOllamaModel,
  ollamaChat,
  ollamaBaseUrl,
  shutdownOllama,
  type OllamaChatRequest,
} from './ollama';
import { registerAiIpc } from './ai/ipc';
import { setBuiltinOllamaResolver } from './ai/connectionStore';
import { shutdownGateway } from './ai/inferenceGateway';
import { cancelAllCopilotRuns } from './ai/agentLoop';
import { shutdownSdRuntime } from './ai/sdRuntime';

interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

interface MediaItemRef {
  relPath: string;
  kind: 'image' | 'video';
}

interface DownloadToLibraryResult {
  ok: boolean;
  relPath?: string;
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

interface ListCollectionResult {
  ok: boolean;
  items?: CollectionItem[];
  error?: string;
}

const isDev = !app.isPackaged;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5174';
const PACKAGED_RENDERER_DIR = path.join(__dirname, '..', 'dist');
const MAIN_RENDERER_PATH = path.join(PACKAGED_RENDERER_DIR, 'index.html');
const QUICK_NOTE_RENDERER_PATH = path.join(PACKAGED_RENDERER_DIR, 'quick-note.html');
const MAIN_RENDERER_URL = isDev
  ? new URL(RENDERER_DEV_URL).href
  : pathToFileURL(MAIN_RENDERER_PATH).href;
const QUICK_NOTE_RENDERER_URL = isDev
  ? new URL('/quick-note.html', RENDERER_DEV_URL).href
  : pathToFileURL(QUICK_NOTE_RENDERER_PATH).href;

let mainWindow: BrowserWindow | null = null;

function rendererUrlForRole(role: InternalRendererRole): string {
  return role === 'main' ? MAIN_RENDERER_URL : QUICK_NOTE_RENDERER_URL;
}

function windowForRole(role: InternalRendererRole): BrowserWindow | null {
  return role === 'main' ? mainWindow : quickNoteWindow;
}

/** A trusted IPC caller must be an allowed internal window's top frame. */
function acceptIpcSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  channel: string,
): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  const roles: readonly InternalRendererRole[] = ['main', 'quick-note'];
  for (const role of roles) {
    if (!isIpcChannelAllowedForRole(channel, role)) continue;
    const win = windowForRole(role);
    if (
      win &&
      !win.isDestroyed() &&
      event.sender === win.webContents &&
      isExactRendererDocumentUrl(frame.url, rendererUrlForRole(role))
    ) {
      return true;
    }
  }
  console.warn(`[ipc] rejected sender for ${channel}`);
  return false;
}

function assertIpcSender(
  event: Electron.IpcMainInvokeEvent,
  channel: string,
): void {
  if (!acceptIpcSender(event, channel)) throw new Error('Forbidden IPC sender');
}

function installNavigationGuard(
  win: BrowserWindow,
  expectedUrl: string,
  openHttpExternally: boolean,
): void {
  const guard = (event: Electron.Event, url: string): void => {
    if (isExactRendererDocumentUrl(url, expectedUrl)) return;
    event.preventDefault();
    if (openHttpExternally && /^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
}

/** Exit with a machine-readable code after a packaged renderer startup smoke. */
function installPackagedSmokeExit(win: BrowserWindow): void {
  if (isDev || process.env.WH_DESKTOP_SMOKE_TEST !== '1') return;
  let settled = false;
  const finish = (code: number): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    app.exit(code);
  };
  const timeout = setTimeout(() => finish(1), 20_000);
  win.webContents.once('did-fail-load', () => finish(1));
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const mounted = await win.webContents.executeJavaScript(`
        (() => {
          const root = document.getElementById('root');
          return Boolean(root && root.childElementCount > 0 && (root.textContent?.trim().length ?? 0) > 10);
        })()
      `);
      finish(mounted ? 0 : 1);
    } catch {
      finish(1);
    }
  });
}

// ---------------------------------------------------------------------------
// Scrapper media library — downloaded inspiration videos/audio live under
// <userData>/scrapper-media/<projectId>/<snapshotId>.<ext> and are served to
// the renderer through the privileged `wh-media://` scheme (registered below).
// ---------------------------------------------------------------------------

/** Content types the wh-media:// handler pins explicitly (see protocol.handle). */
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html; charset=utf-8',
};

const MEDIA_LIBRARY_CONFIG = () => path.join(app.getPath('userData'), 'media-library.json');
let mediaLibraryOverride: string | null = null;

function scrapperMediaDir(): string {
  return mediaLibraryOverride ?? path.join(app.getPath('userData'), 'scrapper-media');
}

async function loadMediaLibraryLocation(): Promise<void> {
  try {
    const parsed = JSON.parse(await fs.readFile(MEDIA_LIBRARY_CONFIG(), 'utf8')) as {
      root?: unknown;
    };
    if (typeof parsed.root !== 'string' || !path.isAbsolute(parsed.root)) return;
    await fs.mkdir(parsed.root, { recursive: true });
    mediaLibraryOverride = path.resolve(parsed.root);
  } catch {
    mediaLibraryOverride = null;
  }
}

async function persistMediaLibraryLocation(root: string): Promise<void> {
  const target = MEDIA_LIBRARY_CONFIG();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ root }, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

async function listManagedFiles(projectId?: string): Promise<Array<{
  relPath: string;
  sizeBytes: number;
  modifiedAt: number;
}>> {
  const root = scrapperMediaDir();
  const start = projectId ? await resolveExistingLibraryPath(projectId) : root;
  if (!start || (projectId && !isSafeNativeSegment(projectId))) return [];
  const rows: Array<{ relPath: string; sizeBytes: number; modifiedAt: number }> = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        rows.push({
          relPath: path.relative(root, absolute).split(path.sep).join('/'),
          sizeBytes: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      }
    }
  };
  await walk(start);
  return rows.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Resolve an existing item through realpath so child symlinks cannot escape. */
async function resolveExistingLibraryPath(relPath: string): Promise<string | null> {
  return resolveExistingContainedNativePath(scrapperMediaDir(), relPath);
}

/**
 * Resolve a future write target and verify its nearest existing ancestor in
 * the real filesystem. Existing and broken symlinks both fail closed.
 */
async function resolveWritableLibraryPath(relPath: string): Promise<string | null> {
  return resolveWritableContainedNativePath(scrapperMediaDir(), relPath);
}

/** In-flight downloads keyed by snapshotId, so we can cancel them / kill on quit. */
const activeDownloads = new Map<string, AbortController>();

/** Serialize downloads (concurrency 1) so several captures can't saturate the CPU. */
let downloadQueue: Promise<unknown> = Promise.resolve();
function enqueueDownload<T>(task: () => Promise<T>): Promise<T> {
  const run = downloadQueue.then(task, task);
  downloadQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Abort every in-flight download (used on app quit so nothing is orphaned). */
function abortAllDownloads(): void {
  for (const controller of activeDownloads.values()) controller.abort();
  activeDownloads.clear();
  for (const controller of activeCaptures.values()) controller.abort();
  activeCaptures.clear();
  activeListingController?.abort();
  activeListingController = null;
}

/**
 * Instagram collection listing (`ig:listCollection`) — only one at a time,
 * matching the one-modal-open reality of `ImportCollectionModal`. Unlike
 * downloads/captures this isn't keyed by snapshotId: nothing has been saved
 * yet at listing time, there's just one in-flight "list this collection" call.
 */
let activeListingController: AbortController | null = null;

// --- Page captures (plain web pages → PDF + screenshot + HTML archive) ------
// Kept on their own queue so archiving an article never waits behind a big
// yt-dlp video, and vice versa. Concurrency 1: each capture spins up a real
// browser window, and several at once would thrash the machine.

/** In-flight page captures keyed by snapshotId, so we can cancel them. */
const activeCaptures = new Map<string, AbortController>();

let captureQueue: Promise<unknown> = Promise.resolve();
function enqueueCapture<T>(task: () => Promise<T>): Promise<T> {
  const run = captureQueue.then(task, task);
  captureQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface CapturePageResult {
  ok: boolean;
  /** "<projectId>/<snapshotId>.pdf" — relative to the media library root. */
  pdfPath?: string;
  imagePath?: string;
  htmlPath?: string;
  /** Rendered HTML, returned inline so the renderer can run Readability on it. */
  html?: string;
  meta?: PageMeta;
  error?: string;
}

// Must run before app `ready`. `stream`+`supportFetchAPI` let <video> issue
// Range requests for smooth seeking; `secure` keeps it a trusted origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wh-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900 };

async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = await fs.readFile(WINDOW_STATE_FILE(), 'utf8');
    const parsed = JSON.parse(raw) as WindowState;
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return DEFAULT_WINDOW_STATE;
    }
    // Sanity: if the saved position is completely off every current display
    // (monitor unplugged), fall back to centered default.
    if (parsed.x !== undefined && parsed.y !== undefined) {
      const { screen } = await import('electron');
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return (
          parsed.x! < b.x + b.width - 40 &&
          parsed.x! + parsed.width > b.x + 40 &&
          parsed.y! < b.y + b.height - 40 &&
          parsed.y! >= b.y - 20
        );
      });
      if (!visible) return { ...parsed, x: undefined, y: undefined };
    }
    return parsed;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

function trackWindowState(win: BrowserWindow): void {
  let saveTimer: NodeJS.Timeout | null = null;
  const save = () => {
    if (!win || win.isDestroyed()) return;
    const isMaximized = win.isMaximized();
    // Use normal bounds so un-maximizing restores the pre-maximize size.
    const bounds = win.getNormalBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    };
    fs.writeFile(WINDOW_STATE_FILE(), JSON.stringify(state)).catch(() => undefined);
  };
  const debounced = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  win.on('close', save);
}

// ---------------------------------------------------------------------------
// Closing the window while a chapter is unsaved
// ---------------------------------------------------------------------------
//
// The renderer used to answer this with `beforeunload` + `preventDefault()`.
// In a browser that raises the "leave site?" prompt. In an Electron renderer
// it cancels the close and shows NOTHING — so the writer clicked the X, the
// window sat there, and they clicked again. Worse, while the save kept failing
// (quota gone, the row deleted underneath it) the X could never close the
// window at all, and the way out was a force-kill: the one exit that beats the
// recovery journal.
//
// So the veto moved here, because the window is main's to close and only main
// can put a real dialog in front of the writer. The split is:
//
//   • the renderer knows whether anything is unsaved, and is the only side
//     that can flush it — so main asks, and does not guess;
//   • main owns the window, so main is the only side that can promise the X
//     eventually works.
//
// Three rules keep it honest, in the order they matter:
//   1. Nothing at risk → the close is never intercepted. No round trip, no
//      latency; the overwhelmingly common close stays instant.
//   2. Something at risk → one round trip. The renderer flushes and answers
//      `proceed`, and the window goes. That is the common unsaved case, and
//      from the writer's seat it is indistinguishable from rule 1.
//   3. No answer, or a second press on the X → a native dialog says what is
//      happening, in words, with "close anyway" in it. A renderer that is
//      wedged or lying can delay the close; it can never win it.
//
// The words in that dialog come from the renderer (`shutdown:setWarning`).
// Main has no `t()`, and a second copy of the strings here would drift out of
// the locale files; the constants below exist only so the type is total and
// are unreachable while any warning has been registered — which is exactly
// when the dialog can appear.

/** How long main waits for a renderer that may simply have no listener. */
const SHUTDOWN_REPLY_TIMEOUT_MS = 2_500;

/** Localized copy for the last-ditch native dialog, supplied by the renderer. */
interface ShutdownWarning {
  title: string;
  message: string;
  closeAnyway: string;
  keepOpen: string;
}

const SHUTDOWN_WARNING_FALLBACK: ShutdownWarning = {
  title: 'Unsaved changes',
  message: 'Writers Hoard is not responding, so the last changes could not be confirmed as saved.',
  closeAnyway: 'Close anyway',
  keepOpen: 'Keep the window open',
};

/** Set while the renderer holds unsaved text. Null means "close is free". */
let shutdownWarning: ShutdownWarning | null = null;
/** True once a close has been approved, so the next `close` event passes through. */
let closeApproved = false;
/** True between `before-quit` and the quit finishing, so approval quits rather than closes. */
let quitting = false;
let shutdownRequestSeq = 0;
/** The round currently waiting on the renderer, if any. */
let pendingShutdown: { id: number; timer: NodeJS.Timeout | null } | null = null;
/** The native dialog is already up; a further X press must not stack another. */
let escalating = false;

function clearShutdownTimer(): void {
  if (pendingShutdown?.timer) {
    clearTimeout(pendingShutdown.timer);
    pendingShutdown.timer = null;
  }
}

/** The writer asked, everything that could be said has been said: let it go. */
function approveShutdown(): void {
  forgetPendingShutdown();
  closeApproved = true;
  // A quit that reached a vetoed `close` was cancelled by Electron, so it has
  // to be asked for again rather than resumed.
  if (quitting) {
    app.quit();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
}

/** Drop the round in flight. A later X starts a fresh one from scratch. */
function forgetPendingShutdown(): void {
  clearShutdownTimer();
  pendingShutdown = null;
}

/**
 * The writer chose to stay. That also retracts the quit: Electron cancelled it
 * when the close was vetoed, and a `quitting` flag left standing would turn
 * their next plain window close into an app quit they never asked for.
 */
function abandonShutdown(): void {
  forgetPendingShutdown();
  quitting = false;
}

/**
 * The renderer is not answering, or the writer has pressed the X again. Either
 * way they have watched a button do nothing, which is the bug this replaces —
 * so say it out loud and give them the exit.
 */
async function escalateShutdown(): Promise<void> {
  if (!pendingShutdown || escalating) return;
  clearShutdownTimer();
  if (!mainWindow || mainWindow.isDestroyed()) {
    abandonShutdown();
    return;
  }
  const warning = shutdownWarning ?? SHUTDOWN_WARNING_FALLBACK;
  escalating = true;
  try {
    // Keeping the window is the default and the Escape answer: the deliberate
    // click is the one that can cost words, exactly as in ConfirmDialog.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: warning.title,
      message: warning.title,
      detail: warning.message,
      buttons: [warning.closeAnyway, warning.keepOpen],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    // The round may already be over — the renderer answered, or the window
    // went — in which case there is nothing left here to decide.
    if (!pendingShutdown) return;
    if (response === 0) approveShutdown();
    else abandonShutdown();
  } finally {
    escalating = false;
  }
}

/**
 * Intercept one close. Returns true when the close was held back, which is the
 * caller's cue to `preventDefault()`.
 */
function interceptClose(): boolean {
  if (closeApproved) return false;
  // Rule 1: the renderer has never claimed unsaved text, so there is nothing
  // to flush and nothing to warn about. Closing instantly IS the honest answer.
  if (!shutdownWarning) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  // Rule 3: pressing the X again while a round is in flight means the first
  // press looked like it did nothing. Stop waiting and say something.
  if (pendingShutdown) {
    void escalateShutdown();
    return true;
  }

  const id = ++shutdownRequestSeq;
  pendingShutdown = {
    id,
    timer: setTimeout(() => void escalateShutdown(), SHUTDOWN_REPLY_TIMEOUT_MS),
  };
  // Fire-and-forget by nature: this succeeds against a renderer with no
  // listener, which is precisely what the timer above is for.
  mainWindow.webContents.send('shutdown:request', id);
  return true;
}

/**
 * The renderer's answer, in four shapes:
 *
 *   (id, true)     the flush landed — close.
 *   (id, false)    the question is now on screen in the renderer's own dialog,
 *                  so the escalation timer stops: the writer is looking at
 *                  words, not at nothing.
 *   (null, true)   the writer chose "close anyway" in that dialog.
 *   (null, false)  the writer chose to stay, so the round is over.
 *
 * The two null forms carry no id on purpose. Main may have stood down in the
 * meantime, and a button in that dialog that stopped working because of it
 * would be the very defect this channel exists to remove.
 */
function handleShutdownReply(requestId: number | null, proceed: boolean): void {
  if (requestId === null) {
    if (proceed) approveShutdown();
    else abandonShutdown();
    return;
  }
  if (!pendingShutdown || pendingShutdown.id !== requestId) return;
  if (proceed) approveShutdown();
  else clearShutdownTimer();
}

/** Guards the window-less gap between this function's first await and its window. */
let creatingMainWindow = false;

async function createWindow(): Promise<void> {
  // Two "open the app" requests can land inside that gap — an impatient
  // double-double-click on the icon launches two processes, each firing
  // `second-instance` — and each would otherwise build its own main window.
  if (creatingMainWindow) return;
  creatingMainWindow = true;
  const state = await loadWindowState().finally(() => {
    creatingMainWindow = false;
  });
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0e0e11',
    show: false,
    title: 'Writers Hoard',
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (state.isMaximized) mainWindow.maximize();
  trackWindowState(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links (target=_blank, window.open) open in the OS browser,
  // never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // In production this permits only the exact packaged index document (plus
  // its client-side hash route), never another file:// URL.
  installNavigationGuard(mainWindow, MAIN_RENDERER_URL, true);
  installPackagedSmokeExit(mainWindow);

  // A reload (Ctrl+R) hands the user a fresh renderer, but a copilot run keeps
  // looping here — writing to the database with no card and no undo button.
  // In-page hash routing (isSameDocument) is not a reload and must not cancel.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      cancelAllCopilotRuns();
      // A reload throws away the editor that registered the warning. Keeping it
      // would make every later close pay the round trip and then offer a dialog
      // about a draft nothing is holding — a warning is only honest while the
      // renderer that raised it is still there to answer for it.
      shutdownWarning = null;
      abandonShutdown();
    }
  });
  mainWindow.webContents.on('destroyed', () => cancelAllCopilotRuns());

  if (isDev) {
    void mainWindow.loadURL(RENDERER_DEV_URL);
    // DevTools ya NO se abre solo. Con las herramientas abiertas, la consola
    // y la línea de tiempo RETIENEN todo lo que se registra — y en este motor
    // los mensajes llevan mundos y regiones de cientos de megabytes. Sumado a
    // la instrumentación del build de desarrollo de React (ver index.html),
    // "regenerar" con DevTools delante era una sentencia de muerte por RAM.
    // Ctrl+Shift+I lo abre cuando de verdad toque depurar.
  } else {
    // Renderer uses HashRouter in Electron, so a plain file load is enough.
    void mainWindow.loadFile(MAIN_RENDERER_PATH);
  }

  // Held back only while the renderer says a chapter is unsaved; see
  // `interceptClose`. Registered after `trackWindowState`'s own `close`
  // listener so the window geometry is still saved on the vetoed pass too.
  mainWindow.on('close', (event) => {
    if (interceptClose()) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The window this protocol was arguing about no longer exists. `quitting`
    // is deliberately left alone: a quit that got this far is still under way.
    shutdownWarning = null;
    forgetPendingShutdown();
    closeApproved = false;
    // Bridge calls are answered by this window; nothing in flight can land now.
    rejectAllPendingCalls('The Writers Hoard window was closed.');
    // Same for relayed quick captures: the only Dexie writer just went away,
    // so every parked submit fails now instead of sitting out its timeout.
    failAllPendingQuickNotes('window-closed');
    // Every hidden window still counts as an open window, so leaving one alive
    // keeps the app running after its last real window closed —
    // `window-all-closed` never fires, `will-quit` never runs, and the
    // single-instance lock then turns every relaunch into an immediate quit
    // against a process the user has no way to reach.
    //
    // The quick-capture window is one of those. So is the page-capture window
    // `electron/media/pageCapture.ts` opens per archive: parentless, hidden,
    // and alive for up to ~90s, so closing the app five seconds into a
    // Scrapper capture hit exactly that dead end. Aborting the captures
    // destroys their windows, which is what lets this quit finish.
    if (quickNoteWindow && !quickNoteWindow.isDestroyed()) quickNoteWindow.destroy();
    abortAllDownloads();
  });
}

// ---------------------------------------------------------------------------
// Quick note capture
// ---------------------------------------------------------------------------
//
// Ctrl+Shift+N anywhere in Windows. Two behaviours, one shortcut:
//   • app focused  → the main renderer opens its in-app composer (it already
//     knows the project you're on and can show a real toast).
//   • app in the background → a small frameless window appears on top of
//     whatever you were doing; type, Enter, gone.
//
// The floating window deliberately does NOT open the database. It relays the
// text to the main process, which hands it to the main renderer — one Dexie
// writer, so no second connection and no stale-list problem in the open app.

interface QuickNoteContext {
  projectId: string | null;
  projectTitle: string | null;
  locale: string;
}

interface QuickNotePayload {
  text: string;
  kind: 'note' | 'quote' | 'idea' | 'word';
  projectId: string | null;
}

/** What the main renderer reports back once it has tried to write the note. */
interface QuickNoteAck {
  requestId: string;
  ok: boolean;
  error?: string;
}

interface QuickNoteSubmitResult {
  ok: boolean;
  error?: string;
}

const QUICK_NOTE_ACCELERATOR = 'CommandOrControl+Shift+N';

/**
 * How long main waits for the main renderer to confirm the Dexie write before
 * calling the capture lost. Long enough to outlast a slow first write or a
 * transaction queued behind a ZIP import; short enough that the floating
 * window doesn't feel hung with the writer's paragraph still in it.
 */
const QUICK_NOTE_ACK_TIMEOUT_MS = 10_000;

let quickNoteWindow: BrowserWindow | null = null;
let quickNoteContext: QuickNoteContext = { projectId: null, projectTitle: null, locale: 'es' };

/**
 * Relayed captures still waiting for the main renderer's verdict.
 *
 * `webContents.send` is fire-and-forget: it succeeds against a renderer that
 * is gone, mid-reload or simply has no listener yet, which is how a typed
 * paragraph could be answered with "Saved" and then thrown away. Every submit
 * now parks here under a correlation id and is only answered `ok: true` by
 * `quick-note:ack`, which the renderer sends after the write resolves.
 */
let quickNoteRequestSeq = 0;
const pendingQuickNotes = new Map<
  string,
  { settle: (result: QuickNoteSubmitResult) => void; timer: NodeJS.Timeout }
>();

function settleQuickNote(requestId: string, result: QuickNoteSubmitResult): void {
  const pending = pendingQuickNotes.get(requestId);
  if (!pending) return;
  pendingQuickNotes.delete(requestId);
  clearTimeout(pending.timer);
  pending.settle(result);
}

/** Fail every parked capture at once — the renderer that owed us an answer is gone. */
function failAllPendingQuickNotes(error: string): void {
  for (const requestId of [...pendingQuickNotes.keys()]) {
    settleQuickNote(requestId, { ok: false, error });
  }
}

async function getQuickNoteWindow(): Promise<BrowserWindow> {
  if (quickNoteWindow && !quickNoteWindow.isDestroyed()) return quickNoteWindow;

  const win = new BrowserWindow({
    width: 560,
    height: 268,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#131317',
    title: 'Quick note',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  installNavigationGuard(win, QUICK_NOTE_RENDERER_URL, false);

  // Clicking away dismisses it — a capture box that lingers is clutter.
  // Kept open in dev so DevTools interaction doesn't kill it mid-debug.
  win.on('blur', () => {
    if (!isDev && !win.isDestroyed()) win.hide();
  });
  win.on('closed', () => {
    quickNoteWindow = null;
  });

  quickNoteWindow = win;
  try {
    if (isDev) await win.loadURL(QUICK_NOTE_RENDERER_URL);
    else await win.loadFile(QUICK_NOTE_RENDERER_PATH);
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
  return win;
}

async function showQuickNote(): Promise<void> {
  const win = await getQuickNoteWindow();
  win.center();
  win.show();
  win.focus();
}

function handleQuickNoteShortcut(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
    mainWindow.webContents.send('quick-note:open-inline');
    return;
  }
  if (quickNoteWindow && !quickNoteWindow.isDestroyed() && quickNoteWindow.isVisible()) {
    quickNoteWindow.hide();
    return;
  }
  void showQuickNote();
}

function registerQuickNoteShortcut(): void {
  const ok = globalShortcut.register(QUICK_NOTE_ACCELERATOR, handleQuickNoteShortcut);
  if (!ok) {
    // Another app owns the combo. Not fatal: the in-app shortcut still works
    // while Writers Hoard has focus.
    console.warn(`[quick-note] could not register ${QUICK_NOTE_ACCELERATOR}`);
  }
}

// ---------------------------------------------------------------------------
// Application menu (minimal — most actions live in the app UI)
// ---------------------------------------------------------------------------

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => void checkForUpdates(true),
        },
        {
          label: 'About Writers Hoard',
          click: () => {
            void dialog.showMessageBox(mainWindow ?? undefined!, {
              type: 'info',
              title: 'Writers Hoard',
              message: 'Writers Hoard',
              detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Auto-update (production only; publishes/reads from GitHub releases)
// ---------------------------------------------------------------------------

async function checkForUpdates(interactive = false): Promise<void> {
  if (isDev) {
    if (interactive) {
      void dialog.showMessageBox(mainWindow ?? undefined!, {
        type: 'info',
        message: 'Updates are disabled in development.',
      });
    }
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (interactive && !result?.updateInfo) {
      void dialog.showMessageBox(mainWindow ?? undefined!, {
        type: 'info',
        message: 'You are on the latest version.',
      });
    }
  } catch (err) {
    console.error('[updates] check failed', err);
    if (interactive) {
      void dialog.showMessageBox(mainWindow ?? undefined!, {
        type: 'error',
        message: 'Update check failed.',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function initAutoUpdates(): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updates:downloaded');
  });
  void checkForUpdates(false);
}

// ---------------------------------------------------------------------------
// Export helpers (teleprompter MP4, script PDF)
// ---------------------------------------------------------------------------

/** Prompt for a destination and write `bytes` there. */
async function saveBytesViaDialog(
  bytes: Buffer,
  suggestedName: string,
  filters: Electron.FileFilter[],
): Promise<SaveResult> {
  if (!mainWindow) return { ok: false, error: 'no window' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName,
    filters,
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fs.writeFile(result.filePath, bytes);
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Render a standalone HTML string to PDF bytes via a hidden, script-free window. */
async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true },
  });
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-script-'));
  const htmlPath = path.join(tmpdir, 'script.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    await win.loadFile(htmlPath);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    win.destroy();
    await fs.rm(tmpdir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Automatic backup — the renderer's archive, given a home under userData
// ---------------------------------------------------------------------------
// The manuscript lives in IndexedDB: invisible to the writer, and evictable by
// the browser engine under storage pressure. The renderer knows how to turn it
// into a restorable ZIP; what it has never had is anywhere to put one without
// a save dialog in front of it. This is that place.
//
// Nothing here trusts the renderer with a path. It sends bytes and a suggested
// name; the directory, the final name, the atomicity and which older copies
// survive are all decided on this side.

/** Automatic archives live here, always inside userData. */
function backupDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

/**
 * The app's own archive names — a UTC stamp that sorts chronologically.
 * Rotation deletes only names matching this, so a writer's own ZIP dropped
 * into the folder survives, and a half-written `.part` can never be counted
 * as a backup.
 */
const BACKUP_ARCHIVE_NAME = /^writers-hoard-auto-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/;

/**
 * The farewell copy written just before a project is deleted for good.
 *
 * A second shape rather than a looser first one. This channel takes bytes and a
 * name from the renderer and puts them on disk with no dialog in front of it,
 * so the name is the whole boundary: anything it accepts is a file a
 * compromised renderer can create. Both patterns are therefore anchored,
 * fixed-extension, and built only from characters that cannot traverse, cannot
 * spell a reserved device name, and cannot hide an extension.
 *
 * The slug is the project's title, reduced by the renderer to lowercase ASCII
 * and hyphens — enough to tell twenty archives apart in a folder listing, and
 * not enough to be anything but a file name. It is optional because a title
 * made entirely of characters outside that alphabet reduces to nothing, and a
 * project called "第一章" must still get its copy.
 */
const BACKUP_DELETED_NAME =
  /^writers-hoard-deleted-(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/;

/** Either kind of archive this folder holds. */
function isBackupArchiveName(name: string): boolean {
  return BACKUP_ARCHIVE_NAME.test(name) || BACKUP_DELETED_NAME.test(name);
}

/** Suffix of an in-flight write. Deliberately outside BACKUP_ARCHIVE_NAME. */
const BACKUP_PART_SUFFIX = '.part';

/** Windows refuses these as file names whatever extension follows. */
const RESERVED_WINDOWS_NAMES = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

/** Leave the writer this much room rather than filling their disk for them. */
const BACKUP_FREE_SPACE_HEADROOM = 64 * 1024 * 1024;

const DEFAULT_BACKUP_COPIES = 3;
const MAX_BACKUP_COPIES = 20;

interface BackupWriteResult {
  ok: boolean;
  /** Absolute path of the archive that now exists. */
  path?: string;
  sizeBytes?: number;
  /** How many older archives rotation removed after this write. */
  removed?: number;
  code?: 'invalid-name' | 'invalid-payload' | 'insufficient-space' | 'write-failed';
  freeBytes?: number;
  requiredBytes?: number;
  error?: string;
}

/**
 * Reduce whatever the renderer sent to one safe file name, or to nothing.
 *
 * Separators are stripped rather than rejected outright so the name is judged
 * on what it would actually address, and every later rule has to pass on that
 * stripped result. Trailing dots and spaces are refused because Windows trims
 * them silently — "x.zip." becomes a second file rotation cannot see — and the
 * reserved device names because opening `CON` there is not a file at all.
 * `isSafeNativeSegment` then admits only `[A-Za-z0-9._-]`, which is what rules
 * out `..`, control characters and every other exotic atom in one gate.
 * Finally the name must be one this app would itself have produced: a name
 * rotation could never collect would grow the folder forever.
 */
function sanitizeBackupFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[\\/]+/g, '');
  if (!stripped || stripped.length > 120) return null;
  if (/[. ]$/.test(stripped)) return null;
  if (RESERVED_WINDOWS_NAMES.test(stripped.replace(/\..*$/, ''))) return null;
  if (!isSafeNativeSegment(stripped)) return null;
  return isBackupArchiveName(stripped) ? stripped : null;
}

/**
 * Bytes actually available on the volume holding `dir`, or null when this
 * build cannot say. `statfs` arrived in Node 18.15 and is not implemented for
 * every filesystem, so "unknown" is a normal answer: the write then proceeds
 * exactly as it would have without the check.
 */
async function availableBytesFor(dir: string): Promise<number | null> {
  if (typeof fs.statfs !== 'function') return null;
  try {
    const stats = await fs.statfs(dir);
    return Number(stats.bsize) * Number(stats.bavail);
  } catch {
    return null;
  }
}

/** Remove `.part` files a killed or crashed write left behind. */
async function sweepInterruptedBackupWrites(dir: string): Promise<void> {
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(BACKUP_PART_SUFFIX)) continue;
      const absolute = await resolveExistingContainedNativePath(dir, entry.name);
      if (absolute) await fs.rm(absolute, { force: true });
    }
  } catch {
    /* no folder yet, or unreadable — the write below will say so */
  }
}

/**
 * Keep the newest `keep` archives, delete the rest.
 *
 * Ordering comes from the app's own names, not from mtimes a copy or a restore
 * may have rewritten. Every target is re-resolved through the containment
 * helper before it is removed, so a symlink planted in the folder cannot turn
 * a rotation into a deletion somewhere else on the disk.
 */
async function rotateBackupArchives(dir: string, keep: number, forName: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return 0;
  // Each kind rotates against its own history. The two answer different
  // questions — "the library as it was last week" and "the project I deleted" —
  // and letting one evict the other would mean a run of deletions quietly
  // eating every automatic backup, or a week of backups eating the only copy of
  // a project that no longer exists anywhere else.
  const matches = BACKUP_DELETED_NAME.test(forName) ? BACKUP_DELETED_NAME : BACKUP_ARCHIVE_NAME;
  const archives = entries
    .filter((entry) => entry.isFile() && matches.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  let removed = 0;
  for (const name of archives.slice(keep)) {
    const absolute = await resolveExistingContainedNativePath(dir, name);
    if (!absolute) continue;
    try {
      await fs.rm(absolute, { force: true });
      removed += 1;
    } catch (err) {
      console.error('[backup] could not remove an old archive', err);
    }
  }
  return removed;
}

/** One archive write at a time — the sweep and the rotation both read the folder. */
let backupQueue: Promise<unknown> = Promise.resolve();
function enqueueBackup<T>(task: () => Promise<T>): Promise<T> {
  const run = backupQueue.then(task, task);
  backupQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeBackupArchive(
  bytes: unknown,
  suggestedName: unknown,
  copies: unknown,
): Promise<BackupWriteResult> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
    return { ok: false, code: 'invalid-payload', error: 'empty archive' };
  }
  const name = sanitizeBackupFileName(suggestedName);
  if (!name) return { ok: false, code: 'invalid-name', error: 'unusable archive name' };
  const payload = Buffer.from(bytes);

  const requested =
    typeof copies === 'number' && Number.isFinite(copies)
      ? Math.trunc(copies)
      : DEFAULT_BACKUP_COPIES;
  const keep = Math.min(Math.max(requested, 1), MAX_BACKUP_COPIES);

  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });
  await sweepInterruptedBackupWrites(dir);

  // Disk safety before the first byte. An archive that does not fit is a
  // skipped backup with a reason, never a full disk with a stub file on it.
  const available = await availableBytesFor(dir);
  const required = payload.byteLength + BACKUP_FREE_SPACE_HEADROOM;
  if (available !== null && available < required) {
    return { ok: false, code: 'insufficient-space', freeBytes: available, requiredBytes: required };
  }

  const target = await resolveWritableContainedNativePath(dir, name);
  const temporary = await resolveWritableContainedNativePath(dir, `${name}${BACKUP_PART_SUFFIX}`);
  if (!target || !temporary) {
    return { ok: false, code: 'invalid-name', error: 'archive path escapes the backup folder' };
  }

  try {
    // Atomic by construction: the bytes land in a `.part` file rotation
    // ignores, are flushed to the device, and only then take the real name in
    // one rename on the same filesystem. Interrupt it anywhere and what
    // remains is a `.part` the next run sweeps — never a truncated ZIP that
    // still opens far enough to look like a backup.
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.write(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, target);
  } catch (err) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    return {
      ok: false,
      code: 'write-failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: true,
    path: target,
    sizeBytes: payload.byteLength,
    removed: await rotateBackupArchives(dir, keep, name),
  };
}

// ---------------------------------------------------------------------------
// AI bridge — local port so external models can operate the app
// ---------------------------------------------------------------------------

/**
 * Where the MCP stdio adapter lives on disk. Packaged, `dist-electron` sits
 * inside app.asar, which plain `node` cannot read — electron-builder unpacks
 * this one directory so an external client can spawn it (see `asarUnpack`).
 */
function aiBridgeAdapterPath(): string {
  const bundled = path.join(__dirname, 'aibridge', 'mcpStdio.cjs');
  return app.isPackaged ? bundled.replace('app.asar', 'app.asar.unpacked') : bundled;
}

async function aiBridgeInfo(): Promise<{
  enabled: boolean;
  writesEnabled: boolean;
  running: boolean;
  port: number;
  url: string;
  token: string;
  adapterPath: string;
  auditPath: string;
  toolCount: number;
}> {
  const [config, token] = await Promise.all([getBridgeConfig(), getBridgeToken()]);
  return {
    ...config,
    running: isAiBridgeRunning(),
    port: AI_BRIDGE_PORT,
    url: AI_BRIDGE_URL,
    token,
    adapterPath: aiBridgeAdapterPath(),
    auditPath: auditPath(),
    toolCount: BRIDGE_TOOLS.length,
  };
}

/** Start or stop the listener to match the switch; never fatal. */
async function syncAiBridgeNow(): Promise<void> {
  try {
    await syncAiBridge({
      version: app.getVersion(),
      hasWindow: () => Boolean(mainWindow && !mainWindow.isDestroyed()),
    });
  } catch (err) {
    // Port busy or refused: the app is entirely usable without the bridge.
    console.error('[aibridge] could not start', err);
  }
}

// ---------------------------------------------------------------------------
// IPC — the renderer's only door to native capabilities (see preload.ts)
// ---------------------------------------------------------------------------

function registerIpc(): void {
  // Teleprompter video: re-encode the renderer's WebM capture to MP4 and save it.
  ipcMain.handle(
    'media:saveTeleprompterMp4',
    async (event, webm: ArrayBuffer, suggestedName: string): Promise<SaveResult> => {
      assertIpcSender(event, 'media:saveTeleprompterMp4');
      try {
        const mp4 = await transcodeWebmToMp4(Buffer.from(webm));
        return await saveBytesViaDialog(mp4, suggestedName, [
          { name: 'MP4 Video', extensions: ['mp4'] },
        ]);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // Script: render styled HTML to a real PDF and save it.
  ipcMain.handle(
    'export:scriptToPdf',
    async (event, html: string, suggestedName: string): Promise<SaveResult> => {
      assertIpcSender(event, 'export:scriptToPdf');
      try {
        const pdf = await htmlToPdf(html);
        return await saveBytesViaDialog(pdf, suggestedName, [
          { name: 'PDF Document', extensions: ['pdf'] },
        ]);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // Automatic backup: take the archive the renderer built out of its own
  // database and give it a home under userData. Every decision that could hurt
  // — the folder, the final name, the atomicity, which older copies go — is
  // made in writeBackupArchive above, never by the caller.
  ipcMain.handle(
    'backup:writeArchive',
    async (
      event,
      bytes: ArrayBuffer,
      suggestedName: string,
      copies: number,
    ): Promise<BackupWriteResult> => {
      assertIpcSender(event, 'backup:writeArchive');
      try {
        // Serialised: two writes at once would sweep and rotate each other's
        // files out from under themselves.
        return await enqueueBackup(() => writeBackupArchive(bytes, suggestedName, copies));
      } catch (err) {
        return {
          ok: false,
          code: 'write-failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Show the writer where their archives actually are. This reuses the one
  // shell-open path the process already has — the same `shell.openExternal`
  // external links take — and the folder is computed here, never sent in.
  ipcMain.handle(
    'backup:revealFolder',
    async (event): Promise<{ ok: boolean; path?: string; error?: string }> => {
      assertIpcSender(event, 'backup:revealFolder');
      const dir = backupDir();
      try {
        await fs.mkdir(dir, { recursive: true });
        await shell.openExternal(pathToFileURL(dir).href);
        return { ok: true, path: dir };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // Scrapper: download a link's media into the managed library, return its rel path.
  ipcMain.handle(
    'media:downloadToLibrary',
    async (
      event,
      args: { url: string; format: MediaFormat; projectId: string; snapshotId: string },
    ): Promise<DownloadToLibraryResult> => {
      assertIpcSender(event, 'media:downloadToLibrary');
      const { url, projectId, snapshotId } = args ?? ({} as typeof args);
      const format: MediaFormat = args?.format === 'audio' ? 'audio' : 'video';
      if (!url || !isSafeNativeSegment(projectId) || !isSafeNativeSegment(snapshotId)) {
        return { ok: false, error: 'invalid request' };
      }
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'unsupported url' };
      // Don't double-spawn yt-dlp for a snapshot already downloading.
      if (activeDownloads.has(snapshotId)) {
        return { ok: false, error: 'already downloading' };
      }
      const controller = new AbortController();
      activeDownloads.set(snapshotId, controller);
      try {
        // Serialized (concurrency 1) so multiple captures queue instead of
        // spawning parallel yt-dlp/ffmpeg processes that pin the CPU.
        return await enqueueDownload(async (): Promise<DownloadToLibraryResult> => {
          if (controller.signal.aborted) return { ok: false, error: 'cancelled' };

          // Refresh exported Instagram cookies if the user connected their account.
          const hasIg = await exportIgCookies().catch(() => false);
          const cookiesFile = hasIg ? igCookiesPath() : undefined;

          // 1) Try yt-dlp (video, anonymous — reels and video posts).
          try {
            const outcome = await downloadMedia(url, format, controller.signal, cookiesFile);
            try {
              const ext = path.extname(outcome.filename) || (format === 'audio' ? '.mp3' : '.mp4');
              const destDir = await resolveWritableLibraryPath(projectId);
              if (!destDir) throw new Error('invalid library destination');
              await fs.mkdir(destDir, { recursive: true });
              const fileName = `${snapshotId}${ext}`;
              const destination = await resolveWritableLibraryPath(`${projectId}/${fileName}`);
              if (!destination) throw new Error('invalid library destination');
              await fs.copyFile(outcome.filePath, destination);
              const relPath = `${projectId}/${fileName}`;
              return {
                ok: true,
                relPath,
                items: [{ relPath, kind: 'video' }],
                filename: outcome.filename,
                sizeBytes: outcome.sizeBytes,
                kind: format,
                description: outcome.metadata?.description,
                uploader: outcome.metadata?.uploader,
                uploadDate: outcome.metadata?.uploadDate,
                title: outcome.metadata?.title,
              };
            } finally {
              await outcome.cleanup();
            }
          } catch (ytErr) {
            const ymsg = ytErr instanceof Error ? ytErr.message : String(ytErr);
            if (ymsg === 'cancelled') return { ok: false, error: 'cancelled' };

            // 2) yt-dlp couldn't (likely a photo / carousel) → gallery-dl with cookies.
            let gallery;
            try {
              gallery = await downloadGallery(url, controller.signal, cookiesFile);
            } catch (gErr) {
              return { ok: false, error: gErr instanceof Error ? gErr.message : String(gErr) };
            }
            try {
              const destDir = await resolveWritableLibraryPath(`${projectId}/${snapshotId}`);
              if (!destDir) throw new Error('invalid library destination');
              await fs.mkdir(destDir, { recursive: true });
              const items: MediaItemRef[] = [];
              for (let i = 0; i < gallery.items.length; i++) {
                const it = gallery.items[i];
                const ext = path.extname(it.filePath) || (it.kind === 'video' ? '.mp4' : '.jpg');
                const fileName = `${i}${ext}`;
                const destination = await resolveWritableLibraryPath(
                  `${projectId}/${snapshotId}/${fileName}`,
                );
                if (!destination) throw new Error('invalid library destination');
                await fs.copyFile(it.filePath, destination);
                items.push({ relPath: `${projectId}/${snapshotId}/${fileName}`, kind: it.kind });
              }
              if (items.length === 0) return { ok: false, error: 'no media found' };
              const firstVideo = items.find((i) => i.kind === 'video');
              return {
                ok: true,
                relPath: (firstVideo ?? items[0]).relPath,
                items,
                kind: firstVideo ? 'video' : 'image',
                description: gallery.metadata?.description,
                uploader: gallery.metadata?.uploader,
                uploadDate: gallery.metadata?.uploadDate,
              };
            } finally {
              await gallery.cleanup();
            }
          }
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        activeDownloads.delete(snapshotId);
        // The exported cookie jar is a live session credential: it exists only
        // for as long as the child process that reads it.
        await cleanupIgCookies();
      }
    },
  );

  // Scrapper: cancel an in-flight download (kills yt-dlp + its ffmpeg child).
  ipcMain.handle('media:cancelDownload', (event, snapshotId: string): void => {
    assertIpcSender(event, 'media:cancelDownload');
    activeDownloads.get(snapshotId)?.abort();
  });

  // Scrapper: remove a downloaded media file (called when its snapshot is deleted).
  ipcMain.handle('media:deleteLibraryFile', async (event, relPath: string): Promise<void> => {
    assertIpcSender(event, 'media:deleteLibraryFile');
    const abs = typeof relPath === 'string' ? await resolveExistingLibraryPath(relPath) : null;
    if (!abs) return;
    await fs.rm(abs, { recursive: true, force: true });
  });

  ipcMain.handle('media:listLibraryFiles', async (event, projectId?: string) => {
    assertIpcSender(event, 'media:listLibraryFiles');
    return {
      root: scrapperMediaDir(),
      files: await listManagedFiles(projectId),
    };
  });

  // Read one managed file back as base64. The renderer displays these through
  // the wh-media:// scheme, but it cannot `fetch` them: in development it is
  // served from http://localhost and in production from file://, so a custom
  // scheme is always cross-origin and the fetch is refused. Same reason all
  // Ollama traffic goes through IPC. Used by the AI bridge's vision tools.
  ipcMain.handle('media:readLibraryFile', async (event, relPath: string) => {
    assertIpcSender(event, 'media:readLibraryFile');
    const absolute = await resolveExistingLibraryPath(relPath);
    if (!absolute) return { ok: false, error: 'not found' };
    try {
      const stat = await fs.stat(absolute);
      // Bounded: this crosses IPC as a base64 string and then a model's context.
      if (stat.size > 32 * 1024 * 1024) return { ok: false, error: 'file too large' };
      const bytes = await fs.readFile(absolute);
      const ext = path.extname(absolute).toLowerCase();
      const mimeType =
        MEDIA_CONTENT_TYPES[ext] ??
        ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
           '.gif': 'image/gif', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream');
      return { ok: true, base64: bytes.toString('base64'), mimeType };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('media:relocateLibrary', async (event) => {
    assertIpcSender(event, 'media:relocateLibrary');
    if (!mainWindow) return { ok: false, error: 'Main window unavailable' };
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for Writers Hoard managed assets',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true };
    const source = path.resolve(scrapperMediaDir());
    const destination = path.resolve(selection.filePaths[0], 'WritersHoardAssets');
    if (destination === source) return { ok: true, root: source, previousRoot: source };
    if (isPathContainedBy(source, destination) || isPathContainedBy(destination, source)) {
      return { ok: false, error: 'Choose a folder outside the current managed asset folder.' };
    }
    try {
      await fs.mkdir(source, { recursive: true });
      await fs.mkdir(destination, { recursive: true });
      await fs.cp(source, destination, { recursive: true, force: true });
      await persistMediaLibraryLocation(destination);
      mediaLibraryOverride = destination;
      return {
        ok: true,
        root: destination,
        previousRoot: source,
        copiedFiles: (await listManagedFiles()).length,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Scrapper: archive a plain web page — PDF print, full-page screenshot and
  // the rendered HTML, all written into the managed media library.
  ipcMain.handle(
    'capture:page',
    async (
      event,
      args: { url: string; projectId: string; snapshotId: string },
    ): Promise<CapturePageResult> => {
      assertIpcSender(event, 'capture:page');
      const { url, projectId, snapshotId } = args ?? ({} as typeof args);
      if (!url || !isSafeNativeSegment(projectId) || !isSafeNativeSegment(snapshotId)) {
        return { ok: false, error: 'invalid request' };
      }
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'unsupported url' };
      if (activeCaptures.has(snapshotId)) return { ok: false, error: 'already capturing' };

      const controller = new AbortController();
      activeCaptures.set(snapshotId, controller);
      try {
        return await enqueueCapture(async (): Promise<CapturePageResult> => {
          if (controller.signal.aborted) return { ok: false, error: 'cancelled' };

          const result = await capturePage(url, controller.signal);

          const destDir = await resolveWritableLibraryPath(projectId);
          if (!destDir) throw new Error('invalid library destination');
          await fs.mkdir(destDir, { recursive: true });

          const pdfName = `${snapshotId}.pdf`;
          const htmlName = `${snapshotId}.html`;
          const pdfDestination = await resolveWritableLibraryPath(`${projectId}/${pdfName}`);
          const htmlDestination = await resolveWritableLibraryPath(`${projectId}/${htmlName}`);
          if (!pdfDestination || !htmlDestination) throw new Error('invalid library destination');
          await fs.writeFile(pdfDestination, result.pdf);
          await fs.writeFile(htmlDestination, result.html, 'utf8');

          let imagePath: string | undefined;
          if (result.png) {
            const pngName = `${snapshotId}.png`;
            const pngDestination = await resolveWritableLibraryPath(`${projectId}/${pngName}`);
            if (!pngDestination) throw new Error('invalid library destination');
            await fs.writeFile(pngDestination, result.png);
            imagePath = `${projectId}/${pngName}`;
          }

          return {
            ok: true,
            pdfPath: `${projectId}/${pdfName}`,
            htmlPath: `${projectId}/${htmlName}`,
            imagePath,
            html: result.html,
            meta: result.meta,
          };
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        activeCaptures.delete(snapshotId);
      }
    },
  );

  // Scrapper: cancel an in-flight page capture (destroys its hidden window).
  ipcMain.handle('capture:cancel', (event, snapshotId: string): void => {
    assertIpcSender(event, 'capture:cancel');
    activeCaptures.get(snapshotId)?.abort();
  });

  // Instagram session — embedded login window → cookies for yt-dlp / gallery-dl.
  ipcMain.handle('ig:login', (event) => {
    assertIpcSender(event, 'ig:login');
    return openIgLogin(mainWindow);
  });
  ipcMain.handle('ig:status', (event) => {
    assertIpcSender(event, 'ig:status');
    return igStatus();
  });
  ipcMain.handle('ig:logout', (event) => {
    assertIpcSender(event, 'ig:logout');
    return igLogout();
  });

  // Scrapper: list every post in an Instagram saved collection (metadata
  // only — no media downloaded here). Feeds ImportCollectionModal; the user
  // reviews/tags each item, then per-item download reuses media:downloadToLibrary
  // unchanged. One listing at a time — a second call aborts the first.
  ipcMain.handle('ig:listCollection', async (event, url: string): Promise<ListCollectionResult> => {
    assertIpcSender(event, 'ig:listCollection');
    if (!url || typeof url !== 'string') return { ok: false, error: 'invalid request' };
    // A bare "--input-file=…" would reach gallery-dl as an OPTION, not a URL.
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'unsupported url' };
    activeListingController?.abort();
    const controller = new AbortController();
    activeListingController = controller;
    try {
      const hasIg = await exportIgCookies().catch(() => false);
      const cookiesFile = hasIg ? igCookiesPath() : undefined;
      const items = await listCollection(url, controller.signal, cookiesFile);
      return { ok: true, items };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    } finally {
      if (activeListingController === controller) activeListingController = null;
      // The exported cookie jar is a live session credential: it exists only for
      // as long as the child process that reads it.
      await cleanupIgCookies();
    }
  });
  ipcMain.handle('ig:cancelListCollection', (event): void => {
    assertIpcSender(event, 'ig:cancelListCollection');
    activeListingController?.abort();
  });

  // --- Quick note capture -------------------------------------------------
  ipcMain.on('quick-note:set-context', (event, ctx: Partial<QuickNoteContext>) => {
    if (!acceptIpcSender(event, 'quick-note:set-context')) return;
    quickNoteContext = {
      projectId: typeof ctx?.projectId === 'string' ? ctx.projectId : null,
      projectTitle: typeof ctx?.projectTitle === 'string' ? ctx.projectTitle : null,
      locale: typeof ctx?.locale === 'string' ? ctx.locale : 'es',
    };
  });

  ipcMain.handle('quick-note:get-context', (event): QuickNoteContext => {
    assertIpcSender(event, 'quick-note:get-context');
    return quickNoteContext;
  });
  ipcMain.handle('quick-note:open', async (event): Promise<void> => {
    assertIpcSender(event, 'quick-note:open');
    await showQuickNote();
  });

  // Resolves only once the main renderer has actually written the note. See
  // `pendingQuickNotes`: anything less is a "Saved" the database never heard.
  ipcMain.handle(
    'quick-note:submit',
    async (event, payload: QuickNotePayload): Promise<QuickNoteSubmitResult> => {
      assertIpcSender(event, 'quick-note:submit');
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text) return { ok: false, error: 'empty' };
      if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };

      const requestId = `qn-${++quickNoteRequestSeq}`;
      const target = mainWindow;
      return new Promise<QuickNoteSubmitResult>((resolve) => {
        const timer = setTimeout(
          () => settleQuickNote(requestId, { ok: false, error: 'timeout' }),
          QUICK_NOTE_ACK_TIMEOUT_MS,
        );
        pendingQuickNotes.set(requestId, { settle: resolve, timer });
        try {
          target.webContents.send('quick-note:add', {
            requestId,
            text,
            kind: payload?.kind ?? 'note',
            projectId: typeof payload?.projectId === 'string' ? payload.projectId : null,
          });
        } catch (error) {
          settleQuickNote(requestId, {
            ok: false,
            error: error instanceof Error ? error.message : 'send-failed',
          });
        }
      });
    },
  );

  ipcMain.on('quick-note:ack', (event, ack: QuickNoteAck) => {
    if (!acceptIpcSender(event, 'quick-note:ack')) return;
    if (typeof ack?.requestId !== 'string') return;
    settleQuickNote(ack.requestId, {
      ok: ack.ok === true,
      error: typeof ack.error === 'string' ? ack.error : undefined,
    });
  });

  ipcMain.on('quick-note:close', (event) => {
    if (!acceptIpcSender(event, 'quick-note:close')) return;
    if (quickNoteWindow && !quickNoteWindow.isDestroyed()) quickNoteWindow.hide();
  });

  // --- Closing the window -------------------------------------------------
  // Both are `send`, not `invoke`: the renderer has nothing to wait for, and
  // an unsaved-state report that could reject would be one more thing between
  // a keystroke and the journal.
  ipcMain.on('shutdown:setWarning', (event, warning: Partial<ShutdownWarning> | null) => {
    if (!acceptIpcSender(event, 'shutdown:setWarning')) return;
    if (!warning) {
      // Nothing is at risk any more — the write landed, or the editor that
      // raised this went away. Any round still in flight is moot, and leaving
      // one standing would send the NEXT press of the X straight to the "not
      // responding" dialog instead of retrying a save that now works.
      shutdownWarning = null;
      abandonShutdown();
      return;
    }
    const text = (value: unknown, fallback: string): string =>
      typeof value === 'string' && value.trim() ? value : fallback;
    shutdownWarning = {
      title: text(warning.title, SHUTDOWN_WARNING_FALLBACK.title),
      message: text(warning.message, SHUTDOWN_WARNING_FALLBACK.message),
      closeAnyway: text(warning.closeAnyway, SHUTDOWN_WARNING_FALLBACK.closeAnyway),
      keepOpen: text(warning.keepOpen, SHUTDOWN_WARNING_FALLBACK.keepOpen),
    };
  });

  ipcMain.on(
    'shutdown:reply',
    (event, reply: { requestId?: number | null; proceed?: boolean } | undefined) => {
      if (!acceptIpcSender(event, 'shutdown:reply')) return;
      const requestId = typeof reply?.requestId === 'number' ? reply.requestId : null;
      handleShutdownReply(requestId, reply?.proceed === true);
    },
  );

  ipcMain.handle('updates:check', (event) => {
    assertIpcSender(event, 'updates:check');
    return checkForUpdates(true);
  });
  ipcMain.handle('updates:quitAndInstall', (event) => {
    assertIpcSender(event, 'updates:quitAndInstall');
    autoUpdater.quitAndInstall();
  });

  // ---- Local AI (embedded portable Ollama) --------------------------------
  // All Ollama HTTP happens here in main: the packaged renderer is file://
  // (null origin) and Ollama's CORS would reject it. See electron/ollama.ts.
  initOllama((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  });
  ipcMain.handle('ollama:getStatus', (event) => {
    assertIpcSender(event, 'ollama:getStatus');
    return getOllamaStatus();
  });
  ipcMain.handle('ollama:start', (event) => {
    assertIpcSender(event, 'ollama:start');
    return startOllama();
  });
  ipcMain.handle('ollama:downloadRuntime', (event) => {
    assertIpcSender(event, 'ollama:downloadRuntime');
    return downloadOllamaRuntime();
  });
  ipcMain.handle('ollama:cancelRuntimeDownload', (event): void => {
    assertIpcSender(event, 'ollama:cancelRuntimeDownload');
    cancelRuntimeDownload();
  });
  ipcMain.handle('ollama:pullModel', (event, tag: string) => {
    assertIpcSender(event, 'ollama:pullModel');
    return pullOllamaModel(tag);
  });
  ipcMain.handle('ollama:cancelPull', (event, tag: string): void => {
    assertIpcSender(event, 'ollama:cancelPull');
    if (typeof tag === 'string') cancelOllamaPull(tag);
  });
  ipcMain.handle('ollama:deleteModel', (event, tag: string) => {
    assertIpcSender(event, 'ollama:deleteModel');
    return deleteOllamaModel(tag);
  });
  ipcMain.handle('ollama:chat', (event, req: OllamaChatRequest) => {
    assertIpcSender(event, 'ollama:chat');
    return ollamaChat(req);
  });

  // ---- AI runtime (connections by IP/URL, gateway, copilot) ---------------
  // Every model server the app talks to — the managed Ollama included — is
  // reached from here through electron/ai/*. The renderer holds ids, never
  // URLs or keys. See docs/AI-BRIDGE.md §17.
  setBuiltinOllamaResolver(() => ollamaBaseUrl());
  registerAiIpc({ assertIpcSender, window: () => mainWindow });

  // ---- AI bridge -----------------------------------------------------------
  // The renderer answers relayed tool calls here; the rest is the settings UI.
  ipcMain.handle('aibridge:reply', (event, payload: unknown): void => {
    assertIpcSender(event, 'aibridge:reply');
    resolveBridgeReply(payload);
  });
  ipcMain.handle('aibridge:getInfo', (event) => {
    assertIpcSender(event, 'aibridge:getInfo');
    return aiBridgeInfo();
  });
  ipcMain.handle('aibridge:setEnabled', async (event, enabled: boolean) => {
    assertIpcSender(event, 'aibridge:setEnabled');
    await setBridgeConfig({ enabled: enabled === true });
    await syncAiBridgeNow();
    return aiBridgeInfo();
  });
  ipcMain.handle('aibridge:setWritesEnabled', async (event, enabled: boolean) => {
    assertIpcSender(event, 'aibridge:setWritesEnabled');
    await setBridgeConfig({ writesEnabled: enabled === true });
    return aiBridgeInfo();
  });
  ipcMain.handle('aibridge:regenerateToken', async (event) => {
    assertIpcSender(event, 'aibridge:regenerateToken');
    await regenerateBridgeToken();
    return aiBridgeInfo();
  });
  ipcMain.handle('aibridge:readAudit', async (event, limit?: number) => {
    assertIpcSender(event, 'aibridge:readAudit');
    const [entries, undone] = await Promise.all([
      readAudit(typeof limit === 'number' ? limit : 50),
      undoneIndices(),
    ]);
    return entries.map((entry) => ({ ...entry, undone: undone.includes(entry.index) }));
  });
  ipcMain.handle('aibridge:undo', async (event, index: number) => {
    assertIpcSender(event, 'aibridge:undo');
    return undoBridgeChange(index);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Single-instance lock: focus the existing window instead of spawning a second.
// ---------------------------------------------------------------------------
// The ceiling is THE MACHINE, not a constant
// ---------------------------------------------------------------------------
// Chromium ships with a V8 heap cap sized for web pages (~4 GB). This app
// scales it to the hardware it is running on: half of physical RAM for the
// window's process, and each Forge process below gets three quarters.
// Memory is only committed as allocated — an idle session costs what it
// always cost. The engine keeps bounded caches regardless, because a leak is
// a leak at any ceiling; the ceilings just stop being the story.
const TOTAL_RAM_MB = Math.floor(os.totalmem() / (1024 * 1024));
app.commandLine.appendSwitch(
  'js-flags',
  `--max-old-space-size=${Math.max(4096, Math.floor(TOTAL_RAM_MB / 2))}`,
);

// ---------------------------------------------------------------------------
// La Forja — worldgen compute in dedicated OS processes
// ---------------------------------------------------------------------------
// The renderer asks for a worker; it gets a MessagePort into a fresh
// utilityProcess running the worldgen core with @napi-rs/canvas for tiles.
// Each process owns its memory (scaled to the machine), crashes alone, and
// is reaped here when the app quits or the port closes.
const forgeChildren = new Set<Electron.UtilityProcess>();

function forgeEntry(kind: string): string {
  return path.join(
    __dirname,
    'forge',
    kind === 'worldgen' ? 'worldgenForge.cjs' : 'regionForge.cjs',
  );
}

ipcMain.on('forge:spawn', (event, payload: { kind?: string } | undefined) => {
  if (!acceptIpcSender(event, 'forge:spawn')) return;
  const port = event.ports[0];
  if (!port) return;
  const kind = payload?.kind === 'worldgen' ? 'worldgen' : 'region';
  try {
    const child = utilityProcess.fork(forgeEntry(kind), [], {
      serviceName: `worldgen-forge-${kind}`,
      env: {
        ...process.env,
        // Three quarters of the machine, per process. This is the point.
        NODE_OPTIONS: `--max-old-space-size=${Math.max(8192, Math.floor(TOTAL_RAM_MB * 0.75))}`,
        // The forge has no preload bridge, so hand it the real figure: its
        // caches size themselves from this instead of guessing a baseline.
        WH_TOTAL_RAM_BYTES: String(os.totalmem()),
      },
    });
    forgeChildren.add(child);
    child.once('exit', () => forgeChildren.delete(child));
    child.postMessage({ type: 'attach' }, [port]);
  } catch {
    // No forge (missing bundle, packaging issue): close the port so the
    // renderer's shim goes quiet and its fallback stays in charge.
    port.close();
  }
});

ipcMain.on('forge:memory', (event) => {
  if (!acceptIpcSender(event, 'forge:memory')) return;
  event.returnValue = os.totalmem();
});

app.on('will-quit', () => {
  for (const child of [...forgeChildren]) {
    try { child.kill(); } catch { /* already gone */ }
  }
  forgeChildren.clear();
});

// ---------------------------------------------------------------------------
// Crash forensics
// ---------------------------------------------------------------------------
// "Render process gone" in DevTools hides the one fact that matters: WHY.
// Electron knows — reason ('oom' | 'crashed' | 'launch-failed'…), exit code,
// and per-process memory at the time. This keeps a rolling two minutes of
// app metrics and dumps trajectory + verdict to a log the moment ANY process
// dies, so the next black screen arrives with a cause of death attached.
const FORENSICS_LOG = () => path.join(app.getPath('userData'), 'logs', 'crash-forensics.log');
const metricsRing: string[] = [];

function metricsSnapshot(): string {
  try {
    const rows = app.getAppMetrics().map((m) => {
      const mem = m.memory;
      const mb = mem ? Math.round((mem.workingSetSize ?? 0) / 1024) : -1;
      return `${m.type}${m.serviceName ? `(${m.serviceName})` : ''}#${m.pid}=${mb}MB`;
    });
    return `${new Date().toISOString()} ${rows.join(' | ')}`;
  } catch (err) {
    return `${new Date().toISOString()} metrics-failed: ${String(err)}`;
  }
}

async function forensicDump(headline: string): Promise<void> {
  try {
    const dir = path.dirname(FORENSICS_LOG());
    await fs.mkdir(dir, { recursive: true });
    const body = [
      '='.repeat(72),
      `${new Date().toISOString()}  ${headline}`,
      'Memory trajectory (oldest first):',
      ...metricsRing,
      metricsSnapshot(),
      '',
    ].join('\n');
    await fs.appendFile(FORENSICS_LOG(), body, 'utf8');
  } catch {
    // Forensics must never hurt the patient.
  }
}

setInterval(() => {
  metricsRing.push(metricsSnapshot());
  while (metricsRing.length > 8) metricsRing.shift();
}, 15_000);

app.on('render-process-gone', (_event, webContents, details) => {
  void forensicDump(
    `RENDER PROCESS GONE reason=${details.reason} exitCode=${details.exitCode} url=${webContents.getURL()}`,
  );
});

app.on('child-process-gone', (_event, details) => {
  // Expected exits (clean forge shutdowns) are logged one line, loudly only
  // when something actually went wrong.
  if (details.reason === 'clean-exit') return;
  void forensicDump(
    `CHILD PROCESS GONE type=${details.type} name=${details.name ?? ''} reason=${details.reason} exitCode=${details.exitCode}`,
  );
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Double-clicking the icon is the user saying "show me the app". This
    // instance owns the single-instance lock, so if it has no window left —
    // the app outlived its last one because something hidden was still open —
    // nobody else is going to open one. Making a new window here is the only
    // way back in short of killing the process from the task manager.
    if (!mainWindow || mainWindow.isDestroyed()) {
      void createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await loadMediaLibraryLocation();
    registerIpc();
    buildMenu();

    // Serve downloaded scrapper media to the renderer with Range/seeking support.
    // URL shape: wh-media://media/<projectId>/<file>  →  <userData>/scrapper-media/...
    protocol.handle('wh-media', async (request) => {
      try {
        const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
        const abs = await resolveExistingLibraryPath(rel);
        if (!abs) return new Response(null, { status: 403 });
        const res = await net.fetch(pathToFileURL(abs).toString());
        // Archived pages are served back into <iframe>s: without an explicit
        // type the PDF viewer never engages and the HTML renders as plain text.
        const forced = MEDIA_CONTENT_TYPES[path.extname(abs).toLowerCase()];
        if (forced) {
          const headers = new Headers(res.headers);
          headers.set('Content-Type', forced);
          return new Response(res.body, { status: res.status, headers });
        }
        return res;
      } catch {
        return new Response(null, { status: 404 });
      }
    });

    try {
      await startMediaServer();
    } catch (err) {
      // Non-fatal: the renderer shows an offline banner and the rest of the
      // app works fine without the downloader.
      console.error('[media] failed to start embedded server', err);
    }

    // The bridge answers from the main window, so it needs a way to find it.
    setBridgeWindowResolver(() => mainWindow);
    await syncAiBridgeNow();

    void createWindow();
    registerQuickNoteShortcut();
    initAutoUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

// Quit (Cmd+Q, the menu, an auto-update install) closes the window the same
// way the X does, so it runs through the same veto — a writer's last paragraph
// is worth no less because they reached for Quit. Electron cancels the whole
// quit when a `close` is vetoed, so `approveShutdown` asks for it again rather
// than expecting it to resume.
app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMediaServer();
  stopAiBridge();
  cancelAllCopilotRuns();
  shutdownGateway();
  shutdownSdRuntime();
  rejectAllPendingCalls('Writers Hoard is shutting down.');
  abortAllDownloads();
  shutdownOllama();
});
