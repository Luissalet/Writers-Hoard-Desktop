import { useState, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import type { WritingGoal } from '../types';
import { generateId } from '@/utils/idGenerator';
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
    // Build NEW goal objects — mutating the ones from props corrupts the
    // parent's state array in place.
    const buildGoal = (
      existing: WritingGoal | undefined,
      type: WritingGoal['type'],
      targetWords: number,
      deadline?: string,
    ): WritingGoal => ({
      id: existing?.id ?? generateId('goal'),
      projectId,
      type,
      targetWords,
      deadline: deadline ?? existing?.deadline,
      active: true,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    if (dailyTarget.trim()) {
      const words = parseInt(dailyTarget, 10);
      if (!isNaN(words)) await onSave(buildGoal(dailyGoal, 'daily', words));
    }

    if (projectTarget.trim()) {
      const words = parseInt(projectTarget, 10);
      if (!isNaN(words)) await onSave(buildGoal(projectGoal, 'project', words));
    }

    if (deadlineTarget.trim() && deadlineDate.trim()) {
      const words = parseInt(deadlineTarget, 10);
      if (!isNaN(words)) await onSave(buildGoal(deadlineGoal, 'deadline', words, deadlineDate));
    }

    onClose();
  }, [dailyTarget, projectTarget, deadlineTarget, deadlineDate, dailyGoal, projectGoal, deadlineGoal, projectId, onSave, onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl p-6 max-w-md w-full mx-4 space-y-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif font-bold text-text-primary">{t('writingStats.goals.title')}</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Daily Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">{t('writingStats.goals.dailyTarget')}</label>
            <input
              type="number"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(e.target.value)}
              placeholder={t('writingStats.goals.dailyExample')}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
            />
            <p className="text-xs text-text-dim">{t('writingStats.goals.dailyHint')}</p>
          </div>

          {/* Project Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">{t('writingStats.goals.projectTarget')}</label>
            <input
              type="number"
              value={projectTarget}
              onChange={(e) => setProjectTarget(e.target.value)}
              placeholder={t('writingStats.goals.projectExample')}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
            />
            <p className="text-xs text-text-dim">{t('writingStats.goals.projectHint')}</p>
          </div>

          {/* Deadline Goal */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">{t('writingStats.goals.deadlineTarget')}</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={deadlineTarget}
                onChange={(e) => setDeadlineTarget(e.target.value)}
                placeholder={t('writingStats.goals.deadlineExample')}
                className="flex-1 px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              />
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="flex-1 px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
            <p className="text-xs text-text-dim">{t('writingStats.goals.deadlineHint')}</p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-muted font-medium rounded-lg hover:bg-elevated transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition-colors"
          >
            <Save size={18} />
            {t('writingStats.goals.saveGoals')}
          </button>
        </div>
      </div>
    </div>
  );
}
