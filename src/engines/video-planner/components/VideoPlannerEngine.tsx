import { useState, useRef, useEffect } from 'react';
import { Plus, Pencil, Check, X, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import type { VideoPlan } from '../types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useVideoPlans, useVideoSegments } from '../hooks';
import { parsePlanJson, importPlan, PlanImportError } from '../planImport';
import VideoPlanView from './VideoPlanView';
import { ConfirmDialog } from '@/engines/_shared';

interface VideoPlannerEngineProps {
  projectId: string;
}

export default function VideoPlannerEngine({ projectId }: VideoPlannerEngineProps) {
  const { t } = useTranslation();
  const { items: plans, loading: plansLoading, addItem: addPlan, editItem: editPlan, removeItem: removePlan, refresh: refreshPlans } = useVideoPlans(projectId);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [showNewPlanForm, setShowNewPlanForm] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [pendingDeletePlanId, setPendingDeletePlanId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!importStatus) return;
    const id = setTimeout(() => setImportStatus(null), 5000);
    return () => clearTimeout(id);
  }, [importStatus]);

  const activePlan = plans.find(p => p.id === activePlanId);
  const { items: segments, addItem: addSegment, editItem: editSegment, removeItem: removeSegment, reorder } = useVideoSegments(
    activePlanId || ''
  );

  const handleCreatePlan = async () => {
    if (!newPlanTitle.trim()) return;

    const newPlan: VideoPlan = {
      id: generateId('vpl'),
      projectId,
      title: newPlanTitle.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await addPlan(newPlan);
    setNewPlanTitle('');
    setShowNewPlanForm(false);
    setActivePlanId(newPlan.id);
  };

  const handleSelectPlan = (planId: string) => {
    setActivePlanId(planId);
  };

  const confirmDeletePlan = async () => {
    if (!pendingDeletePlanId) return;
    const planId = pendingDeletePlanId;
    setPendingDeletePlanId(null);
    await removePlan(planId);
    if (activePlanId === planId) {
      setActivePlanId(plans.find(p => p.id !== planId)?.id || null);
    }
  };

  const startRename = (plan: VideoPlan) => {
    setRenamingPlanId(plan.id);
    setRenameValue(plan.title);
  };

  const cancelRename = () => {
    setRenamingPlanId(null);
    setRenameValue('');
  };

  const commitRename = async () => {
    const planId = renamingPlanId;
    if (!planId) return;
    const title = renameValue.trim();
    const current = plans.find(p => p.id === planId);
    setRenamingPlanId(null);
    setRenameValue('');
    if (title && current && title !== current.title) {
      await editPlan(planId, { title, updatedAt: Date.now() });
    }
  };

  const renamePlan = async (planId: string, title: string) => {
    const trimmed = title.trim();
    const current = plans.find(p => p.id === planId);
    if (trimmed && current && trimmed !== current.title) {
      await editPlan(planId, { title: trimmed, updatedAt: Date.now() });
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    setImportStatus(null);
    try {
      const text = await file.text();
      const fallbackTitle = file.name.replace(/\.json$/i, '');
      const parsed = parsePlanJson(text, fallbackTitle);
      const plan = await importPlan(projectId, parsed);
      await refreshPlans();
      setActivePlanId(plan.id);
      setImportStatus({ kind: 'success', text: t('videoPlanner.import.imported').replace('{title}', plan.title) });
    } catch (err) {
      const text =
        err instanceof PlanImportError
          ? t(`videoPlanner.import.${err.message}`)
          : t('videoPlanner.import.failed');
      setImportStatus({ kind: 'error', text });
    }
  };

  if (plansLoading) return <EngineSpinner />;

  return (
    <div className="space-y-6">
      {/* Plan Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg text-neutral-50">{t('videoPlanner.title')}</h3>
          {plans.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleImportClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-border text-neutral-300 hover:border-accent-gold/50 hover:text-accent-gold transition-colors text-sm"
              >
                <Upload className="w-4 h-4" />
                {t('videoPlanner.import.label')}
              </button>
              <button
                onClick={() => setShowNewPlanForm(!showNewPlanForm)}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                {t('videoPlanner.newPlan')}
              </button>
            </div>
          )}
        </div>

        {/* Hidden file input for plan import (JSON) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />

        {importStatus && (
          <div
            className={`rounded border px-3 py-2 text-sm ${
              importStatus.kind === 'error'
                ? 'border-red-400/40 bg-red-400/10 text-red-300'
                : 'border-green-400/40 bg-green-400/10 text-green-300'
            }`}
          >
            {importStatus.text}
          </div>
        )}

        {/* New plan form */}
        <AnimatePresence>
          {showNewPlanForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-surface border border-border rounded-lg p-4 space-y-3"
            >
              <input
                type="text"
                value={newPlanTitle}
                onChange={(e) => setNewPlanTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreatePlan();
                  if (e.key === 'Escape') {
                    setShowNewPlanForm(false);
                    setNewPlanTitle('');
                  }
                }}
                autoFocus
                placeholder={t('videoPlanner.titlePlaceholder')}
                className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowNewPlanForm(false);
                    setNewPlanTitle('');
                  }}
                  className="px-3 py-1.5 rounded border border-border text-neutral-300 hover:bg-surface transition-colors text-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreatePlan}
                  disabled={!newPlanTitle.trim()}
                  className="px-3 py-1.5 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  {t('common.create')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Plans list or empty state */}
        {plans.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-neutral-400 mb-4">{t('videoPlanner.noPlans')}</p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setShowNewPlanForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('videoPlanner.createFirst')}
              </button>
              <button
                onClick={handleImportClick}
                className="inline-flex items-center gap-2 px-4 py-2 rounded border border-border text-neutral-300 hover:border-accent-gold/50 hover:text-accent-gold transition-colors"
              >
                <Upload className="w-4 h-4" />
                {t('videoPlanner.import.label')}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {plans.map((plan) =>
              renamingPlanId === plan.id ? (
                <div
                  key={plan.id}
                  className="flex items-center gap-2 px-4 py-3 rounded border border-accent-gold bg-accent-gold/10"
                >
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    autoFocus
                    placeholder={t('videoPlanner.renamePlaceholder')}
                    className="flex-1 min-w-0 bg-deep border border-border rounded px-3 py-1.5 text-neutral-50 focus:border-accent-gold focus:outline-none"
                  />
                  <button
                    onClick={commitRename}
                    disabled={!renameValue.trim()}
                    title={t('common.save')}
                    aria-label={t('common.save')}
                    className="p-1.5 rounded text-accent-gold hover:bg-accent-gold/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={cancelRename}
                    title={t('common.cancel')}
                    aria-label={t('common.cancel')}
                    className="p-1.5 rounded text-neutral-400 hover:bg-surface transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  key={plan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectPlan(plan.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectPlan(plan.id);
                    }
                  }}
                  className={`cursor-pointer text-left px-4 py-3 rounded border transition-all ${
                    activePlanId === plan.id
                      ? 'bg-accent-gold/10 border-accent-gold'
                      : 'bg-surface border-border hover:border-accent-gold/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-serif text-neutral-50 truncate">{plan.title}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {new Date(plan.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(plan);
                        }}
                        title={t('videoPlanner.renamePlan')}
                        aria-label={t('videoPlanner.renamePlan')}
                        className="p-1.5 rounded text-neutral-400 hover:text-accent-gold hover:bg-accent-gold/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeletePlanId(plan.id);
                        }}
                        className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Active plan view */}
      {activePlan && (
        <div className="border-t border-border pt-6">
          <VideoPlanView
            plan={activePlan}
            segments={segments}
            onAddSegment={addSegment}
            onUpdateSegment={editSegment}
            onDeleteSegment={removeSegment}
            onReorderSegments={reorder}
            onRenamePlan={(title) => renamePlan(activePlan.id, title)}
          />
        </div>
      )}

      <ConfirmDialog
        open={pendingDeletePlanId !== null}
        destructive
        message={t('videoPlanner.deleteConfirm')}
        onConfirm={confirmDeletePlan}
        onCancel={() => setPendingDeletePlanId(null)}
      />
    </div>
  );
}
