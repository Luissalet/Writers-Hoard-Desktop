import { useState, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import type { WritingGoal } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface GoalSetterProps {
  goals: WritingGoal[];
  onSave: (goal: WritingGoal) => Promise<void>;
  onClose: () => void;
  projectId: string;
}

export default function GoalSetter({ goals, onSave, onClose, projectId }: GoalSetterProps) {
  const { t } = useTranslation();
  // Find active goals by type
  const dailyGoal = goals.find((g) => g.type === 'daily' && g.active);
  const projectGoal = goals.find((g) => g.type === 'project' && g.active);
  const deadlineGoal = goals.find((g) => g.type === 'deadline' && g.active);

  // Form state
  const [dailyTarget, setDailyTarget] = useState(dailyGoal?.targetWords.toString() || '');
  const [projectTarget, setProjectTarget] = useState(projectGoal?.targetWords.toString() || '');
  const [deadlineTarget, setDeadlineTarget] = useState(deadlineGoal?.targetWords.toString() || '');
  const [deadlineDate, setDeadlineDate] = useState(deadlineGoal?.deadline || '');

  const handleSave = useCallback(async () => {
    // Daily goal
    if (dailyTarget.trim()) {
      const words = parseInt(dailyTarget, 10);
      if (!isNaN(words)) {
        const goal: WritingGoal = dailyGoal || {
          id: `goal_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          projectId,
          type: 'daily',
          targetWords: 0,
          active: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        goal.targetWords = words;
        goal.active = true;
        goal.updatedAt = Date.now();
        await onSave(goal);
      }
    }

    // Project goal
    if (projectTarget.trim()) {
      const words = parseInt(projectTarget, 10);
      if (!isNaN(words)) {
        const goal: WritingGoal = projectGoal || {
          id: `goal_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          projectId,
          type: 'project',
          targetWords: 0,
          active: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        goal.targetWords = words;
        goal.active = true;
        goal.updatedAt = Date.now();
        await onSave(goal);
      }
    }

    // Deadline goal
    if (deadlineTarget.trim() && deadlineDate.trim()) {
      const words = parseInt(deadlineTarget, 10);
      if (!isNaN(words)) {
        const goal: WritingGoal = deadlineGoal || {
          id: `goal_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          projectId,
          type: 'deadline',
          targetWords: 0,
          active: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        goal.targetWords = words;
        goal.deadline = deadlineDate;
        goal.active = true;
        goal.updatedAt = Date.now();
        await onSave(goal);
      }
    }

    onClose();
  }, [dailyTarget, projectTarget, deadlineTarget, deadlineDate, dailyGoal, projectGoal, deadlineGoal, projectId, onSave, onClose]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{t('writingStats.goals.title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Daily Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('writingStats.goals.dailyTarget')}</label>
            <input
              type="number"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(e.target.value)}
              placeholder={t('writingStats.goals.dailyExample')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold"
            />
            <p className="text-xs text-gray-500">{t('writingStats.goals.dailyHint')}</p>
          </div>

          {/* Project Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('writingStats.goals.projectTarget')}</label>
            <input
              type="number"
              value={projectTarget}
              onChange={(e) => setProjectTarget(e.target.value)}
              placeholder={t('writingStats.goals.projectExample')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold"
            />
            <p className="text-xs text-gray-500">{t('writingStats.goals.projectHint')}</p>
          </div>

          {/* Deadline Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">{t('writingStats.goals.deadlineTarget')}</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={deadlineTarget}
                onChange={(e) => setDeadlineTarget(e.target.value)}
                placeholder={t('writingStats.goals.deadlineExample')}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold"
              />
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-gold"
              />
            </div>
            <p className="text-xs text-gray-500">{t('writingStats.goals.deadlineHint')}</p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-accent-gold text-black font-medium rounded-lg hover:bg-accent-gold/90 transition-colors"
          >
            <Save size={18} />
            {t('writingStats.goals.saveGoals')}
          </button>
        </div>
      </div>
    </div>
  );
}
