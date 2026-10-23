// ============================================
// AI bridge — writing sprints and their rounds
// ============================================
// The sprint log as the writings toolbar and the Statistics engine keep it,
// read only: a sprint is timed by the person at the desk, so the bridge does
// not start or stop one.

import {
  breakMinutesAfter,
  listSprints,
  readActiveSprint,
  roundsToday,
  summarizeSprints,
} from '@/engines/writing-stats/sprints';
import { resolveProjectId, type ToolArgs } from './shared';

/** Recent sprints, today's rounds and the break the next one earns, and the sprint running now. */
export async function whSprintLog(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(100, Math.floor(args.limit))) : 20;
  const [sprints, active] = await Promise.all([listSprints(projectId), readActiveSprint(projectId)]);
  const rounds = roundsToday(sprints);
  const totals = summarizeSprints(sprints);
  return {
    projectId,
    roundsToday: rounds,
    // The break a sprint run to the end now would earn.
    nextBreakMinutes: breakMinutesAfter(rounds + 1),
    thisWeek: totals.thisWeek,
    bestWords: totals.bestWords,
    running: active ? { startedAt: active.startedAt, endsAt: active.endsAt, targetWords: active.targetWords, writingId: active.writingId ?? null, paused: active.pausedAt !== undefined, remainingMs: Math.max(0, active.endsAt - (active.pausedAt ?? Date.now())) } : null,
    sprints: sprints.slice(0, limit).map((s) => ({
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      minutes: Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000)),
      words: s.actualWords,
      targetWords: s.targetWords,
      stopped: !!s.stopped,
      writingId: s.writingId ?? null,
    })),
    total: sprints.length,
  };
}
