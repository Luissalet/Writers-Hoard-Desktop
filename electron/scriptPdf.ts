import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

export interface SaveResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

/** Prompt for a destination and write `bytes` there. Shared with MP4 export. */
export async function saveBytesViaDialog(
  parent: BrowserWindow | null,
  bytes: Buffer,
  suggestedName: string,
  filters: Electron.FileFilter[],
): Promise<SaveResult> {
  if (!parent) return { ok: false, error: 'no window' };
  const result = await dialog.showSaveDialog(parent, {
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
export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true },
  });
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-script-'));
  const htmlPath = path.join(tmpdir, 'script.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    await win.loadFile(htmlPath);
    // A document that sets its own page (`@page { size }` — a book trim) is
    // printed at that size; anything else stays on A4.
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
  } finally {
    win.destroy();
    await fs.rm(tmpdir, { recursive: true, force: true });
  }
}

export function registerScriptPdfIpc(
  assertSender: (event: IpcMainInvokeEvent, channel: string) => void,
  getParent: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    'export:scriptToPdf',
    async (event, html: string, suggestedName: string): Promise<SaveResult> => {
      assertSender(event, 'export:scriptToPdf');
      try {
        const pdf = await htmlToPdf(html);
        return await saveBytesViaDialog(getParent(), pdf, suggestedName, [
          { name: 'PDF Document', extensions: ['pdf'] },
        ]);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
