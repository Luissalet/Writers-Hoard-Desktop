// ============================================
// Family library search — wire types and pure parsing
// ============================================
//
// The user's other local apps can be asked to search their own documents (a
// reading library, saved pages). The request goes through the local hub, made
// by the main process (electron/familySearch.ts); this module holds what both
// sides agree on and everything that needs no database: reading the hits
// leniently, redacting private people from a query, and shaping a hit into a
// citation. A hit is a POINTER: the document stays in its own app and only a
// title, a reference and the excerpt the search returned are kept here.

export const FAMILY_APPS = ['borges', 'links'] as const;
export type FamilyApp = typeof FAMILY_APPS[number];

/** The tool each app answers to; both take `{ q, limit }`. */
export const FAMILY_TOOLS: Readonly<Record<FamilyApp, string>> = { borges: 'library_search', links: 'search_links' };

const KIND_BY_APP: Readonly<Record<FamilyApp, string>> = { borges: 'document', links: 'page' };

export const FAMILY_MAX_QUERY = 200;
export const FAMILY_MAX_LIMIT = 10;
export const FAMILY_DEFAULT_LIMIT = 5;

export interface FamilySearchRequest {
  app: FamilyApp;
  q: string;
  limit?: number;
}

export type FamilyFailure = 'bad-request' | 'hub_unreachable' | 'unauthorized' | 'app_unavailable' | 'timeout' | 'too-large' | 'bad_response';

export type FamilySearchResponse =
  | { ok: true; data: unknown }
  | { ok: false; code: FamilyFailure; error: string };

export interface FamilyHit {
  app: FamilyApp;
  /** `hoard://<app>/<kind>/<id>`: stable, and enough to open the document later. */
  ref: string;
  title: string;
  /** What the search returned as a preview; never more than MAX_EXCERPT characters. */
  excerpt: string;
  /** Only a plain http(s) address; anything else is dropped. */
  url?: string;
}

const MAX_EXCERPT = 1000;
const MAX_TITLE = 300;
const ID_KEYS = ['id', 'doc_id', 'document_id', 'link_id', 'item_id', 'uid'] as const;
const TITLE_KEYS = ['title', 'name', 'label'] as const;
const TEXT_KEYS = ['snippet', 'excerpt', 'text', 'content', 'summary', 'description'] as const;
const URL_KEYS = ['url', 'link', 'href'] as const;
const LIST_KEYS = ['items', 'results', 'hits', 'documents', 'links', 'matches', 'data'] as const;
const REF_PATTERN = /^hoard:\/\/([a-z0-9_-]+)\/([a-z0-9_-]+)\/(\S+)$/i;

function firstText(hit: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = hit[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function collapse(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The rows of a reply, whichever envelope the app put them in. */
function rowsOf(raw: unknown): Record<string, unknown>[] {
  const isRow = (row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row);
  if (Array.isArray(raw)) return raw.filter(isRow);
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of LIST_KEYS) {
      if (Array.isArray(record[key])) return (record[key] as unknown[]).filter(isRow);
    }
    // One level deeper: some apps wrap the answer as { result: { items: [...] } }.
    if (record.result && typeof record.result === 'object') return rowsOf(record.result);
  }
  return [];
}

function plainWebAddress(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** A `hoard://` reference for a hit, or null when it carries nothing to point at. */
export function refFor(app: FamilyApp, hit: Record<string, unknown>): string | null {
  const given = firstText(hit, ['ref', 'uri', 'hoard_ref']);
  const match = REF_PATTERN.exec(given);
  if (match && match[1].toLowerCase() === app) return `hoard://${app}/${match[2].toLowerCase()}/${match[3]}`;
  const id = firstText(hit, ID_KEYS);
  if (!id) return null;
  return `hoard://${app}/${KIND_BY_APP[app]}/${encodeURIComponent(id)}`;
}

/** Hits from one app's reply. Rows with nothing to point at are skipped; nothing throws. */
export function parseHits(app: FamilyApp, raw: unknown, limit = FAMILY_MAX_LIMIT): FamilyHit[] {
  const out: FamilyHit[] = [];
  const seen = new Set<string>();
  for (const row of rowsOf(raw)) {
    const ref = refFor(app, row);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const url = plainWebAddress(firstText(row, URL_KEYS));
    const hit: FamilyHit = {
      app,
      ref,
      title: collapse(firstText(row, TITLE_KEYS) || url || ref, MAX_TITLE),
      excerpt: collapse(firstText(row, TEXT_KEYS), MAX_EXCERPT),
    };
    if (url) hit.url = url;
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- Privacy: private people never leave in a query ----------

export interface NamedEntry {
  type: string;
  title: string;
  publicFigure?: boolean;
  fields?: Record<string, string>;
}

/** Names a private person goes by: the title, the name field and every word of them long enough to identify. */
function namesOf(entry: NamedEntry): string[] {
  const whole = [entry.title, entry.fields?.name ?? ''].map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const words = whole.flatMap(text => text.split(/[\s,.;:()"'“”‘’-]+/)).filter(word => [...word].length >= 3);
  return [...new Set([...whole, ...words])].sort((a, b) => b.length - a.length);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Redaction {
  /** The query with private people taken out; safe to send. */
  query: string;
  /** Titles of the private people whose names were found in it. */
  removed: string[];
}

/**
 * Take every private person out of a query. A character is private unless the
 * author marked them a public figure, and so is treated as private here even
 * when only a first name matches: a stray first name is cheaper to lose than a
 * private person's name is to leak.
 */
export function redactPrivateNames(query: string, entries: readonly NamedEntry[]): Redaction {
  let text = query.replace(/\s+/g, ' ').trim();
  const removed: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'character' || entry.publicFigure === true) continue;
    let hit = false;
    for (const name of namesOf(entry)) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(name)}(?![\\p{L}\\p{N}])`, 'giu');
      if (pattern.test(text)) {
        hit = true;
        text = text.replace(pattern, ' ');
      }
    }
    if (hit) removed.push(entry.title);
  }
  return { query: text.replace(/\s+/g, ' ').trim(), removed };
}

/** True when something searchable is left: a query of only punctuation is not a query. */
export function hasSearchableText(query: string): boolean {
  return /[\p{L}\p{N}]/u.test(query);
}
