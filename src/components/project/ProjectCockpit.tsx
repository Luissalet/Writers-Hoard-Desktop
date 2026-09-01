import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  Loader2,
  Network,
  Pencil,
  RefreshCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useProjectCockpit } from '@/hooks/useProjectCockpit';
import {
  repairProjectHealthIssue,
  repairMissingManagedAssets,
  updateNarrativeSpineLink,
  type NarrativeContinuitySignal,
  type NarrativeSpineRow,
  type ProjectCockpitData,
} from '@/services/projectIntelligence';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import ProjectToolsPanel from './ProjectToolsPanel';
import ProofreaderPanel from '@/components/proofreader/ProofreaderPanel';
import {
  COCKPIT_GROUPS,
  COCKPIT_TAB_LABEL_KEYS,
  getCockpitGroup,
  isCockpitToolTab,
  resolveCockpitTab,
  type CockpitGroupId,
  type CockpitTab,
} from './cockpitNavigation';

interface ProjectCockpitProps {
  projectId: string;
  onManageEngines: () => void;
  onEditProject: () => void;
}

const groupIcons: Record<CockpitGroupId, typeof Activity> = {
  supervise: Activity,
  develop: Network,
  produce: Boxes,
  prepare: FileText,
};

function CockpitNavigation({
  activeTab,
  onSelect,
}: {
  activeTab: CockpitTab;
  onSelect: (tab: CockpitTab) => void;
}) {
  const { t } = useTranslation();
  const activeGroup = getCockpitGroup(activeTab);

  return (
    <div className="space-y-2">
      <nav
        aria-label={t('projectCockpit.navigation.groups')}
        className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1 sm:grid-cols-4"
      >
        {COCKPIT_GROUPS.map((group) => {
          const Icon = groupIcons[group.id];
          const active = activeGroup.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) onSelect(group.defaultTab);
              }}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
                active ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{t(group.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="sm:hidden">
        <label htmlFor="cockpit-view-select" className="sr-only">
          {t('projectCockpit.navigation.selectView')}
        </label>
        <select
          id="cockpit-view-select"
          value={activeTab}
          onChange={(event) => onSelect(event.target.value as CockpitTab)}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
        >
          {activeGroup.tabs.map((tab) => (
            <option key={tab} value={tab}>{t(COCKPIT_TAB_LABEL_KEYS[tab])}</option>
          ))}
        </select>
      </div>

      <nav
        aria-label={t('projectCockpit.navigation.views')}
        className="hidden flex-wrap gap-1 rounded-lg border border-border/70 bg-surface/60 p-1 sm:flex"
      >
        {activeGroup.tabs.map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(tab)}
              className={`min-h-10 rounded-md px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
                active ? 'bg-elevated font-medium text-accent-gold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t(COCKPIT_TAB_LABEL_KEYS[tab])}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function StatCard({ label, value, detail, onClick }: {
  label: string;
  value: string | number;
  detail?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-2xl font-semibold text-text-primary">{value}</div>
      <div className="mt-1 text-sm text-text-muted">{label}</div>
      {detail && <div className="mt-2 text-xs text-text-dim">{detail}</div>}
    </>
  );
  // A card that leads somewhere has to be reachable by keyboard and say so on
  // hover; a plain figure stays a plain figure.
  if (!onClick) {
    return <div className="rounded-xl border border-border bg-surface p-4">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
    >
      {body}
    </button>
  );
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const { t } = useTranslation();
  const available = value !== null;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-text-muted">{label}</span>
        <span className={available ? 'font-medium text-text-primary' : 'font-medium text-text-dim'}>
          {available ? `${value}%` : t('projectCockpit.notApplicable')}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-elevated"
        role={available ? 'progressbar' : undefined}
        aria-label={`${label}: ${available ? `${value}%` : t('projectCockpit.notApplicableLong')}`}
        aria-valuemin={available ? 0 : undefined}
        aria-valuemax={available ? 100 : undefined}
        aria-valuenow={value ?? undefined}
      >
        {available && (
          <div className="h-full rounded-full bg-accent-gold transition-all" style={{ width: `${value}%` }} />
        )}
      </div>
    </div>
  );
}

function EngineLink({
  projectId,
  engineId,
  entityId,
  children,
  className,
  ariaLabel,
  onBeforeNavigate,
}: {
  projectId: string;
  engineId: string;
  entityId?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  onBeforeNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const open = () => {
    onBeforeNavigate?.();
    const adapter = getAnchorAdapter(engineId);
    if (entityId && adapter) adapter.navigateToEntity(entityId, projectId);
    else navigate(`/project/${encodeURIComponent(projectId)}/${encodeURIComponent(engineId)}`);
  };
  return (
    <button
      type="button"
      onClick={open}
      aria-label={ariaLabel}
      className={className ?? 'text-left transition hover:text-accent-gold'}
    >
      {children}
    </button>
  );
}

function Overview({
  projectId,
  data,
  onManageEngines,
  onOpenHealth,
}: {
  projectId: string;
  data: ProjectCockpitData;
  onManageEngines: () => void;
  onOpenHealth: () => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {/* How big is the book. Already computed for Supervise → Intelligence;
            it was the one number the Overview never showed. */}
        <StatCard
          label={t('projectCockpit.overview.words')}
          value={data.intelligence.totalWords.toLocaleString(locale)}
        />
        <StatCard label={t('projectCockpit.overview.writings')} value={data.counts.writings} />
        <StatCard label={t('projectCockpit.overview.scenes')} value={data.counts.scenes} />
        <StatCard label={t('projectCockpit.overview.codex')} value={data.counts.codex} />
        <StatCard label={t('projectCockpit.overview.notes')} value={data.counts.notes} />
        <StatCard label={t('projectCockpit.overview.research')} value={data.counts.research} />
        <StatCard
          label={t('projectCockpit.overview.review')}
          value={data.counts.unresolved}
          onClick={onOpenHealth}
          detail={
            data.healthStatus === 'not-applicable'
              ? t('projectCockpit.overview.openProofreader')
              : data.healthStatus === 'clean'
                ? t('projectCockpit.overview.openProofreader')
                : t('projectCockpit.overview.openHealth')
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 className="font-serif font-semibold text-text-primary">{t('projectCockpit.overview.recent')}</h3>
            <button type="button" onClick={onManageEngines} className="text-xs text-accent-gold hover:underline">
              {t('project.manageEngines')}
            </button>
          </div>
          <div className="divide-y divide-border">
            {data.recent.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-text-muted">{t('projectCockpit.overview.recentEmpty')}</p>
            )}
            {data.recent.map(item => (
              <EngineLink
                key={`${item.engineId}:${item.id}`}
                projectId={projectId}
                engineId={item.engineId}
                entityId={item.id}
              >
                <span className="flex w-full items-center gap-3 px-5 py-3">
                  <FileText size={16} className="text-text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">{item.title}</span>
                    <span className="block text-xs text-text-dim">
                      {t(`engines.${item.engineId}.name`)} · {new Date(item.updatedAt).toLocaleString(locale)}
                    </span>
                  </span>
                  <ArrowRight size={14} className="text-text-dim" />
                </span>
              </EngineLink>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            {data.healthStatus === 'clean' ? (
              <ShieldCheck size={20} className="text-green-400" />
            ) : data.healthStatus === 'not-applicable' ? (
              <Activity size={20} className="text-text-dim" />
            ) : (
              <AlertTriangle size={20} className="text-amber-400" />
            )}
            <h3 className="font-serif font-semibold text-text-primary">{t('projectCockpit.overview.pulse')}</h3>
          </div>
          {data.healthStatus === 'not-applicable' ? (
            <p className="text-sm text-text-muted">{t('projectCockpit.health.noDataDetail')}</p>
          ) : data.healthStatus === 'clean' ? (
            <p className="text-sm text-text-muted">{t('projectCockpit.overview.noIssues')}</p>
          ) : (
            <div className="space-y-3">
              {data.health.slice(0, 5).map(row => (
                <div key={row.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-text-muted">{t(`projectCockpit.health.issue.${row.id}.title`)}</span>
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-primary">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Health({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
  const { t } = useTranslation();
  const [repairing, setRepairing] = useState<string | null>(null);
  const repair = async (issueId: string) => {
    setRepairing(issueId);
    try {
      await repairProjectHealthIssue(projectId, issueId);
      toast.success(t('projectCockpit.health.repaired'));
    } catch (error) {
      console.error('Project repair failed', error);
      toast.error(t('projectCockpit.health.repairError'));
    } finally {
      setRepairing(null);
    }
  };

  // The integrity report and the proofreader answer different questions —
  // "is the data sound?" and "is the story sound?" — so they stack in the same
  // tab instead of one of them early-returning the other off the screen.
  const integrity = data.healthStatus === 'not-applicable' ? (
    <div className="rounded-xl border border-border bg-surface p-10 text-center">
      <Activity className="mx-auto text-text-dim" size={34} />
      <h3 className="mt-3 font-serif text-lg font-semibold text-text-primary">{t('projectCockpit.health.noData')}</h3>
      <p className="mt-2 text-sm text-text-muted">{t('projectCockpit.health.noDataDetail')}</p>
    </div>
  ) : data.healthStatus === 'clean' ? (
    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-10 text-center">
      <CheckCircle2 className="mx-auto text-green-400" size={34} />
      <h3 className="mt-3 font-serif text-lg font-semibold text-text-primary">{t('projectCockpit.health.clean')}</h3>
      <p className="mt-2 text-sm text-text-muted">{t('projectCockpit.health.cleanDetail')}</p>
    </div>
  ) : (
    <div className="space-y-3">
      {data.health.map(row => (
        <div key={row.id} className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4">
          <AlertTriangle
            size={20}
            className={row.severity === 'error' ? 'text-red-400' : row.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-text-primary">{t(`projectCockpit.health.issue.${row.id}.title`)}</h3>
              <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-muted">{row.count}</span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{t(`projectCockpit.health.issue.${row.id}.detail`)}</p>
          </div>
          {row.repairable && (
            <button
              type="button"
              disabled={repairing !== null}
              onClick={() => void repair(row.id)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-text-primary transition hover:border-accent-gold disabled:opacity-50"
            >
              {repairing === row.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
              {t('projectCockpit.health.repair')}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {integrity}
      <ProofreaderPanel projectId={projectId} />
    </div>
  );
}

function EntityHub({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const entities = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? data.entities.filter(row =>
          row.title.toLocaleLowerCase().includes(normalized) ||
          row.engineId.toLocaleLowerCase().includes(normalized) ||
          row.entityType.toLocaleLowerCase().includes(normalized),
        )
      : data.entities;
  }, [data.entities, query]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={16} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('projectCockpit.entities.filter')}
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-text-primary outline-none focus:border-accent-gold"
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="grid min-w-[34rem] grid-cols-[1fr_150px_100px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
          <span>{t('projectCockpit.entities.entity')}</span><span>{t('projectCockpit.entities.engine')}</span><span>{t('projectCockpit.entities.backlinks')}</span>
        </div>
        <div className="max-h-[60vh] divide-y divide-border overflow-auto">
          {entities.map(entity => (
            <EngineLink key={entity.key} projectId={projectId} engineId={entity.engineId} entityId={entity.id}>
              <span className="grid min-w-[34rem] w-full grid-cols-[1fr_150px_100px] gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-text-primary">{entity.title}</span>
                  <span className="block truncate text-xs text-text-dim">{entity.subtitle ?? entity.entityType}</span>
                </span>
                <span className="self-center text-text-muted">{t(`engines.${entity.engineId}.name`)}</span>
                <span className="self-center text-text-muted">{entity.backlinkCount}</span>
              </span>
            </EngineLink>
          ))}
        </div>
      </div>
    </div>
  );
}

function NarrativeSpine({
  projectId,
  data,
  focusedBeatId,
  onRememberBeat,
}: {
  projectId: string;
  data: ProjectCockpitData;
  focusedBeatId: string | null;
  onRememberBeat: (beatId: string) => void;
}) {
  const { t } = useTranslation();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const appliedFocusRef = useRef<string | null>(null);
  // The links the selects have just been given, keyed beat|field and held until
  // the cockpit's liveQuery has reloaded the whole read model. Without them a
  // controlled select snaps back to its previous option for as long as that
  // reload takes — which is exactly how a stale row got written back.
  const [pendingLinks, setPendingLinks] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!focusedBeatId) {
      appliedFocusRef.current = null;
      return;
    }
    if (appliedFocusRef.current === focusedBeatId) return;
    const row = rowRefs.current.get(focusedBeatId);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.focus({ preventScroll: true });
    appliedFocusRef.current = focusedBeatId;
  }, [focusedBeatId, data.spine]);

  type LinkField = 'scene' | 'writing';
  const pendingKey = (beatId: string, field: LinkField) => `${beatId}|${field}`;
  const linkOf = (row: NarrativeSpineRow, field: LinkField) =>
    (field === 'scene' ? row.sceneId : row.writingId) ?? '';
  // Render-adjust rather than an effect (same pattern as CodexEntryList): each
  // optimistic value is dropped the moment the reloaded row agrees with it, so
  // a later change from anywhere else is never masked.
  const settledKeys = Object.keys(pendingLinks).filter(key => {
    const separator = key.lastIndexOf('|');
    const beatId = key.slice(0, separator);
    const row = data.spine.find(candidate => candidate.beatId === beatId);
    return row !== undefined && linkOf(row, key.slice(separator + 1) as LinkField) === pendingLinks[key];
  });
  if (settledKeys.length > 0) {
    setPendingLinks(current => {
      const next = { ...current };
      for (const key of settledKeys) delete next[key];
      return next;
    });
  }
  const linkValue = (row: NarrativeSpineRow, field: LinkField) =>
    pendingLinks[pendingKey(row.beatId, field)] ?? linkOf(row, field);
  // One field per write. Sending both meant the sibling link was rewritten from
  // whatever this render happened to hold, erasing a change made from the
  // select next to it.
  const changeLink = (row: NarrativeSpineRow, field: LinkField, value: string) => {
    const key = pendingKey(row.beatId, field);
    setPendingLinks(current => ({ ...current, [key]: value }));
    void updateNarrativeSpineLink(
      projectId,
      row.beatId,
      field === 'scene' ? { sceneId: value || undefined } : { writingId: value || undefined },
    ).catch(() => {
      setPendingLinks(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      toast.error(t(field === 'scene'
        ? 'projectCockpit.spine.sceneError'
        : 'projectCockpit.spine.writingError'));
    });
  };

  if (data.spine.length === 0) {
    return <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-muted">{t('projectCockpit.spine.empty')}</p>;
  }

  const unplacedSignals = data.continuity.signals.filter(signal => !signal.beatId);
  const signalLabel = (signal: NarrativeContinuitySignal) => {
    if (signal.kind === 'unlinked-beat') {
      return t('projectCockpit.spine.signal.unlinkedBeat');
    }
    if (signal.kind === 'unpaid-seed') {
      return t('projectCockpit.spine.signal.unpaidSeed')
        .replace('{seed}', signal.seedTitle ?? t('projectCockpit.spine.unknownSeed'));
    }
    return t('projectCockpit.spine.signal.earlyPayoff')
      .replace('{seed}', signal.seedTitle ?? t('projectCockpit.spine.unknownSeed'))
      .replace('{payoff}', String(signal.payoffPosition ?? '—'))
      .replace('{setup}', String(signal.setupPosition ?? '—'));
  };
  const signalLink = (signal: NarrativeContinuitySignal) => {
    const opensBeat = signal.kind === 'unlinked-beat' && Boolean(signal.beatId);
    const engineId = opensBeat ? 'outline' : 'seeds';
    const entityId = opensBeat ? signal.beatId : signal.seedId;
    if (!entityId) return null;
    return (
      <EngineLink
        key={signal.id}
        projectId={projectId}
        engineId={engineId}
        entityId={entityId}
        onBeforeNavigate={() => {
          if (signal.beatId) onRememberBeat(signal.beatId);
        }}
        ariaLabel={
          opensBeat
            ? t('projectCockpit.spine.openBeat').replace('{beat}', signalLabel(signal))
            : t('projectCockpit.spine.openSeed').replace('{seed}', signal.seedTitle ?? '')
        }
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
          signal.kind === 'payoff-before-setup'
            ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:border-red-400'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400'
        }`}
      >
        <CircleAlert size={12} aria-hidden="true" />
        <span>{signalLabel(signal)}</span>
        <ExternalLink size={11} aria-hidden="true" />
      </EngineLink>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="continuity-summary-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="continuity-summary-title" className="font-serif font-semibold text-text-primary">
              {t('projectCockpit.spine.continuityTitle')}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{t('projectCockpit.spine.continuityDetail')}</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label={t('projectCockpit.spine.continuityCounts')}>
            <span className="rounded-full bg-elevated px-2.5 py-1 text-xs text-text-muted">
              {t('projectCockpit.spine.count.unlinked').replace('{count}', String(data.continuity.counts['unlinked-beat']))}
            </span>
            <span className="rounded-full bg-elevated px-2.5 py-1 text-xs text-text-muted">
              {t('projectCockpit.spine.count.unpaid').replace('{count}', String(data.continuity.counts['unpaid-seed']))}
            </span>
            <span className="rounded-full bg-elevated px-2.5 py-1 text-xs text-text-muted">
              {t('projectCockpit.spine.count.early').replace('{count}', String(data.continuity.counts['payoff-before-setup']))}
            </span>
          </div>
        </div>
        {data.continuity.signals.length === 0 && (
          <p className="mt-3 text-sm text-green-400">{t('projectCockpit.spine.noSignals')}</p>
        )}
      </section>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="grid min-w-[48rem] grid-cols-[70px_1.3fr_1fr_1fr_100px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
          <span>{t('projectCockpit.spine.story')}</span><span>{t('projectCockpit.spine.beat')}</span><span>{t('projectCockpit.spine.scene')}</span><span>{t('projectCockpit.spine.writing')}</span><span>{t('projectCockpit.spine.links')}</span>
        </div>
        <div className="divide-y divide-border">
          {data.spine.map(row => (
            <div
              key={row.beatId}
              ref={node => {
                if (node) rowRefs.current.set(row.beatId, node);
                else rowRefs.current.delete(row.beatId);
              }}
              tabIndex={-1}
              aria-current={focusedBeatId === row.beatId ? 'true' : undefined}
              className={`scroll-m-6 px-4 py-3 outline-none transition ${
                focusedBeatId === row.beatId
                  ? 'bg-accent-gold/10 ring-2 ring-inset ring-accent-gold/70'
                  : ''
              }`}
            >
              <div className="grid min-w-[46rem] grid-cols-[70px_1.3fr_1fr_1fr_100px] gap-3 text-sm">
                <span className="text-text-dim">{row.position === undefined ? '—' : `${row.position}%`}</span>
                <EngineLink
                  projectId={projectId}
                  engineId="outline"
                  entityId={row.beatId}
                  onBeforeNavigate={() => onRememberBeat(row.beatId)}
                  ariaLabel={t('projectCockpit.spine.openBeat').replace('{beat}', row.beatTitle)}
                >
                  <span className="block text-text-primary">{row.beatTitle}</span>
                  <span className="block text-xs text-text-dim">{row.outlineTitle} · {t(`outline.status.${row.status}`)}</span>
                </EngineLink>
                <div className="flex min-w-0 items-center gap-1">
                  <select
                    aria-label={t('projectCockpit.spine.sceneAria').replace('{beat}', row.beatTitle)}
                    value={linkValue(row, 'scene')}
                    onChange={event => changeLink(row, 'scene', event.target.value)}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="">{t('projectCockpit.spine.notLinked')}</option>
                    {data.spineOptions.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
                  </select>
                  {row.sceneId && (
                    <EngineLink
                      projectId={projectId}
                      engineId="dialog-scene"
                      entityId={row.sceneId}
                      onBeforeNavigate={() => onRememberBeat(row.beatId)}
                      ariaLabel={t('projectCockpit.spine.openScene').replace('{scene}', row.sceneTitle ?? '')}
                      className="rounded p-1.5 text-text-dim transition hover:bg-elevated hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                    </EngineLink>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <select
                    aria-label={t('projectCockpit.spine.writingAria').replace('{beat}', row.beatTitle)}
                    value={linkValue(row, 'writing')}
                    onChange={event => changeLink(row, 'writing', event.target.value)}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="">{t('projectCockpit.spine.notLinked')}</option>
                    {data.spineOptions.writings.map(writing => <option key={writing.id} value={writing.id}>{writing.title}</option>)}
                  </select>
                  {row.writingId && (
                    <EngineLink
                      projectId={projectId}
                      engineId="writings"
                      entityId={row.writingId}
                      onBeforeNavigate={() => onRememberBeat(row.beatId)}
                      ariaLabel={t('projectCockpit.spine.openWriting').replace('{writing}', row.writingTitle ?? '')}
                      className="rounded p-1.5 text-text-dim transition hover:bg-elevated hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                    </EngineLink>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {t('projectCockpit.spine.related')
                    .replace('{seeds}', String(row.seedCount))
                    .replace('{arcs}', String(row.arcBeatCount))}
                </span>
              </div>
              {row.continuitySignals.length > 0 && (
                <div className="mt-2 flex min-w-[46rem] flex-wrap gap-2 pl-[82px]" aria-label={t('projectCockpit.spine.signalsForBeat').replace('{beat}', row.beatTitle)}>
                  {row.continuitySignals.map(signalLink)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {unplacedSignals.length > 0 && (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <h3 className="text-sm font-medium text-text-primary">{t('projectCockpit.spine.unplacedTitle')}</h3>
          <p className="mt-1 text-xs text-text-muted">{t('projectCockpit.spine.unplacedDetail')}</p>
          <div className="mt-3 flex flex-wrap gap-2">{unplacedSignals.map(signalLink)}</div>
        </section>
      )}
    </div>
  );
}

function Intelligence({ data }: { data: ProjectCockpitData }) {
  const { t, locale } = useTranslation();
  const value = data.intelligence;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-5 font-serif font-semibold text-text-primary">{t('projectCockpit.intelligence.structure')}</h3>
        <div className="space-y-5">
          <Meter label={t('projectCockpit.intelligence.outlineCoverage')} value={value.outlineCoverage} />
          <Meter label={t('projectCockpit.intelligence.sceneCoverage')} value={value.sceneCoverage} />
          <Meter label={t('projectCockpit.intelligence.seedPayoff')} value={value.seedPayoffRate} />
          <Meter label={t('projectCockpit.intelligence.arcCoverage')} value={value.arcCoverage} />
          <Meter label={t('projectCockpit.intelligence.researchCoverage')} value={value.researchCoverage} />
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <StatCard label={t('projectCockpit.intelligence.words')} value={value.totalWords.toLocaleString(locale)} />
        <StatCard label={t('projectCockpit.intelligence.drafts')} value={value.draftedDocuments} />
        <StatCard label={t('projectCockpit.intelligence.unusedCharacters')} value={value.unusedCharacterCount} detail={t('projectCockpit.intelligence.unusedCharactersDetail')} />
        <StatCard label={t('projectCockpit.intelligence.unmappedSpeakers')} value={value.unmappedSpeakerCount} detail={t('projectCockpit.intelligence.unmappedSpeakersDetail')} />
      </section>
    </div>
  );
}

function Assets({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
  const { t } = useTranslation();
  const [availablePaths, setAvailablePaths] = useState<Set<string> | null>(null);
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = data.assets.reduce<Record<string, number>>((acc, row) => {
    acc[row.storage] = (acc[row.storage] ?? 0) + 1;
    return acc;
  }, {});
  const missing = availablePaths
    ? data.assets.filter(asset =>
        asset.storage === 'managed-file' && asset.path && !availablePaths.has(asset.path),
      )
    : [];
  const audit = async () => {
    const result = await window.electronAPI?.media.listLibraryFiles(projectId);
    if (!result) return;
    setLibraryRoot(result.root);
    setAvailablePaths(new Set(result.files.map(file => file.relPath)));
  };
  const relocate = async () => {
    setBusy(true);
    try {
      const result = await window.electronAPI?.media.relocateLibrary();
      if (!result || result.canceled) return;
      if (!result.ok) throw new Error(result.error || 'Relocation failed');
      toast.success(t('projectCockpit.assets.relocated').replace('{count}', String(result.copiedFiles ?? 0)));
      toast.info(t('projectCockpit.assets.previousRetained'));
      await audit();
    } catch (error) {
      console.error('Asset library relocation failed', error);
      toast.error(t('projectCockpit.assets.relocationError'));
    } finally {
      setBusy(false);
    }
  };
  const repair = async () => {
    if (!availablePaths) return;
    const repaired = await repairMissingManagedAssets(projectId, [...availablePaths]);
    toast.success(t(repaired === 1
      ? 'projectCockpit.assets.repairedOne'
      : 'projectCockpit.assets.repairedMany').replace('{count}', String(repaired)));
    await audit();
  };
  return (
    <div className="space-y-4">
      {window.electronAPI?.media.listLibraryFiles && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void audit()} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold">
              {t('projectCockpit.assets.audit')}
            </button>
            <button type="button" disabled={busy} onClick={() => void relocate()} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold">
              {t('projectCockpit.assets.relocate')}
            </button>
            {missing.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void repair()} className="rounded-lg bg-accent-gold px-3 py-2 text-sm font-medium text-background">
                {t(missing.length === 1
                  ? 'projectCockpit.assets.repairOne'
                  : 'projectCockpit.assets.repairMany').replace('{count}', String(missing.length))}
              </button>
            )}
            {libraryRoot && <span className="min-w-0 truncate text-xs text-text-dim">{libraryRoot}</span>}
          </div>
        </section>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('projectCockpit.assets.embedded')} value={totals.indexeddb ?? 0} detail={t('projectCockpit.assets.embeddedDetail')} />
        <StatCard label={t('projectCockpit.assets.managed')} value={totals['managed-file'] ?? 0} detail={t('projectCockpit.assets.managedDetail')} />
        <StatCard label={t('projectCockpit.assets.remote')} value={totals.remote ?? 0} detail={t('projectCockpit.assets.remoteDetail')} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="grid min-w-[32rem] grid-cols-[1fr_140px_140px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
          <span>{t('projectCockpit.assets.asset')}</span><span>{t('projectCockpit.assets.storage')}</span><span>{t('projectCockpit.assets.status')}</span>
        </div>
        <div className="max-h-[55vh] divide-y divide-border overflow-auto">
          {data.assets.map(asset => (
            <div key={asset.id} className="grid min-w-[32rem] grid-cols-[1fr_140px_140px] gap-3 px-4 py-3 text-sm">
              <span className="truncate text-text-primary">{asset.label}</span>
              <span className="text-text-muted">{t(`projectCockpit.assets.storage.${asset.storage}`)}</span>
              <span className={
                (asset.path && availablePaths && !availablePaths.has(asset.path)) || asset.status === 'failed'
                  ? 'text-red-400'
                  : asset.status === 'pending' ? 'text-amber-400' : 'text-text-muted'
              }>
                {t(`projectCockpit.assets.status.${asset.path && availablePaths && !availablePaths.has(asset.path) ? 'missing' : asset.status}`)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectCockpit({ projectId, onManageEngines, onEditProject }: ProjectCockpitProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveCockpitTab(searchParams.get('panel'));
  const focusedBeatId = searchParams.get('beat');
  const { data, error, loading, retry } = useProjectCockpit(projectId);
  const selectTab = (tab: CockpitTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('panel');
    else next.set('panel', tab);
    if (tab !== 'spine') next.delete('beat');
    setSearchParams(next);
  };
  const rememberBeat = (beatId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('panel', 'spine');
    next.set('beat', beatId);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!data || activeTab !== 'spine' || !focusedBeatId) return;
    if (data.spine.some(row => row.beatId === focusedBeatId)) return;
    const next = new URLSearchParams(searchParams);
    next.delete('beat');
    setSearchParams(next, { replace: true });
  }, [activeTab, data, focusedBeatId, searchParams, setSearchParams]);

  if (loading) {
    return <div className="flex min-h-[24rem] items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <AlertTriangle className="mx-auto text-red-400" />
        <p className="mt-3 text-sm text-text-muted">{t('projectCockpit.loadError')}</p>
        <button type="button" onClick={retry} className="mt-4 rounded-lg bg-accent-gold px-4 py-2 text-sm text-background">{t('projectCockpit.retry')}</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="text-accent-gold" size={22} />
            <h2 className="font-serif text-xl font-semibold text-text-primary">{t('projectCockpit.title')}</h2>
          </div>
          <p className="mt-1 text-sm text-text-muted">{t('projectCockpit.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onEditProject}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
        >
          <Pencil size={14} />
          {t('project.edit.action')}
        </button>
      </div>
      <CockpitNavigation activeTab={activeTab} onSelect={selectTab} />
      <section
        id="cockpit-active-panel"
        aria-label={t(COCKPIT_TAB_LABEL_KEYS[activeTab])}
      >
        {activeTab === 'overview' && (
          <Overview
            projectId={projectId}
            data={data}
            onManageEngines={onManageEngines}
            onOpenHealth={() => selectTab('health')}
          />
        )}
        {activeTab === 'health' && <Health projectId={projectId} data={data} />}
        {activeTab === 'entities' && <EntityHub projectId={projectId} data={data} />}
        {activeTab === 'spine' && (
          <NarrativeSpine
            projectId={projectId}
            data={data}
            focusedBeatId={focusedBeatId}
            onRememberBeat={rememberBeat}
          />
        )}
        {activeTab === 'intelligence' && <Intelligence data={data} />}
        {activeTab === 'assets' && <Assets projectId={projectId} data={data} />}
        {isCockpitToolTab(activeTab) && (
          <ProjectToolsPanel projectId={projectId} view={activeTab} />
        )}
      </section>
    </div>
  );
}
