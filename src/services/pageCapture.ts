// ============================================
// Page capture — archive a plain web page (PDF + screenshot + HTML + text)
// ============================================
//
// Desktop-only counterpart of `scrapperMedia.ts`: where that one hands a link
// to yt-dlp, this one hands it to a hidden Chromium window (see
// electron/media/pageCapture.ts) and stores what comes back.
//
// This is the port of Rabbitholer's capture pipeline. The main process does
// the rendering, PDF print and screenshot; the readable-text extraction stays
// here in the renderer because that's where Readability can parse a DOM —
// exactly how Rabbitholer's `urlCapture.ts` worked on the Puppeteer output.

import { Readability } from '@mozilla/readability';
import { isDesktop } from '@/utils/platform';
import type { Snapshot, SnapshotSource } from '@/engines/scrapper/types';

/** Sources archived as a page. Media sources go through scrapperMedia instead. */
export function canCapturePage(source: SnapshotSource): boolean {
  return source === 'url';
}

/**
 * Extracted text is stored in IndexedDB (it powers the snapshot search box),
 * so cap it — a 2 MB wall of text would bloat every query for no benefit.
 */
const MAX_TEXT_CHARS = 120_000;

/** Rabbitholer's threshold: below this, Readability clearly missed the article. */
const MIN_READABLE_CHARS = 200;

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Pull the readable article text out of the captured HTML.
 * Readability first; if it finds too little, use the heuristic main-content
 * text the capture window already scraped from the live DOM.
 */
export function extractReadableText(html: string, fallback?: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const article = new Readability(doc, { charThreshold: 20, keepClasses: false }).parse();
    const text = article?.textContent ? tidy(article.textContent) : '';
    if (text.length >= MIN_READABLE_CHARS) return text.slice(0, MAX_TEXT_CHARS);
  } catch {
    /* malformed markup — fall through to the heuristic text */
  }
  return (fallback ? tidy(fallback) : '').slice(0, MAX_TEXT_CHARS);
}

/** Cancel an in-flight page capture (destroys its hidden browser window). */
export async function cancelSnapshotCapture(snapshotId: string): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;
  try {
    await window.electronAPI.capture.cancel(snapshotId);
  } catch {
    /* best-effort */
  }
}

/** Delete a snapshot's archived page files (best-effort). */
export async function deleteSnapshotCapture(
  snapshot: Pick<Snapshot, 'capturePdfPath' | 'captureImagePath' | 'captureHtmlPath'>,
): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;
  const paths = [
    snapshot.capturePdfPath,
    snapshot.captureImagePath,
    snapshot.captureHtmlPath,
  ].filter((p): p is string => !!p);
  for (const relPath of paths) {
    try {
      await window.electronAPI.media.deleteLibraryFile(relPath);
    } catch {
      /* a leftover file is harmless */
    }
  }
}

/**
 * Full capture lifecycle for a snapshot: mark capturing → render + archive →
 * mark done (with the saved paths and scraped metadata) or error. Drives both
 * the automatic capture on paste and the manual retry. `update` is the entity
 * hook's `editItem`. Never throws — failures land in the snapshot's captureError.
 */
export async function runSnapshotCapture(
  snapshot: Pick<
    Snapshot,
    'id' | 'url' | 'projectId' | 'title' | 'description' | 'author' | 'publishDate'
  >,
  update: (id: string, changes: Partial<Snapshot>) => void | Promise<void>,
): Promise<void> {
  if (!isDesktop() || !window.electronAPI) return;

  await update(snapshot.id, { captureState: 'capturing', captureError: undefined });
  try {
    const res = await window.electronAPI.capture.page({
      url: snapshot.url,
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
    });

    if (!res.ok) {
      // User cancelled → back to link-only; duplicate request → leave as-is.
      if (res.error === 'cancelled') {
        await update(snapshot.id, { captureState: 'idle', captureError: undefined });
        return;
      }
      if (res.error === 'already capturing') return;
      await update(snapshot.id, {
        captureState: 'error',
        captureError: res.error || 'capture failed',
      });
      return;
    }

    const meta = res.meta ?? {};
    const changes: Partial<Snapshot> = {
      capturePdfPath: res.pdfPath,
      captureImagePath: res.imagePath,
      captureHtmlPath: res.htmlPath,
      captureState: 'done',
      captureError: undefined,
      status: 'success',
    };

    if (res.html) {
      const text = extractReadableText(res.html, meta.fallbackText);
      if (text) changes.extractedText = text;
    }

    // Fill in what the page told us about itself — but never overwrite the
    // user's own edits. The capture bar seeds `title` with the bare domain,
    // so a real page title always wins over that placeholder.
    const domainPlaceholder = (() => {
      try {
        return new URL(snapshot.url).hostname.replace('www.', '');
      } catch {
        return '';
      }
    })();
    if (meta.title && (!snapshot.title?.trim() || snapshot.title === domainPlaceholder)) {
      changes.title = meta.title.slice(0, 300);
    }
    if (meta.author && !snapshot.author?.trim()) changes.author = meta.author;
    if (meta.description && !snapshot.description?.trim()) {
      changes.description = meta.description;
    }
    if (meta.publishDate && !snapshot.publishDate) changes.publishDate = meta.publishDate;

    const metadata: Record<string, string> = {};
    if (meta.siteName) metadata.siteName = meta.siteName;
    if (meta.language) metadata.language = meta.language;
    if (meta.wordCount) metadata.wordCount = String(meta.wordCount);
    if (Object.keys(metadata).length > 0) changes.metadata = metadata;

    await update(snapshot.id, changes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await update(snapshot.id, { captureState: 'error', captureError: msg });
  }
}
