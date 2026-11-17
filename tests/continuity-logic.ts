// Pure checks for the travel verifier and the state ledger (no database, no DOM).
import assert from 'node:assert/strict';
import { checkLedger, normalizeLedgerEntry, placeLedger, stateAt } from '@/engines/writings/continuity/ledger';
import { collectAppearances, judgeLeg, legsOf, seasonOfYearShare } from '@/engines/writings/continuity/travel';
import type { ChapterRef, LedgerEntry } from '@/engines/writings/continuity/types';
import type { StoryEvent } from '@/engines/worldgen/core/storyEvents';
import { remapIntentionalKey, remapIntentionalMarks, remapStoryEditsJson } from '@/engines/writings/continuity/duplicateKeys';
import { travelTimelineItems, VERDICT_COLORS, writingIdOfTimelineEvent } from '@/engines/writings/continuity/timelineLanes';
import { defaultWorldCalendar, seasonOfDate, validateWorldCalendar } from '@/engines/timeline/worldCalendar';

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

  const cycle = [
    line({ kind: 'dies', writingId: 'w1' }),
    line({ kind: 'revives', writingId: 'w2' }),
    line({ kind: 'dies', writingId: 'w3' }),
  ];
  const cycleLedger = placeLedger({ ana: cycle }, [...chapters.slice(0, 3), fourth]);
  const cycleFindings = checkLedger(cycleLedger, [
    { characterId: 'ana', chapter: 2, writingId: 'w2', lineId: 'alive-on-map', label: 'Harbour' },
    { characterId: 'ana', chapter: 4, writingId: 'w4', lineId: 'dead-on-map', label: 'Harbour' },
  ]);
  assert.deepEqual(cycleFindings.map((finding) => [finding.kind, finding.lineId, finding.otherLineId]), [
    ['after-death', 'dead-on-map', cycle[2].id],
  ]);
  passed.push('map presences check every death and revival against the chapter');

  const earlyAct = line({ kind: 'actsOn', writingId: 'w2', order: 0, fact: 'Password' });
  const lateLearning = line({ kind: 'learns', writingId: 'w2', order: 1, fact: 'Password' });
  const learningFindings = checkLedger(placeLedger({ ana: [lateLearning, earlyAct] }, chapters));
  assert.deepEqual(learningFindings.map((finding) => [finding.kind, finding.lineId, finding.otherLineId]), [
    ['knows-before-learning', earlyAct.id, lateLearning.id],
  ]);
  assert.deepEqual(checkLedger(placeLedger({ ana: [
    earlyAct, lateLearning, line({ kind: 'learns', writingId: 'w2', fact: 'Password' }),
  ] }, chapters)), []);
  assert.deepEqual(checkLedger(placeLedger({ ana: [
    { ...earlyAct, order: 1 }, lateLearning,
  ] }, chapters)), []);
  passed.push('knowledge checks explicit order within the chapter and leaves ambiguous order unresolved');

  assert.throws(() => normalizeLedgerEntry({ id: 'x', writingId: 'w1', kind: 'location', place: { label: 'A', x: 1, y: 2 } }), /worldId/);
  assert.throws(() => normalizeLedgerEntry({ id: 'x', writingId: 'w1', kind: 'uses' }), /itemId/);
  passed.push('ledger lines are validated');

  // Duplicating a project: intended marks and story events follow the new ids.
  const ids = { world: (id: string) => ({ W: 'W2' } as Record<string, string>)[id], codex: (id: string) => ({ ana: 'ana2', bo: 'bo2' } as Record<string, string>)[id], writing: (id: string) => ({ w1: 'w1b' } as Record<string, string>)[id] };
  assert.equal(remapIntentionalKey('event:W:a>event:W:b', ids), 'event:W2:a>event:W2:b');
  assert.equal(remapIntentionalKey('event:W:a>ledger:sl-1', ids), 'event:W2:a>ledger:sl-1');
  assert.equal(remapIntentionalKey('after-death:bo:event:W:z', ids), 'after-death:bo2:event:W2:z');
  assert.equal(remapIntentionalKey('two-places:ana:sl-1:sl-2', ids), 'two-places:ana2:sl-1:sl-2');
  assert.equal(remapIntentionalKey('item-not-carried:other:sl-9', ids), 'item-not-carried:other:sl-9');
  assert.deepEqual(remapIntentionalMarks({ 'event:W:a>event:W:b': 'magic' }, ids), { 'event:W2:a>event:W2:b': 'magic' });
  const v2 = JSON.stringify({ v: 2, edits: [{ kind: 'story', id: 'a', who: ['ana', 'x'], writingId: 'w1' }, { kind: 'river', pts: [] }] });
  assert.deepEqual(JSON.parse(remapStoryEditsJson(v2, ids)).edits[0], { kind: 'story', id: 'a', who: ['ana2', 'x'], writingId: 'w1b' });
  const v3 = JSON.stringify({ v: 3, legacy: { json: v2, count: 2 }, steps: [{ kind: 'edit', edit: { kind: 'story', id: 'b', who: ['bo'] } }] });
  const v3out = JSON.parse(remapStoryEditsJson(v3, ids));
  assert.deepEqual(JSON.parse(v3out.legacy.json).edits[0].who, ['ana2', 'x']);
  assert.deepEqual(v3out.steps[0].edit.who, ['bo2']);
  assert.equal(remapStoryEditsJson('[{"kind":"river"}]', ids), '[{"kind":"river"}]');
  passed.push('duplicate remaps the ids inside intended marks and story events');

  // Seasons: quarters by default, months, hemisphere and none.
  const cal = defaultWorldCalendar();
  assert.equal(seasonOfDate(cal, { year: 1, month: 1, day: 1 }), 'winter');
  assert.equal(seasonOfDate(cal, { year: 1, month: 7, day: 10 }), 'summer');
  const byMonth = { ...cal, seasons: { mode: 'months' as const, starts: { winter: 12, spring: 3, summer: 6, autumn: 9 } } };
  assert.deepEqual(validateWorldCalendar(byMonth), []);
  assert.equal(seasonOfDate(byMonth, { year: 1, month: 1, day: 5 }), 'winter');
  assert.equal(seasonOfDate(byMonth, { year: 1, month: 3, day: 1 }), 'spring');
  assert.equal(seasonOfDate(byMonth, { year: 1, month: 12, day: 1 }), 'winter');
  assert.equal(seasonOfDate({ ...byMonth, seasons: { ...byMonth.seasons, hemisphere: 'south' } }, { year: 1, month: 7, day: 1 }), 'winter');
  assert.equal(seasonOfDate({ ...cal, seasons: { mode: 'none' } }, { year: 1, month: 7, day: 1 }), null);
  assert.ok(validateWorldCalendar({ ...cal, seasons: { mode: 'months', starts: { winter: 1, spring: 1, summer: 6, autumn: 9 } } }).length > 0);
  // Unequal months: the quarters follow the days (90/10/10/10: the first day of month 2 is 75 % into the year).
  const lopsided = { ...cal, months: [{ name: 'Long', days: 90 }, { name: 'B', days: 10 }, { name: 'C', days: 10 }, { name: 'D', days: 10 }] };
  assert.equal(seasonOfDate(lopsided, { year: 1, month: 2, day: 1 }), 'autumn');
  assert.equal(seasonOfDate(lopsided, { year: 1, month: 1, day: 40 }), 'spring');
  passed.push('the season of a date follows the calendar settings');

  // Timeline lanes: one per traveller, a band per dated leg, coloured by verdict.
  const lanes = travelTimelineItems(cal, [{ ...judgeLeg('ana', apps[0], apps[1], [{ writingId: 'w1', chapter: 1, title: 'One', start: 0, end: 0 }, { writingId: 'w2', chapter: 2, title: 'Two', start: 2, end: 3 }], { days: 10, km: 100 }) }],
    [{ writingId: 'w1', chapter: 1, title: 'One', start: 0, end: 0 }, { writingId: 'w2', chapter: 2, title: 'Two', start: 2, end: 3 }], { ana: 'Ana' }, 'p', { lane: (n) => `Travel ${n}`, verdict: (v) => v, intended: 'Intended' });
  assert.equal(lanes.lanes.length, 1);
  assert.equal(lanes.lanes[0].title, 'Travel Ana');
  assert.equal(lanes.events[0].color, VERDICT_COLORS.impossible);
  assert.equal(writingIdOfTimelineEvent(lanes.events[0].id), 'w2');
  passed.push('travel legs become timeline bands that open the destination chapter');
  return passed;
}
