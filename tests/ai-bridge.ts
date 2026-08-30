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
  const deleters = BRIDGE_TOOLS.filter((t) => /delete|remove|destroy/i.test(t.name));
  assert(deleters.length === 1, 'there should be exactly one deletion tool, wh_delete');
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
    // Worldgen is registered but has no tools here; anything else missing is drift.
    if (engineId === 'worldgen') continue;
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

export async function testAiBridgeContracts(): Promise<string> {
  testManifestHandlerParity();
  testToolGroupSelection();
  testMarkdownConversion();
  await testDeletionConfirmation();
  await testUndoRoundTrip();
  return `AI bridge: ${BRIDGE_TOOLS.length} tools, group filter, Markdown, deny-by-default deletes, undo`;
}
