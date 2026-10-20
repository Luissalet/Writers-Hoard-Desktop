import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Columns2, Save, X } from 'lucide-react';
import { db } from '@/db';
import { useTranslation, registerLocaleStrings } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { closeAppWindow, keepAppWindow, registerCloseGuard, reportUnsavedWork } from '@/services/closeGuard';
import { isDesktop } from '@/utils/platform';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { registerPendingFlusher } from '@/services/pendingWrites';
import { deleteParallelDraft, loadPaneDocument, paneTargetKey, promoteParallelDraft, type PaneDocument, type PaneTarget } from '../parallelDrafts';
import { type ParallelEditorSession, type PaneState } from '../parallelSession';
import ParallelDraftPane, { parallelButton, type PaneSelectionMap } from './ParallelDraftPane';
import en from '../locales/en';
import es from '../locales/es';
registerLocaleStrings({ es, en });

export interface ParallelWorkspaceStart { writingId: string; draftId?: string; compareWritingId?: string; compareDraftId?: string; split?: boolean; selection?: { from: number; to: number } }
interface Props { projectId: string; start: ParallelWorkspaceStart; onClose: (writingId: string) => Promise<void> }

export default function ParallelDraftWorkspace({ projectId, start, onClose }: Props) {
  const { t, locale } = useTranslation();
  const pane = useEnginePane();
  const saveOwner = `parallel-workspace:${pane?.instanceId ?? 'main'}:${projectId}`;
  const navigate = useNavigate();
  const location = useLocation();
  const [left, setLeft] = useState<PaneTarget>({ writingId: start.writingId, draftId: start.draftId });
  const [right, setRight] = useState<PaneTarget | null>(start.compareWritingId || start.split ? { writingId: start.compareWritingId ?? start.writingId, draftId: start.compareDraftId } : null);
  const targets = useRef({ left, right });
  const sessions = useRef(new Map<string, ParallelEditorSession>());
  const states = useRef(new Map<string, PaneState>());
  const requests = useRef({ left: 0, right: 0 });
  const selections = useRef<PaneSelectionMap>(new Map(start.selection && !start.draftId ? [[`left:${paneTargetKey({ writingId: start.writingId })}`, start.selection]] : []));
  const [unsaved, setUnsaved] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const [exit, setExit] = useState<'back' | 'window' | null>(null);
  const [pending, setPending] = useState<{ kind: 'promote' | 'delete'; document: PaneDocument; currentVersion?: number } | null>(null);
  const chapters = useLiveQuery(async () => {
    const result: Array<{ id: string; title: string; chapter?: number }> = [];
    await db.writings.where('projectId').equals(projectId).each(writing => { if (!writing.isGoogleDoc) result.push({ id: writing.id, title: writing.title, chapter: writing.chapter }); });
    return result.sort((a, b) => (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
  }, [projectId]) ?? [];
  const stateChanged = useCallback((pane: string, state: PaneState) => {
    states.current.set(pane, state); setUnsaved([...states.current.values()].some(value => value.status !== 'saved'));
  }, []);
  const register = useCallback((pane: string, session: ParallelEditorSession) => {
    sessions.current.set(pane, session);
    return () => { if (sessions.current.get(pane) === session) { sessions.current.delete(pane); states.current.delete(pane); setUnsaved([...states.current.values()].some(value => value.status !== 'saved')); } };
  }, []);
  const flushAll = useCallback(async () => {
    const outcomes = await Promise.all([...sessions.current.values()].map(session => session.flush()));
    const saved = outcomes.every(Boolean); setBlocked(!saved); return saved;
  }, []);
  const route = useCallback((nextLeft: PaneTarget, nextRight: PaneTarget | null) => {
    const params = new URLSearchParams(); params.set('writing', nextLeft.writingId); params.set('workspace', 'drafts');
    if (nextLeft.draftId) params.set('draft', nextLeft.draftId);
    if (nextRight) { params.set('compareWriting', nextRight.writingId); if (nextRight.draftId) params.set('compareDraft', nextRight.draftId); }
    navigate(`/project/${encodeURIComponent(projectId)}/writings?${params}`, { replace: true });
  }, [navigate, projectId]);
  const commitTargets = useCallback((nextLeft: PaneTarget, nextRight: PaneTarget | null) => {
    targets.current = { left: nextLeft, right: nextRight }; setLeft(nextLeft); setRight(nextRight); route(nextLeft, nextRight);
  }, [route]);
  const changeTarget = useCallback(async (pane: 'left' | 'right', next: PaneTarget) => {
    const request = ++requests.current[pane];
    try {
      await loadPaneDocument(projectId, next);
      const active = sessions.current.get(pane);
      if (active && !await active.flush()) { setBlocked(true); return false; }
      if (request !== requests.current[pane]) return false;
      setBlocked(false); setActionFailed(false);
      commitTargets(pane === 'left' ? next : targets.current.left, pane === 'right' ? next : targets.current.right); return true;
    } catch { setActionFailed(true); return false; }
  }, [projectId, commitTargets]);
  const routeRequest = useRef('');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('workspace') !== 'drafts' || !params.get('writing')) return;
    const signature = params.toString(); if (routeRequest.current === signature) return;
    routeRequest.current = signature;
    const nextLeft = { writingId: params.get('writing')!, draftId: params.get('draft') || undefined };
    const nextRight = params.get('compareWriting') ? { writingId: params.get('compareWriting')!, draftId: params.get('compareDraft') || undefined } : null;
    if (paneTargetKey(nextLeft) === paneTargetKey(targets.current.left) && (!nextRight ? !targets.current.right : targets.current.right && paneTargetKey(nextRight) === paneTargetKey(targets.current.right))) return;
    let cancelled = false;
    void (async () => {
      if (!await flushAll() || cancelled) return;
      try { await loadPaneDocument(projectId, nextLeft); if (nextRight) await loadPaneDocument(projectId, nextRight); if (!cancelled) { targets.current = { left: nextLeft, right: nextRight }; setLeft(nextLeft); setRight(nextRight); } } catch { if (!cancelled) setActionFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [location.search, flushAll, projectId]);
  useEffect(() => registerCloseGuard(async () => { if (await flushAll()) return true; setExit('window'); return false; }), [flushAll]);
  useEffect(() => { if (unsaved) return registerPendingFlusher(saveOwner, flushAll); }, [flushAll, saveOwner, unsaved]);
  useEffect(() => {
    const owner = saveOwner;
    reportUnsavedWork(unsaved ? { title: t('writings.parallel.leaveTitle'), message: t('writings.parallel.leaveMessage'), closeAnyway: t('writings.parallel.closeWindow'), keepOpen: t('writings.parallel.stay') } : null, owner);
    return () => reportUnsavedWork(null, owner);
  }, [unsaved, locale, projectId, saveOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (![...sessions.current.values()].some(session => session.dirty)) return;
      void flushAll(); if (!isDesktop()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
  }, [flushAll]);
  const stage = async (kind: 'promote' | 'delete', document: PaneDocument) => {
    setActionFailed(false); if (!await flushAll()) return;
    try {
      const draft = await loadPaneDocument(projectId, document);
      const current = kind === 'promote' ? await loadPaneDocument(projectId, { writingId: document.writingId }) : null;
      setPending({ kind, document: draft, currentVersion: current?.version });
    } catch { setActionFailed(true); }
  };
  return <div className="space-y-4" data-testid="parallel-workspace">
    <header className="flex items-start justify-between flex-wrap gap-3">
      <div><button type="button" className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent-gold mb-2" onClick={async () => { if (await flushAll()) await onClose(targets.current.left.writingId); else setExit('back'); }}><ArrowLeft size={15} />{t('writings.parallel.back')}</button><h2 className="text-xl font-semibold text-text-primary">{t('writings.parallel.title')}</h2><p className="text-xs text-text-muted mt-1 max-w-2xl">{t('writings.parallel.hint')}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={parallelButton} onClick={async () => {
        if (right) { const active = sessions.current.get('right'); if (active && !await active.flush()) { setBlocked(true); return; } commitTargets(targets.current.left, null); }
        else { const other = left.draftId ? left.writingId : chapters.find(chapter => chapter.id !== left.writingId)?.id ?? left.writingId; commitTargets(targets.current.left, { writingId: other }); }
      }}>{right ? <X size={15} /> : <Columns2 size={15} />}{t(right ? 'writings.parallel.single' : 'writings.parallel.split')}</button><button type="button" className={parallelButton} onClick={() => void flushAll()}><Save size={15} />{t('common.save')}</button></div>
    </header>
    {blocked && <p role="alert" className="text-sm text-danger">{t('writings.parallel.blocked')}</p>}
    {actionFailed && <p role="alert" className="text-sm text-danger">{t('writings.parallel.actionFailed')}</p>}
    {promoted && <p role="status" className="text-sm text-accent-gold">{t('writings.parallel.promoted')}</p>}
    <div className={right ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' : 'max-w-5xl mx-auto'}>
      <ParallelDraftPane key={`left:${paneTargetKey(left)}`} projectId={projectId} paneId="left" target={left} chapters={chapters} onTarget={target => changeTarget('left', target)} register={register} onState={stateChanged} onPromote={document => void stage('promote', document)} onDelete={document => void stage('delete', document)} selections={selections} />
      {right && <ParallelDraftPane key={`right:${paneTargetKey(right)}`} projectId={projectId} paneId="right" target={right} chapters={chapters} onTarget={target => changeTarget('right', target)} register={register} onState={stateChanged} onPromote={document => void stage('promote', document)} onDelete={document => void stage('delete', document)} selections={selections} />}
    </div>
    <ConfirmDialog open={!!pending} title={pending?.kind === 'promote' ? t('writings.parallel.promoteTitle') : t('writings.parallel.delete')} destructive={pending?.kind === 'delete'} message={t(pending?.kind === 'promote' ? 'writings.parallel.promoteConfirm' : 'writings.parallel.deleteConfirm').replace('{draft}', pending?.document.draftName ?? '').replace('{chapter}', pending?.document.title ?? '')} confirmLabel={t(pending?.kind === 'promote' ? 'writings.parallel.promote' : 'writings.parallel.delete')} onCancel={() => setPending(null)} onConfirm={async () => {
      const action = pending; if (!action) return;
      try {
        if (action.kind === 'promote') { await promoteParallelDraft(projectId, action.document.draftId!, action.document.version, action.currentVersion!); setPromoted(true); }
        else {
          await deleteParallelDraft(action.document);
          const nextLeft = targets.current.left.draftId === action.document.draftId ? { writingId: action.document.writingId } : targets.current.left;
          const nextRight = targets.current.right?.draftId === action.document.draftId ? { writingId: action.document.writingId } : targets.current.right;
          commitTargets(nextLeft, nextRight);
        }
      } catch { setActionFailed(true); }
      finally { setPending(null); }
    }} />
    <ConfirmDialog open={!!exit} title={t('writings.parallel.leaveTitle')} message={t('writings.parallel.leaveMessage')} confirmLabel={t(exit === 'window' ? 'writings.parallel.closeWindow' : 'writings.parallel.leave')} cancelLabel={t('writings.parallel.stay')} onCancel={() => { if (exit === 'window') keepAppWindow(); setExit(null); }} onConfirm={async () => { const reason = exit; setExit(null); if (reason === 'window') closeAppWindow(); else await onClose(targets.current.left.writingId); }} />
  </div>;
}
