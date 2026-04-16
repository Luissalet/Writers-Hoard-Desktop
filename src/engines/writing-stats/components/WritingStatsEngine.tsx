import { useState, useCallback } from 'react';
import { Play, Settings, Flame } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useWritingSessions, useWritingGoals, useWritingStats } from '../hooks';
import type { WritingGoal } from '../types';
import type { WritingSession } from '../types';
import SprintTimer from './SprintTimer';
import ProgressChart from './ProgressChart';
import GoalSetter from './GoalSetter';
import SessionCard from './SessionCard';
import { generateId } from '@/utils/idGenerator';

// ============================================================================
// WritingStatsEngine
// ============================================================================

export default function WritingStatsEngine({ projectId }: EngineComponentProps) {
  const {
    items: sessions,
    loading: sessionsLoading,
    addItem: addSession,
  } = useWritingSessions(projectId);

  const {
    items: goals,
    loading: goalsLoading,
    editItem: editGoal,
    addItem: addGoal,
  } = useWritingGoals(projectId);

  const stats = useWritingStats(projectId);

  const [sprintActive, setSprintActive] = useState(false);
  const [goalSettingOpen, setGoalSettingOpen] = useState(false);

  const dailyGoal = goals.find((g) => g.type === 'daily' && g.active);
  const projectGoal = goals.find((g) => g.type === 'project' && g.active);
  const deadlineGoal = goals.find((g) => g.type === 'deadline' && g.active);

  const handleSprintComplete = useCallback(
    async (session: WritingSession) => {
      await addSession(session);
      setSprintActive(false);
    },
    [addSession]
  );

  const handleGoalSave = useCallback(
    async (goal: WritingGoal) => {
      if (goal.id && goals.find((g) => g.id === goal.id)) {
        // Update existing
        await editGoal(goal.id, goal);
      } else {
        // Create new
        goal.id = generateId('goal');
        await addGoal(goal);
      }
    },
    [goals, addGoal, editGoal]
  );

  const loading = sessionsLoading || goalsLoading;

  if (loading) return <EngineSpinner />;

  // Upcoming deadline info
  const deadlineInfo = deadlineGoal
    ? (() => {
        const deadline = new Date(deadlineGoal.deadline + 'T23:59:59');
        const now = new Date();
        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return { daysLeft, target: deadlineGoal.targetWords };
      })()
    : null;

  const recentSessions = sessions.slice(0, 5);
  const dailyGoalTarget = dailyGoal?.targetWords || 0;
  const todayProgress = dailyGoalTarget > 0 ? (stats.todayWords / dailyGoalTarget) * 100 : 0;

  return (
    <div className="space-y-6 pb-6">
      {/* =====================================================================
          SECTION 1: TODAY'S DASHBOARD
          ===================================================================== */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Today</h2>

        <div className="space-y-3">
          {/* Word Count Hero */}
          <div className="bg-gradient-to-br from-accent-gold/10 to-accent-gold/5 border-2 border-accent-gold/30 rounded-lg p-6 text-center">
            <div className="text-sm font-medium text-gray-600 mb-1">Words Written Today</div>
            <div className="text-5xl font-bold text-accent-gold">{stats.todayWords}</div>
            {dailyGoalTarget > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-gray-600">
                  <span>Goal: {dailyGoalTarget}</span>
                  <span>{Math.min(100, Math.round(todayProgress))}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-gold transition-all duration-500"
                    style={{ width: `${Math.min(100, todayProgress)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Time & Streak Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <div className="text-xs font-medium text-blue-600 mb-1">Time Spent</div>
              <div className="text-2xl font-bold text-blue-900">
                {Math.floor(stats.todayTime / 3600)}h {Math.floor((stats.todayTime % 3600) / 60)}m
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <div className="text-xs font-medium text-red-600 mb-1">Streak</div>
              <div className="text-2xl font-bold text-red-900 flex items-center justify-center gap-1">
                <Flame size={24} />
                {stats.streak}
              </div>
            </div>
          </div>

          {/* Start Sprint Button */}
          <button
            onClick={() => setSprintActive(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-gold text-black font-semibold rounded-lg hover:bg-accent-gold/90 transition-colors"
          >
            <Play size={20} />
            Start Sprint
          </button>
        </div>
      </div>

      {/* =====================================================================
          SECTION 2: SPRINT TIMER (when active)
          ===================================================================== */}
      {sprintActive && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Focus Session</h2>
          <SprintTimer
            projectId={projectId}
            onComplete={handleSprintComplete}
            onCancel={() => setSprintActive(false)}
          />
        </div>
      )}

      {/* =====================================================================
          SECTION 3: PROGRESS OVERVIEW
          ===================================================================== */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Last 7 Days</h2>
          <button
            onClick={() => setGoalSettingOpen(true)}
            className="flex items-center gap-2 px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Settings size={16} />
            Goals
          </button>
        </div>

        <ProgressChart stats={stats} dailyGoal={dailyGoalTarget} />

        {/* Goal Info Cards */}
        {(projectGoal || deadlineGoal) && (
          <div className="space-y-2 pt-4 border-t border-gray-200">
            {projectGoal && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <div className="text-xs font-medium text-purple-600">Project Goal</div>
                  <div className="text-sm font-semibold text-purple-900">
                    {stats.totalWords.toLocaleString()} / {projectGoal.targetWords.toLocaleString()} words
                  </div>
                </div>
                <div className="w-12 h-12 flex items-center justify-center bg-purple-100 rounded-lg">
                  <div className="text-xs font-bold text-purple-900">
                    {Math.round((stats.totalWords / projectGoal.targetWords) * 100)}%
                  </div>
                </div>
              </div>
            )}
            {deadlineGoal && deadlineInfo && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <div className="text-xs font-medium text-orange-600">Deadline Goal</div>
                  <div className="text-sm font-semibold text-orange-900">
                    {deadlineGoal.targetWords.toLocaleString()} words by{' '}
                    {new Date(deadlineGoal.deadline + 'T00:00:00').toLocaleDateString()}
                  </div>
                  <div className="text-xs text-orange-700 mt-1">
                    {deadlineInfo.daysLeft > 0
                      ? `${deadlineInfo.daysLeft} days left`
                      : deadlineInfo.daysLeft === 0
                        ? 'Due today!'
                        : `${Math.abs(deadlineInfo.daysLeft)} days overdue`}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =====================================================================
          SECTION 4: RECENT SESSIONS
          ===================================================================== */}
      {recentSessions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Recent Sessions</h2>
          {recentSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}

      {/* =====================================================================
          Goal Setter Modal
          ===================================================================== */}
      {goalSettingOpen && (
        <GoalSetter
          goals={goals}
          projectId={projectId}
          onSave={handleGoalSave}
          onClose={() => setGoalSettingOpen(false)}
        />
      )}
    </div>
  );
}
