// Preload for the two hidden pages of the one-time origin migration
// (originMigration.ts). Exposes nothing else; the main process only answers
// these channels for the exact windows it created, and only while copying.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__whMigration', {
  put: (chunk: unknown): Promise<boolean> => ipcRenderer.invoke('wh-migration:put', chunk),
  get: (index: number): Promise<unknown> => ipcRenderer.invoke('wh-migration:get', index),
});
