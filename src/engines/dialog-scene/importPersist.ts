// ============================================
// Script import — shared contract + persistence
// ============================================
//
// The parsers (`fountainImport.ts`, `fdxImport.ts`) are pure: text in,
// `ParsedScript` out, no Dexie. This module owns what they share — the parsed
// shapes, the error class, the cue helpers — and the single persistence step.
//
// Import is APPEND-ONLY: parsed scenes land after the project's existing ones
// inside one transaction. A failure aborts atomically and leaves the project
// untouched; there is no replace/merge mode.

import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import type { DialogBlockType, Scene, DialogBlock, SceneCast } from './types';

/**
 * `message` is a locale-key suffix under `dialogScene.import.*` — same idiom
 * as `PlanImportError` in video-planner's `planImport.ts`.
 */
export class ScriptImportError extends Error {}

export interface ParsedBlock {
  type: DialogBlockType;
  /** Dialog only: the cue as written, minus "(CONT'D)" — keeps "(V.O.)" etc. */
  characterName?: string;
  /** Dialog only: canonical cast identity — ALL "(...)" extensions stripped. */
  castKey?: string;
  /** WITHOUT surrounding parens (the model stores it bare). */
  parenthetical?: string;
  /** Plain text; may contain newlines. */
  content: string;
  /** Scene-local pair index; persist mints the real dualGroupId. */
  dualGroup?: number;
}

export interface ParsedScene {
  title: string;
  description?: string;
  sceneNumber?: number;
  isOmitted?: boolean;
  blocks: ParsedBlock[];
}

export interface ParsedScript {
  scenes: ParsedScene[];
}

export interface ScriptImportResult {
  sceneCount: number;
  blockCount: number;
}

/** Same default the CastBar uses for a new member. */
const DEFAULT_CAST_COLOR = '#c4973b';

/** "(CONT'D)" is a pagination artifact — drop it from the cue entirely. */
export function stripContD(cue: string): string {
  return cue
    .replace(/\s*\((CONT'?D|CONT’D|CONTINUED)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cast identity: "JOHN (V.O.)" → "JOHN". */
export function castKeyOf(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Persist a parsed script into the project. Returns counts for the toast.
 *
 * - Scenes are appended after the existing ones (`order` continues from the
 *   current maximum), so a failed import can never disturb existing data.
 * - Scenes that arrive with a number (`#12#` / FDX `Number`) are stored
 *   `isLocked: true` — REQUIRED, not cosmetic: the engine renumbers on every
 *   reorder/create/delete, and an unlocked imported number would be clobbered
 *   on the next edit. The caller runs `autoNumberScenes` afterwards, which
 *   respects locks and numbers the rest sequentially.
 * - One `SceneCast` per unique `castKey` per scene; cast AND blocks are
 *   stamped with the codex `characterId` when a character entry matches the
 *   key case-insensitively (that field feeds the Cockpit's speaker counters).
 */
export async function importScript(
  projectId: string,
  parsed: ParsedScript,
): Promise<ScriptImportResult> {
  if (parsed.scenes.length === 0) throw new ScriptImportError('empty');

  const now = Date.now();

  // Read the codex BEFORE the transaction — `codexEntries` is not in the
  // transaction's table list, and Dexie forbids touching unlisted tables.
  const codexRows = await db.codexEntries.where('projectId').equals(projectId).toArray();
  const codexByName = new Map<string, string>();
  for (const row of codexRows) {
    if (row.type === 'character') codexByName.set(row.title.trim().toLowerCase(), row.id);
  }

  let sceneCount = 0;
  let blockCount = 0;

  await db.transaction('rw', db.scenes, db.dialogBlocks, db.sceneCasts, async () => {
    const existing = await db.scenes.where('projectId').equals(projectId).toArray();
    // max+1 beats count(): `order` may have gone sparse over time.
    const baseOrder = existing.reduce((max, s) => Math.max(max, s.order + 1), 0);

    const sceneRows: Scene[] = [];
    const blockRows: DialogBlock[] = [];
    const castRows: SceneCast[] = [];

    parsed.scenes.forEach((ps, si) => {
      const sceneId = generateId('scene');
      sceneRows.push({
        id: sceneId,
        projectId,
        title: ps.title,
        description: ps.description,
        order: baseOrder + si,
        tags: [],
        sceneNumber: ps.sceneNumber,
        isLocked: ps.sceneNumber !== undefined ? true : undefined,
        isOmitted: ps.isOmitted || undefined,
        createdAt: now,
        updatedAt: now,
      });

      const castByKey = new Map<string, SceneCast>();
      const dualIds = new Map<number, string>();

      ps.blocks.forEach((b, bi) => {
        let castMember: SceneCast | undefined;
        if (b.type === 'dialog') {
          const key = (b.castKey ?? b.characterName ?? '').trim();
          if (key) {
            const lower = key.toLowerCase();
            castMember = castByKey.get(lower);
            if (!castMember) {
              castMember = {
                id: generateId('cast'),
                sceneId,
                characterName: key,
                characterId: codexByName.get(lower),
                color: DEFAULT_CAST_COLOR,
              };
              castByKey.set(lower, castMember);
              castRows.push(castMember);
            }
          }
        }

        let dualGroupId: string | undefined;
        if (b.dualGroup !== undefined) {
          const known = dualIds.get(b.dualGroup);
          dualGroupId = known ?? generateId('dual');
          if (!known) dualIds.set(b.dualGroup, dualGroupId);
        }

        blockRows.push({
          id: generateId('block'),
          sceneId,
          projectId,
          type: b.type,
          characterName: b.characterName ?? '',
          characterColor: castMember?.color ?? '',
          characterId: castMember?.characterId,
          content: b.content,
          order: bi,
          parenthetical: b.parenthetical,
          dualGroupId,
          createdAt: now,
          updatedAt: now,
        });
      });
    });

    sceneCount = sceneRows.length;
    blockCount = blockRows.length;

    await db.scenes.bulkAdd(sceneRows);
    if (blockRows.length > 0) await db.dialogBlocks.bulkAdd(blockRows);
    if (castRows.length > 0) await db.sceneCasts.bulkAdd(castRows);
  });

  return { sceneCount, blockCount };
}
