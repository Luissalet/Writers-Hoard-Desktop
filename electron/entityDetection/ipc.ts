import type { IpcMain } from 'electron';
import type { EntityDetectionAPI } from '../../src/services/entityDetection/types';
export function registerEntityDetectionIpc(ipcMain: Pick<IpcMain, 'handle'>, runtime: EntityDetectionAPI) {
  ipcMain.handle('entity-detection:status', () => runtime.status());
  ipcMain.handle('entity-detection:prepare', () => runtime.prepare());
  ipcMain.handle('entity-detection:detect', (_event, text: string) => runtime.detect(text));
}
