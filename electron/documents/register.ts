import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { configureDocumentEngine, executeDocumentTool, isNativeDocumentTool, stopDocumentEngine } from './nativeDocumentService';

/** Installed by the desktop entry; local controls use the same document service as MCP. */
export function registerDocumentIpc(assertSender: (event: IpcMainInvokeEvent, channel: string) => void): void {
  configureDocumentEngine({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
  ipcMain.handle('documents:call', async (event, request: unknown) => {
    assertSender(event, 'documents:call');
    if (!request || typeof request !== 'object') return { ok: false, code: 'bad-args', error: 'Document request must be an object.' };
    const { tool: name, args } = request as Record<string, unknown>;
    if (typeof name !== 'string' || !isNativeDocumentTool(name)) return { ok: false, code: 'unknown-tool', error: 'Unknown document operation.' };
    const tool = getBridgeTool(name)!;
    const checked = validateToolArgs(tool.schema, args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {});
    if (!checked.ok) return { ok: false, code: checked.code, error: checked.error };
    return executeDocumentTool(name, checked.args, tool.timeoutMs);
  });
  app.once('before-quit', () => { void stopDocumentEngine(); });
}
