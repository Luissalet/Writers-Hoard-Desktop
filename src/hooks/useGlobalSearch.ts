import { useCallback } from 'react';
import Fuse from 'fuse.js';
import * as ops from '@/db/operations';

export interface SearchResult {
  type: 'project' | 'codex';
  id: string;
  title: string;
  subtitle: string;
  projectId?: string;
}

export function useGlobalSearch() {
  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim()) return [];

    const [projects, entries] = await Promise.all([
      ops.getAllProjects(),
      ops.getAllCodexEntries(),
    ]);

    const items: SearchResult[] = [
      ...projects.map(p => ({ type: 'project' as const, id: p.id, title: p.title, subtitle: p.type })),
      ...entries.map(e => ({ type: 'codex' as const, id: e.id, title: e.title, subtitle: e.type, projectId: e.projectId })),
    ];

    const fuse = new Fuse(items, { keys: ['title', 'subtitle'], threshold: 0.3 });
    return fuse.search(query).map(r => r.item).slice(0, 10);
  }, []);

  return { search };
}
