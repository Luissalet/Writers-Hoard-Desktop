import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { searchProjectContent } from '@/services/projectSearchIndex';
import { commandCenterSearchKey } from '@/services/commandCenter';

export type SearchResultType = 'project' | 'entity';

export interface SearchResult {
  type: SearchResultType;
  key: string;
  id: string;
  title: string;
  subtitle: string;
  engineId?: string;
  projectId?: string;
  thumbnail?: string;
  snippet?: string;
}

const EMPTY_ENGINE_IDS: string[] = [];

/**
 * Search is project-scoped inside a workspace and global on the dashboard.
 * Content bodies come from an invalidation-aware in-memory index; entity-title
 * providers remain engine-owned through the resolver registry.
 */
export function useGlobalSearch(projectId?: string, enabledEngineIds: string[] = EMPTY_ENGINE_IDS) {
  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const [allProjects, rawEntities, rawContentHits] = await Promise.all([
      projectId ? Promise.resolve([]) : ops.getAllProjects(),
      searchEntities(query, undefined, projectId),
      searchProjectContent(query, projectId),
    ]);
    const enabled = projectId ? new Set(enabledEngineIds) : null;
    const entities = enabled
      ? rawEntities.filter(entity => enabled.has(entity.engineId))
      : rawEntities;
    const contentHits = enabled
      ? rawContentHits.filter(hit => enabled.has(hit.engineId))
      : rawContentHits;

    const titleItems: SearchResult[] = [
      ...allProjects.map(project => ({
        type: 'project' as const,
        key: commandCenterSearchKey({ type: 'project', id: project.id }),
        id: project.id,
        title: project.title,
        subtitle: project.type,
      })),
      ...entities.map(entity => ({
        type: 'entity' as const,
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
      })),
    ];

    const fuse = new Fuse(titleItems, {
      keys: ['title', 'subtitle'],
      threshold: 0.3,
    });
    const ranked = fuse.search(query, { limit: 12 }).map(result => result.item);
    const seen = new Set(ranked.map(result => result.key));

    for (const hit of contentHits) {
      if (ranked.length >= 12) break;
      const key = commandCenterSearchKey({
        type: 'entity',
        id: hit.id,
        projectId: hit.projectId,
        engineId: hit.engineId,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      ranked.push({ type: 'entity', key, ...hit });
    }

    return ranked;
  }, [enabledEngineIds, projectId]);

  return { search };
}
