import { liveQuery } from 'dexie';
import { db } from '@/db';
import { codexBlockPreview } from './model';

/** Read-only projection of current, scoped Codex data into the reader DOM. */
export function hydrateCodexBlocks(container: HTMLElement, projectId: string, unavailable: string) {
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-wh-codex-block="true"]')];
  const ids = [...new Set(blocks.filter(block => block.dataset.projectId === projectId).map(block => block.dataset.entryId ?? '').filter(Boolean))];
  const fallback = (block: HTMLElement) => block.replaceChildren(document.createTextNode(unavailable));
  blocks.forEach(fallback);
  const subscription = liveQuery(() => db.codexEntries.bulkGet(ids)).subscribe({ next(entries) {
    for (const block of blocks) {
      const entry = block.dataset.projectId === projectId && entries.find(entry => entry && entry.id === block.dataset.entryId && entry.projectId === projectId);
      if (!entry) { fallback(block); continue; }
      const preview = codexBlockPreview(entry), heading = document.createElement('h3'), body = document.createElement('p'); heading.textContent = preview.title; body.textContent = preview.text + (preview.truncated ? '…' : '');
      block.replaceChildren(heading, body);
      if (preview.avatar) { const image = document.createElement('img'); image.src = preview.avatar; image.alt = ''; image.style.cssText = 'width:64px;height:64px;object-fit:cover'; block.prepend(image); }
    }
  }, error() { blocks.forEach(fallback); } });
  return () => subscription.unsubscribe();
}
