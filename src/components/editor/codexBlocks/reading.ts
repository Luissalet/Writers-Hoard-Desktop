import { liveQuery } from 'dexie';
import { db } from '@/db';
import { codexBlockPreview } from './model';
import { getEraProject, listEraRows } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { playerHiddenFields, playerSafeHtml, playerVisibleEntries } from '@/engines/codex/playerView';

/** Read-only projection of current, scoped Codex data into the reader DOM. */
export function hydrateCodexBlocks(container: HTMLElement, projectId: string, unavailable: string, eraId?: string, policy: {player?:boolean} = {}) {
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-wh-codex-block="true"]')];
  const ids = [...new Set(blocks.filter(block => block.dataset.projectId === projectId).map(block => block.dataset.entryId ?? '').filter(Boolean))];
  const fallback = (block: HTMLElement) => block.replaceChildren(document.createTextNode(unavailable));
  blocks.forEach(fallback);
  const subscription = liveQuery(async () => { const scope = { projectId, eraId }; const [entries, project] = await Promise.all([eraId ? listEraRows<CodexEntry>(scope, 'codexEntries').then(rows => policy.player?rows:rows.filter(row => ids.includes(row.id))) : policy.player?db.codexEntries.where('projectId').equals(projectId).toArray():db.codexEntries.bulkGet(ids), eraId ? getEraProject(scope) : db.projects.get(projectId)]); return { entries, project }; }).subscribe({ next({ entries, project }) {
    const scopedEntries:CodexEntry[]=[];for(const entry of entries)if(entry&&entry.projectId===projectId)scopedEntries.push(entry);
    const templates=project?.codexTemplates,allowed=policy.player?(project?playerVisibleEntries(scopedEntries,templates,project):[]):undefined;
    for (const block of blocks) {
      const entry = block.dataset.projectId === projectId && (allowed??entries).find(entry => entry && entry.id === block.dataset.entryId && entry.projectId === projectId);
      if (!entry) { fallback(block); continue; }
      // This is a bounded textual projection, not a recursive reader. Nested
      // atoms carry cached captions and must not enter player-visible prose.
      const preview = codexBlockPreview(policy.player?{...entry,content:playerSafeHtml(entry.content)}:entry, templates,policy.player?playerHiddenFields(project):undefined), heading = document.createElement('h3'), body = document.createElement('p'); heading.textContent = preview.title; body.textContent = preview.text + (preview.truncated ? '…' : '');
      block.replaceChildren(heading, body);
      if (preview.fields.length) { const fields = document.createElement('dl'); for (const [label, value] of preview.fields) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; if (preview.fieldHtml[label]) detail.innerHTML = preview.fieldHtml[label]; else detail.textContent = value; fields.append(term, detail); } block.append(fields); }
      if (preview.avatar) { const image = document.createElement('img'); image.src = preview.avatar; image.alt = ''; image.style.cssText = 'width:64px;height:64px;object-fit:cover'; block.prepend(image); }
    }
  }, error() { blocks.forEach(fallback); } });
  return () => subscription.unsubscribe();
}
