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
import { transcodeWebmToMp4 } from './media/transcode';
import { downloadMedia, type MediaFormat } from './media/ytdlp';
import { downloadGallery } from './media/gallerydl';
import { openIgLogin, igStatus, igLogout, exportIgCookies, igCookiesPath } from './media/igAuth';
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
  shutdownOllama,
  type OllamaChatRequest,
} from './ollama';

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
}

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

async function createWindow(): Promise<void> {
  const state = await loadWindowState();
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

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The hidden quick-capture window still counts as an open window, so
    // leaving it alive would keep the app running after its last real window
    // closed (`window-all-closed` never fires).
    if (quickNoteWindow && !quickNoteWindow.isDestroyed()) quickNoteWindow.destroy();
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

const QUICK_NOTE_ACCELERATOR = 'CommandOrControl+Shift+N';

let quickNoteWindow: BrowserWindow | null = null;
let quickNoteContext: QuickNoteContext = { projectId: null, projectTitle: null, locale: 'es' };

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

  ipcMain.handle('quick-note:submit', (event, payload: QuickNotePayload): { ok: boolean } => {
    assertIpcSender(event, 'quick-note:submit');
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return { ok: false };
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    mainWindow.webContents.send('quick-note:add', {
      text,
      kind: payload?.kind ?? 'note',
      projectId: typeof payload?.projectId === 'string' ? payload.projectId : null,
    });
    return { ok: true };
  });

  ipcMain.on('quick-note:close', (event) => {
    if (!acceptIpcSender(event, 'quick-note:close')) return;
    if (quickNoteWindow && !quickNoteWindow.isDestroyed()) quickNoteWindow.hide();
  });

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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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

    void createWindow();
    registerQuickNoteShortcut();
    initAutoUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMediaServer();
  abortAllDownloads();
  shutdownOllama();
});
