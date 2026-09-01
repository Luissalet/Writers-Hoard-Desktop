import { db } from '@/db';
import { getSetting, setSetting } from '@/db/operations';

let initialization: Promise<void> | null = null;
let persistence: Promise<boolean> | null = null;
let deferredScheduled = false;

/** Stamped the first time the browser is asked to keep this origin's data. */
const PERSIST_REQUESTED_KEY = 'storage.persistRequestedAt';

/**
 * A job is only ever left mid-flight by a crash or a kill — a clean shutdown
 * leaves none — so this pass finds nothing on almost every launch. It used to
 * pay for that certainty with `toCollection().modify()`: a cursor over every
 * snapshot row, base64 archives and all, held under a readwrite lock while the
 * rest of the app was trying to start. The scan is now read-only and collects
 * keys, and the write is aimed at exactly those keys — so the usual "nothing to
 * repair" launch opens no write transaction at all.
 */
async function reconcileInterruptedNativeJobs(): Promise<void> {
  const interrupted: string[] = [];
  await db.snapshots.each(snapshot => {
    if (snapshot.downloadState === 'downloading' || snapshot.captureState === 'capturing') {
      interrupted.push(snapshot.id);
    }
  });
  if (interrupted.length === 0) return;
  await db.snapshots.where('id').anyOf(interrupted).modify(snapshot => {
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
 * Ask the browser, exactly once in this profile's life, to stop treating the
 * writer's book as cache.
 *
 * Unpersisted origins are evictable: under storage pressure the browser can
 * drop the whole IndexedDB database without asking anyone. `persist()` is the
 * only way to opt out, and it is answered silently (Chromium decides from site
 * engagement, Firefox asks the user), so the request is made here on start
 * rather than waiting for someone to click a 14px chip in the sidebar.
 *
 * Memoised: every caller — startup and the Dashboard's warning line — awaits
 * the same request and reads the same verdict, so the warning can never race
 * ahead of the answer. Resolves to whether the data is persistent now; it never
 * rejects, because nothing here is worth failing a launch over.
 */
export function ensurePersistentStorage(): Promise<boolean> {
  persistence ??= requestPersistentStorage();
  return persistence;
}

async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
    if (await navigator.storage.persisted()) return true;
    if (typeof navigator.storage.persist !== 'function') return false;

    // Asked once. A browser that said no keeps saying no, and re-asking every
    // launch is how a Firefox user gets a permission prompt every launch.
    if (await getSetting(PERSIST_REQUESTED_KEY)) return false;

    const granted = await navigator.storage.persist();
    await setSetting(PERSIST_REQUESTED_KEY, String(Date.now()));
    return granted;
  } catch (error) {
    console.error('[storage] persistence request failed', error);
    return false;
  }
}

/**
 * Work that must happen on every launch but must never be in front of the first
 * paint, and must never fail one: the storage-persistence request and the
 * automatic backup. Scheduled outside the initialization promise on purpose —
 * a failed snapshot reconciliation is exactly the launch where the writer most
 * needs their data marked persistent and an archive of it on disk.
 *
 * The backup module is imported lazily and never awaited. It pulls in JSZip and
 * every engine's backup strategy — the machinery that BUILDS an archive — and
 * none of that belongs in the chunk the app pays for on every launch. The
 * import failing is not a launch failure: it is one missing archive, logged.
 */
function scheduleDeferredStartupWork(): void {
  if (deferredScheduled) return;
  deferredScheduled = true;
  void ensurePersistentStorage();
  void import('./autoBackup')
    .then(module => module.scheduleStartupBackupCheck())
    .catch(error => console.error('[startup] the backup scheduler could not load', error));
}

/**
 * Idempotent process initialization. React StrictMode may call this twice;
 * every caller receives the same promise and the reconciliation runs once.
 */
export function initializeAppServices(): Promise<void> {
  scheduleDeferredStartupWork();
  initialization ??= reconcileInterruptedNativeJobs().catch(error => {
    initialization = null;
    throw error;
  });
  return initialization;
}
