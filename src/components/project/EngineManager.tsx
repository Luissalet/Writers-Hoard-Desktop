import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GripVertical, Search, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import { ConfirmDialog } from '@/engines/_shared';
import { PROJECT_MODES, getEngine, type EngineDefinition, type ProjectMode } from '@/engines';
import {
  groupEnginesForMode,
  planPresetChange,
  getModeConfig,
  type PresetChange,
} from '@/config/projectPresets';
import { countProjectRowsByEngine } from './engineDataCounts';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

interface EngineManagerProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  /**
   * Persist the whole engine setup, `mode` included.
   *
   * `mode` used not to be here, which is why "you can always change this
   * later" was a lie everywhere except the recipe templates buried under
   * Prepare. The preset is chosen in this modal now, so this modal has to be
   * able to save it.
   */
  onUpdate: (update: {
    enabledEngines: string[];
    engineOrder: string[];
    mode: ProjectMode;
  }) => Promise<void>;
}

/**
 * One row in the ordered "active engines" list.
 *
 * A component of its own rather than a function inside a `.map()` because
 * `useSortable` is a hook — calling it in a loop body would change the hook
 * count per render. Same reason `BeatList` splits its row out.
 *
 * The drag activator is the handle alone, never the whole row: the row holds
 * buttons, and a row-wide drag gesture fights every one of them.
 */
function SortableEngineRow({
  id,
  reorderable,
  dragLabel,
  children,
}: {
  id: string;
  reorderable: boolean;
  dragLabel: string;
  children: React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id, disabled: !reorderable });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-start gap-2 rounded-lg border border-border/50 bg-surface p-3"
    >
      {reorderable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          title={dragLabel}
          aria-label={dragLabel}
          className="mt-0.5 cursor-grab touch-none text-text-dim transition hover:text-text-muted active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
      )}
      {children}
    </div>
  );
}

export default function EngineManager({
  open,
  onClose,
  project,
  onUpdate,
}: EngineManagerProps) {
  const { t } = useTranslation();
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [mode, setMode] = useState<ProjectMode>(project.mode);
  const [query, setQuery] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<PresetChange | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Sync state when the modal opens — deduplicate, drop ids no engine claims,
  // and make the ordered list cover exactly the enabled set, so bad rows heal
  // rather than rendering an engine that cannot be reordered or one that is
  // enabled but invisible.
  useEffect(() => {
    if (!open) return;
    const enabled = [...new Set(project.enabledEngines || [])].filter(id => Boolean(getEngine(id)));
    const enabledSet = new Set(enabled);
    const ordered = [...new Set(project.engineOrder || enabled)].filter(id => enabledSet.has(id));
    const orderedSet = new Set(ordered);
    setEnabledIds(enabled);
    setOrder([...ordered, ...enabled.filter(id => !orderedSet.has(id))]);
    setMode(project.mode);
    setQuery('');
    setPresetsOpen(false);
    setPendingPreset(null);
  }, [open, project]);

  // What each engine currently holds for this project. Informational on the
  // rows; load-bearing in the preset confirmation, which names every engine it
  // would switch off. A failure here costs the numbers, never the safety:
  // removals are confirmed on their own merits below.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    countProjectRowsByEngine(project.id)
      .then(next => { if (!cancelled) setCounts(next); })
      .catch(error => { console.error('Failed to count engine data', error); });
    return () => { cancelled = true; };
  }, [open, project.id]);

  /**
   * Switch an engine on or off.
   *
   * Off means "no tab, out of the order" and nothing else — no table is
   * touched, no row is deleted. `onUpdate` writes `enabledEngines` and
   * `engineOrder` and nothing else, so an engine switched back on finds
   * everything exactly where it left it.
   */
  const toggleEngine = (engineId: string) => {
    setEnabledIds((prev) => {
      if (prev.includes(engineId)) {
        setOrder((o) => o.filter((id) => id !== engineId));
        return prev.filter((id) => id !== engineId);
      }
      setOrder((o) => (o.includes(engineId) ? o : [...o, engineId]));
      return [...prev, engineId];
    });
  };

  const moveUp = (engineId: string) => {
    const idx = order.indexOf(engineId);
    if (idx <= 0) return;
    setOrder(arrayMove(order, idx, idx - 1));
  };

  const moveDown = (engineId: string) => {
    const idx = order.indexOf(engineId);
    if (idx < 0 || idx >= order.length - 1) return;
    setOrder(arrayMove(order, idx, idx + 1));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setOrder(arrayMove(order, from, to));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        enabledEngines: [...new Set(enabledIds)],
        engineOrder: [...new Set(order)],
        mode,
      });
    } finally {
      setSaving(false);
    }
  };

  const engineName = (engine: EngineDefinition) => t(`engines.${engine.id}.name`);
  const engineDescription = (engine: EngineDefinition) => t(`engines.${engine.id}.description`);
  const held = (engineId: string) => counts[engineId] ?? 0;
  /** "holds 60" / "holds nothing yet" — the honest half of every removal. */
  const holdsLabel = (engineId: string) => {
    const count = held(engineId);
    return count > 0
      ? t('engines.preset.holds').replace('{count}', String(count))
      : t('engines.preset.holdsNothing');
  };

  const search = query.trim().toLowerCase();
  const matchesSearch = (engine: EngineDefinition) =>
    !search
    || engineName(engine).toLowerCase().includes(search)
    || engineDescription(engine).toLowerCase().includes(search);

  // Groups follow the staged preset, so picking a new one re-sorts the list
  // under its headings before anything is saved.
  const groups = groupEnginesForMode(mode);
  const includedIds = new Set(groups.included.map(engine => engine.id));
  const recommendedIds = new Set(groups.recommended.map(engine => engine.id));
  const groupTag = (engineId: string) => {
    if (includedIds.has(engineId)) return t('engines.tag.included');
    if (recommendedIds.has(engineId)) return t('common.recommended');
    return t('engines.tag.extra');
  };

  const modeConfig = getModeConfig(mode);
  const modeName = (value: ProjectMode) => t(`modes.${value}.name`);
  const presetChanges = PROJECT_MODES.map(config => planPresetChange(config, enabledIds, order));

  const applyPreset = (change: PresetChange) => {
    setMode(change.mode);
    setEnabledIds(change.nextEnabled);
    setOrder(change.nextOrder);
    setPresetsOpen(false);
    setPendingPreset(null);
    toast.success(t('engines.preset.applied').replace('{mode}', modeName(change.mode)));
  };

  const requestPreset = (change: PresetChange) => {
    // Nothing leaves the workspace — apply straight away. Anything that would
    // switch an engine off goes through the confirmation below, which names
    // every one of them and what it is holding.
    if (change.removes.length === 0) {
      applyPreset(change);
      return;
    }
    // The picker stays open behind the confirmation: cancelling should land
    // the writer back on the list they were comparing, not close it on them.
    setPendingPreset(change);
  };

  const confirmMessage = (change: PresetChange) => {
    const lines = [
      t('engines.preset.confirmIntro').replace('{mode}', modeName(change.mode)),
      '',
      t('engines.preset.confirmRemoves'),
      ...change.removes.map(engine => `• ${engineName(engine)} — ${holdsLabel(engine.id)}`),
    ];
    if (change.adds.length > 0) {
      lines.push('', t('engines.preset.confirmAdds'), ...change.adds.map(engine => `• ${engineName(engine)}`));
    }
    lines.push('', t('engines.preset.dataKept'));
    return lines.join('\n');
  };

  const activeIds = order.filter(engineId => {
    const engine = getEngine(engineId);
    return engine ? matchesSearch(engine) : false;
  });
  // Reordering is hidden while a search is narrowing the list: dragging a row
  // past neighbours it cannot see, or nudging it "up" into a gap, is the same
  // dishonest affordance as a handle that does nothing.
  const reorderable = !search;

  const availableGroups = [
    { key: 'included', heading: `${t('createProject.includedWith')} ${modeName(mode)}`, engines: groups.included },
    { key: 'recommended', heading: `${t('createProject.recommendedFor')} ${modeName(mode)}`, engines: groups.recommended },
    { key: 'other', heading: t('engines.group.other'), engines: groups.other },
  ].map(group => ({
    ...group,
    engines: group.engines.filter(engine => !enabledIds.includes(engine.id) && matchesSearch(engine)),
  }));
  const availableCount = availableGroups.reduce((total, group) => total + group.engines.length, 0);

  const ModeIcon = modeConfig?.icon;

  /**
   * `Modal` listens for Escape on `window`, so while the preset confirmation
   * is layered on top both dialogs would hear the same keypress and the
   * manager would close underneath it, discarding everything staged. Escape
   * belongs to the topmost dialog: dismiss the confirmation and stay.
   */
  const handleModalClose = () => {
    if (pendingPreset) {
      setPendingPreset(null);
      return;
    }
    onClose();
  };

  return (
    <>
      <Modal open={open} onClose={handleModalClose} title={t('engines.manager')} wide>
        <div className="space-y-6">
          {/* ── Preset ── */}
          <section className="rounded-lg border border-border bg-elevated p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {ModeIcon && (
                  <ModeIcon size={22} style={{ color: modeConfig?.color }} className="mt-0.5 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-text-dim">{t('engines.preset.current')}</p>
                  <p className="font-serif text-sm font-bold text-text-primary">{modeName(mode)}</p>
                  <p className="text-xs text-text-muted">{t(`modes.${mode}.description`)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPresetsOpen(value => !value)}
                aria-expanded={presetsOpen}
                className="flex-shrink-0 rounded-lg border border-accent-gold/40 px-3 py-1.5 text-sm font-medium text-accent-gold transition hover:bg-accent-gold/10"
              >
                {presetsOpen ? t('engines.preset.hide') : t('engines.preset.change')}
              </button>
            </div>

            {presetsOpen && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-text-muted">{t('engines.preset.intro')}</p>
                {presetChanges.map(change => {
                  const PresetIcon = change.config.icon;
                  const isCurrent = change.mode === mode;
                  const unchanged = isCurrent && change.adds.length === 0 && change.removes.length === 0;
                  return (
                    <div
                      key={change.mode}
                      className="rounded-lg border border-border bg-surface p-3"
                      style={{ borderLeftWidth: '4px', borderLeftColor: change.config.color }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <PresetIcon size={18} style={{ color: change.config.color }} className="mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary">
                              {modeName(change.mode)}
                              {isCurrent && (
                                <span className="ml-2 rounded-full bg-accent-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-gold">
                                  {t('engines.preset.currentBadge')}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-text-muted">{t(`modes.${change.mode}.description`)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestPreset(change)}
                          disabled={unchanged}
                          className="flex-shrink-0 rounded-lg bg-accent-gold px-3 py-1.5 text-xs font-semibold text-deep transition hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('engines.preset.apply')}
                        </button>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        {change.keepsCurrentEngines ? (
                          <p className="text-xs text-text-muted">{t('engines.preset.keepsEngines')}</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-text-dim">{t('engines.preset.adds')}</span>
                              {change.adds.length === 0 ? (
                                <span className="text-xs text-text-muted">{t('engines.preset.nothing')}</span>
                              ) : change.adds.map(engine => (
                                <span
                                  key={engine.id}
                                  className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] text-success"
                                >
                                  {engineName(engine)}
                                </span>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-text-dim">{t('engines.preset.removes')}</span>
                              {change.removes.length === 0 ? (
                                <span className="text-xs text-text-muted">{t('engines.preset.nothing')}</span>
                              ) : change.removes.map(engine => (
                                <span
                                  key={engine.id}
                                  title={holdsLabel(engine.id)}
                                  className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] text-danger"
                                >
                                  {engineName(engine)}
                                  <span className="ml-1 text-text-muted">{holdsLabel(engine.id)}</span>
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                        {unchanged && (
                          <p className="text-xs text-text-dim">{t('engines.preset.noChanges')}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-text-dim">{t('engines.preset.dataKept')}</p>
              </div>
            )}
          </section>

          {/* ── Search ── */}
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('engines.searchPlaceholder')}
              aria-label={t('engines.searchPlaceholder')}
              className="w-full rounded-lg border border-border bg-elevated py-2.5 pl-9 pr-9 text-sm text-text-primary outline-none transition focus:border-accent-gold"
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title={t('engines.clearSearch')}
                aria-label={t('engines.clearSearch')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-text-muted transition hover:bg-surface"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* ── Active engines, in tab order ── */}
          <section>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <span className="h-2 w-2 rounded-full bg-accent-gold" />
              {t('engines.active')}
            </h3>
            <p className="mb-3 text-xs text-text-dim">{t('engines.removeKeepsData')}</p>
            {order.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-dim">{t('engines.noActive')}</p>
            ) : activeIds.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-dim">{t('engines.noMatches')}</p>
            ) : (
              <>
                {!reorderable && (
                  <p className="mb-2 text-xs text-text-dim">{t('engines.reorderHiddenBySearch')}</p>
                )}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={activeIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 rounded-lg bg-elevated p-3">
                      {activeIds.map((engineId) => {
                        const engine = getEngine(engineId);
                        if (!engine) return null;
                        const Icon = engine.icon;
                        const idx = order.indexOf(engineId);
                        return (
                          <SortableEngineRow
                            key={engineId}
                            id={engineId}
                            reorderable={reorderable}
                            dragLabel={t('common.dragToReorder')}
                          >
                            <Icon size={16} className="mt-0.5 flex-shrink-0 text-text-muted" />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                                {engineName(engine)}
                                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-dim">
                                  {groupTag(engineId)}
                                </span>
                                {held(engineId) > 0 && (
                                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-muted">
                                    {holdsLabel(engineId)}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs leading-snug text-text-dim">{engineDescription(engine)}</p>
                            </div>

                            {reorderable && (
                              <div className="flex flex-shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => moveUp(engineId)}
                                  disabled={idx === 0}
                                  className="rounded-lg p-1.5 text-text-muted transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                                  title={t('engines.moveUp')}
                                  aria-label={t('engines.moveUp')}
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveDown(engineId)}
                                  disabled={idx === order.length - 1}
                                  className="rounded-lg p-1.5 text-text-muted transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                                  title={t('engines.moveDown')}
                                  aria-label={t('engines.moveDown')}
                                >
                                  <ChevronDown size={14} />
                                </button>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => toggleEngine(engineId)}
                              className="flex-shrink-0 rounded-lg p-1.5 text-text-muted transition hover:bg-danger/10 hover:text-danger"
                              title={t('engines.disable')}
                              aria-label={t('engines.disable')}
                            >
                              <X size={14} />
                            </button>
                          </SortableEngineRow>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </>
            )}
          </section>

          {/* ── Everything you can switch on, grouped by the preset ── */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <span className="h-2 w-2 rounded-full bg-text-dim" />
              {t('engines.available')}
            </h3>
            {availableCount === 0 ? (
              <p className="py-4 text-center text-sm text-text-dim">
                {search ? t('engines.noMatches') : t('engines.allEnabled')}
              </p>
            ) : (
              <div className="space-y-4">
                {availableGroups.map(group => group.engines.length > 0 && (
                  <div key={group.key}>
                    <p className="mb-2 text-xs uppercase tracking-wide text-text-muted">{group.heading}</p>
                    <div className="space-y-2 rounded-lg bg-elevated p-3">
                      {group.engines.map(engine => {
                        const Icon = engine.icon;
                        return (
                          <button
                            key={engine.id}
                            type="button"
                            onClick={() => toggleEngine(engine.id)}
                            className="group flex w-full items-start gap-3 rounded-lg border border-border/50 bg-surface p-3 text-left transition hover:border-accent-gold/30 hover:bg-surface/80"
                          >
                            <Icon size={16} className="mt-0.5 flex-shrink-0 text-text-muted transition group-hover:text-accent-gold" />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary transition group-hover:text-accent-gold">
                                {engineName(engine)}
                                {held(engine.id) > 0 && (
                                  <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-text-muted">
                                    {holdsLabel(engine.id)}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs leading-snug text-text-dim">{engineDescription(engine)}</p>
                            </div>
                            <span className="flex flex-shrink-0 items-center gap-1 rounded bg-accent-gold/10 px-2 py-1 text-xs text-accent-gold">
                              <Check size={12} />
                              {t('common.add')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-elevated/80"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-accent-gold px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-amber disabled:opacity-60"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </Modal>

      {pendingPreset && (
        <ConfirmDialog
          open
          title={t('engines.preset.confirmTitle')}
          message={confirmMessage(pendingPreset)}
          confirmLabel={t('engines.preset.confirmButton')}
          destructive={pendingPreset.removes.some(engine => held(engine.id) > 0)}
          onConfirm={() => applyPreset(pendingPreset)}
          onCancel={() => setPendingPreset(null)}
        />
      )}
    </>
  );
}
