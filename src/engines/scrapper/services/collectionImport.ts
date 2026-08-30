// ============================================
// Scrapper — Instagram collection import (typed client for the IPC bridge)
// ============================================
//
// Desktop-only. Lists every post in an Instagram saved collection — metadata
// only, nothing downloaded — so ImportCollectionModal can show a review step
// (AI-suggested tags, per-item include/exclude) before anything is saved.
// Once the user confirms, per-item media download reuses the existing
// single-post path (scrapperMedia.ts → runSnapshotDownload) unchanged.

import { isDesktop } from '@/utils/platform';

export interface CollectionPost {
  /** Canonical permalink, e.g. https://www.instagram.com/p/<shortcode>/ or /reel/<shortcode>/. */
  url: string;
  shortcode: string;
  /** Caption text, when the post has one. */
  description?: string;
  uploader?: string;
  /** YYYYMMDD, best-effort. */
  uploadDate?: string;
  type?: string;
}

/**
 * List every post in an Instagram saved collection. Throws with a readable
 * message on failure (mirrors `downloadSnapshotMedia` in scrapperMedia.ts).
 *
 * Can take a while: gallery-dl paces requests 6-12s apart by design to avoid
 * tripping Instagram's abuse detection, so a collection with dozens of posts
 * is a multi-minute call. Callers should show that expectation, not a bare
 * spinner.
 */
export async function listInstagramCollection(url: string): Promise<CollectionPost[]> {
  if (!isDesktop() || !window.electronAPI) {
    throw new Error('Importar colecciones solo está disponible en la app de escritorio.');
  }
  const res = await window.electronAPI.instagram.listCollection(url);
  if (!res.ok || !res.items) {
    throw new Error(res.error || 'No se pudo listar la colección.');
  }
  return res.items;
}

/** Cancel an in-flight collection listing (best-effort). */
export async function cancelListInstagramCollection(): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;
  try {
    await window.electronAPI.instagram.cancelListCollection();
  } catch {
    /* best-effort */
  }
}
