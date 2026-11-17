// Pure checks for the travel verifier and the state ledger (no database, no DOM).
import assert from 'node:assert/strict';
import { checkLedger, normalizeLedgerEntry, placeLedger, stateAt } from '@/engines/writings/continuity/ledger';
import { collectAppearances, judgeLeg, legsOf, seasonOfYearShare } from '@/engines/writings/continuity/travel';
import type { ChapterRef, LedgerEntry } from '@/engines/writings/continuity/types';
import type { StoryEvent } from '@/engines/worldgen/core/storyEvents';

const chapters: ChapterRef[] = [
  { writingId: 'w1', chapter: 1, title: 'One', start: 100, end: 100 },
  { writingId: 'w2', chapter: 2, title: 'Two', start: 102, end: 103 },
  { writingId: 'w3', chapter: 3, title: 'Three', start: 130, end: 130 },
  { writingId: 'w4', chapter: 4, title: 'Four', start: null, end: null },
];
let t = 0;
const line = (entry: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'writingId'>): LedgerEntry => normalizeLedgerEntry({ id: `l${++t}`, createdAt: t, ...entry });
const ev = (id: string, chapter: number, x: number, y: number, who: string[], order?: number): StoryEvent => ({ id, x, y, type: 'meeting', title: id, chapter, status: 'happened', who, ...(order !== undefined ? { order } : {}) });

export function runContinuityLogicTests(): string[] {
  const passed: string[] = [];

  // Appearances: events in chapter order; a ledger point only where no event names them.
  const ledgers = { ana: [line({ kind: 'location', writingId: 'w3', place: { label: 'Port', worldId: 'W', x: 50, y: 5 } }), line({ kind: 'location', writingId: 'w2', place: { label: 'Ignored', worldId: 'W', x: 1, y: 1 } })] };
  const apps = collectAppearances([{ worldId: 'W', events: [ev('b', 2, 10, 5, ['ana']), ev('a', 1, 0, 5, ['ana'])] }], ledgers, chapters).get('ana')!;
  assert.deepEqual(apps.map((a) => a.id), ['event:W:a', 'event:W:b', `ledger:${ledgers.ana[0].id}`]);
  passed.push('appearances follow chapter order and the ledger fills chapters without events');

  const legs = legsOf(apps);
  assert.equal(legs.length, 2);
  // Chapter 1 (day 100) → chapter 2 (ends day 103): 4 days counted.
  const impossible = judgeLeg('ana', legs[0].from, legs[0].to, chapters, { days: 6.2, km: 150 });
  assert.equal(impossible.availableDays, 4);
  assert.equal(impossible.verdict, 'impossible');
  // 6.2 days → arrive on the 7th day counted from day 100 → last day ≥ 106; chapter 2 lasts 2 days → start ≥ 105.
  assert.equal(impossible.minStart, 105);
  assert.equal(judgeLeg('ana', legs[0].from, legs[0].to, chapters, { days: 3.5, km: 90 }).verdict, 'tight');
  assert.equal(judgeLeg('ana', legs[0].from, legs[0].to, chapters, { days: 1, km: 30 }).verdict, 'comfortable');
  assert.equal(judgeLeg('ana', legs[0].from, legs[0].to, chapters, 'pending').reason, 'pending');
  assert.equal(judgeLeg('ana', legs[0].from, legs[0].to, chapters, { impossible: 'sea' }).reason, 'no-route');
  passed.push('legs are impossible, tight or comfortable against the calendar, with the earliest valid start');

  const undated = judgeLeg('ana', apps[2], { ...apps[2], id: 'x', writingId: 'w4', chapter: 4, x: 90 }, chapters, { days: 2, km: 50 });
  assert.equal(undated.verdict, 'unknown');
  assert.equal(undated.reason, 'undated');
  passed.push('an undated chapter gives no verdict');

  assert.equal(seasonOfYearShare(0.1), 'winter');
  assert.equal(seasonOfYearShare(0.6), 'summer');
  passed.push('seasons follow the quarters of the year');

  // Ledger: accumulate to chapter N.
  const sword = { itemId: 'sword' };
  const led = {
    ana: [
      line({ kind: 'gains', writingId: 'w1', ...sword }),
      line({ kind: 'learns', writingId: 'w2', fact: 'The king is dead' }),
      line({ kind: 'loses', writingId: 'w2', ...sword, toId: 'bo' }),
      line({ kind: 'condition', writingId: 'w2', text: 'Broken arm' }),
      line({ kind: 'actsOn', writingId: 'w1', fact: 'the king is  DEAD' }),
    ],
    bo: [
      line({ kind: 'uses', writingId: 'w3', ...sword }),
      line({ kind: 'dies', writingId: 'w3' }),
      line({ kind: 'appears', writingId: 'w4' }),
      line({ kind: 'uses', writingId: 'w1', item: 'Lantern' }),
      line({ kind: 'location', writingId: 'w1', place: { label: 'Inn' } }),
      line({ kind: 'location', writingId: 'w1', place: { label: 'Tower' } }),
    ],
  };
  const fourth = { ...chapters[3], chapter: 4 };
  const placed = placeLedger(led, [...chapters.slice(0, 3), fourth]);
  const ana1 = stateAt(placed, 'ana', 1), ana2 = stateAt(placed, 'ana', 2), bo2 = stateAt(placed, 'bo', 2), bo3 = stateAt(placed, 'bo', 3);
  assert.deepEqual(ana1.carries.map((c) => c.itemId), ['sword']);
  assert.deepEqual(ana2.carries, []);
  assert.equal(ana2.knows.length, 1);
  assert.equal(ana2.condition?.text, 'Broken arm');
  assert.deepEqual(bo2.carries.map((c) => c.itemId), ['sword']);
  assert.equal(bo3.alive, false);
  passed.push('state at a chapter accumulates every change up to it, gifts included');

  const findings = checkLedger(placed, [{ characterId: 'bo', chapter: 4, writingId: 'w4', lineId: 'event:W:z', label: 'z' }]);
  const kinds = findings.map((f) => `${f.characterId}:${f.kind}`).sort();
  assert.deepEqual(kinds, ['ana:knows-before-learning', 'bo:after-death', 'bo:after-death', 'bo:item-not-carried', 'bo:two-places']);
  passed.push('checks find objects not carried, life after death, knowledge before learning and two places at once');

  assert.throws(() => normalizeLedgerEntry({ id: 'x', writingId: 'w1', kind: 'location', place: { label: 'A', x: 1, y: 2 } }), /worldId/);
  assert.throws(() => normalizeLedgerEntry({ id: 'x', writingId: 'w1', kind: 'uses' }), /itemId/);
  passed.push('ledger lines are validated');
  return passed;
}
