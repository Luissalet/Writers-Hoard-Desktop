// When a project's notes are copied into another project, the ids a prep block
// points at move with them: its gallery image, and the Codex cards linked from an
// encounter's creatures. SRD creatures and the block's text stay as they are.
import { parsePrepData, serializePrepData, type EncounterData, type HandoutData, type PrepKind } from './model';

export function remapPrepBlocks(content: string, remap: (id: string, prefix: string) => string, codexIds: ReadonlySet<string>): string {
  if (!content.includes('data-wh-prep')) return content;
  const template = document.createElement('template');
  template.innerHTML = content;
  for (const block of template.content.querySelectorAll('[data-wh-prep]')) {
    const kind = block.getAttribute('data-wh-prep') as PrepKind;
    if (kind !== 'handout' && kind !== 'encounter') continue;
    const data = parsePrepData(kind, block.getAttribute('data-wh-prep-data'));
    if (kind === 'handout') { const handout = data as HandoutData; if (handout.imageId) handout.imageId = remap(handout.imageId, 'img'); }
    else for (const row of (data as EncounterData).rows) if (row.link?.kind === 'card' && codexIds.has(row.link.id)) row.link = { ...row.link, id: remap(row.link.id, 'codex') };
    block.setAttribute('data-wh-prep-data', serializePrepData(kind, data));
  }
  return template.innerHTML;
}
