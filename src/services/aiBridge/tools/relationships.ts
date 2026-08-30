// ============================================================================
// AI bridge tools — relationships
// ============================================================================
//
// This is the REAL relationship store. `CodexEntry.relations` is an inert
// legacy field the UI never writes; anything asking "who is X to Y" belongs
// here.
//
// Names are denormalised beside the ids for matrix rendering speed and nothing
// reconciles them later, so they are resolved from the codex at write time.
// A relationship is stored once, on whichever side it was created, so reading
// "everything touching X" has to check both columns.

import { db } from '@/db';
import type { Relationship, RelationshipKind } from '@/engines/relationships/types';
import {
  createRelationship,
  getRelationship,
  getRelationships,
  updateRelationship,
} from '@/engines/relationships/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const KINDS = [
  'ally', 'friend', 'family', 'romantic', 'rival', 'enemy',
  'mentor', 'subordinate', 'colleague', 'acquaintance', 'other',
] as const satisfies readonly RelationshipKind[];

const STATES = ['current', 'past', 'secret'] as const satisfies readonly Relationship['state'][];

function serialize(rel: Relationship): Record<string, unknown> {
  return {
    id: rel.id,
    a: { id: rel.entityAId, name: rel.entityAName },
    b: { id: rel.entityBId, name: rel.entityBName },
    kind: rel.kind,
    intensity: rel.intensity,
    label: rel.label,
    notes: rel.notes,
    state: rel.state,
    directional: rel.directional,
    updatedAt: rel.updatedAt,
  };
}

export async function whListRelationships(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const entityId = optString(args, 'entityId');
  const all = await getRelationships(projectId);
  // Stored once, on either side — so "everything touching X" checks both.
  const rows = entityId
    ? all.filter((rel) => rel.entityAId === entityId || rel.entityBId === entityId)
    : all;
  return { projectId, entityId: entityId ?? null, relationships: rows.map(serialize) };
}

/** Resolve a codex id to its title, so the denormalised name is never blank. */
async function nameOf(id: string): Promise<string> {
  const entry = await db.codexEntries.get(id);
  if (!entry) throw new BridgeError('not-found', `No codex entry with id "${id}".`);
  return entry.title;
}

export async function whCreateRelationship(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'relationships');
  const entityAId = requireString(args, 'entityAId');
  const entityBId = requireString(args, 'entityBId');
  if (entityAId === entityBId) {
    throw new BridgeError('bad-args', 'A character cannot have a relationship with themselves.');
  }
  const [entityAName, entityBName] = await Promise.all([nameOf(entityAId), nameOf(entityBId)]);

  const intensity = optNumber(args, 'intensity') ?? 0;
  if (intensity < -5 || intensity > 5) {
    throw new BridgeError('bad-args', 'intensity runs from -5 (hostile) to 5 (devoted).');
  }

  const now = Date.now();
  const relationship: Relationship = {
    id: generateId('rel'),
    projectId,
    entityAId,
    entityAType: 'codex-entry',
    entityAName,
    entityBId,
    entityBType: 'codex-entry',
    entityBName,
    kind: optEnum(args, 'kind', KINDS) ?? 'other',
    intensity,
    label: optString(args, 'label') ?? '',
    notes: optString(args, 'notes') ?? '',
    state: optEnum(args, 'state', STATES) ?? 'current',
    directional: optBoolean(args, 'directional') ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await createRelationship(relationship);
  return withAudit(
    { id: relationship.id, created: true },
    {
      projectId,
      entityId: relationship.id,
      summary: `linked ${entityAName} and ${entityBName} as ${relationship.kind}`,
    },
  );
}

export async function whUpdateRelationship(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await getRelationship(id);
  if (!existing) throw new BridgeError('not-found', `No relationship with id "${id}".`);

  const changes: Partial<Relationship> = {};
  const kind = optEnum(args, 'kind', KINDS);
  if (kind !== undefined) changes.kind = kind;
  const state = optEnum(args, 'state', STATES);
  if (state !== undefined) changes.state = state;
  const intensity = optNumber(args, 'intensity');
  if (intensity !== undefined) {
    if (intensity < -5 || intensity > 5) {
      throw new BridgeError('bad-args', 'intensity runs from -5 (hostile) to 5 (devoted).');
    }
    changes.intensity = intensity;
  }
  const label = optString(args, 'label');
  if (label !== undefined) changes.label = label;
  const notes = optString(args, 'notes');
  if (notes !== undefined) changes.notes = notes;
  const directional = optBoolean(args, 'directional');
  if (directional !== undefined) changes.directional = directional;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateRelationship(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated ${existing.entityAName}–${existing.entityBName}`,
      before: { kind: existing.kind, state: existing.state, intensity: existing.intensity },
    },
  );
}
