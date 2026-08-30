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
import { captureContext, getAnchorAdapter } from '@/engines/_shared/anchoring';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optBoolean,
  optString,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

function serialize(annotation: Annotation): Record<string, unknown> {
  return {
    id: annotation.id,
    engineId: annotation.sourceEngineId,
    entityId: annotation.sourceEntityId,
    note: annotation.noteBody,
    noteType: annotation.noteType,
    anchoredTo: annotation.anchor.selectedText,
    isOrphaned: annotation.isOrphaned,
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

  const filtered = rows
    .filter((row) => (engineId && !entityId ? row.sourceEngineId === engineId : true))
    .filter((row) => (orphanedOnly ? row.isOrphaned : true));

  return { count: filtered.length, annotations: filtered.map(serialize) };
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
    position: existing.length,
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
