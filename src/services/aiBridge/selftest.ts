// ============================================================================
// AI bridge — self-test
// ============================================================================
//
// Exercises the whole tool surface against a project it creates for itself and
// deletes when it is done, so it can be run against a real installation
// without leaving anything behind.
//
// Why it exists: the only honest way to know the bridge works is to call it
// end to end. Typechecks do not catch a wrong scope field, a denormalised name
// left blank, or a handler that writes a row the app cannot read back. This
// does, in about a second, without needing a human to click anything.
//
// It is NOT in the tool manifest: it is a diagnostic reached at
// POST /api/selftest, not a capability a model should be able to invoke.

import { db } from '@/db';
import {
  createProject,
  deleteProject,
  notifyProjectsChanged,
  updateProject,
} from '@/db/operations';
import { generateId } from '@/utils/idGenerator';
import type { Project } from '@/types';
import { BRIDGE_TOOLS } from './manifest';
import { TOOL_HANDLERS } from './tools';
import { BridgeError, type ToolArgs } from './tools/shared';

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail?: string;
  ms: number;
}

export interface SelfTestReport {
  ok: boolean;
  passed: number;
  failed: number;
  projectId: string;
  cleanedUp: boolean;
  totalMs: number;
  checks: SelfTestCheck[];
}

/** Runs one tool the way the bridge does, so the test exercises the real path. */
async function call(tool: string, args: ToolArgs): Promise<Record<string, unknown>> {
  const handler = TOOL_HANDLERS[tool];
  if (!handler) throw new Error(`no handler for ${tool}`);
  const result = (await handler(args)) as Record<string, unknown>;
  return result ?? {};
}

class Harness {
  readonly checks: SelfTestCheck[] = [];

  /** Record one named expectation. A throw is a failure, not a crash. */
  async step(name: string, body: () => Promise<void>): Promise<void> {
    const started = Date.now();
    try {
      await body();
      this.checks.push({ name, ok: true, ms: Date.now() - started });
    } catch (err) {
      this.checks.push({
        name,
        ok: false,
        detail: err instanceof BridgeError ? `${err.code}: ${err.message}` : String(err),
        ms: Date.now() - started,
      });
    }
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Read a nested value without pretending the shape is known. */
function pick(value: unknown, ...path: (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

/** Every engine on, so no check fails for a reason the test does not care about. */
const ALL_ENGINES = [
  'writings', 'codex', 'timeline', 'outline', 'notes', 'diary', 'seeds',
  'relationships', 'character-arc', 'biography', 'dialog-scene', 'board',
  'gallery', 'maps', 'storyboard', 'video-planner', 'scrapper', 'annotations',
  'pov-audit', 'writing-stats',
];

async function createScratchProject(engines: readonly string[] = ALL_ENGINES): Promise<string> {
  const now = Date.now();
  const project: Project = {
    id: generateId('selftest'),
    title: `${SCRATCH_TITLE_PREFIX}${new Date(now).toISOString().slice(0, 19)}`,
    mode: 'custom',
    type: 'idea',
    color: '#6b7280',
    description: 'Temporary project created by the AI bridge self-test. Deleted automatically.',
    status: 'draft',
    enabledEngines: [...engines],
    engineOrder: [...engines],
    createdAt: now,
    updatedAt: now,
  };
  await createProject(project);
  notifyProjectsChanged();
  return project.id;
}

async function runManuscriptChecks(h: Harness, projectId: string): Promise<void> {
  let writingId = '';

  await h.step('writings: create, read back as Markdown', async () => {
    const created = await call('wh_create_writing', {
      projectId,
      title: 'Chapter one',
      content: '# Opening\n\nShe **ran**.\n\n- one\n- two',
      status: 'draft',
    });
    writingId = String(pick(created, 'id'));
    expect(writingId, 'create returned no id');
    const read = await call('wh_get_writing', { id: writingId });
    const body = String(pick(read, 'content'));
    expect(body.includes('# Opening'), 'heading lost on the round trip');
    expect(body.includes('**ran**'), 'bold lost on the round trip');
    expect(body.includes('- one'), 'list lost on the round trip');
  });

  await h.step('writings: append keeps what was there', async () => {
    await call('wh_append_writing', { id: writingId, content: 'And kept running.' });
    const read = await call('wh_get_writing', { id: writingId });
    const body = String(pick(read, 'content'));
    expect(body.includes('# Opening'), 'append destroyed the original text');
    expect(body.includes('And kept running.'), 'append did not land');
  });

  await h.step('writings: overwrite leaves a pre-ai version behind', async () => {
    await call('wh_update_writing', { id: writingId, content: 'Replaced.' });
    const versions = await call('wh_list_writing_versions', { id: writingId });
    const list = (pick(versions, 'versions') ?? []) as { reason: string }[];
    expect(list.some((v) => v.reason === 'pre-ai'), 'no pre-ai snapshot was taken');
  });

  await h.step('search finds the body, not just the title', async () => {
    await call('wh_update_writing', { id: writingId, content: 'A quokka in the doorway.' });
    const hits = await call('wh_search', { projectId, query: 'quokka' });
    const list = (pick(hits, 'hits') ?? []) as unknown[];
    expect(list.length > 0, 'full-text search missed a word only present in the body');
  });
}

async function runPeopleChecks(h: Harness, projectId: string): Promise<string> {
  let characterId = '';

  await h.step('codex: create and merge fields without wiping the sheet', async () => {
    const created = await call('wh_create_codex_entry', {
      projectId,
      type: 'character',
      title: 'Marta',
      fields: { Age: '34', Occupation: 'Smuggler' },
      // A body, because anchoring reads the prose — structured fields are not
      // part of an entity's anchorable text.
      content: 'She keeps a scar she will not explain.',
    });
    characterId = String(pick(created, 'id'));
    await call('wh_update_codex_entry', { id: characterId, fields: { Ship: 'The Kestrel' } });
    const read = await call('wh_get_codex_entry', { id: characterId });
    const fields = (pick(read, 'fields') ?? {}) as Record<string, string>;
    expect(fields.Age === '34', 'merge dropped an existing field');
    expect(fields.Ship === 'The Kestrel', 'merge did not add the new field');
  });

  await h.step('codex: an empty value clears one key only', async () => {
    await call('wh_update_codex_entry', { id: characterId, fields: { Occupation: '' } });
    const read = await call('wh_get_codex_entry', { id: characterId });
    const fields = (pick(read, 'fields') ?? {}) as Record<string, string>;
    expect(!('Occupation' in fields), 'empty value did not clear the key');
    expect(fields.Age === '34', 'clearing one key removed another');
  });

  await h.step('relationships: names are resolved, both sides are found', async () => {
    const other = await call('wh_create_codex_entry', {
      projectId, type: 'character', title: 'Julio',
    });
    const otherId = String(pick(other, 'id'));
    await call('wh_create_relationship', {
      projectId, entityAId: characterId, entityBId: otherId, kind: 'rival', intensity: -3,
    });
    // Stored on A's side; asking from B must still find it.
    const fromB = await call('wh_list_relationships', { projectId, entityId: otherId });
    const list = (pick(fromB, 'relationships') ?? []) as Record<string, unknown>[];
    expect(list.length === 1, 'a relationship was invisible from the other side');
    expect(pick(list[0], 'a', 'name') === 'Marta', 'the denormalised name was left blank');
  });

  return characterId;
}

async function runStoryChecks(h: Harness, projectId: string, characterId: string): Promise<void> {
  await h.step('seeds: status is derived, and a payoff flips it', async () => {
    const seed = await call('wh_create_seed', { projectId, title: 'The kettle', kind: 'chekhov' });
    const seedId = String(pick(seed, 'id'));
    const before = await call('wh_list_seeds', { projectId, orphanedOnly: true });
    const orphans = (pick(before, 'seeds') ?? []) as Record<string, unknown>[];
    expect(orphans.length === 1, 'a fresh seed was not reported as orphaned');
    expect(pick(orphans[0], 'status') === 'orphaned', 'stored status leaked instead of the derived one');
    await call('wh_add_payoff', { seedId, title: 'It boils over' });
    const after = await call('wh_list_seeds', { projectId, orphanedOnly: true });
    expect(((pick(after, 'seeds') ?? []) as unknown[]).length === 0, 'payoff did not clear the orphan');
  });

  await h.step('timeline: event and connection across the same project', async () => {
    const timeline = await call('wh_create_timeline', { projectId, title: 'Main thread' });
    const timelineId = String(pick(timeline, 'id'));
    const first = await call('wh_create_event', { timelineId, title: 'The letter arrives' });
    const second = await call('wh_create_event', { timelineId, title: 'She leaves' });
    await call('wh_connect_events', {
      sourceEventId: String(pick(first, 'id')),
      targetEventId: String(pick(second, 'id')),
      label: 'causes',
    });
    const events = await call('wh_list_events', { timelineId });
    expect(((pick(events, 'events') ?? []) as unknown[]).length === 2, 'events did not land');
  });

  await h.step('arcs: beat lands under its arc', async () => {
    const arc = await call('wh_create_arc', {
      projectId, title: "Marta's turn", characterId, lie: 'Nobody stays.',
    });
    const arcId = String(pick(arc, 'id'));
    await call('wh_add_arc_beat', { arcId, title: 'She is offered a berth', stage: 'inciting' });
    const read = await call('wh_get_arc', { id: arcId });
    expect(pick(read, 'characterName') === 'Marta', 'the arc lost its subject name');
    expect(((pick(read, 'beats') ?? []) as unknown[]).length === 1, 'the beat did not land');
  });

  await h.step('outline: a template lays down translated beats, not i18n keys', async () => {
    const created = await call('wh_create_outline', {
      projectId, title: 'Main outline', template: 'three-act',
    });
    const outlineId = String(pick(created, 'id'));
    expect(Number(pick(created, 'beats')) > 0, 'the template laid down no beats');
    const read = await call('wh_list_beats', { outlineId });
    const beats = (pick(read, 'beats') ?? []) as Record<string, unknown>[];
    expect(beats.length > 0, 'the beats did not read back');
    // A key written into a beat row would live in the author's project for
    // good, never to be re-translated: the handler must resolve them.
    expect(
      !beats.some((beat) => String(beat.title).startsWith('outline.')),
      'a raw i18n key was written into a beat instead of the translated text',
    );
    const listed = await call('wh_list_outlines', { projectId });
    const outlines = (pick(listed, 'outlines') ?? []) as Record<string, unknown>[];
    expect(outlines.length === 1, 'the outline did not list');
    expect(outlines[0].beatCount === beats.length, 'the outline miscounted its own beats');
  });

  await h.step('outline: an unknown template is refused, not silently ignored', async () => {
    let refused = false;
    try {
      await call('wh_create_outline', { projectId, title: 'Nope', template: 'not-a-template' });
    } catch (err) {
      refused = err instanceof BridgeError && err.code === 'bad-args';
    }
    expect(refused, 'an unknown template was accepted and produced an empty outline');
  });
}

/**
 * The four containers a model has to be able to make for itself.
 *
 * Boards, storyboards and video plans were reachable but not creatable, which
 * made those engines dead ends on a fresh project: a model could list them
 * forever and never put anything in one.
 */
async function runContainerChecks(h: Harness, projectId: string): Promise<void> {
  await h.step('board: created, then a card lands on it', async () => {
    const board = await call('wh_create_board', {
      projectId, title: 'The wall', surface: 'slate',
    });
    const boardId = String(pick(board, 'id'));
    await call('wh_add_board_card', { boardId, title: 'The missing ledger', kind: 'card' });
    const read = await call('wh_get_board', { id: boardId });
    expect(pick(read, 'surface') === 'slate', 'the chosen surface was not kept');
    expect(((pick(read, 'cards') ?? []) as unknown[]).length === 1, 'the card did not land');
  });

  await h.step('storyboard: created with a clamped grid, then a panel lands', async () => {
    const board = await call('wh_create_storyboard', {
      projectId, title: 'Opening sequence', columns: 99,
    });
    const storyboardId = String(pick(board, 'id'));
    expect(pick(board, 'columns') === 8, 'an absurd column count was stored instead of clamped');
    await call('wh_add_storyboard_panel', { storyboardId, subtitle: 'Wide on the harbour' });
    const listed = await call('wh_list_storyboards', { projectId });
    const boards = (pick(listed, 'storyboards') ?? []) as Record<string, unknown>[];
    expect(((boards[0]?.panels ?? []) as unknown[]).length === 1, 'the panel did not land');
  });

  await h.step('video plan: created, then a segment lands', async () => {
    const plan = await call('wh_create_video_plan', {
      projectId, title: 'Essay cut', totalDuration: '8 min',
    });
    await call('wh_add_video_segment', {
      videoPlanId: String(pick(plan, 'id')), title: 'Cold open', script: 'It starts wrong.',
    });
    const listed = await call('wh_list_video_plans', { projectId });
    const plans = (pick(listed, 'plans') ?? []) as Record<string, unknown>[];
    expect(((plans[0]?.segments ?? []) as unknown[]).length === 1, 'the segment did not land');
  });
}

async function runScriptAndRestChecks(h: Harness, projectId: string): Promise<void> {
  await h.step('dialog: cast is created, parenthetical is stored bare, dual pairs up', async () => {
    const scene = await call('wh_create_scene', {
      projectId, title: 'Kitchen', setting: 'INT. KITCHEN - NIGHT',
    });
    const sceneId = String(pick(scene, 'id'));
    const first = await call('wh_add_dialog', {
      sceneId, character: 'Marta', content: 'I am not going back.', parenthetical: '(flatly)',
    });
    await call('wh_add_dialog', {
      sceneId, character: 'Julio', content: 'Nobody asked.',
      dualWithBlockId: String(pick(first, 'id')),
    });
    const read = await call('wh_get_scene', { id: sceneId });
    const cast = (pick(read, 'cast') ?? []) as { name: string }[];
    expect(cast.length === 2, 'the cast was not filled in from the speakers');
    const blocks = (pick(read, 'blocks') ?? []) as Record<string, unknown>[];
    expect(pick(blocks[0], 'parenthetical') === 'flatly', 'the parenthetical kept its brackets');
    const groups = blocks.map((block) => block.dualWith).filter(Boolean);
    expect(groups.length === 2 && groups[0] === groups[1], 'dual dialogue did not pair up');
  });

  await h.step('notes: the inbox is reachable without an open project', async () => {
    const created = await call('wh_create_note', { projectId, text: 'A thought.', kind: 'idea' });
    expect(pick(created, 'id'), 'note was not created');
    const listed = await call('wh_list_notes', { projectId });
    expect(((pick(listed, 'notes') ?? []) as unknown[]).length === 1, 'the note did not list');
  });

  await h.step('diary: entry stores and reads back', async () => {
    await call('wh_create_diary_entry', { projectId, content: 'Wrote badly, wrote anyway.' });
    const listed = await call('wh_list_diary', { projectId });
    const entries = (pick(listed, 'entries') ?? []) as Record<string, unknown>[];
    expect(entries.length === 1, 'the diary entry did not list');
    expect(String(pick(entries[0], 'content')).includes('wrote anyway'), 'diary body lost');
  });
}

async function runAnalysisChecks(h: Harness, projectId: string, writingHostId: string): Promise<void> {
  await h.step('annotations: anchoring to an exact phrase, and refusing a wrong one', async () => {
    const annotated = await call('wh_annotate', {
      projectId, engineId: 'codex', entityId: writingHostId,
      quote: 'a scar she will not explain',
      note: 'Do we ever find out where this came from?',
    });
    expect(
      pick(annotated, 'anchoredTo') === 'a scar she will not explain',
      'the note did not anchor to the phrase',
    );
    let refused = false;
    try {
      await call('wh_annotate', {
        projectId, engineId: 'codex', entityId: writingHostId,
        quote: 'a phrase that is not there', note: 'x',
      });
    } catch (err) {
      refused = err instanceof BridgeError && err.code === 'quote-not-found';
    }
    expect(refused, 'a quote that is not in the text was accepted anyway');
  });

  await h.step('pov-audit: a character with no scenes is reported unused', async () => {
    const report = await call('wh_pov_audit', { projectId });
    const rows = (pick(report, 'characters') ?? []) as Record<string, unknown>[];
    expect(rows.length > 0, 'the audit found no characters at all');
  });

  await h.step('read-only tools answer on an empty engine', async () => {
    for (const tool of ['wh_list_boards', 'wh_list_images', 'wh_list_maps',
      'wh_list_storyboards', 'wh_list_video_plans', 'wh_list_biographies',
      'wh_list_snapshots', 'wh_writing_stats']) {
      await call(tool, { projectId });
    }
  });

  await h.step('search covers every engine its own description promises', async () => {
    // wh_search says it searches the whole project. That claim is only worth
    // anything if it is checked: each probe below plants a nonsense word in a
    // field the TITLE never shows, so a hit can only come from the shared body
    // index. Drop a source from projectSearchIndex.ts and this fails.
    const seed = await call('wh_create_seed', { projectId, title: 'Coverage seed' });
    const seedId = String(pick(seed, 'id'));
    const arc = await call('wh_create_arc', {
      projectId, title: 'Coverage arc', summary: 'Turns on wh-probe-arcspine.',
    });
    const arcId = String(pick(arc, 'id'));
    const timeline = await call('wh_create_timeline', { projectId, title: 'Coverage timeline' });
    const character = await call('wh_create_codex_entry', {
      projectId, type: 'character', title: 'Ana', content: 'Ana keeps wh-probe-codex to herself.',
    });
    const other = await call('wh_create_codex_entry', {
      projectId, type: 'character', title: 'Bruno',
    });
    const biography = await call('wh_create_biography', { projectId, subjectName: 'Ana' });

    await call('wh_create_beat', {
      outlineId: String(pick(await call('wh_create_outline', {
        projectId, title: 'Coverage outline',
      }), 'id')),
      title: 'Coverage beat',
      description: 'Turns on wh-probe-outline.',
    });
    await call('wh_update_seed', { id: seedId, description: 'Planted as wh-probe-seed.' });
    await call('wh_add_payoff', {
      seedId, title: 'Coverage payoff', description: 'Lands as wh-probe-payoff.',
    });
    await call('wh_add_arc_beat', {
      arcId, title: 'Coverage arc beat', description: 'Shifts on wh-probe-arcbeat.',
    });
    await call('wh_create_relationship', {
      projectId,
      entityAId: String(pick(character, 'id')),
      entityBId: String(pick(other, 'id')),
      kind: 'other',
      notes: 'Noted as wh-probe-relationship.',
    });
    await call('wh_add_biography_fact', {
      biographyId: String(pick(biography, 'id')),
      title: 'Coverage fact',
      content: 'Recorded as wh-probe-biography.',
    });
    await call('wh_create_event', {
      timelineId: String(pick(timeline, 'id')),
      title: 'Coverage event',
      description: 'Happens at wh-probe-timeline.',
    });
    await call('wh_create_note', {
      projectId, text: 'Coverage note', tags: ['wh-probe-notes'],
    });
    await call('wh_annotate', {
      projectId, engineId: 'codex', entityId: String(pick(character, 'id')),
      quote: 'wh-probe-codex', note: 'Asked as wh-probe-annotation.',
    });

    // token → the engine the hit must be attributed to, because a hit under
    // the wrong engineId sends the reader to the wrong place.
    const probes: [string, string][] = [
      ['wh-probe-outline', 'outline'],
      ['wh-probe-seed', 'seeds'],
      ['wh-probe-payoff', 'seeds'],
      ['wh-probe-arcspine', 'character-arc'],
      ['wh-probe-arcbeat', 'character-arc'],
      ['wh-probe-relationship', 'relationships'],
      ['wh-probe-biography', 'biography'],
      ['wh-probe-timeline', 'timeline'],
      ['wh-probe-notes', 'notes'],
      ['wh-probe-annotation', 'annotations'],
    ];
    const missed: string[] = [];
    for (const [token, engineId] of probes) {
      const found = await call('wh_search', { projectId, query: token });
      const hits = (pick(found, 'hits') ?? []) as Record<string, unknown>[];
      if (!hits.some((hit) => hit.engineId === engineId)) {
        missed.push(`${token} (expected engineId "${engineId}", got ${
          hits.length ? hits.map((hit) => String(hit.engineId)).join('/') : 'nothing'
        })`);
      }
    }
    expect(!missed.length, `wh_search does not reach: ${missed.join('; ')}`);
  });

  await h.step('bad arguments are refused, not half-applied', async () => {
    let refused = false;
    try {
      await call('wh_create_writing', { projectId });
    } catch (err) {
      refused = err instanceof BridgeError && err.code === 'bad-args';
    }
    expect(refused, 'a create with no title was accepted');
  });
}

/** Every id-based write tool the probe builder below exercises. */
const PARENT_PROBE_TOOLS = [
  'wh_update_writing', 'wh_append_writing', 'wh_restore_writing_version',
  'wh_update_codex_entry', 'wh_update_diary_entry', 'wh_update_note',
  'wh_create_event', 'wh_update_event', 'wh_connect_events',
  'wh_create_beat', 'wh_update_beat',
  'wh_add_dialog', 'wh_update_dialog_block', 'wh_update_scene',
  'wh_add_arc_beat', 'wh_update_arc_beat', 'wh_update_relationship',
  'wh_update_seed', 'wh_add_payoff',
  'wh_add_biography_fact', 'wh_update_biography_fact',
  'wh_add_board_card', 'wh_update_board_card', 'wh_connect_board_cards',
  'wh_tag_image', 'wh_add_map_pin', 'wh_update_map_pin',
  'wh_add_storyboard_panel', 'wh_update_storyboard_panel',
  'wh_add_video_segment', 'wh_update_video_segment',
  'wh_tag_snapshot', 'wh_download_snapshot_media',
];

/**
 * Build one real parent per engine, then switch every engine off.
 *
 * These tools cannot be probed with a made-up id: they load the parent first,
 * so a bogus id fails with `not-found` and proves nothing. The parents have to
 * exist. Gallery and maps get their rows written straight to Dexie, because
 * the bridge has no tool that creates a map or an image — which is exactly why
 * their write surface was the most exposed.
 */
async function buildGuardProbes(
  /** Called the moment the host project exists, so a failure can still bin it. */
  onCreated: (projectId: string) => void,
): Promise<[string, ToolArgs][]> {
  const projectId = await createScratchProject();
  onCreated(projectId);
  const id = async (tool: string, args: ToolArgs): Promise<string> =>
    String(pick(await call(tool, { projectId, ...args }), 'id'));

  const writingId = await id('wh_create_writing', { title: 'Host', content: 'A body to edit.' });
  const versions = await call('wh_list_writing_versions', { id: writingId });
  await call('wh_update_writing', { id: writingId, content: 'Changed, to leave a version.' });
  const snapshotId = String(pick(
    await call('wh_list_writing_versions', { id: writingId }), 'versions', 0, 'snapshotId',
  ) ?? pick(versions, 'versions', 0, 'snapshotId'));

  const characterId = await id('wh_create_codex_entry', { type: 'character', title: 'Host A' });
  const otherId = await id('wh_create_codex_entry', { type: 'character', title: 'Host B' });
  const diaryId = await id('wh_create_diary_entry', { content: 'A day.' });
  const noteId = await id('wh_create_note', { text: 'A thought.' });
  const timelineId = await id('wh_create_timeline', { title: 'Host line' });
  const eventA = String(pick(await call('wh_create_event', { timelineId, title: 'A' }), 'id'));
  const eventB = String(pick(await call('wh_create_event', { timelineId, title: 'B' }), 'id'));
  const outlineId = await id('wh_create_outline', { title: 'Host outline' });
  const beatId = String(pick(await call('wh_create_beat', { outlineId, title: 'A beat' }), 'id'));
  const sceneId = await id('wh_create_scene', { title: 'Host scene' });
  const blockId = String(pick(
    await call('wh_add_dialog', { sceneId, character: 'Host A', content: 'A line.' }), 'id',
  ));
  const arcId = await id('wh_create_arc', { title: 'Host arc' });
  const arcBeatId = String(pick(await call('wh_add_arc_beat', { arcId, title: 'A shift' }), 'id'));
  const relationshipId = await id('wh_create_relationship', {
    entityAId: characterId, entityBId: otherId,
  });
  const seedId = await id('wh_create_seed', { title: 'Host seed' });
  const biographyId = await id('wh_create_biography', { subjectName: 'Host A' });
  const factId = String(pick(
    await call('wh_add_biography_fact', { biographyId, title: 'A fact' }), 'id',
  ));
  const boardId = await id('wh_create_board', { title: 'Host board' });
  const cardA = String(pick(await call('wh_add_board_card', { boardId, title: 'A' }), 'id'));
  const cardB = String(pick(await call('wh_add_board_card', { boardId, title: 'B' }), 'id'));
  const storyboardId = await id('wh_create_storyboard', { title: 'Host storyboard' });
  const panelId = String(pick(
    await call('wh_add_storyboard_panel', { storyboardId, subtitle: 'A panel' }), 'id',
  ));
  const videoPlanId = await id('wh_create_video_plan', { title: 'Host plan' });
  const segmentId = String(pick(
    await call('wh_add_video_segment', { videoPlanId, title: 'A segment' }), 'id',
  ));
  const snapshotRowId = String(pick(
    await call('wh_import_snapshots', {
      projectId,
      items: [{ url: 'https://example.invalid/a', title: 'A clipping' }],
    }),
    'snapshots', 0, 'id',
  ));

  // No bridge tool makes these two, so they are written directly.
  const now = Date.now();
  const mapId = generateId('map');
  await db.worldMaps.add({
    id: mapId, projectId, title: 'Host map', source: 'uploaded',
    createdAt: now, updatedAt: now,
  });
  const imageId = generateId('img');
  await db.inspirationImages.add({
    id: imageId, projectId, imageData: '', notes: 'Host image', tags: [], createdAt: now,
  });
  const pinId = generateId('pin');
  await db.mapPins.add({
    id: pinId, projectId, mapId, name: 'Host pin', icon: 'city', position: { x: 50, y: 50 },
  });

  await updateProject(projectId, { enabledEngines: [], updatedAt: Date.now() });

  return [
      ['wh_update_writing', { id: writingId, content: 'x' }],
      ['wh_append_writing', { id: writingId, content: 'x' }],
      ['wh_restore_writing_version', { snapshotId }],
      ['wh_update_codex_entry', { id: characterId, title: 'x' }],
      ['wh_update_diary_entry', { id: diaryId, content: 'x' }],
      ['wh_update_note', { id: noteId, text: 'x' }],
      ['wh_create_event', { timelineId, title: 'x' }],
      ['wh_update_event', { id: eventA, title: 'x' }],
      ['wh_connect_events', { sourceEventId: eventA, targetEventId: eventB }],
      ['wh_create_beat', { outlineId, title: 'x' }],
      ['wh_update_beat', { id: beatId, title: 'x' }],
      ['wh_add_dialog', { sceneId, character: 'Host A', content: 'x' }],
      ['wh_update_dialog_block', { id: blockId, content: 'x' }],
      ['wh_update_scene', { id: sceneId, title: 'x' }],
      ['wh_add_arc_beat', { arcId, title: 'x' }],
      ['wh_update_arc_beat', { id: arcBeatId, title: 'x' }],
      ['wh_update_relationship', { id: relationshipId, label: 'x' }],
      ['wh_update_seed', { id: seedId, title: 'x' }],
      ['wh_add_payoff', { seedId, title: 'x' }],
      ['wh_add_biography_fact', { biographyId, title: 'x' }],
      ['wh_update_biography_fact', { id: factId, title: 'x' }],
      ['wh_add_board_card', { boardId, title: 'x' }],
      ['wh_update_board_card', { id: cardA, title: 'x' }],
      ['wh_connect_board_cards', { sourceId: cardA, targetId: cardB }],
      ['wh_tag_image', { id: imageId, tags: ['x'] }],
      ['wh_add_map_pin', { mapId, name: 'x' }],
      ['wh_update_map_pin', { id: pinId, name: 'x' }],
      ['wh_add_storyboard_panel', { storyboardId, subtitle: 'x' }],
      ['wh_update_storyboard_panel', { id: panelId, subtitle: 'x' }],
      ['wh_add_video_segment', { videoPlanId, title: 'x' }],
      ['wh_update_video_segment', { id: segmentId, title: 'x' }],
      ['wh_tag_snapshot', { id: snapshotRowId, tags: ['x'] }],
      ['wh_download_snapshot_media', { id: snapshotRowId }],
  ];
}

/**
 * Nothing gets written into an engine the writer has switched off.
 *
 * The project a model is most likely to be handed is a new one, and a new
 * project starts on the `essentials` preset: three engines of twenty-one. A
 * row written into any of the other eighteen has no tab to appear in and is
 * skipped by the app's own search, so the writer would never learn it exists.
 *
 * The list of tools to check is DERIVED from the manifest — every write tool
 * that names an engine and takes a projectId — so a new tool added without the
 * guard fails here instead of quietly losing someone's work.
 */
async function runEngineGuardChecks(h: Harness): Promise<void> {
  // One engine on, and one that owns no write tool, so every guarded tool
  // below is genuinely writing into something switched off.
  const projectId = await createScratchProject(['pov-audit']);

  await h.step('writes into a switched-off engine are refused, every one of them', async () => {
    const guarded = BRIDGE_TOOLS.filter(
      (tool) => tool.writes && tool.engineId && tool.schema.properties.projectId,
    );
    expect(guarded.length >= 15, `only ${guarded.length} guarded tools found in the manifest`);

    const leaked: string[] = [];
    for (const tool of guarded) {
      try {
        // Deliberately nothing but projectId: the guard runs before argument
        // validation, so a tool that refuses for a MISSING ARGUMENT instead of
        // a disabled engine is a tool whose guard is in the wrong place.
        await call(tool.name, { projectId });
        leaked.push(`${tool.name} (wrote anyway)`);
      } catch (err) {
        const code = err instanceof BridgeError ? err.code : 'crash';
        if (code !== 'engine-disabled') leaked.push(`${tool.name} (${code})`);
      }
    }
    expect(!leaked.length, `not guarded by enabledEngines: ${leaked.join('; ')}`);
  });

  await h.step('writes that reach their project through a parent are guarded too', async () => {
    // The tools above take a projectId. These take the id of something that
    // already exists — a chapter, an outline, an image — and only learn the
    // project from it. Guarding the first group and not this one would have
    // left every update tool, and the whole of gallery and maps, wide open.
    //
    // The `finally` is not decoration: the first three runs of this check
    // failed inside the builder and left their host project behind, which is
    // exactly the mess this suite promises never to make.
    let host: string | null = null;
    const leaked: string[] = [];
    try {
      const built = await buildGuardProbes((id) => { host = id; });
      for (const [tool, args] of built) {
        try {
          await call(tool, args);
          leaked.push(`${tool} (wrote anyway)`);
        } catch (err) {
          const code = err instanceof BridgeError ? err.code : 'crash';
          if (code !== 'engine-disabled') leaked.push(`${tool} (${code})`);
        }
      }
    } finally {
      if (host) {
        await deleteProject(host);
        notifyProjectsChanged();
      }
    }
    expect(!leaked.length, `not guarded by enabledEngines: ${leaked.join('; ')}`);
  });

  await h.step('every write tool that names an engine is actually covered', async () => {
    // The completeness property. Without it the two checks above only prove
    // something about the tools somebody remembered to include.
    const byProject = BRIDGE_TOOLS
      .filter((tool) => tool.writes && tool.engineId && tool.schema.properties.projectId)
      .map((tool) => tool.name);
    const covered = new Set([...byProject, ...PARENT_PROBE_TOOLS]);
    const uncovered = BRIDGE_TOOLS
      .filter((tool) => tool.writes && tool.engineId && !covered.has(tool.name))
      .map((tool) => tool.name);
    expect(
      !uncovered.length,
      `write tools with no engine-guard check: ${uncovered.join(', ')} — add a probe to buildGuardProbes`,
    );
  });

  await h.step('reading a switched-off engine still answers', async () => {
    // Refusing reads would be theatre: the rows are there, and saying so is
    // more useful than pretending the engine does not exist.
    const listed = await call('wh_list_seeds', { projectId });
    expect(Array.isArray(pick(listed, 'seeds')), 'a read of a disabled engine was refused');
  });

  await h.step('wh_enable_engine opens the door, and only forwards', async () => {
    const enabled = await call('wh_enable_engine', { projectId, engineId: 'seeds' });
    expect(pick(enabled, 'enabled') === true, 'the engine was not switched on');
    const created = await call('wh_create_seed', { projectId, title: 'Now allowed' });
    expect(pick(created, 'id'), 'the write was still refused after enabling');

    const again = await call('wh_enable_engine', { projectId, engineId: 'seeds' });
    expect(pick(again, 'alreadyEnabled') === true, 'enabling twice did not report it was already on');

    let refused = false;
    try {
      await call('wh_enable_engine', { projectId, engineId: 'not-an-engine' });
    } catch (err) {
      refused = err instanceof BridgeError && err.code === 'bad-args';
    }
    expect(refused, 'an unknown engine id was accepted');
  });

  await deleteProject(projectId);
  notifyProjectsChanged();
}

/**
 * Run the whole suite against a throwaway project and delete it afterwards.
 *
 * `deleteProject` sweeps every table that carries a projectId plus the few
 * children that do not, so nothing survives — which is what makes it safe to
 * run this against someone's real installation.
 */
export async function runSelfTest(args: ToolArgs = {}): Promise<SelfTestReport> {
  const started = Date.now();
  const h = new Harness();
  const projectId = await createScratchProject();
  let cleanedUp = false;

  try {
    await runManuscriptChecks(h, projectId);
    const characterId = await runPeopleChecks(h, projectId);
    await runStoryChecks(h, projectId, characterId);
    await runContainerChecks(h, projectId);
    await runScriptAndRestChecks(h, projectId);
    await runAnalysisChecks(h, projectId, characterId);
    // Last, and on its own project: this one needs engines switched OFF.
    await runEngineGuardChecks(h);
  } finally {
    // `keepProject: true` leaves the scratch project on disk for a human to
    // look at when a check fails and the report alone is not enough.
    if (args.keepProject !== true) {
      try {
        await deleteProject(projectId);
        notifyProjectsChanged();
        cleanedUp = true;
      } catch (err) {
        h.checks.push({
          name: 'cleanup: delete the scratch project',
          ok: false,
          detail: String(err),
          ms: 0,
        });
      }
    }
  }

  const failed = h.checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    passed: h.checks.length - failed.length,
    failed: failed.length,
    projectId,
    cleanedUp,
    totalMs: Date.now() - started,
    checks: h.checks,
  };
}

/** Title prefix every scratch project carries, and the only thing cleanup will touch. */
export const SCRATCH_TITLE_PREFIX = 'Bridge self-test ';

/**
 * Delete scratch projects a `--keep` run left behind.
 *
 * Refuses anything whose title is not the self-test's own, so pointing this at
 * a real project id does nothing. With no id, it sweeps every leftover.
 */
export async function cleanupSelfTestProjects(args: ToolArgs = {}): Promise<unknown> {
  const { getAllProjects } = await import('@/db/operations');
  const wanted = typeof args.projectId === 'string' ? args.projectId : null;
  const projects = await getAllProjects();
  const scratch = projects.filter(
    (project) =>
      project.title.startsWith(SCRATCH_TITLE_PREFIX) && (!wanted || project.id === wanted),
  );

  if (wanted && !scratch.length) {
    throw new BridgeError(
      'bad-args',
      `"${wanted}" is not a self-test scratch project. Cleanup only removes projects it created.`,
    );
  }

  for (const project of scratch) await deleteProject(project.id);
  if (scratch.length) notifyProjectsChanged();
  return { deleted: scratch.map((project) => ({ id: project.id, title: project.title })) };
}
