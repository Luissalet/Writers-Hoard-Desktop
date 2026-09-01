// ============================================
// Google Docs / Drive Service
// ============================================

import { cleanGoogleDocsHtml, countWords } from '@/utils/googleDocsHtmlCleaner';
import { generateId } from '@/utils/idGenerator';
import * as ops from '@/db/operations';
import { takeSnapshot } from '@/engines/writings/snapshots';
import { assertTokenAccepted } from '@/services/googleAuth';
import { t } from '@/i18n/useTranslation';
import type { Writing } from '@/types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DOCS_API = 'https://docs.googleapis.com/v1';

export interface GoogleDocFile {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink: string;
  thumbnailLink?: string;
}

/**
 * List Google Docs from the user's Drive
 */
export async function listGoogleDocs(
  accessToken: string,
  query?: string
): Promise<GoogleDocFile[]> {
  let q = "mimeType='application/vnd.google-apps.document' and trashed=false";
  if (query) {
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime,webViewLink,thumbnailLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '50',
  });

  const response = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  assertTokenAccepted(response);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list Google Docs: ${error}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Fetch a Google Doc's content as HTML
 */
export async function fetchGoogleDocHtml(
  accessToken: string,
  fileId: string
): Promise<string> {
  const response = await fetch(
    `${DRIVE_API}/files/${fileId}/export?mimeType=text/html`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  assertTokenAccepted(response);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to export Google Doc: ${error}`);
  }

  const rawHtml = await response.text();
  return cleanGoogleDocsHtml(rawHtml);
}

/**
 * Get file metadata (to check modifiedTime for sync)
 */
export async function getDocMetadata(
  accessToken: string,
  fileId: string
): Promise<{ modifiedTime: string; name: string }> {
  const params = new URLSearchParams({
    fields: 'modifiedTime,name',
  });

  const response = await fetch(`${DRIVE_API}/files/${fileId}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  assertTokenAccepted(response);
  if (!response.ok) {
    throw new Error('Failed to fetch doc metadata');
  }

  return response.json();
}

/**
 * Import a Google Doc as a Writing record in Dexie
 */
export async function importGoogleDoc(
  _accessToken: string,
  doc: GoogleDocFile,
  projectId: string
): Promise<Writing> {
  // Only store a reference — content lives in Google Docs
  const writing: Writing = {
    id: generateId('wrt'),
    projectId,
    title: doc.name,
    status: 'draft',
    content: '',
    synopsis: undefined,
    wordCount: 0,
    chapter: undefined,
    tags: ['google-doc'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // Google Docs fields
    googleDocId: doc.id,
    googleDocUrl: doc.webViewLink,
    googleDocName: doc.name,
    // Deliberately no `lastSyncedAt`: linking fetches nothing, so stamping one
    // here made the badge announce a sync that never happened and presented an
    // empty local copy as the document's freshly-pulled state. The badge simply
    // omits the line until a real pull lands.
    syncDirection: 'pull',
    isGoogleDoc: true,
  };

  await ops.createWriting(writing);
  return writing;
}

// ============================================
// Pull sync — with a restore point and a shrink guard
// ============================================
//
// The cached copy is not a convenience: it is what Compile, publishing and
// full-text search read, and a pull replaces it wholesale. Two things used to
// make that unrecoverable. Nothing snapshotted these documents — `handleOpenWriting`
// skips the per-session `takeSnapshot` for Google Docs — so History had nothing
// to offer afterwards. And an export that came back empty was applied without a
// word: a half-deleted or mid-edit doc answers 200 with near-empty markup, so no
// error path fires and a 2 400-word chapter becomes 0 words with a new title.

/** Below this share of the cached word count, a pull is treated as suspect. */
const SUSPECT_SHRINK_RATIO = 0.5;
/** Cached copies this small are not worth interrupting the writer over. */
const SUSPECT_MIN_CACHED_WORDS = 20;

export type GoogleDocSyncRisk = 'none' | 'emptied' | 'shrunk';

/** A pull that has been fetched but not written, so the writer confirms what they saw. */
export interface GoogleDocSyncPreview {
  changes: Partial<Writing>;
  risk: GoogleDocSyncRisk;
  cachedWordCount: number;
  incomingWordCount: number;
}

export type GoogleDocSyncOutcome =
  | { status: 'applied'; changes: Partial<Writing> }
  | { status: 'needs-confirmation'; preview: GoogleDocSyncPreview };

function assessShrink(cachedWordCount: number, incomingWordCount: number): GoogleDocSyncRisk {
  if (cachedWordCount === 0) return 'none'; // nothing cached to lose
  if (incomingWordCount === 0) return 'emptied';
  if (cachedWordCount < SUSPECT_MIN_CACHED_WORDS) return 'none';
  if (incomingWordCount < cachedWordCount * SUSPECT_SHRINK_RATIO) return 'shrunk';
  return 'none';
}

/**
 * Write a fetched pull into the writing, behind a restore point.
 *
 * The snapshot is taken of the writing as it stands *before* the pull, which is
 * the only restore point a linked Google Doc ever gets — so History can undo a
 * sync the same way it undoes an editing session. `lastSyncedAt` is stamped here
 * rather than at fetch time, so it dates the write, not a pull the writer may
 * have spent a minute deciding about.
 */
export async function applyGoogleDocSync(
  writing: Writing,
  preview: GoogleDocSyncPreview
): Promise<Partial<Writing>> {
  await takeSnapshot(writing, 'auto');

  const changes: Partial<Writing> = {
    ...preview.changes,
    lastSyncedAt: Date.now(),
    updatedAt: Date.now(),
  };

  await ops.updateWriting(writing.id, changes);
  return changes;
}

/**
 * Sync a Google Doc writing — pull latest content.
 *
 * Applies the pull itself when it is unremarkable. When it would empty or gut
 * the cached copy it writes nothing and hands the fetched result back, for the
 * caller to put to the writer and then pass to `applyGoogleDocSync`.
 */
export async function syncGoogleDoc(
  accessToken: string,
  writing: Writing
): Promise<GoogleDocSyncOutcome> {
  if (!writing.googleDocId) {
    throw new Error(t('writings.gdoc.notLinked'));
  }

  const cleanHtml = await fetchGoogleDocHtml(accessToken, writing.googleDocId);
  const metadata = await getDocMetadata(accessToken, writing.googleDocId);

  const incomingWordCount = countWords(cleanHtml);
  // Measured from the content itself: `wordCount` is what the writer is shown,
  // but the HTML is what a pull actually overwrites.
  const cachedWordCount = countWords(writing.content ?? '');

  const preview: GoogleDocSyncPreview = {
    changes: {
      content: cleanHtml,
      wordCount: incomingWordCount,
      googleDocName: metadata.name,
      title: metadata.name, // Keep title in sync with doc name
    },
    risk: assessShrink(cachedWordCount, incomingWordCount),
    cachedWordCount,
    incomingWordCount,
  };

  if (preview.risk !== 'none') return { status: 'needs-confirmation', preview };
  return { status: 'applied', changes: await applyGoogleDocSync(writing, preview) };
}

/**
 * Check if a Google Doc has been modified since last sync
 */
export async function hasDocChanged(
  accessToken: string,
  writing: Writing
): Promise<boolean> {
  if (!writing.googleDocId || !writing.lastSyncedAt) return false;

  try {
    const metadata = await getDocMetadata(accessToken, writing.googleDocId);
    const docModified = new Date(metadata.modifiedTime).getTime();
    return docModified > writing.lastSyncedAt;
  } catch {
    return false;
  }
}

// ============================================
// On-demand content fetch for AI analysis
// Uses the Docs API — no 10 MB export limit
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractParagraphText(paragraph: any): string {
  return (paragraph.elements || [])
    .filter((el: any) => el.textRun)
    .map((el: any) => (el.textRun.content as string).replace(/\n$/, ''))
    .join('');
}

function docsJsonToHtml(doc: any): string {
  const elements: any[] = doc.body?.content || [];
  const lines: string[] = [];

  for (const element of elements) {
    if (element.paragraph) {
      const text = extractParagraphText(element.paragraph);
      if (text.trim()) lines.push(`<p>${text}</p>`);
    } else if (element.table) {
      for (const row of (element.table.tableRows || [])) {
        for (const cell of (row.tableCells || [])) {
          for (const el of (cell.content || [])) {
            if (el.paragraph) {
              const text = extractParagraphText(el.paragraph);
              if (text.trim()) lines.push(`<p>${text}</p>`);
            }
          }
        }
      }
    }
  }

  return lines.join('\n');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch a Google Doc's full content as HTML for AI analysis.
 * Uses the Docs API JSON endpoint — no file-size limit.
 * The content is NOT stored locally; it is used only transiently for AI calls.
 */
export async function fetchGoogleDocForAi(
  accessToken: string,
  fileId: string
): Promise<string> {
  const response = await fetch(`${DOCS_API}/documents/${fileId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  assertTokenAccepted(response);
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`No se pudo obtener el documento para análisis: ${err}`);
  }

  const doc = await response.json();
  const html = docsJsonToHtml(doc);

  if (!html.trim()) {
    throw new Error('El documento parece estar vacío');
  }

  return html;
}
