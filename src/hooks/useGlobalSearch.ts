// ============================================
// useGlobalSearch — cross-engine Cmd+K palette search
// ============================================
//
// Until 2026-04-23 this only searched projects + codex. Now it fans out to
// every engine that registered an entity resolver via `registerEntityResolver`
// — 20+ engines — so a writer pressing Cmd+K and typing can jump to any
// entity anywhere in the app: a scene, a seed, a map pin, a yarn node, a
// diary entry, a writing-session, whatever. Each engine contributes its own
// matches; Fuse.js re-ranks across the union for a consistent result order.
//
// Navigation is delegated to each engine's AnchorAdapter.navigateToEntity
// when present — which means adding a new engine to the palette requires
// zero changes here, just the usual registerEntityResolver +
// registerAnchorAdapter calls in the engine's index.ts.

import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';

export type SearchResultType = 'project' | 'entity';

export interface SearchResult {
  /** 'project' for top-level projects; 'entity' for any engine-owned entity. */
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  /** Present for 'entity' results — tells callers which engine owns the row. */
  engineId?: string;
  /** Present for codex/legacy — kept for back-compat of the existing navigator. */
  projectId?: string;
  /** Visual — thumbnail preview if the engine supplied one. */
  thumbnail?: string;
}

export function useGlobalSearch() {
  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    // Run project search and cross-engine entity search in parallel — the
    // former hits the projects table directly, the latter fans out to every
    // registered engine's searchEntities().
    const [projects, entities] = await Promise.all([
      ops.getAllProjects(),
      searchEntities(query),
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

    // Fuse re-ranks across the combined set so a strong match from an
    // obscure engine can outrank a weak codex match.
    const fuse = new Fuse(items, { keys: ['title', 'subtitle'], threshold: 0.3 });
    return fuse.search(query).map((r) => r.item).slice(0, 15);
  }, []);

  return { search };
}
