// ============================================================================
// Command centre search — three layers, one ranked, grouped answer
// ============================================================================
//
// The palette answers from three places at once:
//
//   projects  the dashboard's own rows (never inside a project)
//   entities  engine-owned titles, through the resolver registry. This is the
//             only way engines whose bodies are deliberately not indexed
//             (board, gallery, storyboard, video) stay findable.
//   content   the prose index — inside a project only. It is the only layer
//             carrying the metadata `tag:`, `status:` and `updated:` are asking
//             about, so on the dashboard those filters, and body text itself,
//             find nothing: reading every table of every project on a
//             three-character keystroke costs the whole hoard in memory, and
//             titles already answer "which project was that in?".
//
// Layers that cannot answer a filter are not asked: a codex title preview knows
// nothing about tags, so `tag:` drops the entity layer rather than letting it
// smuggle unfiltered rows into a filtered result. Everything the layers do
// return is filtered by one shared predicate, `matchesFacets`.

import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { commandCenterSearchKey } from '@/services/commandCenter';
import {
  resolveSearchEngineFilter,
  searchProjectDocuments,
  type ProjectSearchOutcome,
} from '@/services/projectSearchIndex';
import {
  foldSearchText,
  hasExcludedText,
  matchesFacets,
  searchToday,
  type ParsedSearchQuery,
  type ResolvedEngineFilter,
} from '@/services/searchQuery';
import type { SearchResult } from '@/hooks/useGlobalSearch';

export interface CommandCenterGroup {
  /** Engine that owns these results, or '' for the project rows. */
  engineId: string;
  /**
   * Matches in this engine. Can exceed `items.length`: the index counts every
   * document it matched, while the palette only materialises the first page.
   */
  count: number;
  items: SearchResult[];
}

/** Fuzzy title matches worth ranking. Matches the ceiling the palette had before. */
const TITLE_LIMIT = 12;
/** Content rows materialised per search. Counts are taken from the full scan. */
const CONTENT_LIMIT = 60;

const EMPTY_ENGINE_IDS: string[] = [];
/** What the content layer contributes when it is not asked (the dashboard). */
const NO_CONTENT: ProjectSearchOutcome = { hits: [], totals: {}, total: 0 };
const NO_GROUPS: CommandCenterGroup[] = [];
const NO_TAGS: readonly string[] = [];

/** Projects carry a type, a status and a modification date — but never tags. */
function projectsCanAnswer(query: ParsedSearchQuery): boolean {
  return !query.hasEngineFilters && !query.hasTagFilters;
}

/** An entity preview carries its engine and its type, and nothing else. */
function entitiesCanAnswer(query: ParsedSearchQuery): boolean {
  return !query.hasTagFilters && !query.hasStatusFilters && !query.hasDateFilters;
}

/** Exclusions apply to every layer; a title-level row is judged on its own text. */
function titleIsExcluded(query: ParsedSearchQuery, title: string, subtitle: string): boolean {
  if (query.exclusions.length === 0) return false;
  return hasExcludedText(query, foldSearchText(`${title}\n${subtitle}`));
}

function groupIdOf(result: SearchResult): string {
  return result.type === 'project' ? '' : result.engineId ?? '';
}

/**
 * Group by engine, preserving the order results already have inside each group:
 * fuzzy title matches first (as ranked), then index hits in index order.
 *
 * Groups themselves follow the project's own engine order — the sequence the
 * writer arranged their tabs in — so the palette reads in the same order as the
 * sidebar. Projects lead on the dashboard; engines the project does not order
 * (or a global search) fall in behind, first seen first.
 */
function groupResults(
  results: SearchResult[],
  totals: Record<string, number>,
  engineOrder: string[],
): CommandCenterGroup[] {
  const byEngine = new Map<string, SearchResult[]>();
  for (const result of results) {
    const id = groupIdOf(result);
    const bucket = byEngine.get(id);
    if (bucket) bucket.push(result);
    else byEngine.set(id, [result]);
  }

  const ordered = ['', ...engineOrder].filter(id => byEngine.has(id));
  const placed = new Set(ordered);
  for (const id of byEngine.keys()) {
    if (!placed.has(id)) ordered.push(id);
  }

  return ordered.map((engineId) => {
    const items = byEngine.get(engineId) ?? [];
    return {
      engineId,
      // The index knows about matches past the page it returned; never claim
      // fewer than the rows actually on screen.
      count: Math.max(totals[engineId] ?? 0, items.length),
      items,
    };
  });
}

/**
 * Search is project-scoped inside a workspace; on the dashboard it reaches
 * every project, but through titles only. Takes an already-parsed query so the
 * component can reuse the same parse for its hint row, its Tab completion and
 * its saved searches.
 */
export function useCommandCenterSearch(
  projectId?: string,
  enabledEngineIds: string[] = EMPTY_ENGINE_IDS,
) {
  const search = useCallback(async (query: ParsedSearchQuery): Promise<CommandCenterGroup[]> => {
    if (query.isEmpty) return NO_GROUPS;

    const engines: ResolvedEngineFilter | null = resolveSearchEngineFilter(query);
    const today = searchToday();
    // Engines match a whole word or a prefix, so the longest needle is the one
    // most likely to survive an engine's own narrower title matching.
    const probe = query.needles[0] ?? '';

    const [projects, entities, content] = await Promise.all([
      !projectId && projectsCanAnswer(query) ? ops.getAllProjects() : Promise.resolve([]),
      probe && entitiesCanAnswer(query)
        ? searchEntities(probe, undefined, projectId)
        : Promise.resolve([]),
      projectId
        ? searchProjectDocuments(query, projectId, CONTENT_LIMIT)
        : Promise.resolve(NO_CONTENT),
    ]);

    const enabled = projectId ? new Set(enabledEngineIds) : null;
    const titleItems: SearchResult[] = [];

    for (const project of projects) {
      if (titleIsExcluded(query, project.title, project.description)) continue;
      const facets = {
        engineId: '',
        tags: NO_TAGS,
        type: foldSearchText(project.type),
        status: foldSearchText(project.status),
        day: toLocalDateKey(new Date(project.updatedAt)),
      };
      if (!matchesFacets(query, facets, engines, today)) continue;
      titleItems.push({
        type: 'project',
        key: commandCenterSearchKey({ type: 'project', id: project.id }),
        id: project.id,
        title: project.title,
        subtitle: project.type,
      });
    }

    for (const entity of entities) {
      if (enabled && !enabled.has(entity.engineId)) continue;
      if (titleIsExcluded(query, entity.title, entity.subtitle ?? entity.type)) continue;
      const facets = {
        engineId: entity.engineId,
        tags: NO_TAGS,
        type: foldSearchText(entity.type),
        status: '',
        day: '',
      };
      if (!matchesFacets(query, facets, engines, today)) continue;
      titleItems.push({
        type: 'entity',
        key: commandCenterSearchKey({
          type: 'entity',
          id: entity.id,
          projectId: entity.projectId,
          engineId: entity.engineId,
        }),
        id: entity.id,
        title: entity.title,
        subtitle: entity.subtitle ?? entity.type,
        engineId: entity.engineId,
        projectId: entity.projectId,
        thumbnail: entity.thumbnail,
      });
    }

    // Fuzzy ranking is what forgives a typo in a character's name, so the title
    // layer keeps it — fed the free text alone, with the operators taken out.
    const ranked = query.hasText
      ? new Fuse(titleItems, { keys: ['title', 'subtitle'], threshold: 0.3 })
        .search(query.text, { limit: TITLE_LIMIT })
        .map(result => result.item)
      : titleItems.slice(0, TITLE_LIMIT);

    const results = [...ranked];
    const seen = new Set(ranked.map(result => result.key));
    const totals: Record<string, number> = {};

    for (const hit of content.hits) {
      if (enabled && !enabled.has(hit.engineId)) continue;
      const key = commandCenterSearchKey({
        type: 'entity',
        id: hit.id,
        projectId: hit.projectId,
        engineId: hit.engineId,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ type: 'entity', key, ...hit });
    }
    for (const [engineId, count] of Object.entries(content.totals)) {
      if (enabled && !enabled.has(engineId)) continue;
      totals[engineId] = count;
    }

    return groupResults(results, totals, enabledEngineIds);
  }, [enabledEngineIds, projectId]);

  return { search };
}
