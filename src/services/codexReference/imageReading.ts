import { liveQuery } from 'dexie';
import { db } from '@/db';
import { getEraProject, listEraRows } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { CODEX_THUMBNAIL_ATTRIBUTE, projectCodexImages } from './imageHtml';

/** A scoped read-only subscription; retiring it also removes its derived DOM. */
export function hydrateCodexLinkImages(container: HTMLElement, projectId: string, eraId?: string): () => void {
  let active = true;
  const owned = new Set<Element>();
  const clear = () => { for (const node of owned) node.remove(); owned.clear(); };
  const subscription = liveQuery(async () => {
    const scope = { projectId, eraId };
    const project = eraId ? await getEraProject(scope) : await db.projects.get(projectId);
    if (!project?.enabledEngines.includes('codex')) return [];
    return eraId ? listEraRows<CodexEntry>(scope, 'codexEntries') : db.codexEntries.where('projectId').equals(projectId).toArray();
  }).subscribe({ next(entries) {
    if (!active) return;
    clear(); projectCodexImages(container, projectId, entries);
    container.querySelectorAll(`img[${CODEX_THUMBNAIL_ATTRIBUTE}="true"]`).forEach(node => owned.add(node));
  }, error() { clear(); } });
  return () => { active = false; subscription.unsubscribe(); clear(); };
}
