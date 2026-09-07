import { useState, useRef } from 'react';
import { Save } from 'lucide-react';
import type { WritingGoal } from '../types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import { validWordTarget, validGoalDate } from '../goalValidation';
import { getGoalCopy } from '../copy';

interface GoalSetterProps {
  goals: WritingGoal[];
  onSave: (goal: WritingGoal) => Promise<void>;
  onClose: () => void;
  projectId: string;
}

export default function GoalSetter({ goals, onSave, onClose, projectId }: GoalSetterProps) {
  const { t, locale } = useTranslation();
  const copy = getGoalCopy(locale);
  // Find active goals by type
  const dailyGoal = goals.find((g) => g.type === 'daily' && g.active);
  const projectGoal = goals.find((g) => g.type === 'project' && g.active);
  const deadlineGoal = goals.find((g) => g.type === 'deadline' && g.active);

  // Form state
  const [dailyTarget, setDailyTarget] = useState(dailyGoal?.targetWords.toString() || '');
  const [projectTarget, setProjectTarget] = useState(projectGoal?.targetWords.toString() || '');
  const [deadlineTarget, setDeadlineTarget] = useState(deadlineGoal?.targetWords.toString() || '');
  const [deadlineDate, setDeadlineDate] = useState(deadlineGoal?.deadline || '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingGoals = useRef<Partial<Record<WritingGoal['type'], WritingGoal>>>({});
  const savedSignatures = useRef<Partial<Record<WritingGoal['type'], string>>>({});

  const handleSave = async () => {
    if (savingRef.current) return;
    const targets = [dailyTarget, projectTarget, deadlineTarget];
    if (targets.some((value) => value.trim() && !validWordTarget(value))) { setError(copy.positive); return; }
    if ((deadlineTarget.trim() || deadlineDate) && (!validWordTarget(deadlineTarget) || !validGoalDate(deadlineDate))) { setError(copy.deadline); return; }
    if (!targets.some((value) => value.trim())) { setError(copy.empty); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    // Build NEW goal objects — mutating the ones from props corrupts the
    // parent's state array in place.
    const buildGoal = (
      existing: WritingGoal | undefined,
      type: WritingGoal['type'],
      targetWords: number,
      deadline?: string,
    ): WritingGoal => ({
      id: existing?.id ?? pendingGoals.current[type]?.id ?? generateId('goal'),
      projectId,
      type,
      targetWords,
      deadline: deadline ?? existing?.deadline,
      active: true,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });

    try {
      const drafts: Array<[WritingGoal['type'], string, WritingGoal | undefined, string?]> = [
        ['daily', dailyTarget, dailyGoal], ['project', projectTarget, projectGoal], ['deadline', deadlineTarget, deadlineGoal, deadlineDate],
      ];
      for (const [type, target, existing, deadline] of drafts) {
        if (!target.trim()) continue;
        const signature = JSON.stringify([Number(target), deadline]);
        if (savedSignatures.current[type] === signature) continue;
        const goal = buildGoal(existing, type, Number(target), deadline);
        pendingGoals.current[type] = goal;
        await onSave(goal);
        savedSignatures.current[type] = signature;
      }
      onClose();
    } catch { setError(copy.failed); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} busy={saving} title={t('writingStats.goals.title')}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void handleSave(); }} className="space-y-6">
        {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <fieldset disabled={saving} className="space-y-4">
          {/* Daily Goal */}
          <div className="space-y-2">
            <label htmlFor="goal-daily" className="text-sm font-medium text-text-muted">{t('writingStats.goals.dailyTarget')}</label>
            <input
              id="goal-daily" min={1} step={1}
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
            <label htmlFor="goal-project" className="text-sm font-medium text-text-muted">{t('writingStats.goals.projectTarget')}</label>
            <input
              id="goal-project" min={1} step={1}
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
            <label htmlFor="goal-deadline" className="text-sm font-medium text-text-muted">{t('writingStats.goals.deadlineTarget')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                id="goal-deadline" min={1} step={1}
                type="number"
                value={deadlineTarget}
                onChange={(e) => setDeadlineTarget(e.target.value)}
                placeholder={t('writingStats.goals.deadlineExample')}
                className="flex-1 px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              />
              <input
                aria-label={copy.date}
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="flex-1 px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
            <p className="text-xs text-text-dim">{t('writingStats.goals.deadlineHint')}</p>
          </div>
        </fieldset>

        {/* Buttons */}
        <div className="flex gap-3 justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-text-muted font-medium rounded-lg hover:bg-elevated transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition-colors"
          >
            <Save size={18} />
            {saving ? copy.saving : t('writingStats.goals.saveGoals')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
