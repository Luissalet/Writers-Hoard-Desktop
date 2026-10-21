import WorldEraToolbar from '@/services/worldEras/WorldEraToolbar';
import WorkspaceAppearance from '@/services/workspaceAppearance/WorkspaceAppearance';
import WorkspaceDecoration from '@/services/workspaceAppearance/WorkspaceDecoration';
import { useWorkspaceAppearance } from '@/services/workspaceAppearance/useWorkspaceAppearance';
import '@/services/workspaceAppearance/appearance.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Archive, ArrowLeft, ArrowUpRight, Columns2, Copy, Library, Plus, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { EngineDefinition } from '@/engines/_types';
import EngineErrorBoundary from '@/components/common/EngineErrorBoundary';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { flushPendingWrites } from '@/services/pendingWrites';
import { EnginePaneContext, activateEnginePane, registerEnginePaneScope, getActiveEnginePaneScope } from '@/engines/_shared/EnginePaneContext';
import PaneRouter from './PaneRouter';
import { paneEngineId, workspaceEra, routeInEra, workspaceRoute, workspaceRouteKey, type WorkspaceRoute } from './routes';
import { workspaceCopy } from './copy';
import { libraryCopy } from './library/copy';
import ProjectSoundtrack from './ProjectSoundtrack';

interface PaneTab { id: string; engineId: string; history: WorkspaceRoute[]; index: number; documentTitle?: string }
const routeOf = (tab: PaneTab) => tab.history[tab.index];
const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const ArchiveEngine = lazy(() => import('@/engines/archive/ArchiveEngine'));
const WorkspaceLibrary = lazy(() => import('./library/WorkspaceLibrary'));

export default function ProjectWorkspace({ projectId, engines, children }: { projectId: string; engines: EngineDefinition[]; children: ReactNode }) {
  const { locale, t } = useTranslation(), copy = workspaceCopy[locale];
  const location = useLocation(), navigate = useNavigate();
  const eraId = workspaceEra(workspaceRoute(location));
  const { appearance: primaryAppearance, style: primaryTheme } = useWorkspaceAppearance({ projectId, eraId });
  const [tabs, setTabs] = useState<PaneTab[]>([]), [activeId, setActiveId] = useState('');
  const [choice, setChoice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ratio, setRatio] = useState(50);
  const [archiveEraId, setArchiveEraId] = useState<string>(), [libraryEraId, setLibraryEraId] = useState<string>();
  const focusedEra = () => { const focused = getActiveEnginePaneScope(); return focused?.projectId === projectId ? focused.eraId : eraId; };
  const [archiveOpen, setArchiveOpen] = useState(false), [libraryOpen, setLibraryOpen] = useState(false), [libraryBusy, setLibraryBusy] = useState(false);
  const [primaryOverlay, setPrimaryOverlay] = useState<HTMLDivElement | null>(null);
  const [primaryMeasure, primaryWidth] = usePaneWidth();
  const enabledIds = useMemo(() => engines.map(engine => engine.id), [engines]);
  const primaryId = `primary:${projectId}`;
  const requestBeside=useRef<(to:string)=>void>(()=>{});
  const openBeside=useCallback((to:string)=>requestBeside.current(to),[]);
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0];
  const liveTabs = tabs.filter(tab => enabledIds.includes(tab.engineId));
  const reportTitle = useCallback((id: string, title: string | undefined) => setTabs(previous => previous.map(tab => tab.id === id && tab.documentTitle !== title ? { ...tab, documentTitle: title } : tab)), []);
  const split = liveTabs.length > 0;
  const primaryPane = useMemo(() => ({ instanceId: primaryId, projectId, eraId, visible: true, primary: true, width: primaryWidth, overlayTarget: split ? primaryOverlay : null, openBeside, navigate: (to: string) => navigate(workspaceRouteKey(workspaceRoute(to, workspaceRoute(location)))) }), [primaryId, projectId, eraId, primaryOverlay, primaryWidth, split, navigate, location, openBeside]);
  useEffect(() => registerEnginePaneScope(primaryId, { projectId, eraId, navigate: primaryPane.navigate }), [primaryId, projectId, eraId, primaryPane.navigate]);
  useEffect(() => { activateEnginePane(primaryId); }, [location.pathname, location.search, primaryId]);
  const guarded = useCallback(async (action: () => void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { if ((await flushPendingWrites()).ok) action(); else setError(copy.failure); }
    catch { setError(copy.failure); }
    finally { setBusy(false); }
  }, [busy, copy.failure]);
  const open = useCallback((route: WorkspaceRoute, forceNew = false) => {
    const engineId = paneEngineId(route, projectId, enabledIds);
    if (!engineId) { void guarded(() => navigate(workspaceRouteKey(route))); return; }
    const existing = !forceNew && tabs.find(tab => workspaceRouteKey(routeOf(tab)) === workspaceRouteKey(route));
    if (existing) { setActiveId(existing.id); activateEnginePane(existing.id); return; }
    if (tabs.length >= 4) { setError(copy.limit); return; }
    const id = `companion:${crypto.randomUUID()}`;
    setTabs(previous => [...previous, { id, engineId, history: [route], index: 0 }]); setActiveId(id); activateEnginePane(id); setError('');
  }, [copy.limit, enabledIds, guarded, navigate, projectId, tabs]);
  useLayoutEffect(()=>{requestBeside.current=to=>{void guarded(()=>open(workspaceRoute(to)));};return()=>{requestBeside.current=()=>{};};},[guarded,open]);
  const navigateTab = useCallback((id: string, route: WorkspaceRoute, replace = false) => {
    const tab = tabs.find(item => item.id === id), engineId = paneEngineId(route, projectId, enabledIds);
    if (!tab) return;
    if (!engineId) { void guarded(() => navigate(workspaceRouteKey(route))); return; }
    if (engineId !== tab.engineId) { open(route); return; }
    setTabs(previous => previous.map(item => item.id !== id ? item : { ...item, history: replace ? item.history.map((old, index) => index === item.index ? route : old) : [...item.history.slice(0, item.index + 1), route], index: replace ? item.index : item.index + 1 }));
  }, [enabledIds, guarded, navigate, open, projectId, tabs]);
  const closeTab = (id: string) => void guarded(() => { setTabs(previous => previous.filter(tab => tab.id !== id)); if (activeId === id) setActiveId(tabs.find(tab => tab.id !== id)?.id ?? ''); });
  const openLibraryDocument = async (url: string, destination: 'main' | 'beside'): Promise<boolean> => {
    if (busy) return false;
    const route = workspaceRoute(url);
    if (destination === 'beside' && !paneEngineId(route, projectId, enabledIds)) return false;
    if (destination === 'beside' && tabs.length >= 4 && !tabs.some(tab => workspaceRouteKey(routeOf(tab)) === workspaceRouteKey(route))) { setError(copy.limit); return false; }
    setBusy(true); setError('');
    try {
      if (!(await flushPendingWrites()).ok) { setError(copy.failure); return false; }
      if (destination === 'beside') open(route); else navigate(url);
      setLibraryOpen(false); return true;
    } catch { setError(copy.failure); return false; }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="project-workspace">
    <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-deep px-4 py-2">
      <div className="mr-auto flex min-w-0 flex-wrap gap-2"><button type="button" className={button} data-testid="workspace-library-open" onClick={() => { setLibraryEraId(focusedEra()); setLibraryOpen(true); }}><Library size={15} aria-hidden="true" />{libraryCopy[locale].title}</button><button type="button" className={button} data-testid="workspace-archive" onClick={() => { setArchiveEraId(focusedEra()); setArchiveOpen(true); }}><Archive size={15} aria-hidden="true" />{copy.archive}</button><ProjectSoundtrack key={projectId} projectId={projectId} locale={locale} /></div>
      {split && <span className="mr-auto text-xs text-text-muted">{copy.help}</span>}
      {split && <label className="hidden items-center gap-2 text-xs text-text-muted xl:flex">{copy.resize}<input data-testid="workspace-resize" aria-label={copy.resize} type="range" min={35} max={65} value={ratio} onChange={event => setRatio(Number(event.target.value))} className="w-20 accent-accent-gold" /></label>}
      {!split ? <button type="button" className={button} disabled={busy || !engines.length} data-testid="workspace-open" onClick={() => { const engine = engines.find(item => item.id === 'codex' && !location.pathname.endsWith('/codex')) ?? engines.find(item => !location.pathname.endsWith(`/${item.id}`)) ?? engines[0]; if (engine) open(workspaceRoute(`/project/${encodeURIComponent(projectId)}/${engine.id}`, workspaceRoute(location))); }}><Columns2 size={16} aria-hidden="true" />{copy.open}</button>
        : <button type="button" className={button} disabled={busy} data-testid="workspace-close" onClick={() => void guarded(() => { setTabs([]); setActiveId(''); activateEnginePane(primaryId); })}><X size={15} aria-hidden="true" />{copy.close}</button>}
    </div>
    {error && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-danger">{error}</p>}
    <div className={`grid min-h-0 flex-1 overflow-auto ${split ? 'grid-cols-1 xl:grid-cols-[minmax(0,var(--primary-fr))_minmax(0,var(--secondary-fr))]' : 'grid-cols-1'}`} style={{ '--primary-fr': `${ratio}fr`, '--secondary-fr': `${100 - ratio}fr` } as CSSProperties}>
      <EnginePaneContext.Provider value={primaryPane}><div data-testid="workspace-primary" data-engine-pane-id={primaryId} aria-label={split ? copy.primary : undefined} onPointerDownCapture={() => activateEnginePane(primaryId)} onFocusCapture={() => activateEnginePane(primaryId)} style={primaryTheme} data-workspace-performance={primaryAppearance?.effective.performance || undefined} data-workspace-prose={primaryAppearance?.effective.proseFont || undefined} className={`workspace-appearance-pane relative flex min-w-0 flex-col overflow-hidden ${split ? 'min-h-[30rem] xl:min-h-0' : ''}`}><WorkspaceDecoration /><WorldEraToolbar projectId={projectId} eraId={eraId} onChange={next => void guarded(() => navigate(workspaceRouteKey(routeInEra(workspaceRoute(location), next))))} /><WorkspaceAppearance projectId={projectId} eraId={eraId} /><div key={`${primaryId}:${eraId ?? 'base'}`} ref={primaryMeasure} className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div><div ref={setPrimaryOverlay} className="pointer-events-none absolute inset-0 z-30" /></div></EnginePaneContext.Provider>
      {split && <aside className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden border-t border-border bg-deep xl:min-h-0 xl:border-l xl:border-t-0" aria-label={copy.title} data-testid="workspace-secondary">
        <header className="space-y-2 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold text-text-primary">{copy.title}</span><button type="button" className={button} data-testid="workspace-duplicate-main" disabled={busy || tabs.length >= 4 || !paneEngineId(workspaceRoute(location), projectId, enabledIds)} aria-label={copy.duplicate} title={copy.duplicate} onClick={() => open(workspaceRoute(location), true)}><Copy size={15} aria-hidden="true" /></button><button type="button" className={button} data-testid="workspace-to-main" disabled={busy || !active} aria-label={copy.main} title={copy.main} onClick={() => active && void guarded(() => navigate(workspaceRouteKey(routeOf(active))))}><ArrowUpRight size={15} aria-hidden="true" /></button></div>
          <div className="flex flex-wrap items-center gap-2"><label className="min-w-32 flex-1"><span className="sr-only">{copy.add}</span><select data-testid="workspace-engine-choice" className="min-h-9 w-full rounded-lg border border-border bg-deep px-2 text-sm text-text-primary" value={choice || engines[0]?.id || ''} onChange={event => setChoice(event.target.value)}>{engines.map(engine => <option key={engine.id} value={engine.id}>{t(`engines.${engine.id}.name`) === `engines.${engine.id}.name` ? engine.name : t(`engines.${engine.id}.name`)}</option>)}</select></label><button type="button" className={button} disabled={busy || tabs.length >= 4} data-testid="workspace-add-tab" onClick={() => open(workspaceRoute(`/project/${encodeURIComponent(projectId)}/${choice || engines[0]?.id}`, workspaceRoute(location)), true)}><Plus size={15} aria-hidden="true" />{copy.newTab}</button></div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={copy.title}>{liveTabs.map((tab, index) => { const engine = engines.find(item => item.id === tab.engineId)!; return <div key={tab.id} className="flex min-w-0 items-center"><button type="button" role="tab" id={`tab-${tab.id}`} aria-selected={tab.id === active?.id} aria-controls={`panel-${tab.id}`} data-testid={`workspace-tab-${tab.id}`} className={`min-h-9 max-w-60 truncate rounded-l-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold ${tab.id === active?.id ? 'bg-elevated text-accent-gold' : 'text-text-muted'}`} onClick={() => { setActiveId(tab.id); activateEnginePane(tab.id); }}>{tab.documentTitle || t(`engines.${engine.id}.name`) || engine.name} · {index + 1}</button><button type="button" className="min-h-9 rounded-r-lg border border-l-0 border-border px-2 text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold" disabled={busy} aria-label={`${copy.closeTab}: ${engine.name} ${index + 1}`} data-testid={`workspace-close-tab-${tab.id}`} onClick={() => closeTab(tab.id)}><X size={13} aria-hidden="true" /></button></div>; })}</div>
        </header>
        {liveTabs.map(tab => <SecondaryTab key={tab.id} tab={tab} openBeside={openBeside} projectId={projectId} engine={engines.find(item => item.id === tab.engineId)!} visible={tab.id === active?.id} onEraChange={next => void guarded(() => navigateTab(tab.id, routeInEra(routeOf(tab), next), true))} onTitle={reportTitle} onNavigate={(route, replace) => navigateTab(tab.id, route, replace)} onBack={delta => setTabs(previous => previous.map(item => item.id === tab.id ? { ...item, index: Math.max(0, Math.min(item.history.length - 1, item.index + delta)) } : item))} />)}
      </aside>}
    </div>
    <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title={copy.archive} fullscreen><Suspense fallback={<p className="p-5 text-text-muted">{copy.loading}</p>}><ArchiveEngine key={archiveEraId ?? 'base'} projectId={projectId} eraId={archiveEraId} /></Suspense></Modal>
    <Modal open={libraryOpen} onClose={() => { if (!busy && !libraryBusy) setLibraryOpen(false); }} title={libraryCopy[locale].title} busy={busy || libraryBusy} fullscreen><Suspense fallback={<p className="p-5 text-text-muted">{copy.loading}</p>}><WorkspaceLibrary key={libraryEraId ?? 'base'} projectId={projectId} eraId={libraryEraId} enabledEngineIds={enabledIds} onOpen={openLibraryDocument} onManage={() => openLibraryDocument(`/project/${encodeURIComponent(projectId)}/overview?manage=1`, 'main')} onBusyChange={setLibraryBusy} /></Suspense></Modal>
  </div>;
}

function SecondaryTab({ tab, projectId, engine, visible, onEraChange, onTitle, onNavigate, onBack, openBeside }: { openBeside:(to:string)=>void; tab: PaneTab; projectId: string; engine: EngineDefinition; visible: boolean; onEraChange: (eraId?: string) => void; onTitle: (id: string, title: string | undefined) => void; onNavigate: (route: WorkspaceRoute, replace?: boolean) => void; onBack: (delta: number) => void }) {
  const { locale, t } = useTranslation(), copy = workspaceCopy[locale], route = routeOf(tab);
  const eraId = workspaceEra(route);
  const { appearance, style: theme } = useWorkspaceAppearance({ projectId, eraId });
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null);
  const [measure, width] = usePaneWidth();
  const setTitle = useCallback((title: string | undefined) => onTitle(tab.id, title), [onTitle, tab.id]);
  const pane = useMemo(() => ({ instanceId: tab.id, projectId, eraId, visible, width, overlayTarget, reportTitle: setTitle, openBeside, navigate: (to: string) => onNavigate(workspaceRoute(to, route)) }), [onNavigate, route, tab.id, projectId, eraId, visible, setTitle, width, overlayTarget, openBeside]);
  useEffect(() => registerEnginePaneScope(tab.id, { projectId, eraId, navigate: pane.navigate }), [tab.id, projectId, eraId, pane.navigate]);
  return <EnginePaneContext.Provider value={pane}><PaneRouter projectId={projectId} engineId={engine.id} route={route} onNavigate={onNavigate} onBack={onBack}>
    <div id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={!visible} inert={!visible} data-engine-pane-id={tab.id} data-testid={`workspace-panel-${tab.id}`} style={theme} data-workspace-performance={appearance?.effective.performance || undefined} data-workspace-prose={appearance?.effective.proseFont || undefined} className="workspace-appearance-pane relative flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden" onPointerDownCapture={() => activateEnginePane(tab.id)} onFocusCapture={() => activateEnginePane(tab.id)}><WorkspaceDecoration /><WorldEraToolbar projectId={projectId} eraId={eraId} onChange={onEraChange} /><WorkspaceAppearance projectId={projectId} eraId={eraId} /><div key={`${tab.id}:${eraId ?? 'base'}`} ref={measure} className="min-h-0 flex-1 overflow-y-auto p-4">
      {tab.index > 0 && <button type="button" className={`${button} mb-3`} aria-label={copy.back} onClick={() => onBack(-1)}><ArrowLeft size={15} aria-hidden="true" />{copy.back}</button>}
      <EngineErrorBoundary resetKey={`${projectId}:${tab.id}:${engine.id}`} title={t('project.engineError.title')} message={t('project.engineError.message')} retryLabel={t('project.engineError.retry')} detailsLabel={t('project.engineError.details')}><Suspense fallback={<p className="p-5 text-sm text-text-muted">{copy.loading}</p>}><engine.component projectId={projectId} /></Suspense></EngineErrorBoundary>
    </div><div ref={setOverlayTarget} className="pointer-events-none absolute inset-0 z-30" /></div>
  </PaneRouter></EnginePaneContext.Provider>;
}

function usePaneWidth(): [(element: HTMLDivElement | null) => void, number | undefined] {
  const [element, setElement] = useState<HTMLDivElement | null>(null), [width, setWidth] = useState<number>();
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(entries => { const next = entries[0]?.contentRect.width; if (next && next > 0) setWidth(Math.round(next)); });
    observer.observe(element); return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}
