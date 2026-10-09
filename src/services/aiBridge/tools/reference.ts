// ============================================================================
// AI bridge tools — the Writings "Consultar" (reference) panel
// ============================================================================
//
// Same matcher the panel runs (src/services/codexReference), so what a model
// reads is what the writer sees. Pins live in local preferences, per chapter.

import { getCodexEntries, getWriting } from '@/db/operations';
import { findMentions } from '@/services/codexReference/matcher';
import { readPins, setPinned } from '@/services/codexReference/pins';
import { stripHtml } from '@/utils/text';
import {
  assertRowInScope,
  BridgeError,
  requireString,
  type ToolArgs,
} from './shared';

async function chapterAndEntries(args: ToolArgs) {
  const writingId = requireString(args, 'writingId');
  const writing = await getWriting(writingId);
  if (!writing) throw new BridgeError('not-found', `No writing with id "${writingId}".`);
  assertRowInScope(args, writing.projectId);
  const entries = await getCodexEntries(writing.projectId);
  return { writing, entries };
}

export async function whChapterReferences(args: ToolArgs): Promise<unknown> {
  const { writing, entries } = await chapterAndEntries(args);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const mentions = findMentions(stripHtml(writing.content), entries).map((match) => {
    const entry = byId.get(match.entryId)!;
    return {
      id: entry.id,
      name: entry.title,
      type: entry.type,
      matchedAlias: match.matchedAlias,
      count: match.count,
      label: 'mentioned',
    };
  });
  const pinned = readPins(writing.id)
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({ id: entry.id, name: entry.title, type: entry.type }));
  return {
    writingId: writing.id,
    projectId: writing.projectId,
    note: 'A mention means the name appears in the text; it is not presence or point of view.',
    mentions,
    pinned,
  };
}

export async function whPinReference(args: ToolArgs): Promise<unknown> {
  const { writing, entries } = await chapterAndEntries(args);
  const entryId = requireString(args, 'entryId');
  if (typeof args.pinned !== 'boolean') {
    throw new BridgeError('bad-args', '"pinned" must be true or false.');
  }
  if (!entries.some((entry) => entry.id === entryId)) {
    throw new BridgeError('not-found', `No codex entry with id "${entryId}" in this chapter's project.`);
  }
  const pins = setPinned(writing.id, entryId, args.pinned);
  return { writingId: writing.id, entryId, pinned: args.pinned, pins };
}
