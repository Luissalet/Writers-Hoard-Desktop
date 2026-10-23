import { db } from '@/db';
import { beginSprint, beginSprintBreak, breakMinutesAfter, endSprint, endSprintBreak, peekSprintBreak, roundsToday } from '@/engines/writing-stats/sprints';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { SprintRecord } from '@/engines/writing-stats/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Sprints in rounds: which count, how long the break after each is, and the break kept for the session. */
export async function testSprintRounds(): Promise<string[]> {
  const now = new Date(2026, 9, 22, 18, 0).getTime(), hour = 3_600_000;
  const row = (endedAt: number, stopped = false): SprintRecord => ({ id: String(endedAt), projectId: 'p', startedAt: endedAt - 25 * 60_000, endedAt, targetWords: 0, actualWords: 100, ...(stopped ? { stopped: true as const } : {}) });
  const log = [row(now - hour), row(now - 2 * hour), row(now - 3 * hour, true), row(now - 30 * hour)];
  assert(roundsToday(log, now) === 2, `Two rounds today: ${roundsToday(log, now)}`);
  assert(roundsToday([], now) === 0, 'None on an empty log');
  const lengths = [1, 2, 3, 4, 5, 8].map(breakMinutesAfter);
  assert(lengths.join() === '5,5,5,15,5,15', `Breaks: ${lengths.join()}`);
  const rest = beginSprintBreak('p', 4, now);
  assert(rest.minutes === 15 && rest.endsAt === now + 15 * 60_000 && rest.round === 4, `Long break: ${JSON.stringify(rest)}`);
  assert(peekSprintBreak('p', now + 60_000)?.round === 4, 'Kept while it runs');
  assert(peekSprintBreak('other', now) === null, 'Per project');
  assert(peekSprintBreak('p', now + 16 * 60_000) === null && peekSprintBreak('p', now) === null, 'Gone once over');
  beginSprintBreak('p', 1, now); endSprintBreak('p');
  assert(peekSprintBreak('p', now) === null, 'Skipped');
  // ---- the bridge -------------------------------------------------------------
  const P = 'synthetic-sprint-rounds';
  try {
    await db.projects.put({ id: P, title: 'Rondas', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 });
    for (const [words, stopped] of [[400, false], [250, false], [90, true]] as const) {
      const sprint = await beginSprint({ projectId: P, durationMinutes: 25, targetWords: 300, baselineWords: 0 });
      // Completed fixtures ended at the observed start instant; their scheduled
      // end must not be 25 minutes in the future (possibly tomorrow).
      const finished = stopped ? sprint : { ...sprint, startedAt: sprint.startedAt - 25 * 60_000, endsAt: sprint.startedAt };
      await endSprint(finished, { words, stopped });
    }
    const reply = await runBridgeTool('wh_sprint_log', { projectId: P, limit: 2 });
    const out = reply.result as { roundsToday: number; nextBreakMinutes: number; bestWords: number; sprints: Array<{ words: number; stopped: boolean }>; total: number; running: unknown };
    assert(reply.ok && out.roundsToday === 2 && out.nextBreakMinutes === 5 && out.bestWords === 400 && out.total === 3 && out.sprints.length === 2 && out.sprints[0].stopped && out.running === null, `wh_sprint_log: ${JSON.stringify(reply).slice(0, 400)}`);
  } finally {
    for (const key of [`writingStats.sprintLog.${P}`, `writingStats.activeSprint.${P}`]) await db.settings.where('key').equals(key).delete();
    await db.projects.delete(P);
  }
  return [
    'Bridge: wh_sprint_log gives today\'s rounds (a stopped sprint is not one), the break the next round earns, the best sprint, the sprint running now and the recent log, newest first',
    'Rounds today: sprints run to the end today (a stopped one or yesterday\'s does not count)',
    'A 5-minute break after each round and a 15-minute one after every fourth; a break is kept per project while it runs, and is gone once over or skipped',
  ];
}
