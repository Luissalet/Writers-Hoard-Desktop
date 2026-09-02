// ============================================================================
// Critical test — AI bridge
// ============================================================================
//
// Two contracts that break silently in front of a model if they rot:
//   1. every manifest tool has a handler, and no handler is unreachable;
//   2. Markdown survives the round trip through TipTap HTML, because that is
//      the only shape prose takes on its way in and out of the bridge.

import {
  BRIDGE_ENGINE_IDS,
  BRIDGE_TOOLS,
  BRIDGE_INSTRUCTIONS,
  getBridgeTool,
  selectTools,
} from '@/services/aiBridge/manifest';
import { getAllEngines } from '@/engines';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { DELETABLE, DELETABLE_TYPES } from '@/services/aiBridge/tools/deletion';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { applyProjectScope } from '@/services/aiRuntime/toolPolicy';
import { deleteSeed } from '@/engines/seeds/operations';
import { db } from '@/db';
import {
  pendingConfirmations,
  requestBridgeConfirmation,
  subscribeBridgeConfirm,
} from '@/services/aiBridge/confirmation';
import es from '@/locales/es';
import en from '@/locales/en';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function testManifestHandlerParity(): void {
  for (const tool of BRIDGE_TOOLS) {
    assert(typeof TOOL_HANDLERS[tool.name] === 'function', `no handler for tool ${tool.name}`);
    assert(tool.description.length > 40, `tool ${tool.name} needs a usable description`);
    assert(tool.schema.type === 'object', `tool ${tool.name} has a non-object schema`);
  }
  for (const name of Object.keys(TOOL_HANDLERS)) {
    assert(getBridgeTool(name), `handler ${name} is not in the manifest, so no model can call it`);
  }
  assert(BRIDGE_INSTRUCTIONS.includes('wh_get_context'), 'instructions never mention the entry point');
  // Read-only clients must still get the whole reading surface.
  assert(BRIDGE_TOOLS.some((t) => t.writes), 'no write tools at all');
  assert(BRIDGE_TOOLS.some((t) => !t.writes), 'no read tools at all');
  // Exactly one way to delete, and it is a write tool so the writes switch
  // gates it. Per-engine delete tools would each need their own confirmation
  // and their own cascade — that is how the wrong op gets called.
  // wh_remove_place is not one: it appends a `remove` edit to a world's list,
  // which wh_restore_place and the undo reverse, and no row goes anywhere.
  const deleters = BRIDGE_TOOLS.filter(
    (t) => /delete|remove|destroy/i.test(t.name) && t.name !== 'wh_remove_place',
  );
  assert(deleters.length === 1, 'there should be exactly one deletion tool, wh_delete');
  assert(
    getBridgeTool('wh_remove_place')?.description.includes('Not a deletion'),
    'wh_remove_place must tell the model it is an undoable edit, not a deletion',
  );
  assert(deleters[0].name === 'wh_delete', 'the deletion tool is not wh_delete');
  assert(deleters[0].writes, 'wh_delete is not marked as a write tool');
  // The types it accepts must all have a registered delete op behind them.
  const declared = (deleters[0].schema.properties.type as { enum?: string[] })?.enum ?? [];
  assert(declared.length > 0, 'wh_delete declares no entity types');
  for (const type of declared) {
    assert(DELETABLE[type], `wh_delete offers "${type}" with no delete operation behind it`);
  }
  for (const type of DELETABLE_TYPES) {
    assert(declared.includes(type), `"${type}" can be deleted but is not offered in the schema`);
    // The confirmation is composed from template keys, which the conformance
    // gate cannot see — so a missing one would show the user a raw key in the
    // one dialog that must be readable.
    for (const locale of [es, en]) {
      assert(locale[`bridge.delete.type.${type}`], `no name for "${type}" in one locale`);
      if (DELETABLE[type].cascade) {
        assert(locale[`bridge.delete.cascade.${type}`], `no cascade text for "${type}" in one locale`);
      }
    }
  }
  // Every tool must land in a group, or a client that filters silently loses it.
  for (const tool of BRIDGE_TOOLS) {
    assert(tool.group, `tool ${tool.name} has no group`);
  }

  // The engine list is a hand-kept copy, because the real registry imports
  // React icons and the manifest is loaded by the main process. So compare it
  // to the registry here, where both are reachable.
  const registered = new Set(getAllEngines().map((engine) => engine.id));
  assert(registered.size > 0, 'no engines registered — the import for their side effects is gone');
  for (const engineId of BRIDGE_ENGINE_IDS) {
    assert(registered.has(engineId), `BRIDGE_ENGINE_IDS names "${engineId}", which no engine registers`);
  }
  for (const engineId of registered) {
    assert(
      BRIDGE_ENGINE_IDS.includes(engineId),
      `engine "${engineId}" exists but BRIDGE_ENGINE_IDS does not list it, so wh_enable_engine cannot turn it on`,
    );
  }
  for (const tool of BRIDGE_TOOLS) {
    if (!tool.engineId) continue;
    assert(
      BRIDGE_ENGINE_IDS.includes(tool.engineId),
      `tool ${tool.name} claims engine "${tool.engineId}", which is not a known engine`,
    );
  }
  const enableEnum = (getBridgeTool('wh_enable_engine')?.schema.properties.engineId as
    { enum?: string[] })?.enum ?? [];
  assert(
    enableEnum.length === BRIDGE_ENGINE_IDS.length,
    'wh_enable_engine offers a different set of engines than the bridge knows about',
  );
  // Every write tool that names an engine and takes a projectId is guarded at
  // runtime; the self-test proves the guard, this proves the list is complete.
  const guardable = BRIDGE_TOOLS.filter(
    (tool) => tool.writes && tool.engineId && tool.schema.properties.projectId,
  );
  assert(guardable.length >= 15, 'the engine guard covers suspiciously few write tools');
  const names = BRIDGE_TOOLS.map((tool) => tool.name);
  assert(new Set(names).size === names.length, 'duplicate tool name in the manifest');
}

function testToolGroupSelection(): void {
  const everything = selectTools({});
  assert(everything.length === BRIDGE_TOOLS.length, 'no filter should return the whole catalogue');

  const narrowed = selectTools({ groups: ['writing'] });
  assert(narrowed.length < BRIDGE_TOOLS.length, 'group filter returned everything');
  // Core has to survive any filter: without context and search nothing else works.
  assert(narrowed.some((tool) => tool.name === 'wh_get_context'), 'core tool dropped by the filter');
  assert(narrowed.some((tool) => tool.name === 'wh_search'), 'search dropped by the filter');
  assert(
    narrowed.every((tool) => tool.group === 'core' || tool.group === 'writing'),
    'group filter let a foreign group through',
  );
  assert(
    selectTools({ groups: ['nonsense'] }).every((tool) => tool.group === 'core'),
    'an unknown group should leave only core, not everything',
  );

  const readOnly = selectTools({ writesEnabled: false });
  assert(readOnly.every((tool) => !tool.writes), 'a write tool survived writesEnabled:false');
  assert(readOnly.length > 10, 'read-only clients lost almost the whole surface');
}

function testMarkdownConversion(): void {
  const html = markdownToTiptapHtml(
    [
      '# Chapter One',
      '',
      'She **ran**, and the door was *open*.',
      'A second line of the same paragraph.',
      '',
      '## The list',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '> He never came back.',
      '',
      'A [link](https://example.com) and `code`.',
    ].join('\n'),
  );

  assert(html.includes('<h1>Chapter One</h1>'), 'heading lost');
  assert(html.includes('<strong>ran</strong>'), 'bold lost');
  assert(html.includes('<em>open</em>'), 'italic lost');
  assert(html.includes('<br>'), 'soft line break lost');
  assert(html.includes('<ul>') && html.includes('<ol>'), 'lists lost');
  assert(html.includes('<blockquote>'), 'blockquote lost');
  assert(html.includes('<a href="https://example.com">link</a>'), 'link lost');
  assert(html.includes('<code>code</code>'), 'code span lost');

  // Round trip: the shape a model sends must come back recognisably.
  const back = htmlToMarkdown(html);
  assert(back.includes('# Chapter One'), 'heading did not survive the round trip');
  assert(back.includes('**ran**'), 'bold did not survive the round trip');
  assert(back.includes('[link](https://example.com)'), 'link did not survive the round trip');
  assert(back.includes('- first'), 'bullet did not survive the round trip');

  // Foreign HTML must not ride in through the Markdown door.
  const hostile = markdownToTiptapHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert(!hostile.includes('<script'), 'script tag survived conversion');
  assert(!/href="javascript:/i.test(hostile), 'javascript: URL survived conversion');
  assert(!/<script/i.test(sanitizeRichHtml(hostile)), 'sanitizer let a script through');

  // Empty input still produces a valid TipTap document.
  assert(markdownToTiptapHtml('') === '<p></p>', 'empty markdown produced an invalid document');

  // Nested lists nest INSIDE the parent item, and a flush-left bullet under a
  // numbered item is read as its sub-list — the shape every chat model writes.
  const nested = markdownToTiptapHtml('1. Marta\n- Edad: 34\n- Nave: Kestrel\n2. Julio\n   - Sin datos\n3. Ana');
  assert(
    nested === '<ol><li><p>Marta</p><ul><li><p>Edad: 34</p></li><li><p>Nave: Kestrel</p></li></ul></li><li><p>Julio</p><ul><li><p>Sin datos</p></li></ul></li><li><p>Ana</p></li></ol>',
    `nested list shape drifted: ${nested}`,
  );
  assert(markdownToTiptapHtml('3. three\n4. four').startsWith('<ol start="3">'), 'ordered list start lost');
  assert(markdownToTiptapHtml('- a\n- b\n\n1. c') === '<ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>c</p></li></ol>', 'flat lists drifted');
}

/**
 * The property that matters most in the whole bridge: an unanswered deletion
 * denies. Nobody at the keyboard must never mean "go ahead".
 */
async function testDeletionConfirmation(): Promise<void> {
  const unanswered = await requestBridgeConfirmation({
    title: 'x', message: 'nobody is listening', timeoutMs: 20,
  });
  assert(unanswered === false, 'an unanswered confirmation defaulted to YES');
  assert(pendingConfirmations() === 0, 'a settled request stayed in the queue');

  // With a listener that says yes, it resolves true — and only once.
  let seen = 0;
  const stop = subscribeBridgeConfirm((pending) => {
    if (pending) {
      seen += 1;
      pending.settle(true);
    }
  });
  const answered = await requestBridgeConfirmation({ title: 'x', message: 'y', timeoutMs: 5_000 });
  stop();
  assert(answered === true, 'an explicit confirmation did not resolve true');
  assert(seen === 1, 'the host was asked more than once for one request');
  assert(pendingConfirmations() === 0, 'the queue did not drain');
}

/**
 * The three shapes of undo, against the real database.
 *
 * The create and update cases were checked by hand through the settings panel;
 * the delete case could not be, because reaching a logged deletion means a
 * human confirming a dialog. So it is checked here instead: the confirmation
 * is a separate contract (testDeletionConfirmation above), and what remains —
 * that a recorded row goes back where it came from — is exactly this.
 */
async function testUndoRoundTrip(): Promise<void> {
  const projectId = 'undo-test-project';
  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> =>
    TOOL_HANDLERS[tool](args);
  const idOf = (result: unknown): string => String((result as { id: string }).id);

  // A real project row, because the write tools now check that the engine
  // they are about to write into is switched on in it.
  await db.projects.put({
    id: projectId,
    title: 'Undo round trip',
    mode: 'custom',
    type: 'idea',
    color: '#6b7280',
    description: '',
    status: 'draft',
    enabledEngines: ['seeds'],
    engineOrder: ['seeds'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // --- create: the row goes, and its children go with it -------------------
  const seedId = idOf(await call('wh_create_seed', { projectId, title: 'Undo seed' }));
  await call('wh_add_payoff', { seedId, title: 'Undo payoff' });
  assert((await db.payoffs.where('seedId').equals(seedId).count()) === 1, 'the payoff never landed');

  await undoAuditEntry({ entry: { kind: 'create', entityId: seedId, summary: 'created a seed' } });
  assert(!(await db.seeds.get(seedId)), 'undoing a create left the row behind');
  // The point of routing through the engine op instead of a bare table delete:
  // a bare delete would leave this payoff orphaned and invisible forever.
  assert(
    (await db.payoffs.where('seedId').equals(seedId).count()) === 0,
    'undoing a create left an orphaned child row',
  );

  let refusedTwice = false;
  try {
    await undoAuditEntry({ entry: { kind: 'create', entityId: seedId, summary: 'x' } });
  } catch (err) {
    refusedTwice = err instanceof BridgeError && err.code === 'not-found';
  }
  assert(refusedTwice, 'undoing the same creation twice was allowed');

  // --- update: the recorded fields go back, and it says which --------------
  const secondId = idOf(await call('wh_create_seed', { projectId, title: 'Before' }));
  await call('wh_update_seed', { id: secondId, title: 'After' });
  const updated = await undoAuditEntry({
    entry: {
      kind: 'update', entityId: secondId, summary: 'renamed a seed', before: { title: 'Before' },
    },
  });
  assert((await db.seeds.get(secondId))?.title === 'Before', 'undoing an update did not restore');
  assert(updated.caveat?.includes('title'), 'the undo did not say which fields it restored');

  // --- delete: the row comes back, and it is honest about the children -----
  const row = await db.seeds.get(secondId);
  assert(row, 'the row vanished before the delete case');
  await deleteSeed(secondId);
  assert(!(await db.seeds.get(secondId)), 'the delete did not happen');

  const restored = await undoAuditEntry({
    entry: {
      kind: 'delete', entityId: secondId, summary: 'deleted a seed', table: 'seeds', before: row,
    },
  });
  assert((await db.seeds.get(secondId))?.title === 'Before', 'undoing a delete did not put the row back');
  assert(restored.caveat, 'a restored deletion claimed to be complete');

  let refusedBack = false;
  try {
    await undoAuditEntry({
      entry: { kind: 'delete', entityId: secondId, table: 'seeds', before: row },
    });
  } catch (err) {
    refusedBack = err instanceof BridgeError && err.code === 'bad-args';
  }
  assert(refusedBack, 'a row that is already back was restored again');

  // A deletion that never recorded its table cannot be guessed at.
  let refusedBlind = false;
  try {
    await undoAuditEntry({ entry: { kind: 'delete', entityId: secondId, before: row } });
  } catch (err) {
    refusedBlind = err instanceof BridgeError && err.code === 'cannot-undo';
  }
  assert(refusedBlind, 'a deletion with no recorded table was undone by guesswork');

  await db.seeds.delete(secondId);
  await db.projects.delete(projectId);
}

/**
 * What a write records about the row it is replacing, and whether undo can put
 * it back byte for byte.
 *
 * Three regressions live here, all of them silent in front of a model:
 *
 *  • an empty `content` on a codex entry used to be accepted and written, so a
 *    small model that sent a blank string beside the field it actually meant
 *    to change erased the whole body — and the codex has no snapshot table
 *    behind it, so there was nothing to restore from;
 *  • `wh_update_dialog_block` recorded `content.slice(0, 400)` under the key
 *    `character`, so undoing a type-only edit replaced a long speech with its
 *    first 400 characters and left a junk `character` column on the row;
 *  • `wh_append_writing` recorded only the word count, so undoing an append
 *    left the appended prose in the manuscript beside a count that no longer
 *    described it.
 */
async function testWriteBodyGuardsAndUndoFidelity(): Promise<void> {
  const projectId = 'bridge-write-project';
  const call = (tool: string, args: Record<string, unknown>): Promise<unknown> =>
    TOOL_HANDLERS[tool](args);
  const idOf = (result: unknown): string => String((result as { id: string }).id);
  const auditBefore = (result: unknown): Record<string, unknown> =>
    (result as { __audit: { before: Record<string, unknown> } }).__audit.before;
  const codeOf = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
      return '';
    } catch (err) {
      return err instanceof BridgeError ? err.code : 'other';
    }
  };

  await db.projects.put({
    id: projectId,
    title: 'Bridge writes',
    mode: 'custom',
    type: 'idea',
    color: '#6b7280',
    description: '',
    status: 'draft',
    enabledEngines: ['codex', 'dialog-scene', 'writings'],
    engineOrder: ['codex', 'dialog-scene', 'writings'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // --- a blank body is an erasure, not an edit ----------------------------
  const codexId = idOf(await call('wh_create_codex_entry', {
    projectId, title: 'Marta', type: 'character', content: 'Nació en el puerto.',
  }));
  const originalBody = (await db.codexEntries.get(codexId))?.content;
  assert(originalBody && originalBody.length > 0, 'the codex entry was created without a body');

  assert(
    await codeOf(call('wh_update_codex_entry', { id: codexId, content: '' })) === 'bad-args',
    'an empty content was accepted on a codex entry',
  );
  assert(
    await codeOf(call('wh_update_codex_entry', { id: codexId, content: '   \n\t ' })) === 'bad-args',
    'a whitespace-only content was accepted on a codex entry',
  );
  assert(
    (await db.codexEntries.get(codexId))?.content === originalBody,
    'a refused content change still touched the body',
  );

  // A real change goes through — and records the body it replaced, because
  // there is no snapshot table behind the codex to recover it from.
  const changed = await call('wh_update_codex_entry', { id: codexId, content: 'Nació tierra adentro.' });
  const codexAudit = auditBefore(changed);
  assert(codexAudit.content === originalBody, 'the audit did not record the codex body it replaced');
  const rewritten = (await db.codexEntries.get(codexId))?.content;
  assert(rewritten && rewritten !== originalBody, 'the accepted content change did not land');
  await undoAuditEntry({
    entry: { kind: 'update', entityId: codexId, summary: 'rewrote a body', before: codexAudit },
  });
  assert(
    (await db.codexEntries.get(codexId))?.content === originalBody,
    'undoing a codex body change did not restore the original body',
  );

  // --- a type-only edit must not truncate the line it did not touch -------
  const sceneId = idOf(await call('wh_create_scene', { projectId, title: 'La azotea' }));
  const longLine = `Monólogo: ${'palabra '.repeat(90)}fin.`;
  assert(longLine.length > 400, 'the fixture line is not long enough to catch a 400-char truncation');
  const blockId = idOf(await call('wh_add_dialog', {
    sceneId, type: 'dialog', character: 'Alicia', content: longLine,
  }));

  const retyped = await call('wh_update_dialog_block', { id: blockId, type: 'note' });
  const blockAudit = auditBefore(retyped);
  assert(blockAudit.content === longLine, 'the audit truncated the line it recorded');
  assert(blockAudit.characterName === 'Alicia', 'the audit lost the speaker under its real column name');
  assert(!('character' in blockAudit), 'the audit recorded a `character` key that matches no column');
  assert((await db.dialogBlocks.get(blockId))?.type === 'note', 'the type change did not land');

  await undoAuditEntry({
    entry: { kind: 'update', entityId: blockId, summary: 'retyped a block', before: blockAudit },
  });
  const restoredBlock = await db.dialogBlocks.get(blockId);
  assert(restoredBlock?.content === longLine, 'undoing a type-only edit truncated the line');
  assert(restoredBlock?.type === 'dialog', 'undoing a type-only edit did not restore the type');
  assert(restoredBlock?.characterName === 'Alicia', 'undoing a type-only edit lost the speaker');
  assert(
    !('character' in (restoredBlock as unknown as Record<string, unknown>)),
    'undo wrote a stray `character` column onto the block',
  );

  // --- an append comes back whole: the prose AND the count ----------------
  const writingId = idOf(await call('wh_create_writing', {
    projectId, title: 'Capítulo uno', content: 'La primera línea del capítulo.',
  }));
  const original = await db.writings.get(writingId);
  assert(original, 'the writing was not created');

  const appended = await call('wh_append_writing', { id: writingId, content: 'Y una línea añadida después.' });
  const appendAudit = auditBefore(appended);
  const grown = await db.writings.get(writingId);
  assert(
    grown && grown.content.length > original.content.length && grown.wordCount > original.wordCount,
    'the append never landed',
  );
  assert(appendAudit.content === original.content, 'the audit did not record the body before the append');
  assert(appendAudit.wordCount === original.wordCount, 'the audit did not record the word count before the append');

  await undoAuditEntry({
    entry: { kind: 'update', entityId: writingId, summary: 'appended to a writing', before: appendAudit },
  });
  const undone = await db.writings.get(writingId);
  assert(undone?.content === original.content, 'undoing an append left the added prose in the manuscript');
  assert(
    undone?.wordCount === original.wordCount,
    'undoing an append left a word count that no longer matches the body',
  );

  // --- clean up so later suites see an untouched project set --------------
  await db.writingSnapshots.where('writingId').equals(writingId).delete();
  await db.writings.delete(writingId);
  await db.dialogBlocks.where('sceneId').equals(sceneId).delete();
  await db.sceneCasts.where('sceneId').equals(sceneId).delete();
  await db.scenes.delete(sceneId);
  await db.codexEntries.delete(codexId);
  await db.projects.delete(projectId);
}

// ---------------------------------------------------------------------------
// Cross-project scope: a copilot conversation opened in project A must not
// reach a row of project B by id, whether to read it or to write it.
// ---------------------------------------------------------------------------

/**
 * One handler addressed by an id of project B. `args` is what the model
 * would send (no projectId: the scope travels in SCOPE_KEY). `heavy` marks
 * the calls that would build a generated world on the happy path; those are
 * only checked for the refusal, which fires before the world is opened.
 */
interface ScopeCase {
  tool: string;
  args: Record<string, unknown>;
  heavy?: boolean;
}

/** A 1x1 PNG, enough for the vision path to decode and resize. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Every bridge tool that loads a row by id refuses a copilot call scoped to
 * another project, and answers the same call scoped to the row's own project.
 *
 * The call goes through `applyProjectScope` exactly as the copilot runtime
 * does, so the test breaks if either the pin or the handler's check goes.
 * Adding a handler is one line in CASES.
 */
export async function testCopilotScopeLeak(): Promise<void> {
  const A = 'bridge-scope-a';
  const B = 'bridge-scope-b';
  const engines = [
    'codex', 'dialog-scene', 'writings', 'character-arc', 'biography', 'board',
    'real-atlas', 'worldgen', 'gallery', 'scrapper', 'outline', 'timeline', 'annotations',
  ];
  const now = Date.now();
  for (const [id, title] of [[A, 'Scope A'], [B, 'Scope B']]) {
    await db.projects.put({
      id, title, mode: 'custom', type: 'idea', color: '#6b7280', description: '', status: 'draft',
      enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now,
    });
  }

  // Raw calls, as the bridge (no scope) would make them: the fixtures.
  const raw = (tool: string, args: Record<string, unknown>): Promise<unknown> =>
    TOOL_HANDLERS[tool](args);
  const idOf = (result: unknown): string => String((result as { id: string }).id);
  // The copilot path: pinned to `scope` the way the runtime pins a conversation.
  const scoped = async (
    tool: string,
    args: Record<string, unknown>,
    scope: string,
  ): Promise<{ code: string; message: string }> => {
    const spec = getBridgeTool(tool);
    assert(spec, `no manifest entry for ${tool}`);
    const verdict = applyProjectScope(spec, args, { origin: 'copilot', projectId: scope });
    if (!verdict.ok) return { code: verdict.code, message: verdict.error };
    try {
      await TOOL_HANDLERS[tool](verdict.args);
      return { code: '', message: '' };
    } catch (err) {
      if (err instanceof BridgeError) return { code: err.code, message: err.message };
      return { code: 'other', message: err instanceof Error ? err.message : String(err) };
    }
  };

  // --- fixtures, all in B --------------------------------------------------
  const placeId = idOf(await raw('wh_create_atlas_place', { projectId: B, name: 'Cádiz', lat: 36.53, lon: -6.29 }));
  const placeId2 = idOf(await raw('wh_create_atlas_place', { projectId: B, name: 'Sevilla', lat: 37.39, lon: -5.99 }));
  const divergenceId = idOf(await raw('wh_create_divergence', { projectId: B, title: 'El puente nunca cayó', placeId }));
  const worldId = 'bridge-scope-world';
  await db.generatedWorlds.put({
    id: worldId, projectId: B, title: 'Mundo B', params: { seed: 7, width: 64 }, createdAt: now, updatedAt: now,
  });
  const waypointId = idOf(await raw('wh_add_waypoint', { worldId, name: 'Faro', u: 0.2, v: 0.4 }));
  const codexId = idOf(await raw('wh_create_codex_entry', { projectId: B, title: 'Marta', type: 'character', content: 'Nació en el puerto.' }));
  const writingId = idOf(await raw('wh_create_writing', { projectId: B, title: 'Capítulo 1', content: 'Llovía.' }));
  const sceneId = idOf(await raw('wh_create_scene', { projectId: B, title: 'La azotea' }));
  const arcId = idOf(await raw('wh_create_arc', { projectId: B, title: 'Caída de Marta' }));
  const bioId = idOf(await raw('wh_create_biography', { projectId: B, subjectName: 'Marta' }));
  const boardId = idOf(await raw('wh_create_board', { projectId: B, title: 'Tablero' }));
  const cardId = idOf(await raw('wh_add_board_card', { boardId, title: 'Pista' }));
  await db.boardNodes.update(cardId, { image: TINY_PNG });
  const imageId = 'bridge-scope-image';
  await db.inspirationImages.put({ id: imageId, projectId: B, imageData: TINY_PNG, tags: [], notes: '', createdAt: now });
  const snapshotId = 'bridge-scope-snapshot';
  await db.snapshots.put({
    id: snapshotId, projectId: B, url: 'https://example.invalid/x', title: 'Recorte', source: 'url',
    status: 'success', thumbnail: TINY_PNG, notes: '', tags: [], preservedAt: now, createdAt: now,
  });
  const outlineId = idOf(await raw('wh_create_outline', { projectId: B, title: 'Esquema' }));
  const timelineId = idOf(await raw('wh_create_timeline', { projectId: B, title: 'Cronología' }));
  await raw('wh_annotate', { projectId: B, engineId: 'writings', entityId: writingId, note: 'Revisar el tiempo verbal.' });

  const CASES: ScopeCase[] = [
    // real-atlas
    { tool: 'wh_get_atlas_place', args: { id: placeId } },
    { tool: 'wh_get_divergence', args: { id: divergenceId } },
    { tool: 'wh_update_atlas_place', args: { id: placeId, description: 'Puerto' } },
    { tool: 'wh_update_divergence', args: { id: divergenceId, reason: 'Porque sí' } },
    { tool: 'wh_atlas_distance', args: { fromPlaceId: placeId, toPlaceId: placeId2 } },
    { tool: 'wh_atlas_places_near', args: { placeId, radiusKm: 500 } },
    // worldgen — everything goes through loadWorld, plus the waypoint update
    { tool: 'wh_get_world', args: { worldId } },
    { tool: 'wh_list_waypoints', args: { worldId } },
    { tool: 'wh_list_place_links', args: { worldId } },
    { tool: 'wh_add_waypoint', args: { worldId, name: 'Cala', u: 0.5, v: 0.5 } },
    { tool: 'wh_update_waypoint', args: { id: waypointId, name: 'Faro viejo' } },
    { tool: 'wh_add_place', args: { worldId, marker: 'landmark', landmark: 'volcano', x: 3, y: 3 } },
    { tool: 'wh_rename_place', args: { worldId, key: 'settlement:1,1', name: 'Villa' } },
    { tool: 'wh_move_place', args: { worldId, key: 'settlement:1,1', x: 2, y: 2 } },
    { tool: 'wh_remove_place', args: { worldId, key: 'settlement:1,1' } },
    { tool: 'wh_restore_place', args: { worldId, key: 'settlement:1,1' } },
    { tool: 'wh_add_label', args: { worldId, x: 1, y: 1, text: 'Mar' } },
    { tool: 'wh_list_places', args: { worldId }, heavy: true },
    { tool: 'wh_find_place', args: { worldId, query: 'Villa' }, heavy: true },
    { tool: 'wh_place_at', args: { worldId, x: 1, y: 1 }, heavy: true },
    { tool: 'wh_world_summary', args: { worldId }, heavy: true },
    { tool: 'wh_link_place', args: { worldId, key: 'settlement:1,1', targetType: 'codex-entry', targetId: codexId }, heavy: true },
    // the rest of the by-id readers
    { tool: 'wh_get_arc', args: { id: arcId } },
    { tool: 'wh_get_biography', args: { id: bioId } },
    { tool: 'wh_get_board', args: { id: boardId } },
    { tool: 'wh_view_board_image', args: { id: cardId } },
    { tool: 'wh_get_codex_entry', args: { id: codexId } },
    { tool: 'wh_get_scene', args: { id: sceneId } },
    { tool: 'wh_view_image', args: { id: imageId } },
    { tool: 'wh_get_snapshot', args: { id: snapshotId } },
    { tool: 'wh_view_snapshot_image', args: { id: snapshotId } },
    { tool: 'wh_get_writing', args: { id: writingId } },
    { tool: 'wh_list_writing_versions', args: { id: writingId } },
    { tool: 'wh_list_beats', args: { outlineId } },
    { tool: 'wh_list_events', args: { timelineId } },
    { tool: 'wh_list_annotations', args: { engineId: 'writings', entityId: writingId } },
  ];

  try {
    for (const { tool, args, heavy } of CASES) {
      const fromA = await scoped(tool, args, A);
      assert(
        fromA.code === 'scope',
        `${tool} scoped to A reached a row of B (got ${fromA.code || 'success'}${fromA.message ? `: ${fromA.message}` : ''})`,
      );
      if (heavy) continue;
      const fromB = await scoped(tool, args, B);
      assert(
        fromB.code === '',
        `${tool} scoped to B, the row's own project, failed with ${fromB.code}: ${fromB.message}`,
      );
    }
  } finally {
    for (const projectId of [A, B]) {
      await Promise.all([
        db.atlasPlaces, db.atlasDivergences, db.generatedWorlds, db.worldWaypoints, db.codexEntries,
        db.writings, db.writingSnapshots, db.scenes, db.characterArcs, db.biographies,
        db.boards, db.boardNodes, db.inspirationImages, db.snapshots, db.outlines, db.timelines,
        db.annotations, db.entityLinks,
      ].map((table) => table.where('projectId').equals(projectId).delete()));
      await db.projects.delete(projectId);
    }
    await db.sceneCasts.where('sceneId').equals(sceneId).delete();
  }
}

export async function testAiBridgeContracts(): Promise<string> {
  testManifestHandlerParity();
  testToolGroupSelection();
  testMarkdownConversion();
  await testDeletionConfirmation();
  await testUndoRoundTrip();
  await testWriteBodyGuardsAndUndoFidelity();
  await testCopilotScopeLeak();
  return `AI bridge: ${BRIDGE_TOOLS.length} tools, group filter, Markdown, deny-by-default deletes, undo, blank-body refusal, lossless update undo, cross-project scope`;
}
