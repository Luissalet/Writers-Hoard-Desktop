// ============================================================================
// AI bridge tools — dialog scenes (the screenplay / stage side)
// ============================================================================
//
// Three tables, three different scopes: `scenes` by projectId, `dialogBlocks`
// and `sceneCasts` by sceneId. A block carries `projectId` denormalised as
// well, plus the speaker's name and colour copied from the cast — nothing
// reconciles those later, so they are filled in at write time here.

import { db } from '@/db';
import type { DialogBlock, DialogBlockType, Scene, SceneCast } from '@/engines/dialog-scene/types';
import {
  addCastMember,
  createDialogBlock,
  createScene,
  getDialogBlocks,
  getScene,
  getSceneCast,
  getScenes,
  updateDialogBlock,
  updateScene,
} from '@/engines/dialog-scene/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  optBoolean,
  optEnum,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const BLOCK_TYPES = [
  'dialog', 'stage-direction', 'action', 'transition', 'note', 'slug',
] as const satisfies readonly DialogBlockType[];

const DEFAULT_SPEAKER_COLOR = '#c4973b';

async function mustGetScene(id: string): Promise<Scene> {
  const scene = await getScene(id);
  if (!scene) throw new BridgeError('not-found', `No scene with id "${id}".`);
  return scene;
}

export async function whListScenes(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const scenes = await getScenes(projectId);
  // sceneCasts is indexed by sceneId only — it carries no projectId — so it is
  // fetched by the ids we already have rather than scanned.
  const [blocks, casts] = await Promise.all([
    db.dialogBlocks.where('projectId').equals(projectId).toArray(),
    db.sceneCasts.where('sceneId').anyOf(scenes.map((scene) => scene.id)).toArray(),
  ]);
  return {
    projectId,
    scenes: scenes.map((scene) => {
      const own = blocks.filter((block) => block.sceneId === scene.id);
      return {
        id: scene.id,
        title: scene.title,
        setting: scene.setting,
        sceneNumber: scene.sceneNumber,
        isOmitted: scene.isOmitted === true,
        description: scene.description,
        tags: scene.tags,
        blockCount: own.length,
        // Two different things, and the difference is the point: `cast` is who
        // the writer put in the scene, `speakers` is who actually says a line.
        // A cast member with no lines yet is exactly what someone asks about.
        cast: casts.filter((member) => member.sceneId === scene.id).map((member) => member.characterName),
        speakers: [...new Set(
          own.filter((b) => b.type === 'dialog' && b.characterName).map((b) => b.characterName),
        )],
        order: scene.order,
      };
    }),
  };
}

export async function whGetScene(args: ToolArgs): Promise<unknown> {
  const scene = await mustGetScene(requireString(args, 'id'));
  const [blocks, cast] = await Promise.all([getDialogBlocks(scene.id), getSceneCast(scene.id)]);
  return {
    id: scene.id,
    projectId: scene.projectId,
    title: scene.title,
    setting: scene.setting,
    description: scene.description,
    sceneNumber: scene.sceneNumber,
    isOmitted: scene.isOmitted === true,
    tags: scene.tags,
    cast: cast.map((member) => ({ name: member.characterName, characterId: member.characterId })),
    blocks: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      character: block.characterName || undefined,
      parenthetical: block.parenthetical,
      content: block.content,
      dualWith: block.dualGroupId,
    })),
  };
}

export async function whCreateScene(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'dialog-scene');
  const siblings = await getScenes(projectId);
  const now = Date.now();
  const scene: Scene = {
    id: generateId('scene'),
    projectId,
    title: requireString(args, 'title'),
    description: optString(args, 'description'),
    setting: optString(args, 'setting'),
    order: siblings.length,
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createScene(scene);
  return withAudit(
    { id: scene.id, title: scene.title, created: true },
    { projectId, entityId: scene.id, summary: `created scene "${scene.title}"` },
  );
}

export async function whUpdateScene(args: ToolArgs): Promise<unknown> {
  const scene = await mustGetScene(requireString(args, 'id'));
  await assertEngineEnabled(scene.projectId, 'dialog-scene');
  assertRowInScope(args, scene.projectId);
  const changes: Partial<Scene> = {};
  (['title', 'description', 'setting'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const isOmitted = optBoolean(args, 'isOmitted');
  if (isOmitted !== undefined) changes.isOmitted = isOmitted;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateScene(scene.id, changes);
  return withAudit(
    { id: scene.id, updated: Object.keys(changes) },
    {
      projectId: scene.projectId,
      entityId: scene.id,
      summary: `updated scene "${scene.title}"`,
      before: { title: scene.title, setting: scene.setting, isOmitted: scene.isOmitted },
    },
  );
}

/**
 * Resolve a speaker to the scene's cast, adding them if new.
 *
 * The cast is per scene, and a block copies the name and colour out of it —
 * so a speaker who is not in the cast yet has to join it here, or the block
 * renders in a default colour that never matches the rest of their lines.
 */
async function resolveSpeaker(
  scene: Scene,
  name: string,
): Promise<{ characterName: string; characterColor: string; characterId?: string }> {
  const cast = await getSceneCast(scene.id);
  const existing = cast.find(
    (member) => member.characterName.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return {
      characterName: existing.characterName,
      characterColor: existing.color,
      characterId: existing.characterId,
    };
  }
  // Match a codex character by title, case-insensitively — the same rule the
  // Fountain import uses, so a script imported and a line added agree.
  const entries = await db.codexEntries.where('projectId').equals(scene.projectId).toArray();
  const character = entries.find(
    (entry) => entry.type === 'character' && entry.title.toLowerCase() === name.toLowerCase(),
  );
  const member: SceneCast = {
    id: generateId('cast'),
    sceneId: scene.id,
    characterId: character?.id,
    characterName: name,
    color: DEFAULT_SPEAKER_COLOR,
  };
  await addCastMember(member);
  return { characterName: name, characterColor: member.color, characterId: member.characterId };
}

export async function whAddDialog(args: ToolArgs): Promise<unknown> {
  const scene = await mustGetScene(requireString(args, 'sceneId'));
  await assertEngineEnabled(scene.projectId, 'dialog-scene');
  assertRowInScope(args, scene.projectId);
  const type = optEnum(args, 'type', BLOCK_TYPES) ?? 'dialog';
  const content = requireString(args, 'content');
  const speaker = optString(args, 'character');

  if (type === 'dialog' && !speaker?.trim()) {
    throw new BridgeError('bad-args', 'A dialog block needs a `character`: who is speaking?');
  }

  const identity = speaker?.trim()
    ? await resolveSpeaker(scene, speaker.trim())
    : { characterName: '', characterColor: DEFAULT_SPEAKER_COLOR, characterId: undefined };

  // Dual dialogue is two blocks sharing a group id; the first one may not have
  // had a group yet, so it gets one now.
  let dualGroupId: string | undefined;
  const dualWith = optString(args, 'dualWithBlockId');
  if (dualWith) {
    const partner = await db.dialogBlocks.get(dualWith);
    if (!partner) throw new BridgeError('not-found', `No dialog block with id "${dualWith}".`);
    dualGroupId = partner.dualGroupId ?? generateId('dual');
    if (!partner.dualGroupId) await updateDialogBlock(partner.id, { dualGroupId });
  }

  const siblings = await getDialogBlocks(scene.id);
  const now = Date.now();
  const block: DialogBlock = {
    id: generateId('block'),
    sceneId: scene.id,
    projectId: scene.projectId,
    type,
    characterId: identity.characterId,
    characterName: identity.characterName,
    characterColor: identity.characterColor,
    content,
    order: siblings.length,
    // Stored bare: the editor and the Fountain export add the brackets.
    parenthetical: optString(args, 'parenthetical')?.replace(/^\(|\)$/g, '') || undefined,
    dualGroupId,
    createdAt: now,
    updatedAt: now,
  };
  await createDialogBlock(block);
  return withAudit(
    { id: block.id, sceneId: scene.id, order: block.order, created: true },
    {
      projectId: scene.projectId,
      entityId: block.id,
      summary: `added ${type} to scene "${scene.title}"${identity.characterName ? ` (${identity.characterName})` : ''}`,
    },
  );
}

export async function whUpdateDialogBlock(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const block = await db.dialogBlocks.get(id);
  if (!block) throw new BridgeError('not-found', `No dialog block with id "${id}".`);
  await assertEngineEnabled(block.projectId, 'dialog-scene');
  assertRowInScope(args, block.projectId);

  const changes: Partial<DialogBlock> = {};
  const content = optString(args, 'content');
  if (content !== undefined) changes.content = content;
  const type = optEnum(args, 'type', BLOCK_TYPES);
  if (type !== undefined) changes.type = type;
  const parenthetical = optString(args, 'parenthetical');
  if (parenthetical !== undefined) {
    changes.parenthetical = parenthetical.replace(/^\(|\)$/g, '') || undefined;
  }
  const speaker = optString(args, 'character');
  if (speaker !== undefined && speaker.trim()) {
    const scene = await mustGetScene(block.sceneId);
    const identity = await resolveSpeaker(scene, speaker.trim());
    changes.characterName = identity.characterName;
    changes.characterColor = identity.characterColor;
    changes.characterId = identity.characterId;
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateDialogBlock(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: block.projectId,
      entityId: id,
      summary: `edited a ${block.type} block`,
      // Whole and under their real column names: undo writes this object back
      // verbatim, so a truncated line would replace the monologue with its
      // first 400 characters, and `character` would land as a junk column.
      before: {
        type: block.type,
        characterName: block.characterName,
        content: block.content,
      },
    },
  );
}
