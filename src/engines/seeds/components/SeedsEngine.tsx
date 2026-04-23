import { useState, useMemo } from 'react';
import { Sprout, Plus, Trash2, Target, ArrowRight, ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useSeeds, usePayoffs, useAllPayoffs } from '../hooks';
import type { Seed, Payoff, SeedKind, SeedStatus } from '../types';
import { SEED_KIND_CONFIG, SEED_STATUS_CONFIG, computeSeedStatus } from '../types';
import { generateId } from '@/utils/idGenerator';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';

// ---------------------------------------------------------------------------
// SeedsEngine
// ---------------------------------------------------------------------------

export default function SeedsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: seeds, loading: seedsLoading, addItem: addSeed, editItem: editSeed, removeItem: removeSeed } = useSeeds(projectId);
  const { items: allPayoffs, loading: payoffsLoading, refresh: refreshAllPayoffs } = useAllPayoffs(projectId);
  const [activeSeedId, setActiveSeedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filterKind, setFilterKind] = useState<SeedKind | ''>('');
  const [filterStatus, setFilterStatus] = useState<SeedStatus | ''>('');

  const payoffsBySeed = useMemo(() => {
    const map = new Map<string, Payoff[]>();
    for (const p of allPayoffs) {
      if (!map.has(p.seedId)) map.set(p.seedId, []);
      map.get(p.seedId)!.push(p);
    }
    return map;
  }, [allPayoffs]);

  const filteredSeeds = useMemo(() => {
    return seeds.filter((s) => {
      const status = computeSeedStatus(s, payoffsBySeed.get(s.id) ?? []);
      if (filterKind && s.kind !== filterKind) return false;
      if (filterStatus && status !== filterStatus) return false;
      return true;
    });
  }, [seeds, payoffsBySeed, filterKind, filterStatus]);

  if (seedsLoading || payoffsLoading) return <EngineSpinner />;

  if (activeSeedId) {
    const seed = seeds.find((s) => s.id === activeSeedId);
    if (seed) {
      return (
        <SeedDetail
          seed={seed}
          projectId={projectId}
          onBack={() => setActiveSeedId(null)}
          onUpdate={(changes) => editSeed(seed.id, changes)}
          onDelete={async () => {
            await removeSeed(seed.id);
            await refreshAllPayoffs();
            setActiveSeedId(null);
          }}
          onPayoffsChanged={refreshAllPayoffs}
        />
      );
    }
  }

  // --- Dashboard totals ---
  const totalSeeds = seeds.length;
  const paidCount = seeds.filter((s) => (payoffsBySeed.get(s.id)?.length ?? 0) > 0).length;
  const orphanCount = seeds.filter((s) => s.status !== 'cut' && (payoffsBySeed.get(s.id)?.length ?? 0) === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <Sprout size={15} className="text-accent-gold" />
          {t('seeds.title')}
        </h2>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
        >
          <Plus size={14} />
          {t('seeds.newSeed')}
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label={t('seeds.stats.total')} value={totalSeeds} color="text-accent-gold" />
        <StatCard label={t('seeds.stats.paid')} value={paidCount} color="text-green-400" />
        <StatCard label={t('seeds.stats.orphans')} value={orphanCount} color="text-amber-400" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as SeedKind | '')}
          className="px-2.5 py-1.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition cursor-pointer"
        >
          <option value="">{t('seeds.filter.allKinds')}</option>
          {(Object.entries(SEED_KIND_CONFIG) as [SeedKind, { label: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as SeedStatus | '')}
          className="px-2.5 py-1.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition cursor-pointer"
        >
          <option value="">{t('seeds.filter.allStatuses')}</option>
          {(Object.entries(SEED_STATUS_CONFIG) as [SeedStatus, { label: string }][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {showNew && (
        <NewSeedForm
          projectId={projectId}
          onCreate={async (seed) => {
            await addSeed(seed);
            setShowNew(false);
            setActiveSeedId(seed.id);
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {filteredSeeds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-dim">
          <Sprout size={36} className="mb-3 opacity-40" />
          <p className="text-sm">
            {seeds.length === 0 ? t('seeds.empty') : t('seeds.noResults')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSeeds.map((seed) => (
            <SeedCard
              key={seed.id}
              seed={seed}
              payoffs={payoffsBySeed.get(seed.id) ?? []}
              onOpen={() => setActiveSeedId(seed.id)}
              onDelete={async () => {
                if (confirm(t('seeds.confirmDelete'))) {
                  await removeSeed(seed.id);
                  await refreshAllPayoffs();
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border border-border rounded-xl bg-surface/50 p-3 text-center">
      <div className={`text-2xl font-serif font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] text-text-dim uppercase tracking-wide">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeedCard
// ---------------------------------------------------------------------------

function SeedCard({
  seed,
  payoffs,
  onOpen,
  onDelete,
}: {
  seed: Seed;
  payoffs: Payoff[];
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const status = computeSeedStatus(seed, payoffs);
  const kindCfg = SEED_KIND_CONFIG[seed.kind];
  const statusCfg = SEED_STATUS_CONFIG[status];
  return (
    <div className="group flex items-stretch border border-border rounded-xl bg-elevated/40 hover:border-accent-gold/40 transition overflow-hidden">
      <div className="w-1" style={{ backgroundColor: seed.color ?? kindCfg.color }} />
      <button onClick={onOpen} className="flex-1 min-w-0 text-left p-3 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wide"
            style={{ backgroundColor: `${kindCfg.color}20`, color: kindCfg.color }}
          >
            {kindCfg.label}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusCfg.color}`}>
            {statusCfg.label}
          </span>
          {seed.plantedAt !== undefined && (
            <span className="text-[10px] text-text-dim">@ {seed.plantedAt}%</span>
          )}
          <h3 className="text-sm font-semibold text-text-primary truncate flex-1">{seed.title}</h3>
        </div>
        {seed.description && <p className="text-xs text-text-dim line-clamp-2">{seed.description}</p>}
        {payoffs.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-green-400">
            <Target size={10} />
            <span>{payoffs.length} payoff{payoffs.length === 1 ? '' : 's'}</span>
          </div>
        )}
      </button>
      <button
        onClick={onDelete}
        className="px-2 text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition"
        title={t('common.delete')}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewSeedForm
// ---------------------------------------------------------------------------

function NewSeedForm({
  projectId,
  onCreate,
  onCancel,
}: {
  projectId: string;
  onCreate: (seed: Seed) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SeedKind>('foreshadow');

  const handleSubmit = async () => {
    if (!title.trim()) return;
    const now = Date.now();
    const seed: Seed = {
      id: generateId('seed'),
      projectId,
      title: title.trim(),
      description: '',
      kind,
      status: 'planted',
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await onCreate(seed);
  };

  return (
    <div className="border border-accent-gold/40 rounded-xl bg-surface/60 p-4 space-y-3">
      <h3 className="text-sm font-serif font-semibold text-accent-gold">{t('seeds.newSeed')}</h3>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('seeds.titlePlaceholder')}
        className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
      />
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {(Object.entries(SEED_KIND_CONFIG) as [SeedKind, { label: string; description: string; color: string }][]).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-lg border-2 p-2 text-left transition ${
              kind === k ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
            }`}
          >
            <div className="text-xs font-semibold" style={{ color: v.color }}>{v.label}</div>
            <div className="text-[10px] text-text-dim mt-0.5 line-clamp-2">{v.description}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-dim hover:text-text-primary transition">
          {t('common.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="px-3 py-1.5 text-xs bg-accent-gold text-bg rounded-lg hover:bg-accent-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {t('common.create')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeedDetail — shows seed + its payoffs
// ---------------------------------------------------------------------------

function SeedDetail({
  seed,
  projectId,
  onBack,
  onUpdate,
  onDelete,
  onPayoffsChanged,
}: {
  seed: Seed;
  projectId: string;
  onBack: () => void;
  onUpdate: (changes: Partial<Seed>) => Promise<void>;
  onDelete: () => Promise<void>;
  onPayoffsChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { items: payoffs, addItem: addPayoff, editItem: editPayoff, removeItem: removePayoff } = usePayoffs(seed.id);
  const kindCfg = SEED_KIND_CONFIG[seed.kind];

  const handleField = <K extends keyof Seed>(key: K) => (value: Seed[K]) => {
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<Seed>);
  };

  const handleAddPayoff = async () => {
    const now = Date.now();
    const payoff: Payoff = {
      id: generateId('payoff'),
      seedId: seed.id,
      projectId,
      title: t('seeds.payoff.newTitle'),
      description: '',
      strength: 3,
      createdAt: now,
      updatedAt: now,
    };
    await addPayoff(payoff);
    await onPayoffsChanged();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-text-dim hover:bg-elevated hover:text-text-primary transition"
            title={t('common.back')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wide"
                style={{ backgroundColor: `${kindCfg.color}20`, color: kindCfg.color }}
              >
                {kindCfg.label}
              </span>
            </div>
            <input
              value={seed.title}
              onChange={(e) => handleField('title')(e.target.value)}
              placeholder={t('seeds.titlePlaceholder')}
              className="w-full bg-transparent text-lg font-serif font-semibold text-text-primary outline-none border-b border-transparent focus:border-accent-gold transition"
            />
          </div>
        </div>
        <button
          onClick={async () => {
            if (confirm(t('seeds.confirmDelete'))) await onDelete();
          }}
          className="p-1.5 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition"
          title={t('common.delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Seed editor */}
      <div className="border border-border rounded-xl bg-surface/50 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-text-dim">{t('seeds.kind')}</span>
            <select
              value={seed.kind}
              onChange={(e) => handleField('kind')(e.target.value as SeedKind)}
              className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            >
              {(Object.entries(SEED_KIND_CONFIG) as [SeedKind, { label: string }][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-text-dim">{t('seeds.status')}</span>
            <select
              value={seed.status}
              onChange={(e) => handleField('status')(e.target.value as SeedStatus)}
              className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            >
              {(Object.entries(SEED_STATUS_CONFIG) as [SeedStatus, { label: string }][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-text-dim">{t('seeds.plantedAt')}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={seed.plantedAt ?? ''}
              onChange={(e) => handleField('plantedAt')(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="0-100"
              className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs text-text-dim">{t('seeds.description')}</span>
          <textarea
            value={seed.description}
            onChange={(e) => handleField('description')(e.target.value)}
            rows={3}
            placeholder={t('seeds.descriptionPlaceholder')}
            className="w-full px-3 py-2 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
          />
        </label>

        <label className="space-y-1 block">
          <span className="text-xs text-text-dim">{t('seeds.locationLabel')}</span>
          <input
            value={seed.locationLabel ?? ''}
            onChange={(e) => handleField('locationLabel')(e.target.value)}
            placeholder={t('seeds.locationPlaceholder')}
            className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
        </label>
      </div>

      {/* Payoffs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-serif font-semibold text-text-primary flex items-center gap-2">
            <Target size={13} className="text-green-400" />
            {t('seeds.payoffs.title')}
          </h3>
          <button
            onClick={handleAddPayoff}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500/10 text-green-400 rounded-lg hover:bg-green-500/20 transition"
          >
            <Plus size={12} />
            {t('seeds.payoffs.add')}
          </button>
        </div>
        {payoffs.length === 0 ? (
          <p className="text-xs text-text-dim text-center py-6">{t('seeds.payoffs.empty')}</p>
        ) : (
          <div className="space-y-2 pl-4 border-l-2 border-green-500/30">
            {payoffs.map((p) => (
              <PayoffCard
                key={p.id}
                payoff={p}
                onUpdate={async (changes) => {
                  await editPayoff(p.id, changes);
                  await onPayoffsChanged();
                }}
                onDelete={async () => {
                  if (confirm(t('seeds.payoff.confirmDelete'))) {
                    await removePayoff(p.id);
                    await onPayoffsChanged();
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Annotation surface — margin notes + backlinks */}
      <div className="pt-2 border-t border-border">
        <AnnotationSurface
          projectId={projectId}
          engineId="seeds"
          entityId={seed.id}
          layout="stack"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PayoffCard
// ---------------------------------------------------------------------------

function PayoffCard({
  payoff,
  onUpdate,
  onDelete,
}: {
  payoff: Payoff;
  onUpdate: (changes: Partial<Payoff>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const handleField = <K extends keyof Payoff>(key: K) => (value: Payoff[K]) => {
    onUpdate({ [key]: value, updatedAt: Date.now() } as Partial<Payoff>);
  };

  return (
    <div className="group border border-border rounded-lg bg-elevated/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ArrowRight size={12} className="text-green-400 flex-shrink-0" />
        <input
          value={payoff.title}
          onChange={(e) => handleField('title')(e.target.value)}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-transparent focus:border-green-400 transition"
        />
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[11px] text-text-dim hover:text-text-primary px-1.5 py-0.5 rounded transition"
        >
          {expanded ? t('common.less') : t('common.more')}
        </button>
        <button
          onClick={onDelete}
          className="p-1 rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition"
          title={t('common.delete')}
        >
          <Trash2 size={11} />
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 pl-5">
          <textarea
            value={payoff.description}
            onChange={(e) => handleField('description')(e.target.value)}
            rows={3}
            placeholder={t('seeds.payoff.descriptionPlaceholder')}
            className="w-full px-2 py-1.5 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-green-400 transition resize-none"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1 text-[11px] text-text-dim">
              <span>{t('seeds.payoff.strength')}</span>
              <select
                value={payoff.strength}
                onChange={(e) => handleField('strength')(Number(e.target.value) as Payoff['strength'])}
                className="text-xs bg-elevated border border-border rounded px-1.5 py-0.5 text-text-primary outline-none focus:border-green-400 cursor-pointer"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{'⭐'.repeat(n)}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-text-dim">
              <span>@ %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={payoff.paidAt ?? ''}
                onChange={(e) => handleField('paidAt')(e.target.value === '' ? undefined : Number(e.target.value))}
                className="w-16 px-1.5 py-0.5 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-green-400 transition"
              />
            </label>
            <input
              value={payoff.locationLabel ?? ''}
              onChange={(e) => handleField('locationLabel')(e.target.value)}
              placeholder={t('seeds.locationPlaceholder')}
              className="flex-1 min-w-[140px] px-2 py-0.5 text-xs bg-elevated border border-border rounded text-text-primary outline-none focus:border-green-400 transition"
            />
          </div>
        </div>
      )}
    </div>
  );
}
