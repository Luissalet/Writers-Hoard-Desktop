import { useMemo } from 'react';
import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { WritingSession, WritingGoal, WritingStatsData } from './types';

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
// Writing Stats Hook (computed statistics)
// ============================================================================

export function useWritingStats(projectId: string): WritingStatsData {
  const { items: sessions } = useWritingSessions(projectId);

  return useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayStart = new Date(today);
    const last7Start = new Date(todayStart);
    last7Start.setDate(last7Start.getDate() - 6);

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
    const checkDate = new Date(today);
    const sessionDates = new Set(sessions.map((s) => s.date));
    while (sessionDates.has(checkDate.toISOString().split('T')[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Last 7 days breakdown
    const last7Days: Array<{ date: string; words: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(todayStart);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
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
