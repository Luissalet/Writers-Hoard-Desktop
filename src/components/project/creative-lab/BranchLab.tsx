import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowLeftRight,
  CheckCircle2,
  GitBranch,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { db } from '@/db';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { generateId } from '@/utils/idGenerator';
import {
  archiveCreativeBranch,
  createCreativeBranch,
  discardBranchDelta,
  previewBranchPromotion,
  promoteCreativeBranch,
  reactivateCreativeBranch,
  stageBranchCreate,
  stageBranchUpdate,
  undoBranchPromotion,
  type BranchEntityKind,
  type BranchEntitySnapshot,
  type BranchPromotionPreview,
  type CreativeBranchDelta,
} from '@/services/branching';
import type { OutlineBeat } from '@/engines/outline/types';
import type { TimelineEvent } from '@/types';

interface BranchLabProps {
  projectId: string;
}

interface RootOption {
  kind: Extract<BranchEntityKind, 'outline-beat' | 'timeline-event'>;
  id: string;
  title: string;
  group: string;
}

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

function targetLabel(kind: BranchEntityKind, t: (key: string) => string): string {
  if (kind === 'outline-beat') return t('creativeLab.branch.kind.beat');
  if (kind === 'timeline-event') return t('creativeLab.branch.kind.event');
  return t('creativeLab.branch.kind.connection');
}

function proposalValue(snapshot: BranchEntitySnapshot | null): { title: string; description: string } {
  if (!snapshot) return { title: '', description: '' };
  if (snapshot.kind === 'timeline-connection') {
    return { title: snapshot.value.label ?? '', description: '' };
  }
  return { title: snapshot.value.title, description: snapshot.value.description };
}

export default function BranchLab({ projectId }: BranchLabProps) {
  const { t } = useTranslation();
  const data = useLiveQuery(async () => {
    const [branches, beats, events, outlines, timelines, receipts] = await Promise.all([
      db.creativeBranches.where('projectId').equals(projectId).reverse().sortBy('updatedAt'),
      db.outlineBeats.where('projectId').equals(projectId).sortBy('order'),
      db.timelineEvents.where('projectId').equals(projectId).sortBy('order'),
      db.outlines.where('projectId').equals(projectId).toArray(),
      db.timelines.where('projectId').equals(projectId).toArray(),
      db.branchPromotionReceipts.where('projectId').equals(projectId).reverse().sortBy('createdAt'),
    ]);
    return { branches, beats, events, outlines, timelines, receipts };
  }, [projectId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rootValue, setRootValue] = useState('');
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [promotionPreview, setPromotionPreview] = useState<BranchPromotionPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const roots = useMemo<RootOption[]>(() => {
    if (!data) return [];
    const outlineNames = new Map(data.outlines.map((row) => [row.id, row.title]));
    const timelineNames = new Map(data.timelines.map((row) => [row.id, row.title]));
    return [
      ...data.beats.map((beat) => ({
        kind: 'outline-beat' as const,
        id: beat.id,
        title: beat.title,
        group: outlineNames.get(beat.outlineId) ?? t('creativeLab.branch.kind.beat'),
      })),
      ...data.events.map((event) => ({
        kind: 'timeline-event' as const,
        id: event.id,
        title: event.title,
        group: timelineNames.get(event.timelineId) ?? t('creativeLab.branch.kind.event'),
      })),
    ];
  }, [data, t]);

  useEffect(() => {
    if (!data?.branches.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !data.branches.some((branch) => branch.id === selectedId)) {
      setSelectedId(data.branches[0].id);
    }
  }, [data?.branches, selectedId]);

  useEffect(() => {
    if (!rootValue && roots[0]) setRootValue(`${roots[0].kind}:${roots[0].id}`);
  }, [rootValue, roots]);

  const selected = data?.branches.find((branch) => branch.id === selectedId) ?? null;
  const deltas = useLiveQuery<CreativeBranchDelta[]>(
    async () => selectedId
      ? db.creativeBranchDeltas.where('branchId').equals(selectedId).sortBy('createdAt')
      : [],
    [selectedId],
  ) ?? [];
  const rootDelta = selected
    ? deltas.find((delta) => delta.targetKind === selected.root.kind && delta.targetId === selected.root.entityId)
    : undefined;
  const rootCanonical = useLiveQuery(async () => {
    if (!selected) return null;
    if (selected.root.kind === 'outline-beat') {
      const value = await db.outlineBeats.get(selected.root.entityId);
      return value ? ({ kind: 'outline-beat', value } satisfies BranchEntitySnapshot) : null;
    }
    if (selected.root.kind === 'timeline-event') {
      const value = await db.timelineEvents.get(selected.root.entityId);
      return value ? ({ kind: 'timeline-event', value } satisfies BranchEntitySnapshot) : null;
    }
    const value = await db.timelineConnections.get(selected.root.entityId);
    return value ? ({ kind: 'timeline-connection', value } satisfies BranchEntitySnapshot) : null;
  }, [selected?.id, selected?.updatedAt]);
  const shownRoot = rootDelta?.proposal ?? rootCanonical ?? null;

  useEffect(() => {
    const value = proposalValue(shownRoot);
    setEditTitle(value.title);
    setEditDescription(value.description);
  }, [selected?.id, rootDelta?.updatedAt, rootCanonical, shownRoot]);

  const latestReceipt = selected
    ? data?.receipts.find((receipt) => receipt.branchId === selected.id && !receipt.undoneAt)
    : undefined;

  const run = async (operation: () => Promise<void>, success?: string) => {
    setBusy(true);
    try {
      await operation();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(async () => {
    const root = roots.find((option) => `${option.kind}:${option.id}` === rootValue);
    if (!root) throw new Error(t('creativeLab.branch.error.pickRoot'));
    const branch = await createCreativeBranch({
      projectId,
      title,
      question,
      rootKind: root.kind,
      rootId: root.id,
    });
    setSelectedId(branch.id);
    setTitle('');
    setQuestion('');
  }, t('creativeLab.branch.created'));

  const saveRootAlternative = () => run(async () => {
    if (!selected || selected.status !== 'active') return;
    if (selected.root.kind === 'outline-beat') {
      await stageBranchUpdate(selected.id, selected.root.kind, selected.root.entityId, {
        title: editTitle,
        description: editDescription,
      });
    } else if (selected.root.kind === 'timeline-event') {
      await stageBranchUpdate(selected.id, selected.root.kind, selected.root.entityId, {
        title: editTitle,
        description: editDescription,
      });
    }
  }, t('creativeLab.branch.staged'));

  const addConsequence = () => run(async () => {
    if (!selected || selected.status !== 'active' || !shownRoot || !newTitle.trim()) return;
    const now = Date.now();
    if (shownRoot.kind === 'outline-beat') {
      const source = shownRoot.value;
      const beat: OutlineBeat = {
        ...source,
        id: generateId('branch_beat'),
        parentId: source.id,
        order: source.order + 0.5,
        title: newTitle.trim(),
        description: newDescription.trim(),
        storyPosition: source.storyPosition === undefined ? undefined : Math.min(100, source.storyPosition + 5),
        status: 'outlined',
        createdAt: now,
        updatedAt: now,
      };
      await stageBranchCreate(selected.id, 'outline-beat', beat);
    } else if (shownRoot.kind === 'timeline-event') {
      const source = shownRoot.value;
      const event: TimelineEvent = {
        ...source,
        id: generateId('branch_event'),
        order: source.order + 1,
        title: newTitle.trim(),
        description: newDescription.trim(),
        createdAt: now,
        updatedAt: now,
      };
      await stageBranchCreate(selected.id, 'timeline-event', event);
      await stageBranchCreate(selected.id, 'timeline-connection', {
        id: generateId('branch_connection'),
        projectId,
        timelineId: source.timelineId,
        sourceEventId: source.id,
        targetEventId: event.id,
        label: t('creativeLab.branch.therefore'),
        color: source.color,
        style: 'solid',
        createdAt: now,
      });
    }
    setNewTitle('');
    setNewDescription('');
  }, t('creativeLab.branch.consequenceAdded'));

  const openPromotion = () => run(async () => {
    if (!selected) return;
    setPromotionPreview(await previewBranchPromotion(selected.id));
  });

  if (!data) {
    return <p role="status" className="py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <GitBranch size={17} className="text-accent-gold" aria-hidden="true" />
            <h3 className="font-serif font-semibold text-text-primary">{t('creativeLab.branch.new')}</h3>
          </div>
          {roots.length === 0 ? (
            <p className="text-sm text-text-muted">{t('creativeLab.branch.noStructure')}</p>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs text-text-muted">
                {t('creativeLab.branch.splitAt')}
                <select className={`${inputClass} mt-1`} value={rootValue} onChange={(event) => setRootValue(event.target.value)}>
                  {roots.map((root) => (
                    <option key={`${root.kind}:${root.id}`} value={`${root.kind}:${root.id}`}>
                      {root.group} · {root.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-text-muted">
                {t('creativeLab.branch.title')}
                <input className={`${inputClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block text-xs text-text-muted">
                {t('creativeLab.branch.question')}
                <textarea className={`${inputClass} mt-1 min-h-20 resize-y`} value={question} onChange={(event) => setQuestion(event.target.value)} />
              </label>
              <button
                type="button"
                disabled={busy || !title.trim()}
                onClick={create}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-semibold text-deep disabled:opacity-50"
              >
                <Plus size={15} aria-hidden="true" /> {t('creativeLab.branch.create')}
              </button>
            </div>
          )}
        </section>

        <nav aria-label={t('creativeLab.branch.list')} className="space-y-1">
          {data.branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              aria-current={branch.id === selectedId ? 'page' : undefined}
              onClick={() => setSelectedId(branch.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
                branch.id === selectedId ? 'border-accent-gold/60 bg-elevated' : 'border-border bg-surface hover:border-accent-gold/30'
              }`}
            >
              <span className="block truncate text-sm font-medium text-text-primary">{branch.title}</span>
              <span className="mt-0.5 block text-xs text-text-muted">{t(`creativeLab.branch.status.${branch.status}`)}</span>
            </button>
          ))}
          {data.branches.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-text-muted">{t('creativeLab.branch.empty')}</p>
          )}
        </nav>
      </aside>

      <section className="min-w-0 rounded-xl border border-border bg-surface p-5">
        {!selected || !shownRoot ? (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <Sparkles className="mx-auto mb-3 text-text-dim" aria-hidden="true" />
              <p className="text-sm text-text-muted">{t('creativeLab.branch.pick')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-text-muted">
                  <span>{targetLabel(selected.root.kind, t)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t(`creativeLab.branch.status.${selected.status}`)}</span>
                </div>
                <h3 className="font-serif text-xl font-semibold text-text-primary">{selected.title}</h3>
                {selected.question && <p className="mt-1 text-sm text-text-muted">{selected.question}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.status === 'active' && (
                  <button type="button" disabled={busy} onClick={() => void run(() => archiveCreativeBranch(selected.id), t('creativeLab.branch.archived'))} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-muted hover:text-text-primary">
                    <Archive size={14} aria-hidden="true" /> {t('creativeLab.branch.archive')}
                  </button>
                )}
                {selected.status === 'archived' && (
                  <button type="button" disabled={busy} onClick={() => void run(() => reactivateCreativeBranch(selected.id), t('creativeLab.branch.reactivated'))} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-primary">
                    <RotateCcw size={14} aria-hidden="true" /> {t('creativeLab.branch.reactivate')}
                  </button>
                )}
                {latestReceipt && (
                  <button type="button" disabled={busy} onClick={() => void run(() => undoBranchPromotion(latestReceipt.id).then(() => undefined), t('creativeLab.branch.undoDone'))} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-accent-amber/50 px-3 text-sm text-accent-amber">
                    <RotateCcw size={14} aria-hidden="true" /> {t('creativeLab.branch.undoPromotion')}
                  </button>
                )}
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-elevated/40 p-4">
                <h4 className="mb-3 text-sm font-semibold text-text-primary">{t('creativeLab.branch.alternativeRoot')}</h4>
                <div className="space-y-3">
                  <label className="block text-xs text-text-muted">
                    {t('creativeLab.branch.itemTitle')}
                    <input disabled={selected.status !== 'active'} className={`${inputClass} mt-1`} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                  </label>
                  <label className="block text-xs text-text-muted">
                    {t('creativeLab.branch.description')}
                    <textarea disabled={selected.status !== 'active'} className={`${inputClass} mt-1 min-h-28 resize-y`} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                  </label>
                  <button type="button" disabled={busy || selected.status !== 'active' || !editTitle.trim()} onClick={saveRootAlternative} className="min-h-10 rounded-lg bg-accent-gold px-3 text-sm font-semibold text-deep disabled:opacity-50">
                    {t('creativeLab.branch.keepAlternative')}
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-elevated/40 p-4">
                <h4 className="mb-1 text-sm font-semibold text-text-primary">{t('creativeLab.branch.addConsequence')}</h4>
                <p className="mb-3 text-xs text-text-muted">{t('creativeLab.branch.addConsequenceHint')}</p>
                <div className="space-y-3">
                  <input aria-label={t('creativeLab.branch.consequenceTitle')} disabled={selected.status !== 'active'} className={inputClass} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={t('creativeLab.branch.consequenceTitle')} />
                  <textarea aria-label={t('creativeLab.branch.consequenceDescription')} disabled={selected.status !== 'active'} className={`${inputClass} min-h-24 resize-y`} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder={t('creativeLab.branch.consequenceDescription')} />
                  <button type="button" disabled={busy || selected.status !== 'active' || !newTitle.trim()} onClick={addConsequence} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-accent-gold/50 px-3 text-sm text-accent-gold disabled:opacity-50">
                    <Plus size={14} aria-hidden="true" /> {t('creativeLab.branch.add')}
                  </button>
                </div>
              </section>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-text-primary">{t('creativeLab.branch.changes')}</h4>
                <span className="text-xs text-text-muted">{deltas.length}</span>
              </div>
              <div className="space-y-2">
                {deltas.map((delta) => (
                  <div key={delta.id} className="flex items-center gap-3 rounded-lg border border-border bg-elevated/30 px-3 py-2">
                    <ArrowLeftRight size={14} className="text-accent-gold" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">{proposalValue(delta.proposal ?? delta.base).title || delta.targetId}</p>
                      <p className="text-xs text-text-muted">{targetLabel(delta.targetKind, t)} · {t(`creativeLab.branch.operation.${delta.operation}`)}</p>
                    </div>
                    {selected.status === 'active' && (
                      <button type="button" disabled={busy} onClick={() => void run(() => discardBranchDelta(delta.id))} aria-label={t('creativeLab.branch.discardChange')} className="grid size-10 place-items-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger">
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {deltas.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{t('creativeLab.branch.noChanges')}</p>}
              </div>
            </section>

            {selected.status === 'active' && (
              <div className="flex justify-end">
                <button type="button" disabled={busy || deltas.length === 0} onClick={openPromotion} className="flex min-h-11 items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-deep disabled:opacity-50">
                  <CheckCircle2 size={16} aria-hidden="true" /> {t('creativeLab.branch.previewPromotion')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <Modal open={Boolean(promotionPreview)} onClose={() => setPromotionPreview(null)} title={t('creativeLab.branch.promotionTitle')} busy={busy} wide>
        {promotionPreview && (
          <div className="space-y-4">
            <p className="text-sm text-text-muted">{t('creativeLab.branch.promotionIntro')}</p>
            {promotionPreview.rootChanged && (
              <div role="alert" className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                <TriangleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                {t('creativeLab.branch.rootChanged')}
              </div>
            )}
            <ul className="max-h-80 space-y-2 overflow-auto" aria-label={t('creativeLab.branch.promotionChanges')}>
              {promotionPreview.changes.map((change) => (
                <li key={change.deltaId} className="rounded-lg border border-border bg-elevated/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text-primary">{proposalValue(change.after ?? change.before).title || change.targetId}</span>
                    <span className="text-xs text-text-muted">{t(`creativeLab.branch.operation.${change.operation}`)}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{change.changedFields.join(', ') || t('creativeLab.branch.structuralChange')}</p>
                  {change.conflict && <p className="mt-2 text-xs text-danger">{t(`creativeLab.branch.conflict.${change.conflict}`)}</p>}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" disabled={busy} onClick={() => setPromotionPreview(null)} className="min-h-11 rounded-lg border border-border px-4 text-sm text-text-primary">{t('common.cancel')}</button>
              <button
                type="button"
                disabled={busy || !promotionPreview.canPromote}
                onClick={() => void run(async () => {
                  await promoteCreativeBranch(promotionPreview.branch.id);
                  setPromotionPreview(null);
                }, t('creativeLab.branch.promoted'))}
                className="min-h-11 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-50"
              >
                {t('creativeLab.branch.promote')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
