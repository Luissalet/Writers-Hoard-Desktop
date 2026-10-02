// ============================================================================
// AI bridge tools — handing work to the other Hoard apps
// ============================================================================
//
// wh_character_to_prospero · wh_storyboard_to_prospero  →  Prospero's Hoard
// wh_world_to_scheherazade · wh_world_from_scheherazade ↔  Scheherazade's Hoard
//
// The work is in services/familyBridge/actions.ts, shared with the buttons in
// the codex and the storyboard; these handlers resolve the project, pin the
// caller's scope, and put a FamilyActionError into the shape every bridge tool
// fails in. Arguments are camelCase here; the executor also accepts the
// snake_case spelling the other apps use (`character_id`), and so do these
// handlers, for a direct call.

import {
  FamilyActionError, fetchWorldFromScheherazade, sendCharacterToProspero, sendStoryboardToProspero, sendWorldToScheherazade,
} from '@/services/familyBridge/actions';
import { db } from '@/db';
import {
  assertRowInScope, BridgeError, optBoolean, optString, resolveProjectId, withAudit, type ToolArgs,
} from './shared';

const KEYS = ['projectId', 'characterId', 'storyboardId', 'worldId', 'includeSecret'] as const;

/** The arguments under their camelCase names; `project_id` and the like are accepted for a direct call. */
function normalized(args: ToolArgs): ToolArgs {
  const out: ToolArgs = { ...args };
  for (const key of KEYS) {
    const snake = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
    if (out[key] === undefined && out[snake] !== undefined) out[key] = out[snake];
    delete out[snake];
  }
  return out;
}

function required(args: ToolArgs, camel: string): string {
  const value = args[camel];
  if (typeof value !== 'string' || !value.trim()) throw new BridgeError('bad-args', `"${camel}" is required and must be a non-empty string.`);
  return value.trim();
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FamilyActionError) throw new BridgeError(error.code, error.message);
    throw error;
  }
}

/** A row addressed by id is checked against the caller's scope before anything leaves the app. */
async function scoped(args: ToolArgs, table: 'codexEntries' | 'storyboards', id: string): Promise<void> {
  const row = await db.table(table).get(id);
  if (row) assertRowInScope(args, (row as { projectId?: string }).projectId);
}

export async function whCharacterToProspero(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = resolveProjectId(args);
  const characterId = required(args, 'characterId');
  await scoped(args, 'codexEntries', characterId);
  const sent = await guarded(() => sendCharacterToProspero(projectId, characterId));
  return withAudit(
    {
      sent: true,
      app: 'prospero',
      character: { id: characterId, name: sent.name, ref: sent.sourceRef },
      prospero: { id: sent.remoteId ?? null, ref: sent.remoteRef ?? null },
      pictures: { sent: sent.picturesSent, skipped: sent.picturesSkipped },
      linked: sent.linked,
      note: sent.remoteId
        ? 'The character is in Prospero\'s cast. The codex entry was not changed.'
        : 'Prospero accepted the character but did not say which cast member it made; the codex entry was not changed.',
    },
    { projectId, summary: `sent character "${sent.name}" to Prospero's cast` },
  );
}

export async function whStoryboardToProspero(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = resolveProjectId(args);
  const storyboardId = required(args, 'storyboardId');
  await scoped(args, 'storyboards', storyboardId);
  const sent = await guarded(() => sendStoryboardToProspero(projectId, storyboardId));
  return withAudit(
    {
      sent: true,
      app: 'prospero',
      storyboard: { id: storyboardId, title: sent.title, ref: sent.sourceRef },
      shots: sent.shots,
      prospero: { id: sent.remoteId ?? null, ref: sent.remoteRef ?? null },
      pictures: { sent: sent.picturesSent, skipped: sent.picturesSkipped, dropped: sent.picturesDropped },
      linked: sent.linked,
      note: 'A production draft was made in Prospero. The storyboard was not changed.',
    },
    { projectId, summary: `sent storyboard "${sent.title}" (${sent.shots} shots) to Prospero` },
  );
}

export async function whWorldToScheherazade(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = resolveProjectId(args);
  const worldId = optString(args, 'worldId');
  const includeSecret = optBoolean(args, 'includeSecret') === true;
  const sent = await guarded(() => sendWorldToScheherazade(projectId, { worldId: worldId?.trim() || undefined, includeSecret }));
  const total = Object.values(sent.sent).reduce((sum, count) => sum + count, 0);
  return withAudit(
    {
      sent: true,
      app: 'scheherazade',
      world: sent.world ?? null,
      worldCreated: sent.worldCreated ?? false,
      worldRef: sent.worldRef ?? null,
      documentCounts: sent.sent,
      leftOut: sent.skipped,
      states: sent.counts ?? {},
      items: sent.items ?? [],
      linked: sent.linked,
      note: 'The project was not changed. Records Scheherazade reports as local_modified were edited there and were left as they are.',
    },
    { projectId, summary: `sent the world of "${sent.projectTitle}" (${total} records) to Scheherazade` },
  );
}

export async function whWorldFromScheherazade(raw: ToolArgs): Promise<unknown> {
  const args = normalized(raw);
  const projectId = resolveProjectId(args);
  const worldId = required(args, 'worldId');
  const result = await guarded(() => fetchWorldFromScheherazade(projectId, worldId));
  const ids = [...result.created.timelines, ...result.created.codex, ...result.created.relationships, ...result.created.events];
  const shown = result.items.slice(0, 100);
  const body = {
    app: 'scheherazade',
    world: result.world,
    counts: result.counts,
    created: {
      codexEntries: result.created.codex.length, relationships: result.created.relationships.length,
      events: result.created.events.length, timelines: result.created.timelines.length,
    },
    updated: result.updatedIds.length,
    items: shown,
    itemsTruncated: result.items.length > shown.length,
    notes: result.notes,
    linked: result.linked,
    hint: result.counts.local_modified
      ? 'local_modified records were edited here after an earlier import and were left alone; compare them with the source before changing them.'
      : undefined,
  };
  const summary = `brought the world "${result.world.name}" from Scheherazade (${ids.length} new, ${result.updatedIds.length} updated)`;
  if (!ids.length) return withAudit({ ...body, created: { ...body.created }, changed: result.updatedIds.length > 0 }, { projectId, summary });
  return withAudit({ ...body, changed: true }, { projectId, entityIds: ids, entityId: ids[0], kind: 'create', summary });
}
