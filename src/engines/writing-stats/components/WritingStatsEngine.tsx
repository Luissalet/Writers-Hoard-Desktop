import { useState, useCallback } from 'react';
import { Play, Settings, Flame } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useWritingSessions, useWritingGoals, useWritingStats } from '../hooks';
import type { WritingGoal } from '../types';
import type { WritingSession } from '../types';
import SprintTimer from './SprintTimer';
import ProgressChart from './ProgressChart';
import GoalSetter from './GoalSetter';
import SessionCard from './SessionCard';
import SprintHistory from './SprintHistory';
import { getGoal } from '../operations';

// ============================================================================
// WritingStatsEngine
// ============================================================================

export default function WritingStatsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
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

  const stats = useWritingStats(sessions);

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
      if (await getGoal(goal.id)) {
        // Update existing
        await editGoal(goal.id, goal);
      } else {
        // Create new
        await addGoal(goal);
      }
    },
    [addGoal, editGoal]
  );

  const loading = sessionsLoading || goalsLoading;

  if (loading) return <EngineSpinner />;

  // Upcoming deadline info
  const deadlineInfo = deadlineGoal
    ? (() => {
        const deadline = new Date(deadlineGoal.deadline + 'T23:59:59');
        const now = new Date();
        const rawDays = Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const daysLeft = rawDays === 0 ? 0 : rawDays;
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
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h2 className="text-2xl font-bold text-text-primary">{t('stats.today')}</h2>

        <div className="space-y-3">
          {/* Word Count Hero */}
          <div className="bg-gradient-to-br from-accent-gold/10 to-accent-gold/5 border-2 border-accent-gold/30 rounded-lg p-6 text-center">
            <div className="text-sm font-medium text-text-muted mb-1">{t('stats.wordsWrittenToday')}</div>
            <div className="text-5xl font-bold text-accent-gold">{stats.todayWords}</div>
            {dailyGoalTarget > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-text-muted">
                  <span>{t('stats.goal')} {dailyGoalTarget}</span>
                  <span>{Math.min(100, Math.round(todayProgress))}%</span>
                </div>
                <div className="h-2 bg-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-gold transition-[width] duration-500"
                    style={{ width: `${Math.min(100, todayProgress)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Time & Streak Stats.
              Same card as a session row and a sprint row: `bg-elevated` on the
              panel's `bg-surface`, one `border-border` hairline, the app's own
              text tokens. Only the flame carries a colour, and it carries one
              of ours. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-elevated border border-border rounded-lg p-3 text-center">
              <div className="text-xs font-medium text-text-muted mb-1">{t('stats.timeSpent')}</div>
              <div className="text-2xl font-bold text-text-primary">
                {Math.floor(stats.todayTime / 3600)}h {Math.floor((stats.todayTime % 3600) / 60)}m
              </div>
            </div>
            <div className="bg-elevated border border-border rounded-lg p-3 text-center">
              <div className="text-xs font-medium text-text-muted mb-1">{t('stats.streak')}</div>
              <div className="text-2xl font-bold text-text-primary flex items-center justify-center gap-1">
                <Flame size={24} className="text-accent-amber" />
                {stats.streak}
              </div>
            </div>
          </div>

          {/* Start Sprint Button */}
          <button
            onClick={() => setSprintActive(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-gold/90 transition-colors"
          >
            <Play size={20} />
            {t('stats.startSprint')}
          </button>
        </div>
      </div>

      {/* =====================================================================
          SECTION 2: SPRINT TIMER (when active)
          ===================================================================== */}
      {sprintActive && (
        <div className="bg-surface border border-border rounded-lg p-6">
          <h2 className="text-xl font-bold text-text-primary mb-4">{t('stats.focusSession')}</h2>
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
      <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">{t('stats.last7Days')}</h2>
          <button
            onClick={() => setGoalSettingOpen(true)}
            className="flex items-center gap-2 px-3 py-1 text-sm font-medium text-text-muted bg-elevated rounded-lg hover:bg-border transition-colors"
          >
            <Settings size={16} />
            {t('stats.goals')}
          </button>
        </div>

        <ProgressChart stats={stats} dailyGoal={dailyGoalTarget} />

        {/* Goal Info Cards */}
        {(projectGoal || deadlineGoal) && (
          <div className="space-y-2 pt-4 border-t border-border">
            {projectGoal && (
              <div className="bg-accent-plum/10 border border-accent-plum/30 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <div className="text-xs font-medium text-accent-plum-light">{t('stats.projectGoal')}</div>
                  <div className="text-sm font-semibold text-text-primary">
                    {stats.totalWords.toLocaleString()} / {projectGoal.targetWords.toLocaleString()} words
                  </div>
                </div>
                <div className="w-12 h-12 flex items-center justify-center bg-accent-plum/20 rounded-lg">
                  <div className="text-xs font-bold text-accent-plum-light">
                    {Math.round((stats.totalWords / projectGoal.targetWords) * 100)}%
                  </div>
                </div>
              </div>
            )}
            {deadlineGoal && deadlineInfo && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <div className="text-xs font-medium text-warning">{t('stats.deadlineGoal')}</div>
                  <div className="text-sm font-semibold text-text-primary">
                    {deadlineGoal.targetWords.toLocaleString()} words by{' '}
                    {new Date(deadlineGoal.deadline + 'T00:00:00').toLocaleDateString()}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
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
        <div className="bg-surface border border-border rounded-lg p-6 space-y-3">
          <h2 className="text-lg font-bold text-text-primary">{t('stats.recentSessions')}</h2>
          {recentSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}

      {/* =====================================================================
          SECTION 5: SPRINT LOG
          Timed sprints started from the manuscript editor. They are kept in
          the settings store rather than `writingSessions`, because the words
          they measure are already counted for the day by the editor itself —
          filing them as sessions too would count every sprint twice.
          ===================================================================== */}
      <SprintHistory projectId={projectId} />

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
