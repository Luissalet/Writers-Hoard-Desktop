// ============================================
// Scrapper Engine — What a clipping actually preserves
// ============================================
//
// A saved link is only a pointer: if the page dies, so does the reference.
// This answers "what do we hold locally for this clipping?" from the same
// fields `projectIntelligence.ts` reads for its asset inventory, so the
// Recortes badge and the project cockpit never disagree about what is
// "reference-only". Pure and read-only — it never touches a row.

import type { Snapshot } from './types';

/**
 * Strongest local copy a clipping has. Precedence (strongest first):
 *
 *  - `media`     — the video/audio/photos themselves were downloaded. For a
 *                  media link that IS the content, and nothing else we store
 *                  replaces it.
 *  - `archived`  — the page was archived to disk (PDF / screenshot / HTML).
 *                  An archive already carries the text and the layout, so it
 *                  outranks text alone.
 *  - `text`      — only the readable text was kept (e.g. an archive whose
 *                  files were not restored from a metadata-only backup).
 *  - `link-only` — nothing but the URL and the user's own notes.
 */
export type PreservationLevel = 'link-only' | 'text' | 'archived' | 'media';

export type PreservableFields = Pick<
  Snapshot,
  | 'extractedText'
  | 'capturePdfPath'
  | 'captureImagePath'
  | 'captureHtmlPath'
  | 'localMediaPath'
  | 'mediaItems'
>;

export function preservationLevel(snapshot: PreservableFields): PreservationLevel {
  if (snapshot.localMediaPath || snapshot.mediaItems?.length) return 'media';
  if (snapshot.capturePdfPath || snapshot.captureHtmlPath || snapshot.captureImagePath) {
    return 'archived';
  }
  if (snapshot.extractedText?.trim()) return 'text';
  return 'link-only';
}

/**
 * A clipping whose only local trace is its link. Manual notes have no URL —
 * there is nothing out there to lose — so they never count.
 */
export function isLinkOnly(snapshot: PreservableFields & Pick<Snapshot, 'url'>): boolean {
  return Boolean(snapshot.url?.trim()) && preservationLevel(snapshot) === 'link-only';
}
