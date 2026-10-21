import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Editor } from '@tiptap/react';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { createParallelDraft, listParallelDraftMeta, loadPaneDocument, paneTargetKey, renameParallelDraft, type PaneDocument, type PaneTarget } from '../parallelDrafts';
import { ParallelEditorSession, type PaneState } from '../parallelSession';
import ParallelDraftHistoryModal from './ParallelDraftHistoryModal';

const extensions = [FootnoteNode];
const field = 'min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';
export const parallelButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:text-accent-gold hover:border-accent-gold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';
export type PaneSelectionMap = Map<string, { from: number; to: number }>;
interface Props {
  projectId: string; paneId: 'left' | 'right'; target: PaneTarget; chapters: Array<{ id: string; title: string }>;
  onTarget: (target: PaneTarget) => Promise<boolean>;
  register: (paneId: string, session: ParallelEditorSession) => () => void;
  onState: (paneId: string, state: PaneState) => void;
  onPromote: (document: PaneDocument) => void;
  onDelete: (document: PaneDocument) => void;
  selections: MutableRefObject<PaneSelectionMap>;
}

export default function ParallelDraftPane({ projectId, paneId, target, chapters, onTarget, register, onState, onPromote, onDelete, selections }: Props) {
  const { t, locale } = useTranslation();
  const workspace = useEnginePane();
  const scope = useWorldEraScope(projectId);
  const recoveryOwner = scope.eraId ? `${workspace?.instanceId ?? 'main'}:era:${scope.eraId}` : workspace?.primary ? undefined : workspace?.instanceId;
  const [session, setSession] = useState<ParallelEditorSession | null>(null);
  const [state, setState] = useState<PaneState | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [historyDocument, setHistoryDocument] = useState<PaneDocument>();
  const shell = useRef<HTMLDivElement>(null);
  const writingId = target.writingId, draftId = target.draftId;
  const targetKey = paneTargetKey(target);
  useEffect(() => setHistoryDocument(undefined), [projectId, scope.eraId, targetKey]);
  const drafts = useLiveQuery(() => listParallelDraftMeta(projectId, writingId, scope.eraId), [projectId, writingId, scope.eraId]) ?? [];
  useEffect(() => {
    let active: ParallelEditorSession | null = null;
    let stopped = false;
    let unsubscribeState: (() => void) | null = null;
    let unregister: (() => void) | null = null;
    const subscription = liveQuery(() => loadPaneDocument(projectId, { writingId, draftId }, scope.eraId)).subscribe({
      next(document) {
        if (stopped) return;
        if (!active) {
          active = new ParallelEditorSession(document, paneId, undefined, recoveryOwner); setSession(active); setName(document.draftName ?? ''); unregister = register(paneId, active);
          unsubscribeState = active.subscribe(value => { setState(value); onState(paneId, value); });
        } else active.receive(document);
      },
      error(error) { console.error('[parallel drafts] document unavailable', error); if (!stopped) setMissing(true); },
    });
    return () => { stopped = true; subscription.unsubscribe(); unsubscribeState?.(); unregister?.(); active?.dispose(); };
  }, [projectId, writingId, draftId, paneId, register, onState, recoveryOwner, scope.eraId]);
  useEffect(() => {
    if (!editor) return;
    const key = `${paneId}:${targetKey}`;
    const position = selections.current.get(key);
    if (position) editor.commands.setTextSelection({ from: Math.min(position.from, editor.state.doc.content.size), to: Math.min(position.to, editor.state.doc.content.size) });
    const remember = () => { if (!editor.isDestroyed) selections.current.set(key, { from: editor.state.selection.from, to: editor.state.selection.to }); };
    editor.on('selectionUpdate', remember);
    return () => { remember(); editor.off('selectionUpdate', remember); };
  }, [editor, targetKey, paneId, selections]);
  useEffect(() => {
    if (!session) return;
    const save = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || !shell.current?.contains(document.activeElement)) return;
      event.preventDefault(); void session.flush();
    };
    window.addEventListener('keydown', save); return () => window.removeEventListener('keydown', save);
  }, [session]);
  const action = async (run: (session: ParallelEditorSession) => Promise<void>) => {
    if (!session || busy) return;
    setBusy(true); setFailed(false);
    try { if (!await session.flush()) { setFailed(true); return; } await run(session); }
    catch (error) { console.error('[parallel drafts] action failed', error); setFailed(true); }
    finally { setBusy(false); }
  };
  return <section ref={shell} className="min-w-0 rounded-xl border border-border bg-surface overflow-hidden" data-testid={`parallel-${paneId}`}>
    <div className="space-y-3 p-4 border-b border-border">
      <div className="flex gap-3 flex-wrap">
        <label className="flex-1 min-w-36 space-y-1 text-xs text-text-muted">{t('writings.parallel.chapter')}<select className={`${field} w-full`} value={writingId} onChange={event => void onTarget({ writingId: event.target.value })} aria-label={`${t('writings.parallel.chapter')} ${paneId}`}>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label>
        <label className="flex-1 min-w-36 space-y-1 text-xs text-text-muted">{t('writings.parallel.version')}<select className={`${field} w-full`} value={draftId ?? ''} onChange={event => void onTarget({ writingId, draftId: event.target.value || undefined })} aria-label={`${t('writings.parallel.version')} ${paneId}`}><option value="">{t('writings.parallel.current')}</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.draftName}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className={`${field} flex-1 min-w-36`} value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder={t('writings.parallel.name')} aria-label={`${t('writings.parallel.name')} ${paneId}`} />
        <button type="button" className={parallelButton} disabled={busy || !name.trim() || !session} onClick={() => void action(async active => { const draft = await createParallelDraft(active.document, name); await onTarget({ writingId, draftId: draft.id }); })}>{t(draftId ? 'writings.parallel.duplicate' : 'writings.parallel.new')}</button>
        {draftId && <button type="button" className={parallelButton} disabled={busy || !name.trim()} onClick={() => void action(active => renameParallelDraft(active.document, name))}>{t('writings.parallel.rename')}</button>}
      </div>
      {draftId && <div className="flex flex-wrap gap-2"><button type="button" className={parallelButton} disabled={busy || !session} onClick={() => void action(async active => onPromote(active.document))}>{t('writings.parallel.promote')}</button><button type="button" className={`${parallelButton} text-danger`} disabled={busy || !session} onClick={() => void action(async active => onDelete(active.document))}>{t('writings.parallel.delete')}</button></div>}
      {draftId && <button type="button" className={parallelButton} disabled={busy || !session} onClick={() => void action(async active => { setHistoryDocument({ ...active.document }); })}>{locale === 'es' ? 'Historial del borrador' : 'Draft history'}</button>}
      {failed && <p role="alert" className="text-xs text-danger">{t('writings.parallel.actionFailed')}</p>}
      <p role="status" className="text-xs text-text-muted" data-testid={`parallel-status-${paneId}`}>{state ? t(`writings.parallel.${state.status === 'conflict' ? 'conflict' : state.status}`) : t('writings.parallel.loading')}</p>
      {state?.recovered && <p className="text-xs text-accent-gold">{t('writings.parallel.recovered')}</p>}
      {state?.status === 'error' && <button type="button" className={parallelButton} onClick={() => void session?.flush()}>{t('writings.parallel.retry')}</button>}
      {state?.incoming && <div className="space-y-3 p-3 rounded-lg border border-accent-gold/40">
        <details><summary className="text-sm text-accent-gold cursor-pointer">{t('writings.parallel.viewSaved')}</summary><div className="tiptap-editor max-h-60 overflow-auto mt-3" dangerouslySetInnerHTML={sanitizedHtml(state.incoming.content)} /></details>
        <div className="flex flex-wrap gap-2"><button type="button" className={parallelButton} disabled={busy} onClick={async () => { setBusy(true); try { await session?.useSaved(); } finally { setBusy(false); } }}>{t('writings.parallel.theirs')}</button><button type="button" className={parallelButton} disabled={busy} onClick={async () => { setBusy(true); try { await session?.keepMine(); } finally { setBusy(false); } }}>{t('writings.parallel.ours')}</button>{session?.mergeCandidate !== null && <button type="button" className={parallelButton} disabled={busy} onClick={async () => { setBusy(true); try { await session?.keepMine(true); } finally { setBusy(false); } }}>{t('writings.parallel.merge')}</button>}</div>
      </div>}
    </div>
    {missing ? <p role="alert" className="p-6 text-text-muted">{t('writings.parallel.missing')}</p> : session && state ? <div className="p-3 min-h-80" data-testid={`parallel-editor-${paneId}`}><TiptapEditor key={`${paneId}:${targetKey}`} content={state.content} onChange={content => session.change(content)} onEditorReady={setEditor} referenceContext={{ projectId, scopeId: `parallel:${paneId}:${targetKey}` }} extensions={extensions} /></div> : <p role="status" className="p-6 text-text-muted">{t('writings.parallel.loading')}</p>}
    {historyDocument && <ParallelDraftHistoryModal key={`${historyDocument.projectId}:${historyDocument.eraId ?? ''}:${paneTargetKey(historyDocument)}`} document={historyDocument} onClose={() => setHistoryDocument(undefined)} />}
  </section>;
}
