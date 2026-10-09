// ============================================================================
// Reference sources beyond the Codex — the project's notes and library
// ============================================================================
//
// The "Consultar" panel looks things up in the Codex first. When the author
// searches, it also reaches the notes and the library (citations) the project
// already keeps, read-only: search and preview, nothing is created, edited or
// pinned from here. The shapes below are the one view of those rows that the
// panel and the AI bridge share.

import { db } from '@/db';
import { bodyParagraphs, normalizeForMatch } from './matcher';

export type ReferenceSourceKind = 'note' | 'citation';

export interface ReferenceSourceItem {
  kind: ReferenceSourceKind;
  id: string;
  title: string;
  /** Short line under the title: note kind, or authors/publisher. */
  subtitle: string;
  /** Plain-text paragraphs for the preview. */
  body: string[];
  tags: string[];
}

interface NoteLike {
  id: string;
  kind?: string;
  text: string;
  source?: string;
  tags?: string[];
}

interface CitationLike {
  id: string;
  title: string;
  authors?: string[];
  publisher?: string;
  publishedAt?: string;
  url?: string;
  notes?: string;
  tags?: string[];
}

const TITLE_MAX = 80;

export function noteToSource(note: NoteLike): ReferenceSourceItem {
  const lines = (note.text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  const title = first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
  return {
    kind: 'note',
    id: note.id,
    title: title || note.id,
    subtitle: [note.kind, note.source].filter(Boolean).join(' · '),
    body: lines,
    tags: note.tags ?? [],
  };
}

export function citationToSource(citation: CitationLike): ReferenceSourceItem {
  const body: string[] = [];
  if (citation.url) body.push(citation.url);
  if (citation.notes) body.push(...bodyParagraphs(citation.notes));
  return {
    kind: 'citation',
    id: citation.id,
    title: citation.title,
    subtitle: [(citation.authors ?? []).join(', '), citation.publisher, citation.publishedAt]
      .filter(Boolean)
      .join(' · '),
    body,
    tags: citation.tags ?? [],
  };
}

/** Items matching a free-text query on title, subtitle, tags or body; best first. */
export function searchSourceItems(
  query: string,
  items: readonly ReferenceSourceItem[],
  limit = 20,
): ReferenceSourceItem[] {
  const needle = normalizeForMatch(query).trim();
  if (!needle) return [];
  const scored: Array<{ item: ReferenceSourceItem; score: number }> = [];
  for (const item of items) {
    const title = normalizeForMatch(item.title);
    let score = 0;
    if (title === needle) score = 100;
    else if (title.startsWith(needle)) score = 80;
    else if (title.includes(needle)) score = 60;
    else if (item.tags.some((tag) => normalizeForMatch(tag).includes(needle))) score = 40;
    else if (normalizeForMatch(item.subtitle).includes(needle)) score = 25;
    else if (normalizeForMatch(item.body.join(' ')).includes(needle)) score = 10;
    if (score > 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.item);
}

/** Every note and citation the project keeps, as source items. */
export async function loadSourceItems(projectId: string): Promise<ReferenceSourceItem[]> {
  const [notes, citations] = await Promise.all([
    db.notes.where('projectId').equals(projectId).toArray(),
    db.citations.where('projectId').equals(projectId).toArray(),
  ]);
  return [...notes.map(noteToSource), ...citations.map(citationToSource)];
}

export async function searchSources(projectId: string, query: string, limit = 20): Promise<ReferenceSourceItem[]> {
  if (!query.trim()) return [];
  return searchSourceItems(query, await loadSourceItems(projectId), limit);
}

export async function getSource(
  projectId: string,
  kind: ReferenceSourceKind,
  id: string,
): Promise<ReferenceSourceItem | null> {
  const row = kind === 'note' ? await db.notes.get(id) : await db.citations.get(id);
  if (!row || row.projectId !== projectId) return null;
  return kind === 'note' ? noteToSource(row as NoteLike) : citationToSource(row as CitationLike);
}
