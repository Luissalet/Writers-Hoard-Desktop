// ============================================
// Family library search — the renderer side
// ============================================
//
// Search the user's other local apps for documents, and file the hits the
// writer picks as citations. A hit never becomes evidence by itself: the
// citation it creates is ungraded and carries the excerpt the search returned
// as a PENDING excerpt, which still has to be checked against the document.
//
// The private-person guard lives here, before anything is sent: a character
// the author has not marked as a public figure is taken out of the query.

import { db } from '@/db';
import type { Citation, ResearchEvidence } from '@/types/projectTools';
import { generateId } from '@/utils/idGenerator';
import {
  FAMILY_APPS, FAMILY_DEFAULT_LIMIT, FAMILY_MAX_LIMIT, FAMILY_MAX_QUERY, hasSearchableText, parseHits, redactPrivateNames,
  type FamilyApp, type FamilyFailure, type FamilyHit, type FamilySearchRequest, type FamilySearchResponse,
} from './familySearch';

export type FamilySearchErrorCode = 'scope' | 'unavailable' | 'query' | 'private_query' | 'hit';

const HINTS: Partial<Record<FamilySearchErrorCode, string>> = {
  unavailable: 'Library search needs the desktop app; this build has no connection to the local hub.',
  private_query: 'The query only contained the names of people who are not marked as public figures, and those are never sent. Search for a topic, an organisation or a place instead.',
};

export class FamilySearchError extends Error {
  readonly code: FamilySearchErrorCode;
  readonly hint: string;
  constructor(code: FamilySearchErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FamilySearchError';
    this.code = code;
    this.hint = HINTS[code] ?? '';
  }
}

export type FamilyTransport = (request: FamilySearchRequest) => Promise<FamilySearchResponse>;

export function familyTransport(): FamilyTransport | null {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI?.family;
  return api ? request => api.search(request) : null;
}

/** What the writer or the agent is told when an app did not answer. */
const APP_HINTS: Record<FamilyFailure, string> = {
  'bad-request': 'The request was refused before it was sent.',
  hub_unreachable: 'The Hoard hub is not running. Start it and try again; nothing else in the investigation is affected.',
  unauthorized: 'The hub did not accept this app\'s token. Restart the hub so it reads the token again.',
  app_unavailable: 'That app is not running or has no search tool. Start it from the hub and try again.',
  timeout: 'The app did not answer in time. Try again in a moment.',
  'too-large': 'The app answered with far more than a list of hits.',
  bad_response: 'The app answered with something that is not a list of hits.',
};

export type FamilyAppResult =
  | { status: 'ok'; hits: FamilyHit[] }
  | { status: 'unavailable'; code: FamilyFailure; error: string; hint: string };

export interface FamilyLibrarySearch {
  /** What was actually sent, after private people were taken out. */
  query: string;
  /** Titles of the private people whose names were removed from the query. */
  redacted: string[];
  apps: Partial<Record<FamilyApp, FamilyAppResult>>;
}

export async function searchFamilyLibrary(
  projectId: string,
  rawQuery: string,
  options: { apps?: readonly FamilyApp[]; limit?: number; transport?: FamilyTransport | null } = {},
): Promise<FamilyLibrarySearch> {
  const text = rawQuery.replace(/\s+/g, ' ').trim();
  if (!text || text.length > FAMILY_MAX_QUERY) throw new FamilySearchError('query');
  const apps = [...new Set(options.apps?.length ? options.apps : FAMILY_APPS)];
  const limit = Math.max(1, Math.min(FAMILY_MAX_LIMIT, Math.floor(options.limit ?? FAMILY_DEFAULT_LIMIT)));
  if (!await db.projects.get(projectId)) throw new FamilySearchError('scope');

  // Before anything is sent, and before anything else can fail: a character is
  // private until the author says otherwise.
  const entries = await db.codexEntries.where('projectId').equals(projectId).toArray();
  const { query, removed } = redactPrivateNames(text, entries);
  if (!hasSearchableText(query)) throw new FamilySearchError('private_query');
  const send = options.transport ?? familyTransport();
  if (!send) throw new FamilySearchError('unavailable');

  const results: FamilyLibrarySearch['apps'] = {};
  for (const app of apps) {
    let response: FamilySearchResponse;
    try {
      response = await send({ app, q: query, limit });
    } catch (error) {
      response = { ok: false, code: 'hub_unreachable', error: error instanceof Error ? error.message : String(error) };
    }
    results[app] = response.ok
      ? { status: 'ok', hits: parseHits(app, response.data, limit) }
      : { status: 'unavailable', code: response.code, error: response.error, hint: APP_HINTS[response.code] };
  }
  return { query, redacted: removed, apps: results };
}

// ---------- Filing a hit as a citation ----------

const PUBLISHER: Record<FamilyApp, string> = { borges: 'Borges library', links: 'Saved pages' };

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function findExisting(citations: readonly Citation[], hit: FamilyHit): Citation | undefined {
  return citations.find(citation => (hit.url && citation.url === hit.url) || (citation.notes ?? '').includes(hit.ref));
}

export interface FiledHit {
  hit: FamilyHit;
  citation: Citation;
  /** False when the project already had a citation for this document. */
  created: boolean;
}

/**
 * File the chosen hits as citations of the project. The `hoard://` reference
 * goes in the notes (the address field only takes a web page, and the writer
 * clicks that one); a hit with a web address also fills it.
 */
export async function fileFamilyHits(projectId: string, hits: readonly FamilyHit[], query: string): Promise<FiledHit[]> {
  for (const hit of hits) {
    if (!(FAMILY_APPS as readonly string[]).includes(hit.app) || !hit.ref.startsWith(`hoard://${hit.app}/`)) throw new FamilySearchError('hit', hit.ref);
  }
  return db.transaction('rw', db.projects, db.citations, async () => {
    if (!await db.projects.get(projectId)) throw new FamilySearchError('scope');
    const existing = await db.citations.where('projectId').equals(projectId).toArray();
    const out: FiledHit[] = [];
    for (const hit of hits) {
      const found = findExisting(existing, hit);
      if (found) {
        out.push({ hit, citation: found, created: false });
        continue;
      }
      const now = Date.now();
      const evidence: ResearchEvidence[] = hit.excerpt ? [{
        id: generateId('evidence'), statement: hit.title, kind: 'attribution', quote: hit.excerpt, locator: hit.ref, status: 'pending',
        notes: 'Preview returned by the search. Open the document and check it before relying on it.', createdAt: now, updatedAt: now,
      }] : [];
      const citation: Citation = {
        id: generateId('cite'), projectId, title: hit.title, authors: [], publisher: PUBLISHER[hit.app], accessedAt: localDay(),
        notes: `${hit.ref}\nFound by searching ${hit.app} for "${query}".`, writingIds: [], tags: ['family', hit.app],
        ...(hit.url ? { url: hit.url } : {}),
        ...(evidence.length ? { researchEvidence: evidence } : {}),
        createdAt: now, updatedAt: now,
      };
      await db.citations.add(citation);
      existing.push(citation);
      out.push({ hit, citation, created: true });
    }
    return out;
  });
}
