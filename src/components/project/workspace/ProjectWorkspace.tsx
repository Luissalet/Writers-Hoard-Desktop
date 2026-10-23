import WorldEraToolbar from '@/services/worldEras/WorldEraToolbar';
import WorkspaceAppearance from '@/services/workspaceAppearance/WorkspaceAppearance';
import WorkspaceDecoration from '@/services/workspaceAppearance/WorkspaceDecoration';
import { useWorkspaceAppearance } from '@/services/workspaceAppearance/useWorkspaceAppearance';
import '@/services/workspaceAppearance/appearance.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Archive, ArrowLeft, ArrowUpRight, Columns2, Copy, Library, Plus, Undo2, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { EngineDefinition } from '@/engines/_types';
import EngineErrorBoundary from '@/components/common/EngineErrorBoundary';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import { flushPendingWrites } from '@/services/pendingWrites';
import { undoLast } from '@/services/undoJournal';
import { useLastUndoable } from '@/services/useUndoJournal';
import { matchesShortcut, TAB_REOPEN_SHORTCUT } from '@/components/common/shortcuts';
import { EnginePaneContext, activateEnginePane, registerEnginePaneScope, getActiveEnginePaneScope } from '@/engines/_shared/EnginePaneContext';
import PaneRouter from './PaneRouter';
import { paneEngineId, workspaceEra, routeInEra, workspaceRoute, workspaceRouteKey, type WorkspaceRoute } from './routes';
import { workspaceCopy } from './copy';
import { libraryCopy } from './library/copy';
import ProjectSoundtrack from './ProjectSoundtrack';
import WorkspaceTabBar from './WorkspaceTabBar';
import { findFreshUntouchedDocument, freshUntouchedDocument, keepFreshDocument, routeDocument } from './freshDocument';
import type { WorkspaceDocument } from './library/types';
import { closeTabs, duplicateTab, idsToCloseOthers, idsToCloseRight, loadTabsState, newTabId, renameTab, reopenClosed, routeOf, saveTabsState, tabJumpIndex, TAB_LIMIT, togglePin, type PaneTab, type TabsState } from './workspaceTabs';

const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
const ArchiveEngine = lazy(() => import('@/engines/archive/ArchiveEngine'));
const WorkspaceLibrary = lazy(() => import('./library/WorkspaceLibrary'));

export default function ProjectWorkspace({ projectId, engines, children }: { projectId: string; engines: EngineDefinition[]; children: ReactNode }) {
  const { locale, t } = useTranslation(), copy = workspaceCopy[locale];
  const location = useLocation(), navigate = useNavigate();
  const eraId = workspaceEra(workspaceRoute(location));
  const { appearance: primaryAppearance, style: primaryTheme } = useWorkspaceAppearance({ projectId, eraId });
  const enabledIds = useMemo(() => engines.map(engine => engine.id), [engines]);
  // The open tabs come back as they were left (per project, in this window's storage; see workspaceTabs.ts).
  const [restored] = useState(() => loadTabsState(projectId, enabledIds));
  const [tabs, setTabs] = useState<PaneTab[]>(restored.tabs), [activeId, setActiveId] = useState(restored.activeId), [closed, setClosed] = useState(restored.closed);
  const [closing, setClosing] = useState<{ ids: string[]; docs: WorkspaceDocument[]; remove: WorkspaceDocument[] } | null>(null);
  const lastUndo = useLastUndoable(projectId);
  const [choice, setChoice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ratio, setRatio] = useState(50);
  const [archiveEraId, setArchiveEraId] = useState<string>(), [libraryEraId, setLibraryEraId] = useState<string>();
  const focusedEra = () => { const focused = getActiveEnginePaneScope(); return focused?.projectId === projectId ? focused.eraId : eraId; };
  const [archiveOpen, setArchiveOpen] = useState(false), [libraryOpen, setLibraryOpen] = useState(false), [libraryBusy, setLibraryBusy] = useState(false);
  const [primaryOverlay, setPrimaryOverlay] = useState<HTMLDivElement | null>(null);
  const [primaryMeasure, primaryWidth] = usePaneWidth();
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
  const guarded = useCallback(async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { if ((await flushPendingWrites()).ok) await action(); else setError(copy.failure); }
    catch { setError(copy.failure); }
    finally { setBusy(false); }
  }, [busy, copy.failure]);
  const open = useCallback((route: WorkspaceRoute, forceNew = false) => {
    const engineId = paneEngineId(route, projectId, enabledIds);
    if (!engineId) { void guarded(() => navigate(workspaceRouteKey(route))); return; }
    const existing = !forceNew && tabs.find(tab => workspaceRouteKey(routeOf(tab)) === workspaceRouteKey(route));
    if (existing) { setActiveId(existing.id); activateEnginePane(existing.id); return; }
    if (tabs.length >= TAB_LIMIT) { setError(copy.limit); return; }
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
  // What is on screen right now. Handlers that wait (saving, asking) read it AFTER the wait, so an update that
  // landed in between (a tab renamed, a title reported, another tab opened) is never overwritten.
  const latest = useRef<{ state: TabsState; route: WorkspaceRoute }>({ state: { tabs, activeId: active?.id ?? '', closed }, route: workspaceRoute(location) });
  useLayoutEffect(() => { latest.current = { state: { tabs, activeId: active?.id ?? '', closed }, route: workspaceRoute(location) }; });
  const currentState = (): TabsState => latest.current.state;
  const applyState = (next: TabsState) => { const previousActive = latest.current.state.activeId; latest.current = { ...latest.current, state: next }; setTabs(next.tabs); setActiveId(next.activeId); setClosed(next.closed); if (next.activeId && next.activeId !== previousActive) activateEnginePane(next.activeId); else if (!next.tabs.length) activateEnginePane(primaryId); };
  const select = (id: string) => { setActiveId(id); activateEnginePane(id); };
  const deleteFresh = async (documents: WorkspaceDocument[]) => {
    // After the tab has unmounted, through the document's own delete path (it archives; the toast offers Deshacer).
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      // The writer may have typed into it (or opened it again) since they chose: ask again now and keep what is no longer empty or is on screen.
      const { state, route } = latest.current, shown = [route, ...state.tabs.map(routeOf)].map(item => routeDocument(item, projectId)).filter(Boolean);
      const still: WorkspaceDocument[] = [];
      for (const document of documents) {
        if (shown.some(item => item?.entityId === document.entityId)) continue;
        if (await freshUntouchedDocument(projectId, document.engineId as 'codex' | 'writings', document.entityId)) still.push(document);
      }
      if (still.length) await (await import('./library/bulkDelete')).deleteLibraryDocuments(still, projectId);
    } catch { setError(copy.freshDeleteFailed); }
  };
  const finishClose = (ids: string[], remove: WorkspaceDocument[]) => { applyState(closeTabs(currentState(), ids)); if (remove.length) void deleteFresh(remove); };
  /** Close tabs after saving; a brand-new empty document in one of them asks "keep or delete" first. */
  const requestClose = (ids: string[]) => void guarded(async () => {
    // Read the state once saving has finished (not the render this handler was made in).
    const closingIds = new Set(ids), { state, route } = latest.current;
    const shown = [route, ...state.tabs.filter(tab => !closingIds.has(tab.id)).map(routeOf)].map(item => routeDocument(item, projectId)).filter(Boolean);
    const docs: WorkspaceDocument[] = [];
    for (const tab of state.tabs) {
      if (!closingIds.has(tab.id) || !routeDocument(routeOf(tab), projectId)) continue;
      const found = await findFreshUntouchedDocument(projectId, routeOf(tab));
      if (found && !docs.some(item => item.entityId === found.entityId) && !shown.some(item => item?.entityId === found.entityId)) docs.push(found);
    }
    if (docs.length) setClosing({ ids, docs, remove: [] }); else finishClose(ids, []);
  });
  const decideFresh = (choice: 'keep' | 'delete') => {
    if (!closing) return;
    const [document, ...rest] = closing.docs;
    if (choice === 'keep') keepFreshDocument(projectId, document.engineId, document.entityId);
    const remove = choice === 'delete' ? [...closing.remove, document] : closing.remove;
    if (rest.length) { setClosing({ ...closing, docs: rest, remove }); return; }
    setClosing(null); finishClose(closing.ids, remove);
  };
  const closeTab = (id: string) => { if (!tabs.find(tab => tab.id === id)?.pinned) requestClose([id]); };
  /** `exact`: reopen precisely that entry of the list (nothing if its tool is off); otherwise the first usable one from `at`. */
  const reopen = (at = 0, exact = false) => {
    const { closed: stack } = currentState();
    const usable = exact ? (stack[at] && enabledIds.includes(stack[at].engineId) ? at : -1) : stack.findIndex((entry, index) => index >= at && enabledIds.includes(entry.engineId));
    if (usable < 0) return;
    const next = reopenClosed(currentState(), newTabId(), usable);
    if (!next) { setError(copy.limit); return; }
    setError(''); applyState(next); activateEnginePane(next.activeId);
  };
  const duplicate = (id: string) => { const next = duplicateTab(tabs, id, newTabId()); if (!next) { setError(copy.limit); return; } setError(''); setTabs(next); };
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => { keys.current = event => {
    // Not while a key is held down, not while a dialog owns the keyboard.
    if (event.defaultPrevented || event.repeat || closing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (matchesShortcut(event, TAB_REOPEN_SHORTCUT)) {
      // Only take the keystroke when there is something to bring back; otherwise the browser's own meaning stays.
      if (currentState().closed.some(entry => enabledIds.includes(entry.engineId))) { event.preventDefault(); reopen(0); }
      return;
    }
    const at = tabJumpIndex(event), target = at === null ? undefined : liveTabs[at];
    if (target) { event.preventDefault(); select(target.id); }
  }; });
  useEffect(() => { const listener = (event: KeyboardEvent) => keys.current(event); window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, []);
  useEffect(() => { saveTabsState(projectId, { tabs, activeId, closed }); }, [projectId, tabs, activeId, closed]);
  const openLibraryDocument = async (url: string, destination: 'main' | 'beside'): Promise<boolean> => {
    if (busy) return false;
    const route = workspaceRoute(url);
    if (destination === 'beside' && !paneEngineId(route, projectId, enabledIds)) return false;
    if (destination === 'beside' && tabs.length >= TAB_LIMIT && !tabs.some(tab => workspaceRouteKey(routeOf(tab)) === workspaceRouteKey(route))) { setError(copy.limit); return false; }
    setBusy(true); setError('');
    try {
      if (!(await flushPendingWrites()).ok) { setError(copy.failure); return false; }
      if (destination === 'beside') open(route); else navigate(url);
      setLibraryOpen(false); return true;
    } catch { setError(copy.failure); return false; }
    finally { setBusy(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="project-workspace">
    <div data-tour="project-workspace" className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-deep px-4 py-2">
      <div className="mr-auto flex min-w-0 flex-wrap gap-2"><button type="button" className={button} data-testid="workspace-library-open" data-tour="workspace-library" onClick={() => { setLibraryEraId(focusedEra()); setLibraryOpen(true); }}><Library size={15} aria-hidden="true" />{libraryCopy[locale].title}</button><button type="button" className={button} data-testid="workspace-archive" onClick={() => { setArchiveEraId(focusedEra()); setArchiveOpen(true); }}><Archive size={15} aria-hidden="true" />{copy.archive}</button><ProjectSoundtrack key={projectId} projectId={projectId} locale={locale} />{lastUndo && <button type="button" className={button} data-testid="workspace-undo-last" title={copy.undoLast.replace('{label}', lastUndo.label)} onClick={() => void undoLast(projectId)}><Undo2 size={15} aria-hidden="true" /><span className="max-w-48 truncate">{copy.undoLast.replace('{label}', lastUndo.label)}</span></button>}</div>
      {split && <span className="mr-auto text-xs text-text-muted">{copy.help}</span>}
      {split && <label className="hidden items-center gap-2 text-xs text-text-muted xl:flex">{copy.resize}<input data-testid="workspace-resize" aria-label={copy.resize} type="range" min={35} max={65} value={ratio} onChange={event => setRatio(Number(event.target.value))} className="w-20 accent-accent-gold" /></label>}
      {!split ? <button type="button" className={button} disabled={busy || !engines.length} data-testid="workspace-open" onClick={() => { const engine = engines.find(item => item.id === 'codex' && !location.pathname.endsWith('/codex')) ?? engines.find(item => !location.pathname.endsWith(`/${item.id}`)) ?? engines[0]; if (engine) open(workspaceRoute(`/project/${encodeURIComponent(projectId)}/${engine.id}`, workspaceRoute(location))); }}><Columns2 size={16} aria-hidden="true" />{copy.open}</button>
        : <button type="button" className={button} disabled={busy} data-testid="workspace-close" onClick={() => requestClose(tabs.map(tab => tab.id))}><X size={15} aria-hidden="true" />{copy.close}</button>}
    </div>
    {error && <p role="alert" className="border-b border-border px-4 py-3 text-sm text-danger">{error}</p>}
    <div className={`grid min-h-0 flex-1 overflow-auto ${split ? 'grid-cols-1 xl:grid-cols-[minmax(0,var(--primary-fr))_minmax(0,var(--secondary-fr))]' : 'grid-cols-1'}`} style={{ '--primary-fr': `${ratio}fr`, '--secondary-fr': `${100 - ratio}fr` } as CSSProperties}>
      <EnginePaneContext.Provider value={primaryPane}><div data-testid="workspace-primary" data-engine-pane-id={primaryId} aria-label={split ? copy.primary : undefined} onPointerDownCapture={() => activateEnginePane(primaryId)} onFocusCapture={() => activateEnginePane(primaryId)} style={primaryTheme} data-workspace-performance={primaryAppearance?.effective.performance || undefined} data-workspace-prose={primaryAppearance?.effective.proseFont || undefined} className={`workspace-appearance-pane relative flex min-w-0 flex-col overflow-hidden ${split ? 'min-h-[30rem] xl:min-h-0' : ''}`}><WorkspaceDecoration /><WorldEraToolbar projectId={projectId} eraId={eraId} onChange={next => void guarded(() => navigate(workspaceRouteKey(routeInEra(workspaceRoute(location), next))))} /><WorkspaceAppearance projectId={projectId} eraId={eraId} /><div key={`${primaryId}:${eraId ?? 'base'}`} ref={primaryMeasure} className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div><div ref={setPrimaryOverlay} className="pointer-events-none absolute inset-0 z-30" /></div></EnginePaneContext.Provider>
      {split && <aside className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden border-t border-border bg-deep xl:min-h-0 xl:border-l xl:border-t-0" aria-label={copy.title} data-testid="workspace-secondary">
        <header className="space-y-2 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold text-text-primary">{copy.title}</span><button type="button" className={button} data-testid="workspace-duplicate-main" disabled={busy || tabs.length >= TAB_LIMIT || !paneEngineId(workspaceRoute(location), projectId, enabledIds)} aria-label={copy.duplicate} title={copy.duplicate} onClick={() => open(workspaceRoute(location), true)}><Copy size={15} aria-hidden="true" /></button><button type="button" className={button} data-testid="workspace-to-main" disabled={busy || !active} aria-label={copy.main} title={copy.main} onClick={() => active && void guarded(() => navigate(workspaceRouteKey(routeOf(active))))}><ArrowUpRight size={15} aria-hidden="true" /></button></div>
          <div className="flex flex-wrap items-center gap-2"><label className="min-w-32 flex-1"><span className="sr-only">{copy.add}</span><select data-testid="workspace-engine-choice" className="min-h-9 w-full rounded-lg border border-border bg-deep px-2 text-sm text-text-primary" value={choice || engines[0]?.id || ''} onChange={event => setChoice(event.target.value)}>{engines.map(engine => <option key={engine.id} value={engine.id}>{t(`engines.${engine.id}.name`) === `engines.${engine.id}.name` ? engine.name : t(`engines.${engine.id}.name`)}</option>)}</select></label><button type="button" className={button} disabled={busy || tabs.length >= TAB_LIMIT} data-testid="workspace-add-tab" onClick={() => open(workspaceRoute(`/project/${encodeURIComponent(projectId)}/${choice || engines[0]?.id}`, workspaceRoute(location)), true)}><Plus size={15} aria-hidden="true" />{copy.newTab}</button></div>
          <WorkspaceTabBar tabs={liveTabs} openCount={tabs.length} activeId={active?.id} engines={engines} closed={closed} busy={busy} onSelect={select} onClose={closeTab} onRename={(id, label) => setTabs(previous => renameTab(previous, id, label))} onPin={id => setTabs(previous => togglePin(previous, id))} onDuplicate={duplicate} onCloseOthers={id => { const ids = idsToCloseOthers(tabs, id); if (ids.length) requestClose(ids); }} onCloseRight={id => { const ids = idsToCloseRight(tabs, id); if (ids.length) requestClose(ids); }} onReopen={(at, exact) => reopen(at, exact)} />
        </header>
        {liveTabs.map(tab => <SecondaryTab key={tab.id} tab={tab} openBeside={openBeside} projectId={projectId} engine={engines.find(item => item.id === tab.engineId)!} visible={tab.id === active?.id} onEraChange={next => void guarded(() => navigateTab(tab.id, routeInEra(routeOf(tab), next), true))} onTitle={reportTitle} onNavigate={(route, replace) => navigateTab(tab.id, route, replace)} onBack={delta => setTabs(previous => previous.map(item => item.id === tab.id ? { ...item, index: Math.max(0, Math.min(item.history.length - 1, item.index + delta)) } : item))} />)}
      </aside>}
    </div>
    <Modal open={!!closing} onClose={() => setClosing(null)} title={copy.freshTitle} dismissible={false}>{closing && <div className="space-y-4" data-testid="workspace-fresh-prompt"><p className="text-sm text-text-primary">{copy.freshBody.replace('{title}', closing.docs[0].title || copy.untitled)}</p><div className="flex flex-wrap justify-end gap-2"><button type="button" className={button} data-testid="workspace-fresh-cancel" onClick={() => setClosing(null)}>{copy.freshCancel}</button><button type="button" className={`${button} text-danger`} data-testid="workspace-fresh-delete" onClick={() => decideFresh('delete')}>{copy.freshDelete}</button><button type="button" autoFocus className={button} data-testid="workspace-fresh-keep" onClick={() => decideFresh('keep')}>{copy.freshKeep}</button></div></div>}</Modal>
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
  // A tab restored from the last session mounts its tool the first time it is shown, not all at once at start-up.
  const [everShown, setEverShown] = useState(visible);
  if (visible && !everShown) setEverShown(true);
  const setTitle = useCallback((title: string | undefined) => onTitle(tab.id, title), [onTitle, tab.id]);
  const pane = useMemo(() => ({ instanceId: tab.id, projectId, eraId, visible, width, overlayTarget, reportTitle: setTitle, openBeside, navigate: (to: string) => onNavigate(workspaceRoute(to, route)) }), [onNavigate, route, tab.id, projectId, eraId, visible, setTitle, width, overlayTarget, openBeside]);
  useEffect(() => registerEnginePaneScope(tab.id, { projectId, eraId, navigate: pane.navigate }), [tab.id, projectId, eraId, pane.navigate]);
  return <EnginePaneContext.Provider value={pane}><PaneRouter projectId={projectId} engineId={engine.id} route={route} onNavigate={onNavigate} onBack={onBack}>
    <div id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={!visible} inert={!visible} data-engine-pane-id={tab.id} data-testid={`workspace-panel-${tab.id}`} style={theme} data-workspace-performance={appearance?.effective.performance || undefined} data-workspace-prose={appearance?.effective.proseFont || undefined} className="workspace-appearance-pane relative flex min-h-0 flex-1 flex-col overflow-hidden [&[hidden]]:hidden" onPointerDownCapture={() => activateEnginePane(tab.id)} onFocusCapture={() => activateEnginePane(tab.id)}><WorkspaceDecoration /><WorldEraToolbar projectId={projectId} eraId={eraId} onChange={onEraChange} /><WorkspaceAppearance projectId={projectId} eraId={eraId} /><div key={`${tab.id}:${eraId ?? 'base'}`} ref={measure} className="min-h-0 flex-1 overflow-y-auto p-4">
      {tab.index > 0 && <button type="button" className={`${button} mb-3`} aria-label={copy.back} onClick={() => onBack(-1)}><ArrowLeft size={15} aria-hidden="true" />{copy.back}</button>}
      <EngineErrorBoundary resetKey={`${projectId}:${tab.id}:${engine.id}`} title={t('project.engineError.title')} message={t('project.engineError.message')} retryLabel={t('project.engineError.retry')} detailsLabel={t('project.engineError.details')}>{everShown && <Suspense fallback={<p className="p-5 text-sm text-text-muted">{copy.loading}</p>}><engine.component projectId={projectId} /></Suspense>}</EngineErrorBoundary>
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
