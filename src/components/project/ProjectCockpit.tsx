import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  FileText,
  HeartPulse,
  Image,
  Link2,
  Loader2,
  Network,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useProjectCockpit } from '@/hooks/useProjectCockpit';
import {
  repairProjectHealthIssue,
  repairMissingManagedAssets,
  updateNarrativeSpineLink,
  type HubEntity,
  type ProjectCockpitData,
} from '@/services/projectIntelligence';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { toast } from '@/components/common/toast';
import ProjectToolsPanel, { type ProjectToolView } from './ProjectToolsPanel';

type CockpitTab =
  | 'overview'
  | 'health'
  | 'entities'
  | 'spine'
  | 'intelligence'
  | 'assets'
  | ProjectToolView;

interface ProjectCockpitProps {
  projectId: string;
  onManageEngines: () => void;
}

const tabs: Array<{ id: CockpitTab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'entities', label: 'Entity Hub', icon: Network },
  { id: 'spine', label: 'Narrative Spine', icon: Link2 },
  { id: 'intelligence', label: 'Story Intelligence', icon: Sparkles },
  { id: 'assets', label: 'Asset Vault', icon: Image },
  { id: 'workflows', label: 'Workflows', icon: Boxes },
  { id: 'research', label: 'Citations', icon: FileText },
  { id: 'templates', label: 'Templates', icon: Boxes },
  { id: 'publishing', label: 'Publishing', icon: FileText },
  { id: 'ai', label: 'Grounded AI', icon: Sparkles },
];

function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-2xl font-semibold text-text-primary">{value}</div>
      <div className="mt-1 text-sm text-text-muted">{label}</div>
      {detail && <div className="mt-2 text-xs text-text-dim">{detail}</div>}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-text-muted">{label}</span>
        <span className="font-medium text-text-primary">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-elevated">
        <div className="h-full rounded-full bg-accent-gold transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function EngineLink({
  projectId,
  engineId,
  entity,
  children,
}: {
  projectId: string;
  engineId: string;
  entity?: HubEntity;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const open = () => {
    const adapter = getAnchorAdapter(engineId);
    if (entity && adapter) adapter.navigateToEntity(entity.id, projectId);
    else navigate(`/project/${projectId}/${engineId}`);
  };
  return (
    <button type="button" onClick={open} className="text-left transition hover:text-accent-gold">
      {children}
    </button>
  );
}

function Overview({
  projectId,
  data,
  onManageEngines,
}: {
  projectId: string;
  data: ProjectCockpitData;
  onManageEngines: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Writings" value={data.counts.writings} />
        <StatCard label="Scenes" value={data.counts.scenes} />
        <StatCard label="Codex entries" value={data.counts.codex} />
        <StatCard label="Notes" value={data.counts.notes} />
        <StatCard label="Research items" value={data.counts.research} />
        <StatCard
          label="Items to review"
          value={data.counts.unresolved}
          detail={data.counts.unresolved === 0 ? 'Project checks are clean' : 'Open Project Health'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 className="font-serif font-semibold text-text-primary">Recent work</h3>
            <button type="button" onClick={onManageEngines} className="text-xs text-accent-gold hover:underline">
              Manage engines
            </button>
          </div>
          <div className="divide-y divide-border">
            {data.recent.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-text-muted">Your recent work will appear here.</p>
            )}
            {data.recent.map(item => (
              <EngineLink key={`${item.engineId}:${item.id}`} projectId={projectId} engineId={item.engineId}>
                <span className="flex w-full items-center gap-3 px-5 py-3">
                  <FileText size={16} className="text-text-dim" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">{item.title}</span>
                    <span className="block text-xs text-text-dim">
                      {item.engineId} · {new Date(item.updatedAt).toLocaleString()}
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
            {data.health.length === 0 ? (
              <ShieldCheck size={20} className="text-green-400" />
            ) : (
              <AlertTriangle size={20} className="text-amber-400" />
            )}
            <h3 className="font-serif font-semibold text-text-primary">Project pulse</h3>
          </div>
          {data.health.length === 0 ? (
            <p className="text-sm text-text-muted">No integrity or workflow issues detected.</p>
          ) : (
            <div className="space-y-3">
              {data.health.slice(0, 5).map(row => (
                <div key={row.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-text-muted">{row.title}</span>
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
  const [repairing, setRepairing] = useState<string | null>(null);
  const repair = async (issueId: string) => {
    setRepairing(issueId);
    try {
      await repairProjectHealthIssue(projectId, issueId);
      toast.success('Project issue repaired');
    } catch (error) {
      console.error('Project repair failed', error);
      toast.error('The repair could not be completed');
    } finally {
      setRepairing(null);
    }
  };

  if (data.health.length === 0) {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-10 text-center">
        <CheckCircle2 className="mx-auto text-green-400" size={34} />
        <h3 className="mt-3 font-serif text-lg font-semibold text-text-primary">Project checks are clean</h3>
        <p className="mt-2 text-sm text-text-muted">No orphan data, broken workflow links, or interrupted jobs were found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.health.map(row => (
        <div key={row.id} className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4">
          <AlertTriangle
            size={20}
            className={row.severity === 'error' ? 'text-red-400' : row.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-text-primary">{row.title}</h3>
              <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-muted">{row.count}</span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{row.detail}</p>
          </div>
          {row.repairable && (
            <button
              type="button"
              disabled={repairing !== null}
              onClick={() => void repair(row.id)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-text-primary transition hover:border-accent-gold disabled:opacity-50"
            >
              {repairing === row.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
              Repair
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EntityHub({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
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
          placeholder="Filter project entities…"
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-text-primary outline-none focus:border-accent-gold"
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-[1fr_150px_100px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
          <span>Entity</span><span>Engine</span><span>Backlinks</span>
        </div>
        <div className="max-h-[60vh] divide-y divide-border overflow-auto">
          {entities.map(entity => (
            <EngineLink key={entity.key} projectId={projectId} engineId={entity.engineId} entity={entity}>
              <span className="grid w-full grid-cols-[1fr_150px_100px] gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-text-primary">{entity.title}</span>
                  <span className="block truncate text-xs text-text-dim">{entity.subtitle ?? entity.entityType}</span>
                </span>
                <span className="self-center text-text-muted">{entity.engineId}</span>
                <span className="self-center text-text-muted">{entity.backlinkCount}</span>
              </span>
            </EngineLink>
          ))}
        </div>
      </div>
    </div>
  );
}

function NarrativeSpine({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
  if (data.spine.length === 0) {
    return <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-muted">Create an outline to build your narrative spine.</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-[70px_1.3fr_1fr_1fr_100px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
        <span>Story</span><span>Beat</span><span>Scene</span><span>Writing</span><span>Links</span>
      </div>
      <div className="divide-y divide-border">
        {data.spine.map(row => (
          <div key={row.beatId} className="grid grid-cols-[70px_1.3fr_1fr_1fr_100px] gap-3 px-4 py-3 text-sm">
            <span className="text-text-dim">{row.position === undefined ? '—' : `${row.position}%`}</span>
            <EngineLink projectId={projectId} engineId="outline">
              <span className="block text-text-primary">{row.beatTitle}</span>
              <span className="block text-xs text-text-dim">{row.outlineTitle} · {row.status}</span>
            </EngineLink>
            <select
              aria-label={`Scene linked to ${row.beatTitle}`}
              value={row.sceneId ?? ''}
              onChange={event => void updateNarrativeSpineLink(projectId, row.beatId, {
                sceneId: event.target.value || undefined,
                writingId: row.writingId,
              }).catch(() => toast.error('Scene link could not be saved'))}
              className="min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
            >
              <option value="">Not linked</option>
              {data.spineOptions.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
            </select>
            <select
              aria-label={`Writing linked to ${row.beatTitle}`}
              value={row.writingId ?? ''}
              onChange={event => void updateNarrativeSpineLink(projectId, row.beatId, {
                writingId: event.target.value || undefined,
                sceneId: row.sceneId,
              }).catch(() => toast.error('Writing link could not be saved'))}
              className="min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
            >
              <option value="">Not linked</option>
              {data.spineOptions.writings.map(writing => <option key={writing.id} value={writing.id}>{writing.title}</option>)}
            </select>
            <span className="text-xs text-text-muted">{row.seedCount} seeds · {row.arcBeatCount} arcs</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Intelligence({ data }: { data: ProjectCockpitData }) {
  const value = data.intelligence;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-5 font-serif font-semibold text-text-primary">Draft structure</h3>
        <div className="space-y-5">
          <Meter label="Outline beats connected" value={value.outlineCoverage} />
          <Meter label="Scenes represented in outline" value={value.sceneCoverage} />
          <Meter label="Seeds paid off" value={value.seedPayoffRate} />
          <Meter label="Character arcs with beats" value={value.arcCoverage} />
          <Meter label="Research connected to the story" value={value.researchCoverage} />
        </div>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <StatCard label="Total draft words" value={value.totalWords.toLocaleString()} />
        <StatCard label="Active drafts" value={value.draftedDocuments} />
        <StatCard label="Unused characters" value={value.unusedCharacterCount} detail="Codex characters absent from dialogue" />
        <StatCard label="Unmapped speakers" value={value.unmappedSpeakerCount} detail="Dialogue names without a Codex identity" />
      </section>
    </div>
  );
}

function Assets({ projectId, data }: { projectId: string; data: ProjectCockpitData }) {
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
      toast.success(`Asset library copied and relocated (${result.copiedFiles ?? 0} files)`);
      toast.info('The previous asset folder was retained as a safety copy.');
      await audit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Relocation failed');
    } finally {
      setBusy(false);
    }
  };
  const repair = async () => {
    if (!availablePaths) return;
    const repaired = await repairMissingManagedAssets(projectId, [...availablePaths]);
    toast.success(`${repaired} missing asset reference${repaired === 1 ? '' : 's'} repaired`);
    await audit();
  };
  return (
    <div className="space-y-4">
      {window.electronAPI?.media.listLibraryFiles && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void audit()} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold">
              Audit managed files
            </button>
            <button type="button" disabled={busy} onClick={() => void relocate()} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold">
              Relocate library
            </button>
            {missing.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void repair()} className="rounded-lg bg-accent-gold px-3 py-2 text-sm font-medium text-background">
                Repair {missing.length} missing reference{missing.length === 1 ? '' : 's'}
              </button>
            )}
            {libraryRoot && <span className="min-w-0 truncate text-xs text-text-dim">{libraryRoot}</span>}
          </div>
        </section>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Embedded assets" value={totals.indexeddb ?? 0} detail="Included with structured backups" />
        <StatCard label="Managed files" value={totals['managed-file'] ?? 0} detail="Stored in the desktop media library" />
        <StatCard label="Remote references" value={totals.remote ?? 0} detail="Require the original URL or recapture" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="grid grid-cols-[1fr_140px_140px] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-wide text-text-dim">
          <span>Asset</span><span>Storage</span><span>Status</span>
        </div>
        <div className="max-h-[55vh] divide-y divide-border overflow-auto">
          {data.assets.map(asset => (
            <div key={asset.id} className="grid grid-cols-[1fr_140px_140px] gap-3 px-4 py-3 text-sm">
              <span className="truncate text-text-primary">{asset.label}</span>
              <span className="text-text-muted">{asset.storage}</span>
              <span className={
                (asset.path && availablePaths && !availablePaths.has(asset.path)) || asset.status === 'failed'
                  ? 'text-red-400'
                  : asset.status === 'pending' ? 'text-amber-400' : 'text-text-muted'
              }>
                {asset.path && availablePaths && !availablePaths.has(asset.path) ? 'missing' : asset.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectCockpit({ projectId, onManageEngines }: ProjectCockpitProps) {
  const [activeTab, setActiveTab] = useState<CockpitTab>('overview');
  const { data, error, loading, retry } = useProjectCockpit(projectId);

  if (loading) {
    return <div className="flex min-h-[24rem] items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <AlertTriangle className="mx-auto text-red-400" />
        <p className="mt-3 text-sm text-text-muted">Project intelligence could not be loaded.</p>
        <button type="button" onClick={retry} className="mt-4 rounded-lg bg-accent-gold px-4 py-2 text-sm text-background">Retry</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Boxes className="text-accent-gold" size={22} />
          <h2 className="font-serif text-xl font-semibold text-text-primary">Project Cockpit</h2>
        </div>
        <p className="mt-1 text-sm text-text-muted">One view of progress, integrity, connections, and story structure.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                activeTab === tab.id ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab === 'overview' && <Overview projectId={projectId} data={data} onManageEngines={onManageEngines} />}
      {activeTab === 'health' && <Health projectId={projectId} data={data} />}
      {activeTab === 'entities' && <EntityHub projectId={projectId} data={data} />}
      {activeTab === 'spine' && <NarrativeSpine projectId={projectId} data={data} />}
      {activeTab === 'intelligence' && <Intelligence data={data} />}
      {activeTab === 'assets' && <Assets projectId={projectId} data={data} />}
      {(['workflows', 'research', 'templates', 'publishing', 'ai'] as ProjectToolView[]).includes(activeTab as ProjectToolView) && (
        <ProjectToolsPanel projectId={projectId} view={activeTab as ProjectToolView} />
      )}
    </div>
  );
}
