import { useMemo } from 'react';
import { makeEntityHook, makeReadOnlyHook } from '@/engines/_shared';
import * as ops from './operations';
import { listSprints } from './sprints';
import type { SprintRecord, WritingSession, WritingGoal, WritingStatsData } from './types';
import { shiftLocalDateKey, toLocalDateKey } from './date';

// ============================================================================
// WritingSession Hook
// ============================================================================

export const useWritingSessions = makeEntityHook<WritingSession>({
  fetchFn: ops.getSessions,
  createFn: ops.createSession,
  updateFn: ops.updateSession,
  deleteFn: ops.deleteSession,
});

// ============================================================================
// WritingGoal Hook
// ============================================================================

export const useWritingGoals = makeEntityHook<WritingGoal>({
  fetchFn: ops.getGoals,
  createFn: ops.createGoal,
  updateFn: ops.updateGoal,
  deleteFn: ops.deleteGoal,
});

// ============================================================================
// Sprint Log Hook (read-only — sprints live in `settings`, not a table)
// ============================================================================
//
// Read-only rather than `makeEntityHook`: the sprint log is a single settings
// payload written by ./sprints.ts, so there is no per-row CRUD to expose. It
// still refreshes on `notifyDataChanged`, which `endSprint` fires — that is
// how a sprint filed in the writings editor shows up here without a remount.

export const useSprintLog = makeReadOnlyHook<SprintRecord>({
  fetchFn: listSprints,
});

// ============================================================================
// Writing Stats Hook (computed statistics)
// ============================================================================

/**
 * Derived from the caller's session list rather than a hook instance of its
 * own. It used to call `useWritingSessions` itself, so the engine held TWO
 * independent copies of the table: finishing a sprint refreshed the one behind
 * "Recent sessions" while today's words, the streak and the 7-day chart kept
 * reading the other, stale copy until the tab was remounted.
 */
export function useWritingStats(sessions: WritingSession[]): WritingStatsData {
  return useMemo(() => {
    const today = toLocalDateKey();

    // Today's stats
    const todaySessions = sessions.filter((s) => s.date === today);
    const todayWords = todaySessions.reduce((sum, s) => sum + s.wordCount, 0);
    const todayTime = todaySessions.reduce((sum, s) => sum + s.duration, 0);

    // All-time totals
    const totalWords = sessions.reduce((sum, s) => sum + s.wordCount, 0);

    // Average daily (only count days with writing)
    const daysWithWriting = new Set(sessions.map((s) => s.date));
    const averageDaily = daysWithWriting.size > 0 ? Math.round(totalWords / daysWithWriting.size) : 0;

    // Streak: consecutive days backwards from today
    let streak = 0;
    let checkDate = today;
    const sessionDates = new Set(sessions.map((s) => s.date));
    while (sessionDates.has(checkDate)) {
      streak++;
      checkDate = shiftLocalDateKey(checkDate, -1);
    }

    // Last 7 days breakdown
    const last7Days: Array<{ date: string; words: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dateStr = shiftLocalDateKey(today, -i);
      const dayWords = sessions
        .filter((s) => s.date === dateStr)
        .reduce((sum, s) => sum + s.wordCount, 0);
      last7Days.push({ date: dateStr, words: dayWords });
    }

    return {
      todayWords,
      todayTime,
      streak,
      totalWords,
      averageDaily,
      last7Days,
    };
  }, [sessions]);
}
