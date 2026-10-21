import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { VisualSearchRuntime } from './runtime';
export function registerVisualSearchIpc(assertSender: (event: IpcMainInvokeEvent, channel: string) => void, runtime = new VisualSearchRuntime(path.join(app.getPath('userData'), 'visual-search'), path.join(__dirname, 'visualSearch/worker.cjs'))): void {
  for (const [action, invoke] of Object.entries({ status: () => runtime.status(), prepare: () => runtime.prepare(), image: (value: string) => runtime.image(value), text: (value: string) => runtime.text(value) })) {
    const channel = `visual-search:${action}`;
    ipcMain.handle(channel, (event, value: string) => { assertSender(event, channel); return invoke(value); });
  }
  app.once('will-quit', () => { void runtime.close(); });
}
