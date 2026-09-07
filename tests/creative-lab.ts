import type { BoardNode } from '../src/engines/board/types';
import type { Note } from '../src/engines/notes/types';
import type { Seed } from '../src/engines/seeds/types';
import type { CodexEntry, InspirationImage } from '../src/types';
import {
  buildCreativePromotionRequest,
  buildCreativeSources,
  createCreativePossibility,
  createDeckPossibility,
  dealConstraintDeck,
  getConstraintDeckIssue,
  getCreativeOperationIssue,
  groupCreativePossibilities,
  toggleComparison,
} from '../src/components/project/creative-lab';
import type {
  ConstraintDeck,
  CreativeOperationRequest,
  CreativePossibility,
  CreativeSource,
} from '../src/components/project/creative-lab';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: expected ${right}, got ${left}`);
}

function assertThrows(run: () => void, expected: string): void {
  try {
    run();
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    assert(message.includes(expected), `unexpected error: ${message}`);
    return;
  }
  throw new Error(`expected an error containing "${expected}"`);
}

function canonicalFixtures() {
  const projectId = 'project-a';
  const note: Note = {
    id: 'note-1', projectId, kind: 'idea', text: '\n  A bell that rings before a lie.\nSecond line.',
    source: 'margin', tags: ['bell'], pinned: false, createdAt: 10, updatedAt: 20,
  };
  const boardNode: BoardNode = {
    id: 'board-1', projectId, boardId: 'board-main', kind: 'card', role: 'clue', title: 'Salt map',
    content: 'A coastline drawn in salt.', color: '#fff', position: { x: 0, y: 0 },
    size: { width: 220, height: 140 }, zIndex: 1, tags: ['map'], createdAt: 11, updatedAt: 21,
  };
  const codexEntry: CodexEntry = {
    id: 'codex-1', projectId, type: 'character', title: 'Mara', avatar: 'data:image/png;base64,avatar',
    fields: { role: 'archivist' }, content: '<p>Keeps every version of the truth.</p>', tags: ['witness'],
    relations: [], createdAt: 12, updatedAt: 22,
  };
  const image: InspirationImage = {
    id: 'image-1', projectId, imageData: 'data:image/png;base64,full', thumbnailData: 'data:image/png;base64,thumb',
    tags: ['red-room'], notes: 'A red room with no doors.', createdAt: 13,
  };
  const seed: Seed = {
    id: 'seed-1', projectId, title: 'The borrowed key', description: 'It opens a room that should not exist.',
    kind: 'chekhov', status: 'planted', tags: ['key'], createdAt: 14, updatedAt: 24,
  };
  const foreign: Note = { ...note, id: 'foreign', projectId: 'project-b' };
  return { projectId, note, boardNode, codexEntry, image, seed, foreign };
}

function buildSources(): CreativeSource[] {
  const rows = canonicalFixtures();
  return buildCreativeSources({
    projectId: rows.projectId,
    notes: [rows.note, rows.foreign],
    boardNodes: [rows.boardNode],
    codexEntries: [rows.codexEntry],
    images: [rows.image],
    seeds: [rows.seed],
    usageCounts: {
      'note:note-1': 0,
      'board:board-1': 1,
      'codex:codex-1': 2,
      'gallery:image-1': 100,
      'seed:seed-1': 100,
    },
  });
}

function testCanonicalAdapters(): void {
  const rows = canonicalFixtures();
  const sources = buildSources();
  assertEqual(sources.length, 5, 'the adapter leaked a source from another project');
  assertJsonEqual(
    [...new Set(sources.map(source => source.kind))].sort(),
    ['board', 'codex', 'gallery', 'note', 'seed'],
    'the adapter did not expose every requested canonical kind',
  );
  assertEqual(sources.find(source => source.kind === 'note')?.title, 'A bell that rings before a lie.', 'note title projection is wrong');
  assertEqual(sources.find(source => source.kind === 'codex')?.excerpt, 'Keeps every version of the truth.', 'Codex HTML was not projected as plain text');
  assertEqual(sources.find(source => source.kind === 'gallery')?.thumbnail, rows.image.thumbnailData, 'the Gallery thumbnail was not preferred');
  assertEqual(sources[0].key, 'note:note-1', 'least-used material was not sorted first');

  sources[0].tags.push('session-only');
  assert(!rows.note.tags.includes('session-only'), 'the source projection retained a mutable canonical tags array');
}

function testEveryDeterministicOperation(): void {
  const sources = buildSources();
  const requests: CreativeOperationRequest[] = [
    { operation: 'combine' },
    { operation: 'invert', focus: 'the warning' },
    { operation: 'remove', element: 'the bell' },
    { operation: 'scale', scale: 'an entire city' },
    { operation: 'relocate', place: 'an orbital station', era: 'after the archive burns' },
    { operation: 'pov', pointOfView: 'the person who forged the key' },
    { operation: 'cost', cost: 'Mara losing her name' },
    { operation: 'truth' },
  ];

  for (const request of requests) {
    const selected = request.operation === 'combine' ? sources.slice(0, 2) : sources.slice(0, 1);
    const first = createCreativePossibility({ id: `first-${request.operation}`, createdAt: 50, sources: selected, request });
    const second = createCreativePossibility({ id: `second-${request.operation}`, createdAt: 60, sources: selected, request });
    assertEqual(first.text, second.text, `${request.operation} depends on random or remote output`);
    assert(first.text.length > 40, `${request.operation} generated an unusably thin prompt`);
    assertEqual(first.provenance.generation.method, 'deterministic', `${request.operation} did not record deterministic generation`);
    assertJsonEqual(
      first.provenance.sources.map(source => `${source.kind}:${source.id}`),
      selected.map(source => source.key),
      `${request.operation} lost source order or identity`,
    );
  }

  assertEqual(getCreativeOperationIssue({ operation: 'combine' }, 1), 'select-two-sources', 'combine accepted one source');
  assertEqual(getCreativeOperationIssue({ operation: 'remove', element: '  ' }, 1), 'missing-remove-element', 'remove accepted an empty element');
  assertEqual(getCreativeOperationIssue({ operation: 'relocate', place: '', era: '' }, 1), 'missing-place-or-era', 'relocate accepted no destination');
  assertThrows(() => createCreativePossibility({
    id: 'cross-project',
    createdAt: 1,
    sources: [sources[0], { ...sources[1], projectId: 'project-b' }],
    request: { operation: 'combine' },
  }), 'one project');
}

function testConstraintDeckLocksAndUnderusedMaterial(): void {
  const sources = buildSources();
  const first = dealConstraintDeck({ sources, seed: 73 });
  const repeated = dealConstraintDeck({ sources, seed: 73 });
  assertJsonEqual(first, repeated, 'the same constraint seed produced another deal');
  assert(first.sourceKeys.every(Boolean), 'a populated source shelf left an empty deck slot');
  assert(!first.sourceKeys.includes('gallery:image-1') && !first.sourceKeys.includes('seed:seed-1'), 'heavily used material displaced neglected sources');

  const next = dealConstraintDeck({
    sources,
    seed: 74,
    previous: first,
    locks: { verb: true, sourceSlots: [true, false] },
  });
  assertEqual(next.verb, first.verb, 'a locked verb changed during reroll');
  assertEqual(next.sourceKeys[0], first.sourceKeys[0], 'a locked source changed during reroll');
  assert(next.sourceKeys[1] !== first.sourceKeys[1], 'an unlocked source did not reroll despite available alternatives');
  assertEqual(new Set(next.sourceKeys.filter(Boolean)).size, next.sourceKeys.filter(Boolean).length, 'the deck dealt one source twice');
}

function testDeckPossibilityAndProvenance(): void {
  const sources = buildSources();
  const deck: ConstraintDeck = {
    seed: 91,
    verb: 'change-who-pays',
    sourceKeys: [sources[0].key, sources[1].key],
  };
  const possibility = createDeckPossibility({ id: 'deck-idea', createdAt: 100, sources, deck });
  assertEqual(possibility.provenance.origin, 'constraint-deck', 'the deck origin was lost');
  assertEqual(possibility.provenance.parameters.deckSeed, '91', 'the reproducible deck seed was lost');
  assertJsonEqual(possibility.provenance.sources.map(source => `${source.kind}:${source.id}`), deck.sourceKeys, 'the deal lost canonical source ids');
  assert(possibility.text.includes('pay'), 'the selected deck verb did not shape the result');
  assertEqual(getConstraintDeckIssue({ verb: 'combine' }, 1), 'select-two-sources', 'a two-source deck verb accepted one card');
  assertThrows(() => createDeckPossibility({
    id: 'missing-card', createdAt: 100, sources, deck: { seed: 1, verb: 'combine', sourceKeys: ['missing', null] },
  }), 'select-source');
}

function testEphemeralWorkflowAndPromotionContract(): void {
  const sources = buildSources();
  const base = createCreativePossibility({
    id: 'idea-a', createdAt: 200, sources: sources.slice(0, 2), request: { operation: 'combine' },
  });
  const possibilities: CreativePossibility[] = [
    { ...base, id: 'idea-a', title: 'First route', group: 'Act II' },
    { ...base, id: 'idea-b', title: 'Second route', group: 'act ii' },
    { ...base, id: 'idea-c', status: 'archived', group: 'Discarded' },
    { ...base, id: 'idea-d', group: '' },
  ];
  const activeGroups = groupCreativePossibilities(possibilities, 'active');
  assertEqual(activeGroups.length, 2, 'case-equivalent groups were split or ungrouped material disappeared');
  assertEqual(activeGroups[0].possibilities.length, 2, 'the named group did not collect both routes');
  assertEqual(activeGroups.at(-1)?.id, '__ungrouped__', 'ungrouped possibilities were not kept visible');
  assertEqual(groupCreativePossibilities(possibilities, 'archived')[0].possibilities[0].id, 'idea-c', 'archive filtering lost the route');

  let comparison = toggleComparison([], 'idea-a');
  comparison = toggleComparison(comparison, 'idea-b');
  comparison = toggleComparison(comparison, 'idea-d');
  assertJsonEqual(comparison, ['idea-b', 'idea-d'], 'comparison did not cap itself at the two newest selections');
  assertJsonEqual(toggleComparison(comparison, 'idea-b'), ['idea-d'], 'comparison could not deselect a route');

  const request = buildCreativePromotionRequest(possibilities[0], 'timeline');
  assertEqual(request.projectId, 'project-a', 'promotion escaped the source project');
  assertEqual(request.target, 'timeline', 'promotion target was lost');
  assertEqual(request.group, 'Act II', 'promotion lost the working group');
  assertEqual(request.provenance.sources[0].id, sources[0].id, 'promotion lost canonical provenance');
  request.provenance.sources[0].title = 'changed in callback';
  assert(possibilities[0].provenance.sources[0].title !== 'changed in callback', 'the promotion callback can mutate session provenance');
}

export function runCreativeLabTests(): string[] {
  testCanonicalAdapters();
  testEveryDeterministicOperation();
  testConstraintDeckLocksAndUnderusedMaterial();
  testDeckPossibilityAndProvenance();
  testEphemeralWorkflowAndPromotionContract();
  return [
    'canonical sources are projected without a parallel store',
    'all eight idea operations are deterministic and traceable',
    'constraint locks reroll only unlocked cards and favor neglected material',
    'constraint results preserve their real sources and seed',
    'group, compare, archive, and promotion stay ephemeral and provenance-safe',
  ];
}
