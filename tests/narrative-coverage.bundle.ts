import assert from 'node:assert/strict';
import {
  buildCoverageMatrixFromParts,
  buildTimelineEvidenceFromParts,
  cellKey,
  effectiveCoverageRole,
  effectiveEvidenceStatus,
  findEventWitness,
  hashText,
  inferCoverageRole,
  inferTimelineEvidence,
  manuscriptHashFromWritingHashes,
  proseWitnessesEvent,
  strongerRole,
  writingHasPovTag,
} from '@/services/narrativeXray/coverageEvidence';
import { buildManuscriptBoard } from '@/services/narrativeXray/manuscriptViews';
import { buildPhraseRecurrence } from '@/services/narrativeXray/phraseRecurrence';
import type { Writing } from '@/types';

assert.equal(strongerRole('mention', 'pov'), 'pov');
assert.equal(effectiveCoverageRole('mention', 'presence', false), 'presence');
assert.equal(effectiveCoverageRole('mention', 'presence', true), 'mention');
assert.equal(inferCoverageRole({ mentioned: true, povTagged: false }), 'mention');
assert.equal(inferCoverageRole({ mentioned: true, povTagged: true }), 'pov');
assert.notEqual(inferCoverageRole({ mentioned: true, povTagged: false }), 'presence');

assert.equal(
  inferTimelineEvidence({
    eventTitle: 'Ana arrives at the lighthouse',
    eventWitnessedInProse: false,
    linkedEntryId: 'c1',
    characterMentionedInAnyWriting: true,
  }),
  'not_narrated',
);
assert.equal(
  inferTimelineEvidence({
    eventTitle: 'Ana arrives at the lighthouse',
    eventWitnessedInProse: true,
    linkedEntryId: 'c1',
    characterMentionedInAnyWriting: true,
  }),
  'narrated',
);

// Anchored witness: multi-token title in prose.
assert.ok(proseWitnessesEvent('Ana arrives at the lighthouse before dawn.', 'Ana arrives at the lighthouse'));
// Single distinctive token must NOT certify narration.
assert.equal(findEventWitness([{ id: 'w', title: 'w', content: '<p>The grey fog rolls in.</p>' }], 'Rey'), null);
assert.equal(findEventWitness([{ id: 'w', title: 'w', content: '<p>Storm tonight.</p>' }], 'Storm'), null);
// Epistemic / avoidance frames are not narration.
assert.equal(
  findEventWitness(
    [{ id: 'w', title: 'w', content: '<p>Ana remembered the storm over Faro and tried to avoid it.</p>' }],
    'Storm over Faro',
  ),
  null,
);
// Empty chapter cannot witness.
assert.equal(
  findEventWitness([{ id: 'empty', title: 'Empty', content: '' }], 'Storm over Faro'),
  null,
);
const anchored = findEventWitness(
  [
    { id: 'empty', title: 'Empty', chapter: 1, content: '' },
    {
      id: 'w2',
      title: 'Ch2',
      chapter: 2,
      content: '<p>That night the storm over Faro broke the glass.</p>',
    },
  ],
  'Storm over Faro',
);
assert.ok(anchored);
assert.equal(anchored!.writingId, 'w2');
assert.ok(anchored!.excerpt.toLowerCase().includes('storm'));

assert.equal(effectiveEvidenceStatus('narrated', 'contradiction', true), 'unverified');
assert.equal(effectiveEvidenceStatus('narrated', 'contradiction', false), 'contradiction');
assert.ok(writingHasPovTag('<p>pov:Ana</p>', 'Ana', []));
assert.equal(hashText('abc'), hashText('abc'));

const mentionByWriting = new Map<string, Set<string>>([['w1', new Set(['c1'])]]);
const matrix = buildCoverageMatrixFromParts({
  projectId: 'p1',
  characters: [
    { id: 'c1', name: 'Ana', aliases: ['A.'] },
    { id: 'c2', name: 'Luis', aliases: [] },
  ],
  writings: [
    { id: 'w1', title: 'Ch1', chapter: 1, status: 'draft', content: '<p>Ana walks.</p>' },
    { id: 'w2', title: 'Ch2', chapter: 2, status: 'draft', content: '' },
  ],
  mentionByWriting,
  presenceLinks: [{ characterId: 'c2', writingId: 'w1' }],
  povLinks: [{ characterId: 'c1', writingId: 'w1' }],
  overrides: { cells: {} },
  beats: [{ id: 'b1', title: 'Beat empty', linkedWritingId: 'w2' }],
});

const anaW1 = matrix.cells.find((c) => c.characterId === 'c1' && c.writingId === 'w1')!;
assert.equal(anaW1.role, 'mention');
assert.equal(anaW1.plannedPov, true);
assert.equal(anaW1.inferred, 'mention');
const luisW1 = matrix.cells.find((c) => c.characterId === 'c2' && c.writingId === 'w1')!;
assert.equal(luisW1.role, 'absent');
assert.equal(luisW1.plannedPresence, true);
assert.equal(matrix.emptyLinkedBeats.length, 1);

const writingHashes = new Map([
  ['w1', hashText('Ana walks the pier. No storm words here.')],
  ['w2', hashText('')],
]);
const evidence = buildTimelineEvidenceFromParts({
  projectId: 'p1',
  events: [
    { id: 'e1', title: 'Storm over Faro', linkedEntryId: 'c1' },
    { id: 'e2', title: 'Mystery' },
  ],
  mentionedEntryIds: new Set(['c1']),
  writings: [
    { id: 'w1', title: 'Ch1', chapter: 1, content: '<p>Ana walks the pier. No storm words here.</p>' },
    { id: 'w2', title: 'Ch2', chapter: 2, content: '' },
  ],
  writingHashes,
  overrides: {
    rows: {
      e1: {
        status: 'contradiction',
        writingId: 'w1',
        contentHash: 'bbbb',
        manuscriptHash: 'old',
      },
    },
  },
});
const e1 = evidence.rows.find((r) => r.eventId === 'e1')!;
assert.equal(e1.stale, true);
assert.equal(e1.status, 'unverified');
assert.equal(e1.inferred, 'not_narrated');
assert.equal(evidence.rows.find((r) => r.eventId === 'e2')?.status, 'unverified');

// Manual presence with matching hash works; mismatched hash falls back.
const freshHash = hashText('x');
const withManual = buildCoverageMatrixFromParts({
  projectId: 'p1',
  characters: [{ id: 'c2', name: 'Luis', aliases: [] }],
  writings: [{ id: 'w1', title: 'Ch1', chapter: 1, status: 'draft', content: '<p>x</p>' }],
  mentionByWriting: new Map(),
  presenceLinks: [{ characterId: 'c2', writingId: 'w1' }],
  povLinks: [],
  overrides: { cells: { [cellKey('c2', 'w1')]: { role: 'presence', contentHash: freshHash } } },
  beats: [],
});
assert.equal(withManual.cells[0].role, 'presence');
assert.equal(withManual.cells[0].overrideStale, false);

const staleManual = buildCoverageMatrixFromParts({
  projectId: 'p1',
  characters: [{ id: 'c2', name: 'Luis', aliases: [] }],
  writings: [{ id: 'w1', title: 'Ch1', chapter: 1, status: 'draft', content: '<p>edited</p>' }],
  mentionByWriting: new Map(),
  presenceLinks: [],
  povLinks: [],
  overrides: { cells: { [cellKey('c2', 'w1')]: { role: 'presence', contentHash: freshHash } } },
  beats: [],
});
assert.equal(staleManual.cells[0].overrideStale, true);
assert.equal(staleManual.cells[0].role, 'absent');

// Binder/kanban from the same Writing rows — 30 synthetic chapters.
const synthetic: Writing[] = Array.from({ length: 30 }, (_, i) => ({
  id: `w${i + 1}`,
  projectId: 'p1',
  title: `Chapter ${i + 1}`,
  status: (['idea', 'draft', 'finished'] as const)[i % 3],
  content: `<p>Chapter ${i + 1} with Ana and basically basically filler.</p>`,
  wordCount: 10,
  chapter: i + 1,
  tags: [],
  createdAt: i,
  updatedAt: i,
}));
const board = buildManuscriptBoard(synthetic, 'kanban');
assert.equal(board.ordered.length, 30);
assert.equal(board.columns.reduce((n, c) => n + c.cards.length, 0), 30);
assert.equal(board.columns.find((c) => c.status === 'draft')?.cards.length, 10);

const phrases = buildPhraseRecurrence({
  locale: 'en',
  writings: synthetic.map((w) => ({ id: w.id, content: w.content })),
  fillers: ['basically'],
});
assert.ok(phrases.hits.some((h) => h.phrase === 'basically' && h.count >= 2));

assert.ok(writingHasPovTag('<p>pov:A.</p>', 'Ana', ['A.']));
const aliasMatrix = buildCoverageMatrixFromParts({
  projectId: 'p1',
  characters: [{ id: 'c1', name: 'Ana', aliases: ['A.'] }],
  writings: [{ id: 'w1', title: 'Ch1', chapter: 1, status: 'draft', content: '<p>A. waits.</p>' }],
  mentionByWriting: new Map([['w1', new Set(['c1'])]]),
  presenceLinks: [],
  povLinks: [],
  overrides: {
    cells: { [cellKey('c1', 'w1')]: { role: 'presence', contentHash: hashText('A. waits.') } },
  },
  beats: [],
});
assert.equal(aliasMatrix.cells[0].inferred, 'mention');
assert.equal(aliasMatrix.cells[0].role, 'presence');

assert.equal(
  manuscriptHashFromWritingHashes(new Map([['a', '1'], ['b', '2']])),
  manuscriptHashFromWritingHashes(new Map([['b', '2'], ['a', '1']])),
);

console.log('PASS narrative-coverage honesty + board + muletillas tests');
