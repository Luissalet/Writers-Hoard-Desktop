import { useState } from 'react';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateId } from '@/utils/idGenerator';
import type { VideoPlan } from '../types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useVideoPlans, useVideoSegments } from '../hooks';
import VideoPlanView from './VideoPlanView';

interface VideoPlannerEngineProps {
  projectId: string;
}

export default function VideoPlannerEngine({ projectId }: VideoPlannerEngineProps) {
  const { items: plans, loading: plansLoading, addItem: addPlan, removeItem: removePlan } = useVideoPlans(projectId);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [showNewPlanForm, setShowNewPlanForm] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');

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

  const handleDeletePlan = async (planId: string) => {
    if (confirm('Delete this video plan? This cannot be undone.')) {
      await removePlan(planId);
      if (activePlanId === planId) {
        setActivePlanId(plans.find(p => p.id !== planId)?.id || null);
      }
    }
  };

  if (plansLoading) return <EngineSpinner />;

  return (
    <div className="space-y-6">
      {/* Plan Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg text-neutral-50">Video Plans</h3>
          {plans.length > 0 && (
            <button
              onClick={() => setShowNewPlanForm(!showNewPlanForm)}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              New Plan
            </button>
          )}
        </div>

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
                placeholder="Enter plan title..."
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
                  Cancel
                </button>
                <button
                  onClick={handleCreatePlan}
                  disabled={!newPlanTitle.trim()}
                  className="px-3 py-1.5 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  Create
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Plans list or empty state */}
        {plans.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-neutral-400 mb-4">No video plans yet.</p>
            <button
              onClick={() => setShowNewPlanForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Your First Plan
            </button>
          </div>
        ) : (
          <div className="grid gap-2">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => handleSelectPlan(plan.id)}
                className={`text-left px-4 py-3 rounded border transition-all ${
                  activePlanId === plan.id
                    ? 'bg-accent-gold/10 border-accent-gold'
                    : 'bg-surface border-border hover:border-accent-gold/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-serif text-neutral-50">{plan.title}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {new Date(plan.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePlan(plan.id);
                    }}
                    className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </button>
            ))}
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
          />
        </div>
      )}
    </div>
  );
}
