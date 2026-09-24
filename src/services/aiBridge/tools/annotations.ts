// ============================================================================
// AI bridge tools — margin notes
// ============================================================================
//
// An annotation attaches to (engineId, entityId). With a `quote` it anchors to
// a character range inside that entity's plain text; without one it attaches
// to the entity as a whole.
//
// No live DOM selection is needed: the anchoring layer stores plain-text
// offsets plus ~40 characters of context on each side, and re-locates them
// fuzzily the next time the entity is opened. That is exactly what the editor
// does from a real selection — the offsets just come from an indexOf here.

import type { Annotation } from '@/engines/annotations/types';
import {
  createAnnotation,
  getAnnotationsForEntity,
  getAnnotationsForProject,
} from '@/engines/annotations/operations';
import {
  captureContext,
  getAnchorAdapter,
  resolveTextRangeAnchor,
} from '@/engines/_shared/anchoring';
import { resolveEntityInEngine } from '@/engines/_shared/entityResolverRegistry';
import { generateId } from '@/utils/idGenerator';
import {
  assertRowInScope,
  BridgeError,
  optBoolean,
  optString,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  nextSlot,
  type ToolArgs,
} from './shared';

function serialize(annotation: Annotation, freshOrphan?: boolean): Record<string, unknown> {
  return {
    id: annotation.id,
    engineId: annotation.sourceEngineId,
    entityId: annotation.sourceEntityId,
    note: annotation.noteBody,
    noteType: annotation.noteType,
    anchoredTo: annotation.anchor.selectedText,
    isOrphaned: freshOrphan ?? annotation.isOrphaned,
    createdAt: annotation.createdAt,
  };
}

export async function whListAnnotations(args: ToolArgs): Promise<unknown> {
  const engineId = optString(args, 'engineId');
  const entityId = optString(args, 'entityId');
  const orphanedOnly = optBoolean(args, 'orphanedOnly') === true;

  if (entityId && !engineId) {
    throw new BridgeError('bad-args', 'entityId needs engineId too: ids are only unique within an engine.');
  }

  const rows = engineId && entityId
    ? await getAnnotationsForEntity(engineId, entityId)
    : await getAnnotationsForProject(resolveProjectId(args));
  // The entity path is addressed by (engineId, entityId) alone, with no project
  // in the query: an id from another project would list that project's notes.
  for (const row of rows) assertRowInScope(args, row.projectId);

  // `isOrphaned` is a STORED field that only the app refreshes, and only when
  // someone opens the entity. A model that has just rewritten a chapter here
  // would otherwise ask which of its notes it had broken and be told "none" —
  // the one question this tool exists to answer, answered wrongly.
  //
  // So it is recomputed against the text as it stands. NOT written back: this
  // is a `writes: false` tool, and a read-only client must not mutate rows on
  // the way past. The app still persists the same verdict when the writer
  // opens the entity; this just refuses to report a stale one.
  //
  // Scoped to one entity, because re-checking reads the whole body: doing it
  // for a project-wide listing would load the manuscript to answer a listing.
  const fresh = engineId && entityId ? await freshOrphanFlags(engineId, rows) : null;

  const filtered = rows
    .filter((row) => (engineId && !entityId ? row.sourceEngineId === engineId : true))
    .filter((row) => (orphanedOnly ? fresh?.get(row.id) ?? row.isOrphaned : true));

  return {
    count: filtered.length,
    annotations: filtered.map((row) => serialize(row, fresh?.get(row.id))),
    orphanStatus: fresh
      ? 'checked against the text as it stands right now'
      : 'as of the last time each entity was opened; pass engineId and entityId to have it rechecked',
  };
}

/**
 * Recompute `isOrphaned` for one entity's notes without touching the database.
 *
 * Same resolver the app uses on entity open (`reanchorEntityAnnotations`), and
 * the same verdict — minus the writes, which do not belong in a read tool.
 */
async function freshOrphanFlags(
  engineId: string,
  rows: Annotation[],
): Promise<Map<string, boolean> | null> {
  const adapter = getAnchorAdapter(engineId);
  if (!adapter?.supportsTextRange || !adapter.getEntityText) return null;
  const ranged = rows.filter((row) => row.anchor.type === 'text_range');
  if (!ranged.length) return new Map();

  const body = await adapter.getEntityText(rows[0].sourceEntityId);
  // A body that cannot be read means "unknown", not "the text is gone":
  // flagging every note as orphaned because a fetch failed would be worse
  // than admitting the flags are stale.
  if (body === null || body === undefined) return null;

  return new Map(
    ranged.map((row) => [row.id, !resolveTextRangeAnchor(row.anchor, body).ok]),
  );
}

export async function whAnnotate(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'annotations');
  const engineId = requireString(args, 'engineId');
  const entityId = requireString(args, 'entityId');
  const note = requireString(args, 'note');
  const quote = optString(args, 'quote')?.trim();

  const adapter = getAnchorAdapter(engineId);
  if (!adapter) {
    throw new BridgeError(
      'bad-args',
      `"${engineId}" cannot be annotated. Try writings, codex, seeds, board, maps, biography, character-arc, notes or outline.`,
    );
  }
  const title = await adapter.getEntityTitle(entityId);
  if (!title) throw new BridgeError('not-found', `No ${engineId} entity with id "${entityId}".`);

  // The note is filed under `projectId` but anchored to (engineId, entityId),
  // and existing was the only thing ever checked about the target. An id from
  // another project would have hung a note in project A off a chapter in
  // project B, where nothing can ever show it. `projectId` is already the
  // caller's scope — this tool's schema takes it, so applyProjectScope pinned
  // it — which makes this the scope check as well as the sanity one.
  const target = await resolveEntityInEngine(engineId, entityId);
  if (target && target.projectId !== projectId) {
    throw new BridgeError(
      'bad-args',
      `That ${engineId} entity belongs to another project, so a note filed here could never be shown beside it. Annotate something in this project instead.`,
    );
  }

  let anchor: Annotation['anchor'] = { type: 'entity' };
  if (quote) {
    if (!adapter.supportsTextRange || !adapter.getEntityText) {
      throw new BridgeError(
        'bad-args',
        `"${engineId}" entities have no body text to anchor into. Drop the quote to attach the note to the whole entity.`,
      );
    }
    const body = (await adapter.getEntityText(entityId)) ?? '';
    const start = body.indexOf(quote);
    if (start === -1) {
      throw new BridgeError(
        'quote-not-found',
        'That exact phrase is not in the text. Quote it verbatim, or omit `quote` to attach the note to the whole entity.',
      );
    }
    const end = start + quote.length;
    anchor = { type: 'text_range', start, end, selectedText: quote, ...captureContext(body, start, end) };
  }

  const existing = await getAnnotationsForEntity(engineId, entityId);
  const now = Date.now();
  const annotation: Annotation = {
    id: generateId('ann'),
    projectId,
    sourceEngineId: engineId,
    sourceEntityId: entityId,
    anchor,
    noteType: 'text',
    noteBody: note,
    isOrphaned: false,
    position: nextSlot(existing, 'position'),
    createdAt: now,
    updatedAt: now,
  };
  await createAnnotation(annotation);
  return withAudit(
    {
      id: annotation.id,
      anchoredTo: quote ?? null,
      on: { engineId, entityId, title },
      created: true,
    },
    {
      projectId,
      entityId: annotation.id,
      summary: `left a note on ${engineId} "${title}"${quote ? ` at "${quote.slice(0, 60)}"` : ''}`,
    },
  );
}
