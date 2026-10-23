import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { getWikiProfile } from './store';
import { captureWikiSnapshot, wikiSource, wikiSourceFingerprint } from './snapshot';

export type WikiChangeKind = 'entry' | 'map' | 'timeline';
export interface WikiDocumentChange { documentId: string; title: string; kind: WikiChangeKind; change: 'added' | 'changed' | 'removed' }
export interface WikiProfileChanges {
  changes: WikiDocumentChange[];
  /** Same as changes.length: the number shown on the publish button. */
  count: number;
  /** When the last local edition was published; null when there is none yet (every admitted document then counts as added). */
  lastEditionAt: number | null;
  editionId: string | null;
  /** The saved configuration (sections, exclusions, look) differs from the one the last edition froze. */
  configChanged: boolean;
  /** The captured sources differ from the ones the last edition was built from. */
  sourceChanged: boolean;
}
type Page = Map<string, { title: string; html: string }>;

const unhex = (hex: string) => new TextDecoder().decode(Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16)));
const split = (articleId: string): { kind: WikiChangeKind; documentId: string } | undefined => {
  const match = /^(entry|map|timeline)-((?:[\da-f]{2})+)$/.exec(articleId);
  return match ? { kind: match[1] as WikiChangeKind, documentId: unhex(match[2]) } : undefined;
};
/** What a reader sees of each document: the article markup of an exported wiki, by article id. */
function articlesOf(html: string): Page {
  const page: Page = new Map(), doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('#wiki article[id]').forEach(article => page.set(article.id, { title: article.querySelector('h2')?.textContent?.trim() || article.id, html: article.outerHTML }));
  return page;
}
const byTitle = (a: WikiDocumentChange, b: WikiDocumentChange) => a.title.localeCompare(b.title) || a.documentId.localeCompare(b.documentId);

/**
 * Compares what the saved profile would publish now with its last local edition. Read-only and
 * lazy: callers ask for it on open or on demand. The captured-source fingerprint and the saved
 * configuration are compared first, so an untouched world costs one snapshot and no build; only a
 * difference makes it render the wiki once and compare the document articles with the frozen ones.
 */
export async function wikiProfileChanges(projectId: string, profileId: string): Promise<WikiProfileChanges> {
  const profile = await getWikiProfile(projectId, profileId), last = profile.editions?.at(-1);
  const snapshot = await captureWikiSnapshot({ projectId, eraId: profile.options.eraId });
  const sourceChanged = !last || await wikiSourceFingerprint(snapshot) !== last.sourceFingerprint;
  const configChanged = !!last && (JSON.stringify(last.options) !== JSON.stringify(profile.options) || last.profileName !== profile.name);
  const base = { lastEditionAt: last?.publishedAt ?? null, editionId: last?.id ?? null, configChanged, sourceChanged };
  if (last && !sourceChanged && !configChanged) return { changes: [], count: 0, ...base };
  const current = articlesOf(buildWorldWiki(await loadWorldWikiData(projectId, profile.options, wikiSource(snapshot)), profile.options).html);
  const before = last ? articlesOf(last.reader.html) : new Map() as Page, changes: WikiDocumentChange[] = [];
  for (const [id, now] of current) {
    const parts = split(id), old = before.get(id);
    if (!parts) continue;
    if (!old) changes.push({ ...parts, title: now.title, change: 'added' });
    else if (old.html !== now.html) changes.push({ ...parts, title: now.title, change: 'changed' });
  }
  for (const [id, old] of before) { const parts = split(id); if (parts && !current.has(id)) changes.push({ ...parts, title: old.title, change: 'removed' }); }
  const order = { added: 0, changed: 1, removed: 2 } as const;
  changes.sort((a, b) => order[a.change] - order[b.change] || byTitle(a, b));
  return { changes, count: changes.length, ...base };
}
