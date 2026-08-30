// ============================================================================
// AI bridge tools — character arcs
// ============================================================================
//
// `arcBeats` is scoped by arcId, not projectId. `CharacterArc.characterName`
// is denormalised beside `characterId` and nothing reconciles them later, so
// both are written together here.
//
// Template seeding is deliberately NOT exposed: the templates store i18n keys
// that must be resolved with t() before they become the author's content, and
// a model writing its own beats is better than a model pasting label keys.

import { db } from '@/db';
import type { ArcBeat, ArcBeatStage, ArcStatus, CharacterArc } from '@/engines/character-arc/types';
import {
  createArc,
  createBeat,
  getArc,
  getArcs,
  getBeats,
  updateBeat,
} from '@/engines/character-arc/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optEnum,
  optNumber,
  optString,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const STAGES = [
  'ghost', 'weak', 'flaw', 'denial', 'inciting',
  'commitment', 'growth', 'moment-of-truth', 'climax', 'resolution',
] as const satisfies readonly ArcBeatStage[];

const STATUSES = ['planning', 'drafting', 'revised', 'done'] as const satisfies readonly ArcStatus[];

function serializeArc(arc: CharacterArc): Record<string, unknown> {
  return {
    id: arc.id,
    title: arc.title,
    characterId: arc.characterId,
    characterName: arc.characterName,
    ghost: arc.ghost,
    lie: arc.lie,
    truth: arc.truth,
    want: arc.want,
    need: arc.need,
    summary: arc.summary,
    status: arc.status,
    updatedAt: arc.updatedAt,
  };
}

export async function whListArcs(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const arcs = await getArcs(projectId);
  const beats = await db.arcBeats.where('projectId').equals(projectId).toArray();
  return {
    projectId,
    arcs: arcs.map((arc) => ({
      ...serializeArc(arc),
      beatCount: beats.filter((beat) => beat.arcId === arc.id).length,
    })),
  };
}

export async function whGetArc(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const arc = await getArc(id);
  if (!arc) throw new BridgeError('not-found', `No character arc with id "${id}".`);
  const beats = await getBeats(id);
  return {
    ...serializeArc(arc),
    projectId: arc.projectId,
    beats: beats.map((beat) => ({
      id: beat.id,
      order: beat.order,
      stage: beat.stage,
      title: beat.title,
      description: beat.description,
      emotion: beat.emotion,
      storyPosition: beat.storyPosition,
      status: beat.status,
      linkedSceneId: beat.linkedSceneId,
      linkedBeatId: beat.linkedBeatId,
    })),
  };
}

export async function whCreateArc(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'character-arc');
  const characterId = optString(args, 'characterId');
  // The name is denormalised beside the id; resolve it now or the arc shows
  // a blank subject forever.
  const character = characterId ? await db.codexEntries.get(characterId) : undefined;
  if (characterId && !character) {
    throw new BridgeError('not-found', `No codex entry with id "${characterId}".`);
  }
  const now = Date.now();
  const arc: CharacterArc = {
    id: generateId('arc'),
    projectId,
    title: requireString(args, 'title'),
    characterId,
    characterName: character?.title,
    ghost: optString(args, 'ghost') ?? '',
    lie: optString(args, 'lie') ?? '',
    truth: optString(args, 'truth') ?? '',
    want: optString(args, 'want') ?? '',
    need: optString(args, 'need') ?? '',
    summary: optString(args, 'summary') ?? '',
    status: optEnum(args, 'status', STATUSES) ?? 'planning',
    createdAt: now,
    updatedAt: now,
  };
  await createArc(arc);
  return withAudit(
    { id: arc.id, title: arc.title, created: true },
    { projectId, entityId: arc.id, summary: `created arc "${arc.title}"` },
  );
}

export async function whAddArcBeat(args: ToolArgs): Promise<unknown> {
  const arcId = requireString(args, 'arcId');
  const arc = await getArc(arcId);
  if (!arc) throw new BridgeError('not-found', `No character arc with id "${arcId}".`);
  const siblings = await getBeats(arcId);
  const now = Date.now();
  const beat: ArcBeat = {
    id: generateId('arcbeat'),
    arcId,
    projectId: arc.projectId,
    order: optNumber(args, 'order') ?? siblings.length,
    stage: optEnum(args, 'stage', STAGES) ?? 'inciting',
    title: requireString(args, 'title'),
    description: optString(args, 'description') ?? '',
    emotion: optString(args, 'emotion'),
    storyPosition: optNumber(args, 'storyPosition'),
    linkedBeatId: optString(args, 'linkedBeatId'),
    linkedSceneId: optString(args, 'linkedSceneId'),
    status: optEnum(args, 'status', STATUSES) ?? 'planning',
    createdAt: now,
    updatedAt: now,
  };
  await createBeat(beat);
  return withAudit(
    { id: beat.id, arcId, stage: beat.stage, created: true },
    {
      projectId: arc.projectId,
      entityId: beat.id,
      summary: `added ${beat.stage} beat to arc "${arc.title}"`,
    },
  );
}

export async function whUpdateArcBeat(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await db.arcBeats.get(id);
  if (!existing) throw new BridgeError('not-found', `No arc beat with id "${id}".`);

  const changes: Partial<ArcBeat> = {};
  (['title', 'description', 'emotion', 'linkedSceneId'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const stage = optEnum(args, 'stage', STAGES);
  if (stage !== undefined) changes.stage = stage;
  const status = optEnum(args, 'status', STATUSES);
  if (status !== undefined) changes.status = status;
  const storyPosition = optNumber(args, 'storyPosition');
  if (storyPosition !== undefined) changes.storyPosition = storyPosition;
  const order = optNumber(args, 'order');
  if (order !== undefined) changes.order = order;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateBeat(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated arc beat "${existing.title}"`,
      before: { title: existing.title, stage: existing.stage, status: existing.status },
    },
  );
}
