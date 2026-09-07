import { db } from '@/db';
import { resolveEntityInEngine } from '@/engines/_shared/entityResolverRegistry';
import { generateId } from '@/utils/idGenerator';
import type {
  NarrativeAnchorKind,
  NarrativeMoment,
  StoryClaim,
  StoryEntityRef,
} from './types';

const ANCHOR_ENGINE: Record<NarrativeAnchorKind, NarrativeMoment['anchorEngineId']> = {
  beat: 'outline',
  scene: 'dialog-scene',
  event: 'timeline',
};

async function anchorRow(
  kind: NarrativeAnchorKind,
  entityId: string,
): Promise<{ projectId: string; title: string } | null> {
  if (kind === 'beat') {
    const row = await db.outlineBeats.get(entityId);
    return row ? { projectId: row.projectId, title: row.title } : null;
  }
  if (kind === 'scene') {
    const row = await db.scenes.get(entityId);
    return row ? { projectId: row.projectId, title: row.title } : null;
  }
  const row = await db.timelineEvents.get(entityId);
  return row ? { projectId: row.projectId, title: row.title } : null;
}

async function requireMoment(projectId: string, momentId: string): Promise<NarrativeMoment> {
  const moment = await db.narrativeMoments.get(momentId);
  if (!moment || moment.projectId !== projectId) throw new Error('Narrative moment is outside this project.');
  return moment;
}

async function requireEntity(projectId: string, ref: StoryEntityRef): Promise<void> {
  const entity = await resolveEntityInEngine(ref.engineId, ref.entityId);
  if (!entity || entity.projectId !== projectId) {
    throw new Error(`Story source "${ref.title}" is unavailable in this project.`);
  }
}

async function validateInterval(
  projectId: string,
  fromId: string | undefined,
  untilId: string | undefined,
): Promise<void> {
  const from = fromId ? await requireMoment(projectId, fromId) : undefined;
  const until = untilId ? await requireMoment(projectId, untilId) : undefined;
  if (from && until && until.order < from.order) {
    throw new Error('A story-state interval cannot end before it begins.');
  }
}

async function validateClaim(claim: StoryClaim): Promise<void> {
  if (!claim.projectId) throw new Error('A story claim needs a project.');
  if (claim.source) await requireEntity(claim.projectId, claim.source);
  if (claim.kind === 'fact') {
    if (!claim.value.trim()) throw new Error('A continuity fact needs a value.');
    await requireEntity(claim.projectId, claim.subject);
    await validateInterval(claim.projectId, claim.fromMomentId, claim.untilMomentId);
    return;
  }
  if (claim.kind === 'belief') {
    if (!claim.proposition.trim()) throw new Error('Knowledge needs a proposition.');
    await requireEntity(claim.projectId, claim.actor);
    await validateInterval(claim.projectId, claim.acquiredAtMomentId, claim.revealedAtMomentId);
    return;
  }
  if (!claim.title.trim() || !claim.effect.trim()) throw new Error('A world rule needs a title and an effect.');
  await validateInterval(claim.projectId, claim.fromMomentId, claim.untilMomentId);
  if (claim.codexEntryId) {
    const entry = await db.codexEntries.get(claim.codexEntryId);
    if (!entry || entry.projectId !== claim.projectId) throw new Error('The rule Codex entry is unavailable.');
  }
  for (const evidence of claim.evidence) await requireEntity(claim.projectId, evidence);
}

export async function createNarrativeMoment(input: {
  projectId: string;
  label?: string;
  anchorKind: NarrativeAnchorKind;
  anchorEntityId: string;
  order?: number;
}): Promise<NarrativeMoment> {
  const anchor = await anchorRow(input.anchorKind, input.anchorEntityId);
  if (!anchor || anchor.projectId !== input.projectId) throw new Error('Narrative anchor is outside this project.');
  const duplicate = await db.narrativeMoments
    .where('[projectId+anchorKind+anchorEntityId]')
    .equals([input.projectId, input.anchorKind, input.anchorEntityId])
    .first();
  if (duplicate) return duplicate;
  const existing = await db.narrativeMoments.where('projectId').equals(input.projectId).toArray();
  const now = Date.now();
  const moment: NarrativeMoment = {
    id: generateId('moment'),
    projectId: input.projectId,
    label: input.label?.trim() || anchor.title,
    order: input.order ?? (existing.reduce((max, row) => Math.max(max, row.order), -1) + 1),
    anchorKind: input.anchorKind,
    anchorEngineId: ANCHOR_ENGINE[input.anchorKind],
    anchorEntityId: input.anchorEntityId,
    anchorTitle: anchor.title,
    createdAt: now,
    updatedAt: now,
  };
  await db.narrativeMoments.add(moment);
  return moment;
}

export async function listNarrativeMoments(projectId: string): Promise<NarrativeMoment[]> {
  return db.narrativeMoments.where('projectId').equals(projectId).sortBy('order');
}

export async function reorderNarrativeMoments(projectId: string, orderedIds: readonly string[]): Promise<void> {
  const moments = await db.narrativeMoments.where('projectId').equals(projectId).toArray();
  const byId = new Map(moments.map((row) => [row.id, row]));
  if (orderedIds.length !== moments.length || new Set(orderedIds).size !== moments.length) {
    throw new Error('Narrative reorder must name every moment exactly once.');
  }
  if (orderedIds.some((id) => !byId.has(id))) throw new Error('Narrative reorder contains a foreign moment.');
  const now = Date.now();
  await db.narrativeMoments.bulkPut(orderedIds.map((id, order) => ({ ...byId.get(id)!, order, updatedAt: now })));
}

export async function deleteNarrativeMoment(momentId: string): Promise<void> {
  const moment = await db.narrativeMoments.get(momentId);
  if (!moment) return;
  const references = await db.storyClaims.where('projectId').equals(moment.projectId).filter((claim) => {
    if (claim.kind === 'fact') return claim.fromMomentId === momentId || claim.untilMomentId === momentId;
    if (claim.kind === 'belief') return claim.acquiredAtMomentId === momentId || claim.revealedAtMomentId === momentId;
    return claim.fromMomentId === momentId || claim.untilMomentId === momentId;
  }).count();
  if (references) throw new Error('Move or remove the claims attached to this story moment first.');
  await db.narrativeMoments.delete(momentId);
}

export async function createStoryClaim<Claim extends StoryClaim>(
  value: Omit<Claim, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Claim, 'id'>>,
): Promise<Claim> {
  const now = Date.now();
  const claim = {
    ...value,
    id: value.id ?? generateId('story_claim'),
    createdAt: now,
    updatedAt: now,
  } as Claim;
  await validateClaim(claim);
  await db.storyClaims.add(claim);
  return claim;
}

export async function updateStoryClaim(
  claimId: string,
  changes: Partial<StoryClaim>,
): Promise<StoryClaim> {
  const current = await db.storyClaims.get(claimId);
  if (!current) throw new Error('Story claim not found.');
  const next = {
    ...current,
    ...changes,
    id: current.id,
    projectId: current.projectId,
    kind: current.kind,
    updatedAt: Date.now(),
  } as StoryClaim;
  await validateClaim(next);
  await db.storyClaims.put(next);
  return next;
}

export async function listStoryClaims(projectId: string): Promise<StoryClaim[]> {
  return db.storyClaims.where('projectId').equals(projectId).sortBy('createdAt');
}

export async function deleteStoryClaim(claimId: string): Promise<void> {
  await db.storyClaims.delete(claimId);
}
