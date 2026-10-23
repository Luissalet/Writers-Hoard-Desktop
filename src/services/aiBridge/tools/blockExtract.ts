// ============================================
// AI bridge — move one block of a chapter or card into a new Codex card
// ============================================
// As "Extraer bloque a una ficha nueva" in the editor: the top-level block at
// `blockIndex` (0 = first) becomes the body of a new card, and a live Codex
// reference to that card takes its place in the source.

import { db } from '@/db';
import { createCodexEntry, updateCodexEntry } from '@/db/operations';
import type { CodexEntry } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { blockTitle } from '@/components/editor/wiki/blockActions';
import { BridgeError } from './bridgeError';
import { assertEngineEnabled, assertRowInScope, optNumber, optString, resolveProjectId, withAudit, type ToolArgs } from './shared';

const CODEX_TYPES: CodexEntry['type'][] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
import { mustGetWriting, replaceWritingHtml } from './writings';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function whExtractBlockToCard(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (optString(args, 'eraId')) throw new BridgeError('bad-args', 'Extracting works in the shared base, not inside an era.');
  const writingId = optString(args, 'writingId'), entryId = optString(args, 'entryId');
  if (!!writingId === !!entryId) throw new BridgeError('bad-args', 'Pass writingId or entryId (one of them).');
  const source = writingId ? await mustGetWriting(writingId, args) : await db.codexEntries.get(entryId!);
  if (!source || source.projectId !== projectId) throw new BridgeError('not-found', 'No such chapter or card in this project.');
  assertRowInScope(args, projectId);
  await assertEngineEnabled(projectId, writingId ? 'writings' : 'codex');
  const body = new DOMParser().parseFromString(source.content ?? '', 'text/html').body;
  const blocks = [...body.children];
  // The blocks as stored, with their indexes: what blockIndex counts.
  if (args.list === true) return { blocks: blocks.map((block, index) => ({ index, tag: block.tagName.toLowerCase(), kind: block.getAttribute('data-wh-callout') ?? block.getAttribute('data-wh-rules-card') ?? (block.matches('[data-wh-codex-block="true"]') ? 'codex-reference' : undefined), text: (block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) })) };
  const index = optNumber(args, 'blockIndex');
  if (index === undefined || !Number.isInteger(index) || index < 0) throw new BridgeError('bad-args', 'blockIndex is the 0-based top-level block (list:true shows them).');
  const block = blocks[index];
  if (!block) throw new BridgeError('bad-args', `There are ${blocks.length} top-level blocks (0 to ${blocks.length - 1}).`);
  if (block.matches('[data-wh-codex-block="true"]')) throw new BridgeError('bad-args', 'That block is already a Codex reference.');
  if (block.matches('[data-chapter-heading]')) throw new BridgeError('bad-args', 'A chapter title cannot be extracted.');
  const expected = optString(args, 'expectText');
  const fold = (text: string) => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (expected && !fold(block.textContent ?? '').startsWith(fold(expected))) throw new BridgeError('conflict', `Block ${index} begins "${(block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}", not "${expected.slice(0, 60)}". Call with list:true to see the blocks.`);
  const type = optString(args, 'type') ?? 'concept';
  if (!CODEX_TYPES.includes(type as CodexEntry['type'])) throw new BridgeError('bad-args', `type is one of ${CODEX_TYPES.join(', ')}.`);
  const title = (optString(args, 'title') ?? '').trim() || blockTitle(block.textContent ?? '', 'Fragmento');
  const now = Date.now();
  const card = { id: generateId(), projectId, type: type as CodexEntry['type'], title, content: block.outerHTML, fields: {}, tags: [], relations: [], createdAt: now, updatedAt: now } as CodexEntry;
  await createCodexEntry(card);
  const reference = document.createElement('div');
  reference.innerHTML = `<aside data-wh-codex-block="true" data-project-id="${escape(projectId)}" data-entry-id="${escape(card.id)}" data-label="${escape(title)}"></aside>`;
  block.replaceWith(reference.firstElementChild!);
  const content = body.innerHTML;
  const summary = `moved block ${index + 1} of "${source.title}" into the new card "${title}"`;
  if (writingId) {
    const written = await replaceWritingHtml(args, source as never, content, summary) as Record<string, unknown>;
    return { ...written, card: { id: card.id, title }, blocks: blocks.length };
  }
  await updateCodexEntry(source.id, { content });
  return withAudit({ id: source.id, card: { id: card.id, title }, blocks: blocks.length }, { projectId, entityId: source.id, summary, before: { content: source.content } });
}
