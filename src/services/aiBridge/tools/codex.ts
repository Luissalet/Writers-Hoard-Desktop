// ============================================================================
// AI bridge tools — the codex (characters, places, items, factions, concepts)
// ============================================================================
//
// The real operations live in src/db/operations.ts, not in
// engines/codex/operations.ts — that file is dead code nothing imports.
//
// Two fields are deliberately out of reach: `avatar` (a base64 image the user
// crops in the app) and `relations` (an inert legacy field; real relations
// belong to the relationships engine).

import type { CodexEntry, CodexEntryType } from '@/types';
import {
  createCodexEntry,
  getCodexEntries,
  getCodexEntry,
  updateCodexEntry,
} from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  htmlFromMarkdown,
  markdownFromHtml,
  optBoolean,
  optEnum,
  optString,
  optStringArray,
  optStringMap,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const TYPES = [
  'character', 'location', 'item', 'faction', 'concept', 'magic', 'custom',
] as const satisfies readonly CodexEntryType[];

async function mustGetEntry(id: string): Promise<CodexEntry> {
  const entry = await getCodexEntry(id);
  if (!entry) throw new BridgeError('not-found', `No codex entry with id "${id}".`);
  return entry;
}

export async function whListCodex(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const type = optEnum(args, 'type', TYPES);
  const entries = await getCodexEntries(projectId);
  const filtered = type ? entries.filter((e) => e.type === type) : entries;
  return {
    projectId,
    entries: filtered.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      fields: entry.fields,
      tags: entry.tags,
      hasBody: Boolean(entry.content && entry.content.trim()),
      updatedAt: entry.updatedAt,
    })),
  };
}

export async function whGetCodexEntry(args: ToolArgs): Promise<unknown> {
  const entry = await mustGetEntry(requireString(args, 'id'));
  return {
    id: entry.id,
    projectId: entry.projectId,
    type: entry.type,
    title: entry.title,
    fields: entry.fields,
    tags: entry.tags,
    updatedAt: entry.updatedAt,
    content: markdownFromHtml(entry.content),
  };
}

export async function whCreateCodexEntry(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'codex');
  const title = requireString(args, 'title');
  const type = optEnum(args, 'type', TYPES) ?? 'character';
  const markdown = optString(args, 'content') ?? '';
  const now = Date.now();
  const entry: CodexEntry = {
    id: generateId('codex'),
    projectId,
    type,
    title,
    fields: optStringMap(args, 'fields') ?? {},
    content: markdown ? htmlFromMarkdown(markdown) : '',
    tags: optStringArray(args, 'tags') ?? [],
    relations: [],
    createdAt: now,
    updatedAt: now,
  };
  await createCodexEntry(entry);
  return withAudit(
    { id: entry.id, title: entry.title, type: entry.type, created: true },
    { projectId, entityId: entry.id, summary: `created ${type} "${title}"` },
  );
}

export async function whUpdateCodexEntry(args: ToolArgs): Promise<unknown> {
  const entry = await mustGetEntry(requireString(args, 'id'));
  const changes: Partial<CodexEntry> = {};

  const incomingFields = optStringMap(args, 'fields');
  if (incomingFields) {
    if (optBoolean(args, 'replaceFields') === true) {
      changes.fields = incomingFields;
    } else {
      // Merge, so adding one attribute never wipes the rest of the sheet.
      // An empty string is the explicit "remove this key" signal.
      const merged: Record<string, string> = { ...entry.fields };
      for (const [key, value] of Object.entries(incomingFields)) {
        if (value === '') delete merged[key];
        else merged[key] = value;
      }
      changes.fields = merged;
    }
  }

  const title = optString(args, 'title');
  if (title !== undefined) changes.title = title;
  const type = optEnum(args, 'type', TYPES);
  if (type !== undefined) changes.type = type;
  const markdown = optString(args, 'content');
  if (markdown !== undefined) changes.content = htmlFromMarkdown(markdown);
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateCodexEntry(entry.id, changes);
  return withAudit(
    { id: entry.id, updated: Object.keys(changes), fields: changes.fields ?? entry.fields },
    {
      projectId: entry.projectId,
      entityId: entry.id,
      summary: `updated ${entry.type} "${entry.title}" (${Object.keys(changes).join(', ')})`,
      before: { title: entry.title, type: entry.type, fields: entry.fields, tags: entry.tags },
    },
  );
}
