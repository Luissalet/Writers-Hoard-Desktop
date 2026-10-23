// ============================================================================
// "You never wrote anything in this one" — spotting a brand-new empty document
// ============================================================================
//
// Closing a tab that shows a document made a moment ago and still empty is the
// one close where the writer may not want the document to stay behind. This
// answers only the factual half: is the document open in this tab fresh and
// untouched? The tab bar asks the writer; the delete goes through the
// document's own delete path (which archives it), never a raw table delete.
//
// Deliberately narrow, and honest about it: cards (codex) and chapters
// (writings), in the shared base only. Other tools are not guessed at.

import { db } from '@/db';
import { workspaceEra, type WorkspaceRoute } from './routes';
import type { WorkspaceDocument } from './library/types';
import { workspaceDocument } from './library/catalog';

/** A document made longer ago than this is somebody's draft, not a slip. */
export const FRESH_WINDOW_MS = 12 * 60 * 60 * 1000;

const visibleText = (html: unknown) => typeof html === 'string' ? html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').trim() : '';

/** Tags a blank page can contain. Anything else (a picture, an embedded block, a table…) is something the writer put there. */
const BLANK_TAGS = new Set(['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code']);
/** Content that is not text but is not blank either: any image or embedded block counts as written. */
export function hasNonTextContent(html: unknown): boolean {
  if (typeof html !== 'string' || !html.includes('<')) return false;
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    if (!BLANK_TAGS.has(match[1].toLowerCase()) || /\bdata-wh[\w-]*\s*=/i.test(match[2])) return true;
  }
  return false;
}
/** The titles a document gets before anyone names it (both languages); a different title was typed by the writer. */
const DEFAULT_TITLES = new Set(['', 'sin título', 'untitled', 'nueva entrada', 'new entry', 'nuevo escrito', 'new writing', 'capítulo sin título', 'untitled chapter']);
const hasOwnTitle = (title: unknown) => !DEFAULT_TITLES.has(String(title ?? '').replace(/\s+/g, ' ').trim().toLowerCase());
const filled = (value: unknown): boolean => Array.isArray(value) ? value.some(filled) : value !== null && typeof value === 'object' ? Object.values(value).some(filled) : typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' ? true : false;

/** Documents the writer already said "keep" about, for the rest of this session. */
const kept = new Set<string>();
export const keepFreshDocument = (projectId: string, engineId: string, entityId: string) => { kept.add(`${projectId}:${engineId}:${entityId}`); };
export const forgetKeptDocuments = () => kept.clear();

export function routeDocument(route: WorkspaceRoute, projectId: string): { engineId: 'codex' | 'writings'; entityId: string } | null {
  if (workspaceEra(route)) return null;
  const match = /^\/project\/([^/]+)\/(codex|writings)\/?$/.exec(route.pathname);
  if (!match || decodeURIComponent(match[1]) !== projectId) return null;
  const engineId = match[2] as 'codex' | 'writings';
  const entityId = new URLSearchParams(route.search).get(engineId === 'codex' ? 'entry' : 'writing');
  return entityId ? { engineId, entityId } : null;
}

/** Is this very document still brand new and untouched? Re-checkable at any moment (the delete re-asks it). */
export async function freshUntouchedDocument(projectId: string, engineId: 'codex' | 'writings', entityId: string, now = Date.now()): Promise<WorkspaceDocument | null> {
  if (kept.has(`${projectId}:${engineId}:${entityId}`)) return null;
  if (engineId === 'codex') {
    const row = await db.codexEntries.get(entityId);
    if (!row || row.projectId !== projectId || now - row.createdAt > FRESH_WINDOW_MS) return null;
    const empty = !hasOwnTitle(row.title) && !visibleText(row.content) && !hasNonTextContent(row.content) && !row.avatar && !row.avatarOriginal && !row.tags?.length && !row.relations?.length
      && !filled(row.fields) && !filled(row.referenceFields);
    return empty ? workspaceDocument(projectId, 'codex', row.id, row.title) : null;
  }
  const row = await db.writings.get(entityId);
  if (!row || row.projectId !== projectId || now - row.createdAt > FRESH_WINDOW_MS) return null;
  const empty = !hasOwnTitle(row.title) && !visibleText(row.content) && !hasNonTextContent(row.content) && !(row.wordCount > 0) && !row.synopsis?.trim() && !row.tags?.length && !row.kicker?.trim() && !row.worldDate;
  return empty ? workspaceDocument(projectId, 'writings', row.id, row.title) : null;
}

/** The document this route shows when it was created recently and holds nothing yet. */
export async function findFreshUntouchedDocument(projectId: string, route: WorkspaceRoute, now = Date.now()): Promise<WorkspaceDocument | null> {
  const target = routeDocument(route, projectId);
  return target ? freshUntouchedDocument(projectId, target.engineId, target.entityId, now) : null;
}
