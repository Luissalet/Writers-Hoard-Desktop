// ============================================
// useDownloadFolder — persist a FileSystemDirectoryHandle across reloads
// ============================================
//
// FileSystemDirectoryHandle objects are structured-cloneable so they can be
// stored in IndexedDB. We keep them in a tiny dedicated IndexedDB store
// (separate from the Dexie app DB) so picking a folder doesn't require a
// schema migration.
//
// After reload the browser still has the handle but the user's *permission*
// must be re-requested with `handle.requestPermission()`.

import { useCallback, useEffect, useState } from 'react';
import { supportsDirectoryPicker } from '@/services/mediaDownloader';

const DB_NAME = 'wh-media-downloader';
const STORE = 'handles';
const KEY = 'downloadFolder';

// ---------------------------------------------------------------------------
// Tiny IndexedDB helpers
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    if (handle == null) {
      store.delete(KEY);
    } else {
      store.put(handle, KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported';

async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as unknown as {
    queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof h.queryPermission !== 'function') return 'unsupported';
  return (await h.queryPermission({ mode: 'readwrite' })) as PermState;
}

async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  const h = handle as unknown as {
    requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof h.requestPermission !== 'function') return 'unsupported';
  return (await h.requestPermission({ mode: 'readwrite' })) as PermState;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDownloadFolder {
  /** Currently selected directory handle (null = none, undefined = still loading) */
  handle: FileSystemDirectoryHandle | null | undefined;
  /** Permission state for the current handle */
  permission: PermState;
  /** Whether the browser supports `showDirectoryPicker` at all */
  supported: boolean;
  /** Open the native folder picker and store the chosen handle */
  pick: () => Promise<void>;
  /** Re-request readwrite permission for the current handle (user gesture required) */
  ensurePermission: () => Promise<boolean>;
  /** Forget the current handle */
  clear: () => Promise<void>;
}

export function useDownloadFolder(): UseDownloadFolder {
  const supported = supportsDirectoryPicker();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null | undefined>(undefined);
  const [permission, setPermission] = useState<PermState>('prompt');

  // Load any stored handle on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported) {
        if (!cancelled) {
          setHandle(null);
          setPermission('unsupported');
        }
        return;
      }
      const stored = await readHandle();
      if (cancelled) return;
      setHandle(stored);
      if (stored) {
        setPermission(await queryPermission(stored));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const pick = useCallback(async () => {
    if (!supported) return;
    const w = window as unknown as {
      showDirectoryPicker: (opts?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    };
    try {
      const newHandle = await w.showDirectoryPicker({ mode: 'readwrite' });
      await writeHandle(newHandle);
      setHandle(newHandle);
      setPermission(await queryPermission(newHandle));
    } catch (e) {
      // User cancelled or denied — keep previous state.
      if ((e as DOMException)?.name !== 'AbortError') {
        console.warn('Folder pick failed:', e);
      }
    }
  }, [supported]);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (!handle) return false;
    const current = await queryPermission(handle);
    if (current === 'granted') {
      setPermission('granted');
      return true;
    }
    const next = await requestPermission(handle);
    setPermission(next);
    return next === 'granted';
  }, [handle]);

  const clear = useCallback(async () => {
    await writeHandle(null);
    setHandle(null);
    setPermission('prompt');
  }, []);

  return { handle, permission, supported, pick, ensurePermission, clear };
}
