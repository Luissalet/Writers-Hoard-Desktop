import { db } from '@/db';
import type { Project } from '@/types';
import type { EntityPreview } from '@/engines/_types';
import type { EntityResolverConfig } from './entityResolverRegistry';
const folded = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
/** Project metadata carries some local document kinds. Project scope is used
 * before projection, and binary/font/image fields never enter a preview. */
export function metadataResolver(engineId: string, entityTypes: string[], projectDocuments: (project: Project) => EntityPreview[]): EntityResolverConfig {
  return { engineId, entityTypes,
    async resolveEntity(id) { for (const project of await db.projects.toArray()) { const found = projectDocuments(project).find(document => document.id === id); if (found) return found; } return null; },
    async searchEntities(query, projectId) {
      const projects = projectId ? [await db.projects.get(projectId)] : await db.projects.toArray(), term = folded(query.trim());
      return projects.flatMap(project => project ? projectDocuments(project).filter(document => folded([document.title, document.subtitle, ...(document.searchTerms ?? [])].join('\n')).includes(term)) : []);
    },
  };
}
