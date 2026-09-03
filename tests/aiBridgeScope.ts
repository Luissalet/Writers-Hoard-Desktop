// ============================================================================
// Critical test — AI bridge: links between rows stay inside one project
// ============================================================================
//
// `testCopilotScopeLeak` (tests/ai-bridge.ts) covers the row a tool loads by
// id. This covers the ids a tool STORES inside the row it writes: an arc's
// character, a beat's scene, a pin's codex entry, a payoff's chapter, a dual
// dialogue's partner. Each one must exist and live in the same project as
// the row being written — from the bridge (no scope) as much as from a
// copilot pinned to a project.

import { db } from '@/db';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { applyProjectScope } from '@/services/aiRuntime/toolPolicy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Args = Record<string, unknown>;

const raw = (tool: string, args: Args): Promise<unknown> => TOOL_HANDLERS[tool](args);
const idOf = (result: unknown): string => String((result as { id: string }).id);

/** The failure code of a raw call, or '' when it succeeds. */
async function codeOf(tool: string, args: Args): Promise<string> {
  try {
    await raw(tool, args);
    return '';
  } catch (err) {
    if (err instanceof BridgeError) return err.code;
    throw err;
  }
}

/** The failure code of the same call made by a copilot pinned to `scope`. */
async function scopedCodeOf(tool: string, args: Args, scope: string): Promise<string> {
  const spec = getBridgeTool(tool);
  assert(spec, `no manifest entry for ${tool}`);
  const verdict = applyProjectScope(spec, args, { origin: 'copilot', projectId: scope });
  if (!verdict.ok) return verdict.code;
  return codeOf(tool, verdict.args);
}

export async function testBridgeLinksStayInProject(): Promise<void> {
  const A = 'bridge-links-a';
  const B = 'bridge-links-b';
  const engines = [
    'codex', 'writings', 'dialog-scene', 'character-arc', 'biography', 'relationships',
    'outline', 'seeds', 'storyboard', 'maps', 'timeline',
  ];
  const now = Date.now();
  for (const [id, title] of [[A, 'Links A'], [B, 'Links B']]) {
    await db.projects.put({
      id, title, mode: 'custom', type: 'idea', color: '#6b7280', description: '', status: 'draft',
      enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now,
    });
  }
  const sceneIds: string[] = [];
  try {
    // One of everything a link can point at, in each project.
    const charA = idOf(await raw('wh_create_codex_entry', { projectId: A, title: 'Ana', type: 'character', content: 'De A.' }));
    const charA2 = idOf(await raw('wh_create_codex_entry', { projectId: A, title: 'Alba', type: 'character', content: 'De A.' }));
    const charB = idOf(await raw('wh_create_codex_entry', { projectId: B, title: 'Bruno', type: 'character', content: 'De B.' }));
    const writingA = idOf(await raw('wh_create_writing', { projectId: A, title: 'Capítulo A', content: 'Llovía.' }));
    const writingB = idOf(await raw('wh_create_writing', { projectId: B, title: 'Capítulo B', content: 'Nevaba.' }));
    const sceneA = idOf(await raw('wh_create_scene', { projectId: A, title: 'Azotea A' }));
    const sceneA2 = idOf(await raw('wh_create_scene', { projectId: A, title: 'Sótano A' }));
    const sceneB = idOf(await raw('wh_create_scene', { projectId: B, title: 'Azotea B' }));
    sceneIds.push(sceneA, sceneA2, sceneB);

    // --- arcs: the character, then the beat's scene and outline beat -------
    assert(await codeOf('wh_create_arc', { projectId: A, title: 'Arco', characterId: charB }) === 'scope', 'an arc in A took a character of B');
    assert(await codeOf('wh_create_arc', { projectId: A, title: 'Arco', characterId: 'no-such-row' }) === 'not-found', 'an arc took a character that does not exist');
    const arcA = idOf(await raw('wh_create_arc', { projectId: A, title: 'Arco', characterId: charA }));
    const arcRow = await db.characterArcs.get(arcA);
    assert(arcRow?.characterName === 'Ana', 'the arc still denormalises the character name');
    assert(await codeOf('wh_add_arc_beat', { arcId: arcA, title: 'Beat', linkedSceneId: sceneB }) === 'scope', 'an arc beat in A linked a scene of B');
    assert(await codeOf('wh_add_arc_beat', { arcId: arcA, title: 'Beat', linkedSceneId: sceneA }) === '', 'an arc beat could not link a scene of its own project');
    const beatId = idOf(await raw('wh_add_arc_beat', { arcId: arcA, title: 'Otro beat' }));
    assert(await codeOf('wh_update_arc_beat', { id: beatId, linkedSceneId: sceneB }) === 'scope', 'an arc beat update linked a scene of B');
    assert(await codeOf('wh_update_arc_beat', { id: beatId, linkedSceneId: '' }) === '', 'an empty linkedSceneId (unlink) must still be accepted');

    // --- biography subject ---------------------------------------------------
    assert(await codeOf('wh_create_biography', { projectId: A, subjectId: charB }) === 'scope', 'a biography in A took a subject of B');
    assert(await codeOf('wh_create_biography', { projectId: A, subjectId: charA }) === '', 'a biography could not take a subject of its own project');

    // --- relationships: both ends --------------------------------------------
    assert(await codeOf('wh_create_relationship', { projectId: A, entityAId: charA, entityBId: charB }) === 'scope', 'a relationship in A reached a character of B');
    assert(await codeOf('wh_create_relationship', { projectId: A, entityAId: charA, entityBId: charA2 }) === '', 'a relationship between two characters of A failed');

    // --- outline beats: parent and writing ----------------------------------
    const outlineA = idOf(await raw('wh_create_outline', { projectId: A, title: 'Esquema' }));
    assert(await codeOf('wh_create_beat', { outlineId: outlineA, title: 'Beat', linkedWritingId: writingB }) === 'scope', 'an outline beat in A linked a writing of B');
    const outlineBeat = idOf(await raw('wh_create_beat', { outlineId: outlineA, title: 'Beat', linkedWritingId: writingA }));
    assert(await codeOf('wh_create_beat', { outlineId: outlineA, title: 'Hijo', parentId: outlineBeat }) === '', 'a child beat under a beat of the same outline failed');
    assert(await codeOf('wh_create_beat', { outlineId: outlineA, title: 'Hijo', parentId: 'no-such-row' }) === 'not-found', 'a child beat took a parent that does not exist');
    assert(await codeOf('wh_update_beat', { id: outlineBeat, linkedWritingId: writingB }) === 'scope', 'an outline beat update linked a writing of B');

    // --- seeds and payoffs -----------------------------------------------------
    assert(await codeOf('wh_create_seed', { projectId: A, title: 'Pista', linkedSceneId: sceneB }) === 'scope', 'a seed in A linked a scene of B');
    const seedA = idOf(await raw('wh_create_seed', { projectId: A, title: 'Pista', linkedWritingId: writingA, linkedSceneId: sceneA }));
    assert(await codeOf('wh_add_payoff', { seedId: seedA, title: 'Pago', linkedWritingId: writingB }) === 'scope', 'a payoff in A linked a writing of B');
    assert(await codeOf('wh_add_payoff', { seedId: seedA, title: 'Pago', linkedWritingId: writingA }) === '', 'a payoff could not link a writing of its own project');

    // --- storyboard panels -------------------------------------------------------
    const boardA = idOf(await raw('wh_create_storyboard', { projectId: A, title: 'Guion' }));
    assert(await codeOf('wh_add_storyboard_panel', { storyboardId: boardA, subtitle: 'Plano', linkedSceneId: sceneB }) === 'scope', 'a panel in A linked a scene of B');
    const panelId = idOf(await raw('wh_add_storyboard_panel', { storyboardId: boardA, subtitle: 'Plano', linkedSceneId: sceneA }));
    assert(await codeOf('wh_update_storyboard_panel', { id: panelId, linkedSceneId: sceneB }) === 'scope', 'a panel update linked a scene of B');

    // --- map pins ------------------------------------------------------------------
    const mapId = 'bridge-links-map';
    await db.worldMaps.put({ id: mapId, projectId: A, title: 'Mapa', createdAt: now, updatedAt: now });
    assert(await codeOf('wh_add_map_pin', { mapId, name: 'Faro', linkedEntryId: charB }) === 'scope', 'a pin in A linked a codex entry of B');
    const pinId = idOf(await raw('wh_add_map_pin', { mapId, name: 'Faro', linkedEntryId: charA }));
    assert(await codeOf('wh_update_map_pin', { id: pinId, linkedEntryId: charB }) === 'scope', 'a pin update linked a codex entry of B');
    assert(await codeOf('wh_update_map_pin', { id: pinId, linkedEntryId: charA2 }) === '', 'a pin update could not link a codex entry of its own project');

    // --- timeline events -----------------------------------------------------------
    const timelineA = idOf(await raw('wh_create_timeline', { projectId: A, title: 'Cronología' }));
    assert(await codeOf('wh_create_event', { timelineId: timelineA, title: 'Boda', linkedEntryId: charB }) === 'scope', 'an event in A linked a codex entry of B');
    const eventId = idOf(await raw('wh_create_event', { timelineId: timelineA, title: 'Boda', linkedEntryId: charA }));
    assert(await codeOf('wh_update_event', { id: eventId, linkedEntryId: charB }) === 'scope', 'an event update linked a codex entry of B');

    // --- dual dialogue: same scene, not merely same project -------------------------
    const blockB = idOf(await raw('wh_add_dialog', { sceneId: sceneB, character: 'Bruno', content: 'Hola.' }));
    const blockA2 = idOf(await raw('wh_add_dialog', { sceneId: sceneA2, character: 'Alba', content: 'Hola.' }));
    const blockA = idOf(await raw('wh_add_dialog', { sceneId: sceneA, character: 'Ana', content: 'Hola.' }));
    assert(await codeOf('wh_add_dialog', { sceneId: sceneA, character: 'Ana', content: 'Adiós.', dualWithBlockId: blockB }) === 'bad-args', 'a dual partner from another project was accepted');
    assert(await codeOf('wh_add_dialog', { sceneId: sceneA, character: 'Ana', content: 'Adiós.', dualWithBlockId: blockA2 }) === 'bad-args', 'a dual partner from another scene of the same project was accepted');
    assert(await codeOf('wh_add_dialog', { sceneId: sceneA, character: 'Ana', content: 'Adiós.', dualWithBlockId: blockA }) === '', 'a dual partner from the same scene was refused');
    const partner = await db.dialogBlocks.get(blockA);
    assert(partner?.dualGroupId, 'the first block of the pair did not get the group id');
    // Through the copilot's pin the refusal names the scope, before the scene check.
    assert(await scopedCodeOf('wh_add_dialog', { sceneId: sceneA, character: 'Ana', content: 'Y.', dualWithBlockId: blockB }, A) === 'scope', 'a copilot pinned to A paired a block of B');

    // And a copilot pinned to A is told the same about a link it cannot see.
    assert(await scopedCodeOf('wh_create_arc', { title: 'Arco', characterId: charB }, A) === 'scope', 'a copilot pinned to A linked a character of B');
    assert(await scopedCodeOf('wh_create_arc', { title: 'Arco', characterId: charA }, A) === '', 'a copilot pinned to A could not link its own character');
  } finally {
    for (const projectId of [A, B]) {
      await Promise.all([
        db.codexEntries, db.writings, db.writingSnapshots, db.scenes, db.dialogBlocks, db.characterArcs, db.arcBeats,
        db.biographies, db.relationships, db.outlines, db.outlineBeats, db.seeds, db.payoffs,
        db.storyboards, db.storyboardPanels, db.worldMaps, db.mapPins, db.timelines, db.timelineEvents, db.entityLinks,
      ].map((table) => table.where('projectId').equals(projectId).delete()));
      await db.projects.delete(projectId);
    }
    if (sceneIds.length) await db.sceneCasts.where('sceneId').anyOf(sceneIds).delete();
  }
}
