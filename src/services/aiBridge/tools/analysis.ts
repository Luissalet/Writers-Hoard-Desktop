// ============================================================================
// AI bridge tools — derived reports
// ============================================================================
//
// Both are read-only, and writing-stats deliberately so: the app writes those
// sessions itself as the writer types, keying an auto-row on
// (projectId, date, 'freewrite', notes:'editor'). An outside write landing on
// that tuple is absorbed or deleted by the next autosave flush, and a row with
// a differently-formatted date silently breaks the streak. Reading is safe;
// writing is not worth the risk.

import { computeUsage } from '@/engines/pov-audit/operations';
import { getActiveGoals, getSessions } from '@/engines/writing-stats/operations';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { resolveProjectId, type ToolArgs } from './shared';

export async function whPovAudit(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const report = await computeUsage(projectId);
  return {
    projectId,
    totals: report.totals,
    characters: report.rows.map((row) => ({
      characterId: row.characterId,
      name: row.characterName,
      scenes: row.sceneCount,
      lines: row.lineCount,
      words: row.wordCount,
      // In the codex but never on the page.
      unused: row.isUnused,
      // On the page but never in the codex.
      unmapped: row.isUnmapped,
    })),
    hint:
      'unused = a character the writer created and never used. unmapped = a speaker on the page with no codex entry, often a typo in a name.',
  };
}

export async function whWritingStats(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const [sessions, goals] = await Promise.all([getSessions(projectId), getActiveGoals(projectId)]);

  const today = toLocalDateKey();
  const byDay = new Map<string, number>();
  for (const session of sessions) {
    byDay.set(session.date, (byDay.get(session.date) ?? 0) + session.wordCount);
  }

  // Streak: consecutive days with words, walking back from today.
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = toLocalDateKey(cursor);
    if (!(byDay.get(key) ?? 0)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const last7: Array<{ date: string; words: number }> = [];
  const walk = new Date();
  for (let i = 0; i < 7; i += 1) {
    const key = toLocalDateKey(walk);
    last7.unshift({ date: key, words: byDay.get(key) ?? 0 });
    walk.setDate(walk.getDate() - 1);
  }

  const totalWords = sessions.reduce((sum, session) => sum + session.wordCount, 0);
  return {
    projectId,
    todayWords: byDay.get(today) ?? 0,
    todaySeconds: sessions
      .filter((session) => session.date === today)
      .reduce((sum, session) => sum + session.duration, 0),
    streakDays: streak,
    totalWords,
    daysWritten: byDay.size,
    averagePerWritingDay: byDay.size ? Math.round(totalWords / byDay.size) : 0,
    last7Days: last7,
    goals: goals.map((goal) => ({
      id: goal.id,
      type: goal.type,
      targetWords: goal.targetWords,
      deadline: goal.deadline,
    })),
  };
}
