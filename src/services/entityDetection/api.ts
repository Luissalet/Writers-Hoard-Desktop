import { BrowserEntityDetectionRuntime, type EntityDetectionCancellation, type EntityDetectionJobOptions } from './browserRuntime';
import type { EntityDetectionAPI, EntityDetectionStatus, EntitySpan } from './types';

export interface EntityDetectionPort extends EntityDetectionAPI {
  prepare(options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus>;
  detect(text: string, options?: EntityDetectionJobOptions): Promise<EntitySpan[]>;
  importFiles?(files: readonly File[], options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus>;
  cancel?(jobId: string): Promise<EntityDetectionCancellation>;
}
let browser: BrowserEntityDetectionRuntime | undefined;
/** UI and bridge choose the same real runtime; no Electron API is invented. */
export function getEntityDetectionAPI(): EntityDetectionPort {
  const desktop = typeof window !== 'undefined' ? window.electronAPI?.entityDetection : undefined;
  if (desktop) return desktop;
  if (!browser) {
    browser = new BrowserEntityDetectionRuntime();
    window.addEventListener('pagehide', () => { void browser?.close(); });
  }
  return browser;
}
