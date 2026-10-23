import { db } from '@/db';
import type { Project, Timeline, TimelineEvent } from '@/types';
import { defaultWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { redatePlan } from '@/engines/timeline/redate';
import { calendarMonth, daysBetween, stepMonth } from '@/engines/timeline/calendarGrid';
import { saveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The calendar grid's arithmetic, and events re-dated when the calendar changes. */
export async function testTimelineRedate(): Promise<string[]> {
  const P = 'synthetic-timeline-redate', T = 'synthetic-timeline-redate-t';
  const calendar = (months: number, days: number, hours = 24): WorldCalendar => ({ ...defaultWorldCalendar('Mundo'), hoursPerDay: hours, months: Array.from({ length: months }, (_, i) => ({ name: ['Brote', 'Siega', 'Escarcha', 'Niebla'][i], days })), weekdays: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'], eras: [{ name: 'Era Nueva', abbr: 'EN', startYear: 1 }], moons: [], holidays: [{ name: 'Fiesta', month: 1, day: 2 }] });
  const big = calendar(4, 30), small = calendar(3, 28, 20);
  // ---- the grid ----------------------------------------------------------------------------
  const grid = calendarMonth(big, 'world', 3, 1, []);
  assert(grid.days.length === 30 && grid.days[1].holidays.join() === 'Fiesta' && grid.lead === big.weekdays.indexOf(grid.days[0].weekday!), 'A month with its holiday and lead');
  assert(JSON.stringify(stepMonth(big, { year: 3, month: 4 }, 1)) === '{"year":4,"month":1}' && daysBetween(big, { year: 1, month: 1, day: 1 }, { year: 2, month: 1, day: 1 }) === 120, 'Steps and days between');
  const passed = ['Calendar grid on a world calendar: a month in weeks with its holidays, steps across years, days between two dates'];
  // ---- the plan -----------------------------------------------------------------------------
  const ev = (id: string, extra: Partial<TimelineEvent>): TimelineEvent => ({ id, projectId: P, timelineId: T, title: id, description: '', date: id, dateMode: 'world', eventType: 'point', order: 0, lane: '', color: '#aa5533', createdAt: 1, updatedAt: 1, ...extra });
  const events = [ev('fits', { worldDate: { year: 3, month: 2, day: 10 } }), ev('day30', { worldDate: { year: 3, month: 1, day: 30 } }), ev('month4', { worldDate: { year: 3, month: 4, day: 5 }, worldDateEnd: { year: 3, month: 4, day: 9 } }), ev('late', { worldDate: { year: 3, month: 2, day: 3 }, time: '22:30' })];
  const plan = redatePlan(events, small);
  const by = Object.fromEntries(plan.map(change => [change.id, change.changes]));
  assert(plan.length === 3 && !by.fits, `Only what no longer fits: ${plan.map(c => c.id)}`);
  assert(JSON.stringify(by.day30.worldDate) === '{"year":3,"month":1,"day":28}', `Day past the end: ${JSON.stringify(by.day30)}`);
  assert(by.month4.worldDate?.month === 3 && by.month4.worldDate.day === 5 && by.month4.worldDateEnd?.day === 9, `Removed month: ${JSON.stringify(by.month4)}`);
  assert(by.late.time === '19:30', `Hour past the day: ${JSON.stringify(by.late)}`);
  passed.push('Re-date plan: with 3 months of 28 days and 20 hours, the 30th moves to the 28th, a date in the removed 4th month to the 3rd, 22:30 to 19:30; dates that still fit stay');
  // ---- the bridge ---------------------------------------------------------------------------
  try {
    await db.projects.put({ id: P, title: 'Re-fechar', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await saveWorldCalendar(P, big);
    await db.timelines.put({ id: T, projectId: P, title: 'Crónica', color: '#aa5533', createdAt: 1, updatedAt: 1 } satisfies Timeline);
    for (const row of events) await db.timelineEvents.put(row);
    const refused = await runBridgeTool('wh_world_calendar_set', { projectId: P, calendar: small });
    assert(!refused.ok && /would fall on dates/.test(refused.error ?? ''), `Refused without redate: ${JSON.stringify(refused).slice(0, 200)}`);
    const moved = await runBridgeTool('wh_world_calendar_set', { projectId: P, calendar: small, redate: true });
    assert(moved.ok, JSON.stringify(moved).slice(0, 300));
    const redated = (moved.result as { redated: Array<{ title: string; to: string }> }).redated;
    assert(redated.length === 3, `Moves returned: ${JSON.stringify(redated)}`);
    const stored = (id: string) => db.timelineEvents.get(id);
    assert((await stored('day30'))?.worldDate?.day === 28 && (await stored('month4'))?.worldDate?.month === 3 && (await stored('late'))?.time === '19:30' && (await stored('fits'))?.worldDate?.day === 10, 'Stored moved');
    assert(/28 Brote 3 EN/.test((await stored('day30'))!.date), `Label: ${(await stored('day30'))!.date}`);
    passed.push('Bridge: wh_world_calendar_set refuses a calendar that would strand events, and with redate:true moves them (returned as from → to, labels rewritten) and leaves the rest');
    const { undoAuditEntry } = await import('@/services/aiBridge/undo');
    await undoAuditEntry({ entry: { ...(moved.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_world_calendar_set', kind: 'update' } });
    const { resolveWorldCalendar } = await import('@/engines/timeline/worldCalendarStore');
    assert((await stored('day30'))?.worldDate?.day === 30 && (await stored('month4'))?.worldDate?.month === 4 && (await stored('late'))?.time === '22:30' && (await resolveWorldCalendar(P))?.calendar.months.length === big.months.length, 'Undo puts the calendar and the moved events back');
    passed.push('Undo of a re-dating save puts back the calendar and every moved event (30th, the 4th month, 22:30)');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
