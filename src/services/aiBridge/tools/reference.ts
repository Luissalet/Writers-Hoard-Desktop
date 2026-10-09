// ============================================================================
// AI bridge tools — the Writings "Consultar" (reference) panel
// ============================================================================
//
// Same matcher, pins, sources and UI state the panel runs
// (src/services/codexReference, referencePrefs), so what a model reads or sets
// is what the writer sees. Pins are project data (table `referencePins`) and
// travel with the backup; the docked preference and width live in the app's
// local preferences; the temporary consult is never saved.

import { db } from '@/db';
import { getCodexEntries, getWriting } from '@/db/operations';
import {
  clampReferenceWidth,
  getReferenceUi,
  setReferenceConsult,
  setReferenceOpen,
  setReferenceWidth,
} from '@/engines/writings/components/referencePrefs';
import {
  bodyParagraphs,
  entrySummary,
  findMentions,
  searchEntries,
} from '@/services/codexReference/matcher';
import { bookScopeId, readPins, setPinned } from '@/services/codexReference/pins';
import { getSource, searchSources, type ReferenceSourceKind } from '@/services/codexReference/sources';
import { stripHtml } from '@/utils/text';
import {
  assertRowInScope,
  BridgeError,
  clampLimit,
  optBoolean,
  optNumber,
  optString,
  requireString,
  resolveProjectId,
  type ToolArgs,
} from './shared';

interface Scope {
  projectId: string;
  /** Pin scope: the chapter id, or `book:<projectId>`. */
  scopeId: string;
  /** Plain text matching runs on. */
  text: () => Promise<string>;
  writingId?: string;
}

/** A chapter (`writingId`) or the whole book (`scope: "book"` with the project). */
async function resolveScope(args: ToolArgs): Promise<Scope> {
  if (optString(args, 'scope') === 'book') {
    const projectId = resolveProjectId(args);
    return {
      projectId,
      scopeId: bookScopeId(projectId),
      text: async () => {
        const rows = await db.writings.where('projectId').equals(projectId).toArray();
        return rows.map((row) => stripHtml(row.content)).join('\n');
      },
    };
  }
  const writingId = requireString(args, 'writingId');
  const writing = await getWriting(writingId);
  if (!writing) throw new BridgeError('not-found', `No writing with id "${writingId}".`);
  assertRowInScope(args, writing.projectId);
  return {
    projectId: writing.projectId,
    scopeId: writing.id,
    writingId: writing.id,
    text: async () => stripHtml(writing.content),
  };
}

function uiState() {
  const ui = getReferenceUi();
  return {
    docked: { open: ui.open, width: ui.width },
    consult: ui.consult,
    note: 'docked is the saved side-column preference (chapter editor, wide windows); consult is the temporary drawer used in focus mode, the whole-book editor and narrow windows, and is not saved.',
  };
}

export async function whChapterReferences(args: ToolArgs): Promise<unknown> {
  const scope = await resolveScope(args);
  const entries = await getCodexEntries(scope.projectId);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const mentions = findMentions(await scope.text(), entries).map((match) => {
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
  const pinned = (await readPins(scope.projectId, scope.scopeId))
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({ id: entry.id, name: entry.title, type: entry.type }));
  return {
    writingId: scope.writingId ?? null,
    scope: scope.writingId ? 'chapter' : 'book',
    projectId: scope.projectId,
    note: 'A mention means the name appears in the text; it is not presence or point of view.',
    mentions,
    pinned,
  };
}

export async function whPinReference(args: ToolArgs): Promise<unknown> {
  const scope = await resolveScope(args);
  const entries = await getCodexEntries(scope.projectId);
  const entryId = requireString(args, 'entryId');
  if (typeof args.pinned !== 'boolean') {
    throw new BridgeError('bad-args', '"pinned" must be true or false.');
  }
  if (!entries.some((entry) => entry.id === entryId)) {
    throw new BridgeError('not-found', `No codex entry with id "${entryId}" in this project.`);
  }
  const pins = await setPinned(scope.projectId, scope.scopeId, entryId, args.pinned);
  return { writingId: scope.writingId ?? null, scope: scope.writingId ? 'chapter' : 'book', entryId, pinned: args.pinned, pins };
}

/** Open or close the temporary consult drawer, exactly as the floating button and Ctrl+Alt+R do. */
export async function whReferenceConsult(args: ToolArgs): Promise<unknown> {
  const open = optBoolean(args, 'open');
  if (open === undefined) throw new BridgeError('bad-args', '"open" must be true or false.');
  setReferenceConsult(open);
  return uiState();
}

/** Read or set the docked preference and its width. With no arguments it only reads. */
export async function whReferencePrefs(args: ToolArgs): Promise<unknown> {
  const open = optBoolean(args, 'open');
  const width = optNumber(args, 'width');
  if (args.open !== undefined && open === undefined) throw new BridgeError('bad-args', '"open" must be true or false.');
  if (args.width !== undefined && (width === undefined || !Number.isFinite(width))) {
    throw new BridgeError('bad-args', '"width" must be a number of pixels.');
  }
  if (open !== undefined) setReferenceOpen(open);
  if (width !== undefined) setReferenceWidth(width);
  return { ...uiState(), widthRange: { min: clampReferenceWidth(0), max: clampReferenceWidth(1e6) } };
}

/** The panel's search: the codex first, then the project's notes and library, read-only. */
export async function whReferenceSearch(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const query = requireString(args, 'query');
  const limit = clampLimit(optNumber(args, 'limit'), 10, 30);
  const entries = await getCodexEntries(projectId);
  const codex = searchEntries(query, entries, limit).map((entry) => ({
    kind: 'codex',
    id: entry.id,
    title: entry.title,
    type: entry.type,
    summary: entrySummary(entry, 140),
  }));
  const others = (await searchSources(projectId, query, limit)).map((item) => ({
    kind: item.kind,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
  }));
  return { projectId, query, codex, sources: others, note: 'Read-only lookups; nothing is created or changed.' };
}

/** The panel's preview of one result: a codex entry, a note or a library citation. */
export async function whReferencePreview(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const kind = requireString(args, 'kind');
  const id = requireString(args, 'id');
  if (kind === 'codex') {
    const entry = (await getCodexEntries(projectId)).find((row) => row.id === id);
    if (!entry) throw new BridgeError('not-found', `No codex entry with id "${id}" in this project.`);
    return {
      kind,
      id,
      title: entry.title,
      type: entry.type,
      tags: entry.tags,
      fields: entry.fields,
      paragraphs: bodyParagraphs(entry.content),
    };
  }
  if (kind !== 'note' && kind !== 'citation') {
    throw new BridgeError('bad-args', '"kind" must be "codex", "note" or "citation".');
  }
  const item = await getSource(projectId, kind as ReferenceSourceKind, id);
  if (!item) throw new BridgeError('not-found', `No ${kind} with id "${id}" in this project.`);
  return { kind, id, title: item.title, subtitle: item.subtitle, tags: item.tags, paragraphs: item.body };
}
