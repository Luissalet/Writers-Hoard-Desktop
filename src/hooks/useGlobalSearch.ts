// ============================================
// useGlobalSearch — cross-engine Cmd+K palette search
// ============================================
//
// Two layers:
//   1. TITLE search — fans out to every engine's registered entity resolver
//      (20+ engines) exactly as before.
//   2. CONTENT search (new) — full-text "contains" over the four prose-heavy
//      tables (writings, codex entries, diary entries, dialog blocks), with
//      a highlighted snippet. Previously only titles were searchable: a
//      phrase you *wrote* was unfindable unless it was also a title.
//
// Navigation is delegated to each engine's AnchorAdapter.navigateToEntity
// when present; results now carry `projectId` so engines WITHOUT an adapter
// can at least land on their engine tab.

import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';
import { db } from '@/db/index';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { stripHtml } from '@/utils/text';

export type SearchResultType = 'project' | 'entity';

export interface SearchResult {
  /** 'project' for top-level projects; 'entity' for any engine-owned entity. */
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  /** Present for 'entity' results — tells callers which engine owns the row. */
  engineId?: string;
  /** Lets the palette fall back to the engine tab when no adapter exists. */
  projectId?: string;
  /** Visual — thumbnail preview if the engine supplied one. */
  thumbnail?: string;
  /** Content match — the ±40-char excerpt around the hit. */
  snippet?: string;
}

/** Build a "…context around the hit…" excerpt from plain text. */
function excerpt(plain: string, q: string): string | null {
  const idx = plain.toLowerCase().indexOf(q);
  if (idx < 0) return null;
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + q.length + 40);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

const CONTENT_RESULT_CAP = 8;

/**
 * Full-content search over prose bodies. Cheap first-pass filter runs on the
 * raw stored strings (indexOf) — stripHtml only runs on actual matches to
 * build the snippet.
 */
async function searchContentBodies(query: string): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  if (q.length < 3) return [];
  const out: SearchResult[] = [];

  const [writings, codexEntries, diaryEntries, dialogBlocks] = await Promise.all([
    db.writings.toArray(),
    db.codexEntries.toArray(),
    db.diaryEntries.toArray(),
    db.dialogBlocks.toArray(),
  ]);

  for (const w of writings) {
    if (out.length >= CONTENT_RESULT_CAP) break;
    if (!w.content?.toLowerCase().includes(q)) continue;
    const snip = excerpt(stripHtml(w.content), q);
    if (!snip) continue;
    out.push({
      type: 'entity', id: w.id, engineId: 'writings', projectId: w.projectId,
      title: w.title, subtitle: w.status, snippet: snip,
    });
  }

  for (const c of codexEntries) {
    if (out.length >= CONTENT_RESULT_CAP) break;
    if (!c.content?.toLowerCase().includes(q)) continue;
    const snip = excerpt(stripHtml(c.content), q);
    if (!snip) continue;
    out.push({
      type: 'entity', id: c.id, engineId: 'codex', projectId: c.projectId,
      title: c.title, subtitle: c.type, snippet: snip,
    });
  }

  for (const d of diaryEntries) {
    if (out.length >= CONTENT_RESULT_CAP) break;
    if (!d.content?.toLowerCase().includes(q)) continue;
    const snip = excerpt(stripHtml(d.content), q);
    if (!snip) continue;
    out.push({
      type: 'entity', id: d.id, engineId: 'diary', projectId: d.projectId,
      title: d.title || d.entryDate, subtitle: 'diary', snippet: snip,
    });
  }

  // Dialog: match block content but surface the owning SCENE.
  const seenScenes = new Set<string>();
  for (const b of dialogBlocks) {
    if (out.length >= CONTENT_RESULT_CAP) break;
    if (seenScenes.has(b.sceneId)) continue;
    if (!b.content?.toLowerCase().includes(q)) continue;
    const snip = excerpt(stripHtml(b.content), q);
    if (!snip) continue;
    seenScenes.add(b.sceneId);
    const scene = await db.scenes.get(b.sceneId);
    if (!scene) continue;
    out.push({
      type: 'entity', id: scene.id, engineId: 'dialog-scene', projectId: scene.projectId,
      title: scene.title, subtitle: b.characterName || 'scene', snippet: snip,
    });
  }

  return out;
}

export function useGlobalSearch() {
  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();

    const [projects, entities, contentHits] = await Promise.all([
      ops.getAllProjects(),
      searchEntities(query),
      searchContentBodies(q),
    ]);

    const items: SearchResult[] = [
      ...projects.map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.title,
        subtitle: p.type,
      })),
      ...entities.map((e) => ({
        type: 'entity' as const,
        id: e.id,
        title: e.title,
        subtitle: e.subtitle ?? e.type,
        engineId: e.engineId,
        thumbnail: e.thumbnail,
      })),
    ];

    // Fuse re-ranks the title-based union; content hits are appended after
    // (deduped) — a title match is almost always the better jump target.
    const fuse = new Fuse(items, { keys: ['title', 'subtitle'], threshold: 0.3 });
    const ranked = fuse.search(query).map((r) => r.item);

    const seen = new Set(ranked.map((r) => `${r.engineId ?? 'project'}:${r.id}`));
    for (const hit of contentHits) {
      const key = `${hit.engineId}:${hit.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranked.push(hit);
      }
    }

    return ranked.slice(0, 20);
  }, []);

  return { search };
}
