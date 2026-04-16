import { useState, useEffect } from 'react';
import { X, Grip, ChevronUp, ChevronDown } from 'lucide-react';
import { getAllEngines } from '@/engines';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

interface EngineManagerProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onUpdate: (enabledEngines: string[], engineOrder: string[]) => Promise<void>;
}

export default function EngineManager({
  open,
  onClose,
  project,
  onUpdate,
}: EngineManagerProps) {
  const { t } = useTranslation();
  const allEngines = getAllEngines();
  const [enabledIds, setEnabledIds] = useState<string[]>(
    project.enabledEngines || []
  );
  const [order, setOrder] = useState<string[]>(
    project.engineOrder || project.enabledEngines || []
  );
  const [saving, setSaving] = useState(false);

  // Sync state when modal opens
  useEffect(() => {
    if (open) {
      setEnabledIds(project.enabledEngines || []);
      setOrder(project.engineOrder || project.enabledEngines || []);
    }
  }, [open, project]);

  const toggleEngine = (engineId: string) => {
    setEnabledIds((prev) => {
      if (prev.includes(engineId)) {
        // Disable: remove from both lists
        setOrder((o) => o.filter((id) => id !== engineId));
        return prev.filter((id) => id !== engineId);
      } else {
        // Enable: add to end of order
        setOrder((o) => [...o, engineId]);
        return [...prev, engineId];
      }
    });
  };

  const moveUp = (engineId: string) => {
    const idx = order.indexOf(engineId);
    if (idx <= 0) return;
    const newOrder = [...order];
    [newOrder[idx], newOrder[idx - 1]] = [newOrder[idx - 1], newOrder[idx]];
    setOrder(newOrder);
  };

  const moveDown = (engineId: string) => {
    const idx = order.indexOf(engineId);
    if (idx >= order.length - 1) return;
    const newOrder = [...order];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    setOrder(newOrder);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(enabledIds, order);
    } finally {
      setSaving(false);
    }
  };

  const disabledEngines = allEngines.filter((e) => !enabledIds.includes(e.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('engines.manager')}
      wide={false}
    >
      <div className="space-y-6">
        {/* Enabled Engines - Reorderable */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-accent-gold rounded-full" />
            {t('engines.active')}
          </h3>
          {order.length === 0 ? (
            <p className="text-sm text-text-dim text-center py-4">
              {t('engines.noActive')}
            </p>
          ) : (
            <div className="space-y-2 bg-elevated rounded-lg p-3">
              {order.map((engineId, idx) => {
                const engine = allEngines.find((e) => e.id === engineId);
                if (!engine) return null;
                const Icon = engine.icon;
                return (
                  <div
                    key={engineId}
                    className="flex items-center gap-2 p-3 bg-surface rounded-lg border border-border/50"
                  >
                    <Grip size={16} className="text-text-dim cursor-move" />
                    <Icon size={16} className="text-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {engine.name}
                      </p>
                      <p className="text-xs text-text-dim truncate">
                        {engine.description}
                      </p>
                    </div>

                    {/* Reorder buttons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => moveUp(engineId)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg text-text-muted hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition"
                        title={t('engines.moveUp')}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => moveDown(engineId)}
                        disabled={idx === order.length - 1}
                        className="p-1.5 rounded-lg text-text-muted hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition"
                        title={t('engines.moveDown')}
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => toggleEngine(engineId)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition flex-shrink-0"
                      title={t('engines.disable')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Available Engines */}
        {disabledEngines.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-text-dim rounded-full" />
              {t('engines.available')}
            </h3>
            <div className="space-y-2 bg-elevated rounded-lg p-3 max-h-64 overflow-y-auto">
              {disabledEngines.map((engine) => {
                const Icon = engine.icon;
                return (
                  <button
                    key={engine.id}
                    onClick={() => toggleEngine(engine.id)}
                    className="w-full flex items-center gap-3 p-3 bg-surface rounded-lg border border-border/50 hover:border-accent-gold/30 hover:bg-surface/80 transition text-left group"
                  >
                    <Icon size={16} className="text-text-muted flex-shrink-0 group-hover:text-accent-gold transition" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent-gold transition">
                        {engine.name}
                      </p>
                      <p className="text-xs text-text-dim truncate">
                        {engine.description}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-accent-gold/10 text-accent-gold flex-shrink-0">
                      {t('common.add')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 justify-end pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-elevated text-text-primary hover:bg-elevated/80 transition text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent-gold text-surface hover:bg-accent-amber disabled:opacity-60 transition text-sm font-medium"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
