import { db } from '@/db';

let initialization: Promise<void> | null = null;

async function reconcileInterruptedNativeJobs(): Promise<void> {
  await db.snapshots.toCollection().modify(snapshot => {
    if (snapshot.downloadState === 'downloading') {
      snapshot.downloadState = 'error';
      snapshot.downloadError = 'The app closed before this download finished. Retry it.';
    }
    if (snapshot.captureState === 'capturing') {
      snapshot.captureState = 'error';
      snapshot.captureError = 'The app closed before this capture finished. Retry it.';
    }
  });
}

/**
 * Idempotent process initialization. React StrictMode may call this twice;
 * every caller receives the same promise and the reconciliation runs once.
 */
export function initializeAppServices(): Promise<void> {
  initialization ??= reconcileInterruptedNativeJobs().catch(error => {
    initialization = null;
    throw error;
  });
  return initialization;
}
