import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { configureProofingService, checkGrammar, stopProofingService } from './service';
export function registerProofingIpc(assertSender: (event: IpcMainInvokeEvent, channel: string) => void): void {
  configureProofingService({ appPath: app.getAppPath(), isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
  ipcMain.handle('proofing:check', async (event, request: unknown) => {
    assertSender(event, 'proofing:check');
    if (!request || typeof request !== 'object') return { ok: false, code: 'bad-args', error: 'Grammar request must be an object.' };
    const { text, language } = request as Record<string, unknown>;
    if (typeof text !== 'string' || (language !== 'es' && language !== 'en-US')) return { ok: false, code: 'bad-args', error: 'Grammar requires literal text and an explicit language.' };
    return checkGrammar({ text, language });
  });
  app.once('before-quit', event => {
    event.preventDefault();
    void stopProofingService().catch(() => undefined).finally(() => { app.quit(); });
  });
}
