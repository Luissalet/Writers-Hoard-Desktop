import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { createEntityCandidate, newEntityCandidates, suggestedEntityType, updateEntityDetectionPreferences } from '@/services/entityDetection/service';
import type { EntityDetectionPreferences, EntityDetectionStatus, EntitySpan } from '@/services/entityDetection/types';
import { createEntityCandidatesPlugin, entityCandidatesKey, entitySnapshot, type EntitySnapshot } from './decorations';
import { ScanSearch } from 'lucide-react';
import './entityDetection.css';

interface Props { editor: Editor; projectId: string; eraId?: string; entries: CodexEntry[]; preferences: EntityDetectionPreferences }
export default function EntityDetectionControls({ editor, projectId, eraId, entries, preferences }: Props) {
  const { locale, t } = useTranslation(), es = locale === 'es';
  const api = window.electronAPI?.entityDetection;
  const [status, setStatus] = useState<EntityDetectionStatus>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [candidates, setCandidates] = useState<EntitySpan[]>([]), [types, setTypes] = useState<Record<string, CodexEntryType>>({});
  const [selected, setSelected] = useState<number>();
  const details = useRef<HTMLDetailsElement>(null), panel = useRef<HTMLDivElement>(null);
  const active = useRef(0), mounted = useRef(true), snapshot = useRef<EntitySnapshot | undefined>(undefined);
  const latest = useRef({ projectId, eraId, entries, preferences }); latest.current = { projectId, eraId, entries, preferences };
  const invalidate = useCallback(() => { active.current++; }, []);
  const clear = useCallback(() => { invalidate(); snapshot.current = undefined; setCandidates([]); setBusy(false); if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(entityCandidatesKey, { snapshot: entitySnapshot(editor.state.doc), candidates: [] }).setMeta('addToHistory', false)); }, [editor, invalidate]);
  useEffect(() => {
    mounted.current = true;
    editor.registerPlugin(createEntityCandidatesPlugin(index => { if (details.current) { details.current.open = true; let ancestor = details.current.parentElement?.closest('details'); while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement?.closest('details'); } } setSelected(index); panel.current?.querySelector<HTMLButtonElement>(`[data-create-entity="${index}"]`)?.focus(); }));
    return () => { mounted.current = false; invalidate(); if (!editor.isDestroyed) editor.unregisterPlugin(entityCandidatesKey); };
  }, [editor, invalidate]);
  useEffect(() => { let cancelled = false; void api?.status().then(value => { if (!cancelled) setStatus(value); }).catch(cause => { if (!cancelled) setError(String(cause)); }); return () => { cancelled = true; }; }, [api]);
  const scan = async () => {
    if (!api || !latest.current.preferences.detectNewEntities || status?.state !== 'ready') return;
    const token = ++active.current, captured = entitySnapshot(editor.state.doc), context = latest.current;
    setBusy(true); setError('');
    try {
      const spans = await api.detect(captured.text);
      if (token !== active.current || editor.isDestroyed || editor.state.doc !== captured.doc || context.projectId !== latest.current.projectId || context.eraId !== latest.current.eraId) return;
      const next = newEntityCandidates(captured.text, spans, latest.current.entries); snapshot.current = captured; setCandidates(next);
      editor.view.dispatch(editor.state.tr.setMeta(entityCandidatesKey, { snapshot: captured, candidates: next }).setMeta('addToHistory', false));
    } catch (cause) { if (token === active.current) { setError(String(cause)); void api.status().then(value => { if (token === active.current) setStatus(value); }).catch(() => {}); } } finally { if (token === active.current) setBusy(false); }
  };
  const scanRef = useRef(scan); scanRef.current = scan;
  useEffect(() => {
    clear(); let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clear(); clearTimeout(timer); if (latest.current.preferences.detectNewEntities) timer = setTimeout(() => { void scanRef.current(); }, 1100); };
    editor.on('update', changed);
    if (preferences.detectNewEntities && status?.state === 'ready') timer = setTimeout(() => { void scanRef.current(); }, 200);
    return () => { invalidate(); clearTimeout(timer); editor.off('update', changed); };
  }, [editor, projectId, eraId, preferences.detectNewEntities, status?.state, entries, clear, invalidate]);
  const toggle = async (key: 'detectNewEntities' | 'autoLinkMentions' | 'animateNewLinks') => {
    setError(''); try { await updateEntityDetectionPreferences(projectId, { [key]: !preferences[key] }, preferences.revision); } catch (cause) { setError(String(cause)); }
  };
  const prepare = async () => {
    if (!api) return; setError(''); setBusy(true);
    const poll = setInterval(() => { void api.status().then(value => { if (mounted.current) setStatus(value); }).catch(() => {}); }, 500);
    try { const value = await api.prepare(); if (mounted.current) setStatus(value); } catch (cause) { if (mounted.current) { setError(String(cause)); setStatus({ state: 'error', model: '' }); } } finally { clearInterval(poll); if (mounted.current) setBusy(false); }
  };
  const create = async (candidate: EntitySpan) => {
    const captured = snapshot.current;
    if (!captured || captured.doc !== editor.state.doc) { clear(); return; }
    const token = active.current; setBusy(true); setError('');
    try {
      await createEntityCandidate({ projectId, eraId, text: captured.text, candidate, type: types[candidate.text] ?? suggestedEntityType(candidate.label) }, () => { if (!mounted.current || token !== active.current || editor.isDestroyed || captured.doc !== editor.state.doc || projectId !== latest.current.projectId || eraId !== latest.current.eraId) throw Error('entity_candidate_stale_or_existing'); });
      if (token === active.current) clear();
    } catch (cause) { if (token === active.current) setError(String(cause)); } finally { if (token === active.current) setBusy(false); }
  };
  const names = { detectNewEntities: es ? 'Detectar entidades nuevas' : 'Detect new entities', autoLinkMentions: es ? 'Enlazar menciones' : 'Auto-link mentions', animateNewLinks: es ? 'Animar enlaces nuevos' : 'Animate new links' };
  return <details ref={details} className="wh-entity-controls"><summary><ScanSearch size={15} />{es ? 'Entidades y menciones' : 'Entities and mentions'}{candidates.length > 0 && <span>({candidates.length})</span>}</summary><div ref={panel} className="wh-entity-panel">
    <p>{es ? 'Preferencias del proyecto, compartidas por Base y todas las eras.' : 'Project preferences, shared by Base and every era.'}</p>
    {(['detectNewEntities', 'autoLinkMentions', 'animateNewLinks'] as const).map(key => <button type="button" key={key} role="switch" aria-checked={preferences[key]} onClick={() => { void toggle(key); }}><span>{names[key]}</span><strong>{preferences[key] ? es ? 'Activado' : 'On' : es ? 'Desactivado' : 'Off'}</strong></button>)}
    <p>{es ? 'Las menciones son enlaces visuales por nombre o alias; no cambian el texto guardado. Los enlaces insertados a mano permanecen.' : 'Mentions are visual name or alias links; saved text stays unchanged. Manually inserted links remain.'}</p>
    {preferences.detectNewEntities && <>
      <p>{es ? 'El clasificador local sugiere personas, lugares y organizaciones. Puede omitir nombres o equivocarse, especialmente en ficción. Tú eliges el tipo y creas cada ficha.' : 'The local classifier suggests people, places and organizations. It can miss names or be wrong, especially in fiction. You choose the type and create each card.'}</p>
      {!api ? <p>{es ? 'Disponible en la aplicación de escritorio.' : 'Available in the desktop application.'}</p> : status?.state !== 'ready' ? <div><p role="status">{status?.state === 'preparing' ? `${es ? 'Preparando clasificador' : 'Preparing classifier'} ${status.progress ?? 0}%` : es ? 'Descarga única de 182 MB. Después funciona sin conexión, en CPU.' : 'One-time 182 MB download. Then works offline on CPU.'}</p><button type="button" disabled={busy} onClick={() => { void prepare(); }}>{status?.state === 'error' ? es ? 'Reintentar preparación' : 'Retry preparation' : es ? 'Preparar clasificador local' : 'Prepare local classifier'}</button></div> : <><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { void scan(); }}>{busy ? es ? 'Analizando…' : 'Scanning…' : es ? 'Analizar documento' : 'Scan document'}</button>{busy && <button type="button" onClick={clear}>{es ? 'Cancelar análisis' : 'Cancel scan'}</button>}</div><p role="status">{!busy && !candidates.length ? es ? 'No hay candidatos nuevos. Puedes crear fichas manualmente en Códex.' : 'No new candidates. You can create cards manually in Codex.' : es ? `${candidates.length} candidatos nuevos · destino: ${eraId ? 'era actual' : 'Base'}` : `${candidates.length} new candidates · destination: ${eraId ? 'current era' : 'Base'}`}</p></>}
      <ul>{candidates.map((candidate, index) => <li key={`${candidate.from}:${candidate.text}`} data-selected={selected === index || undefined}><span>{candidate.text}</span><label><span className="sr-only">{es ? 'Tipo de' : 'Type of'} {candidate.text}</span><select value={types[candidate.text] ?? suggestedEntityType(candidate.label)} onChange={event => setTypes(previous => ({ ...previous, [candidate.text]: event.target.value as CodexEntryType }))}>{(['character', 'location', 'faction', 'item', 'concept', 'magic', 'custom'] as const).map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</select></label><button type="button" data-create-entity={index} disabled={busy} onClick={() => { void create(candidate); }}>{es ? 'Crear ficha' : 'Create card'}</button></li>)}</ul>
    </>}
    {error && <p role="alert">{es ? 'No se ha completado la operación. Reintenta; si las preferencias cambiaron, vuelve a abrirlas.' : 'The operation did not complete. Retry; if preferences changed, reopen them.'} <span>{error}</span></p>}
  </div></details>;
}
