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

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { autoUpdater } from 'electron-updater';
import { startMediaServer, stopMediaServer, MEDIA_SERVER_URL } from './media/server';
import { transcodeWebmToMp4 } from './media/transcode';

interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

const isDev = !app.isPackaged;
const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5174';

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links (target=_blank, window.open) open in the OS browser,
  // never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Defense in depth: block top-level navigation away from our own renderer.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const ownOrigin = isDev ? RENDERER_DEV_URL : 'file://';
    if (!url.startsWith(ownOrigin)) {
      event.preventDefault();
      if (url.startsWith('http')) void shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Renderer uses HashRouter in Electron, so a plain file load is enough.
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getDataPath', () => app.getPath('userData'));
  ipcMain.handle('app:getMediaServerUrl', () => MEDIA_SERVER_URL);

  ipcMain.handle('fs:pickFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:readFile', (_e, filePath: string) => fs.readFile(filePath, 'utf8'));
  ipcMain.handle('fs:writeFile', (_e, filePath: string, data: string) =>
    fs.writeFile(filePath, data, 'utf8'),
  );
  ipcMain.handle('fs:exists', async (_e, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Teleprompter video: re-encode the renderer's WebM capture to MP4 and save it.
  ipcMain.handle(
    'media:saveTeleprompterMp4',
    async (_e, webm: ArrayBuffer, suggestedName: string): Promise<SaveResult> => {
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
    async (_e, html: string, suggestedName: string): Promise<SaveResult> => {
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

  ipcMain.handle('updates:check', () => checkForUpdates(true));
  ipcMain.handle('updates:quitAndInstall', () => {
    autoUpdater.quitAndInstall();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Single-instance lock: focus the existing window instead of spawning a second.
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
    registerIpc();
    buildMenu();

    try {
      await startMediaServer();
    } catch (err) {
      // Non-fatal: the renderer shows an offline banner and the rest of the
      // app works fine without the downloader.
      console.error('[media] failed to start embedded server', err);
    }

    createWindow();
    initAutoUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopMediaServer();
});
