// ============================================================================
// AI bridge tools — seeds and payoffs
// ============================================================================
//
// The status is DERIVED, never read from the row: `computeSeedStatus` is the
// single source of truth the whole app agreed on — an un-cut seed with no
// payoff is orphaned, whatever the stored field says. Only 'cut' is worth
// writing.

import type { Payoff, Seed, SeedKind } from '@/engines/seeds/types';
import { computeSeedStatus } from '@/engines/seeds/types';
import {
  createPayoff,
  createSeed,
  getAllPayoffsForProject,
  getSeed,
  getSeeds,
  updateSeed,
} from '@/engines/seeds/operations';
import { generateId } from '@/utils/idGenerator';
import {
  BridgeError,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const KINDS = [
  'foreshadow', 'chekhov', 'setup', 'callback', 'mystery',
] as const satisfies readonly SeedKind[];

export async function whListSeeds(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const kind = optEnum(args, 'kind', KINDS);
  const orphanedOnly = optBoolean(args, 'orphanedOnly') === true;

  const [seeds, payoffs] = await Promise.all([
    getSeeds(projectId),
    getAllPayoffsForProject(projectId),
  ]);

  const rows = seeds
    .filter((seed) => (kind ? seed.kind === kind : true))
    .map((seed) => {
      const own = payoffs.filter((payoff) => payoff.seedId === seed.id);
      return {
        id: seed.id,
        title: seed.title,
        description: seed.description,
        kind: seed.kind,
        // Derived, not stored — see the header note.
        status: computeSeedStatus(seed, own),
        plantedAt: seed.plantedAt,
        locationLabel: seed.locationLabel,
        tags: seed.tags,
        linkedWritingId: seed.linkedWritingId,
        linkedSceneId: seed.linkedSceneId,
        payoffs: own.map((payoff) => ({
          id: payoff.id,
          title: payoff.title,
          description: payoff.description,
          paidAt: payoff.paidAt,
          strength: payoff.strength,
          locationLabel: payoff.locationLabel,
        })),
      };
    })
    .filter((row) => (orphanedOnly ? row.status === 'orphaned' : true));

  return {
    projectId,
    seeds: rows,
    hint: orphanedOnly && rows.length === 0
      ? 'Nothing left hanging: every seed either paid off or was cut.'
      : undefined,
  };
}

export async function whCreateSeed(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'seeds');
  const now = Date.now();
  const seed: Seed = {
    id: generateId('seed'),
    projectId,
    title: requireString(args, 'title'),
    description: optString(args, 'description') ?? '',
    kind: optEnum(args, 'kind', KINDS) ?? 'foreshadow',
    status: 'planted',
    plantedAt: optNumber(args, 'plantedAt'),
    linkedWritingId: optString(args, 'linkedWritingId'),
    linkedSceneId: optString(args, 'linkedSceneId'),
    locationLabel: optString(args, 'locationLabel'),
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createSeed(seed);
  return withAudit(
    { id: seed.id, title: seed.title, created: true },
    { projectId, entityId: seed.id, summary: `planted "${seed.title}" (${seed.kind})` },
  );
}

export async function whUpdateSeed(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await getSeed(id);
  if (!existing) throw new BridgeError('not-found', `No seed with id "${id}".`);

  const changes: Partial<Seed> = {};
  (['title', 'description', 'locationLabel'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const kind = optEnum(args, 'kind', KINDS);
  if (kind !== undefined) changes.kind = kind;
  const status = optEnum(args, 'status', ['planted', 'cut'] as const);
  if (status !== undefined) changes.status = status;
  const plantedAt = optNumber(args, 'plantedAt');
  if (plantedAt !== undefined) changes.plantedAt = plantedAt;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateSeed(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated seed "${existing.title}"`,
      before: { title: existing.title, kind: existing.kind, status: existing.status },
    },
  );
}

export async function whAddPayoff(args: ToolArgs): Promise<unknown> {
  const seedId = requireString(args, 'seedId');
  const seed = await getSeed(seedId);
  if (!seed) throw new BridgeError('not-found', `No seed with id "${seedId}".`);

  const rawStrength = Math.round(optNumber(args, 'strength') ?? 3);
  const strength = Math.max(1, Math.min(5, rawStrength)) as Payoff['strength'];
  const now = Date.now();
  const payoff: Payoff = {
    id: generateId('payoff'),
    seedId,
    // Denormalised: getAllPayoffsForProject and the backup both rely on it.
    projectId: seed.projectId,
    title: requireString(args, 'title'),
    description: optString(args, 'description') ?? '',
    paidAt: optNumber(args, 'paidAt'),
    strength,
    linkedWritingId: optString(args, 'linkedWritingId'),
    linkedSceneId: optString(args, 'linkedSceneId'),
    locationLabel: optString(args, 'locationLabel'),
    createdAt: now,
    updatedAt: now,
  };
  await createPayoff(payoff);
  return withAudit(
    { id: payoff.id, seedId, created: true, seedStatusNow: 'paid' },
    {
      projectId: seed.projectId,
      entityId: payoff.id,
      summary: `paid off "${seed.title}" with "${payoff.title}"`,
    },
  );
}
