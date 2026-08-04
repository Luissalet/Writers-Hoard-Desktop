import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';
import { searchEntities } from '@/engines/_shared/entityResolverRegistry';
import { searchProjectContent } from '@/services/projectSearchIndex';

export type SearchResultType = 'project' | 'entity';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  engineId?: string;
  projectId?: string;
  thumbnail?: string;
  snippet?: string;
}

/**
 * Search is project-scoped inside a workspace and global on the dashboard.
 * Content bodies come from an invalidation-aware in-memory index; entity-title
 * providers remain engine-owned through the resolver registry.
 */
export function useGlobalSearch(projectId?: string) {
  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];
    const [allProjects, entities, contentHits] = await Promise.all([
      ops.getAllProjects(),
      searchEntities(query, undefined, projectId),
      searchProjectContent(query, projectId),
    ]);
    const projects = projectId
      ? allProjects.filter(project => project.id === projectId)
      : allProjects;

    const titleItems: SearchResult[] = [
      ...projects.map(project => ({
        type: 'project' as const,
        id: project.id,
        title: project.title,
        subtitle: project.type,
      })),
      ...entities.map(entity => ({
        type: 'entity' as const,
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
    const ranked = fuse.search(query).map(result => result.item);
    const seen = new Set(ranked.map(result => `${result.engineId ?? 'project'}:${result.id}`));

    for (const hit of contentHits) {
      const key = `${hit.engineId}:${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranked.push({ type: 'entity', ...hit });
    }

    return ranked;
  }, [projectId]);

  return { search };
}
