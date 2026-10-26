import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { entryNames } from '@/services/codexReference/matcher';
import { candidateKey, type EntityCandidateContext } from '@/services/entityDetection/dismissalTypes';
import { actOnEntityCandidateDismissal, getEntityCandidateDismissals } from '@/services/entityDetection/service';
import type { Editor } from '@tiptap/react';
import type { CodexEntry, CodexEntryType } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { createEntityCandidate, newEntityCandidates, suggestedEntityType, updateEntityDetectionPreferences } from '@/services/entityDetection/service';
import type { EntityDetectionPreferences, EntityDetectionStatus, EntitySpan } from '@/services/entityDetection/types';
import { createEntityCandidatesPlugin, entityCandidatesKey, entitySnapshot, type EntitySnapshot } from './decorations';
import { getEntityDetectionAPI } from '@/services/entityDetection/api';
import { ENTITY_ASSETS } from '@/services/entityDetection/modelManifest';
import { ScanSearch } from 'lucide-react';
import './entityDetection.css';

interface Props { editor: Editor; projectId: string; eraId?: string; context?: EntityCandidateContext; entries: CodexEntry[]; preferences: EntityDetectionPreferences }
export default function EntityDetectionControls({ editor, projectId, eraId, context, entries, preferences }: Props) {
  const { locale, t } = useTranslation(), es = locale === 'es';
  const api = getEntityDetectionAPI();
  const [status, setStatus] = useState<EntityDetectionStatus>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [scanning, setScanning] = useState(false), [preparing, setPreparing] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const scanJob = useRef<string | undefined>(undefined), preparationJob = useRef<string | undefined>(undefined);
  const operationBusy = busy || scanning || preparing;
  const [candidates, setCandidates] = useState<EntitySpan[]>([]), [types, setTypes] = useState<Record<string, CodexEntryType>>({});
  const [selected, setSelected] = useState<number>();
  const [receipt, setReceipt] = useState<string>();
  const [undoRestore, setUndoRestore] = useState(false);
  const [provisional, setProvisional] = useState<string[]>([]);
  const contextKey = JSON.stringify(context), namesKey = JSON.stringify(entries.map(entry => [entry.id, entryNames(entry)]));
  const dismissalRead = useLiveQuery(async () => {
    try { return { value: context ? await getEntityCandidateDismissals({ projectId, eraId, context }) : undefined, error: '' }; }
    catch (cause) { return { value: undefined, error: String(cause) }; }
  }, [projectId, eraId, contextKey]);
  const decisions = dismissalRead?.value;
  const raw = useRef<EntitySpan[]>([]);
  const details = useRef<HTMLDetailsElement>(null), panel = useRef<HTMLDivElement>(null);
  const active = useRef(0), mounted = useRef(true), snapshot = useRef<EntitySnapshot | undefined>(undefined);
  const latest = useRef({ projectId, eraId, entries, preferences, contextKey }); latest.current = { projectId, eraId, entries, preferences, contextKey };
  const hidden = new Set(context ? decisions?.decisions.filter(row => row.discarded).map(row => row.key) : provisional);
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden;
  const invalidate = useCallback(() => { active.current++; const id = scanJob.current; scanJob.current = undefined; if (id) void api.cancel?.(id).catch(() => {}); }, [api]);
  const clear = useCallback(() => { invalidate(); snapshot.current = undefined; raw.current = []; setCandidates([]); setBusy(false); setScanning(false); if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(entityCandidatesKey, { snapshot: entitySnapshot(editor.state.doc), candidates: [] }).setMeta('addToHistory', false)); }, [editor, invalidate]);
  useEffect(() => {
    const captured = snapshot.current;
    if (!captured || editor.isDestroyed || captured.doc !== editor.state.doc) return;
    const next = raw.current.filter(row => !hiddenRef.current.has(candidateKey(row.text)));
    setCandidates(next);
    editor.view.dispatch(editor.state.tr.setMeta(entityCandidatesKey, { snapshot: captured, candidates: next }).setMeta('addToHistory', false));
  }, [editor, decisions, provisional]);
  useEffect(() => { setReceipt(undefined); setProvisional([]); }, [projectId, eraId, contextKey]);
  useEffect(() => {
    mounted.current = true;
    editor.registerPlugin(createEntityCandidatesPlugin(index => { if (details.current) { details.current.open = true; let ancestor = details.current.parentElement?.closest('details'); while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement?.closest('details'); } } setSelected(index); panel.current?.querySelector<HTMLButtonElement>(`[data-create-entity="${index}"]`)?.focus(); }));
    return () => { mounted.current = false; invalidate(); const id = preparationJob.current; preparationJob.current = undefined; if (id) void api.cancel?.(id).catch(() => {}); if (!editor.isDestroyed) editor.unregisterPlugin(entityCandidatesKey); };
  }, [editor, invalidate, api]);
  useEffect(() => { let cancelled = false; void api?.status().then(value => { if (!cancelled) setStatus(value); }).catch(cause => { if (!cancelled) setError(String(cause)); }); return () => { cancelled = true; }; }, [api]);
  const scan = async () => {
    if (preparationJob.current || scanJob.current || busy || !latest.current.preferences.detectNewEntities || status?.state !== 'ready') return;
    const token = ++active.current, captured = entitySnapshot(editor.state.doc), binding = latest.current;
    const jobId = crypto.randomUUID(); scanJob.current = jobId;
    setScanning(true); setError('');
    try {
      const spans = await api.detect(captured.text, { jobId });
      const saved = context ? await getEntityCandidateDismissals({ projectId, eraId, context }) : undefined;
      if (token !== active.current || editor.isDestroyed || editor.state.doc !== captured.doc || binding.projectId !== latest.current.projectId || binding.eraId !== latest.current.eraId || binding.contextKey !== latest.current.contextKey) return;
      const filtered = new Set(saved ? saved.decisions.filter(row => row.discarded).map(row => row.key) : hiddenRef.current);
      raw.current = newEntityCandidates(captured.text, spans, latest.current.entries);
      const next = raw.current.filter(row => !filtered.has(candidateKey(row.text))); snapshot.current = captured; setCandidates(next);
      editor.view.dispatch(editor.state.tr.setMeta(entityCandidatesKey, { snapshot: captured, candidates: next }).setMeta('addToHistory', false));
    } catch (cause) { if (token === active.current) { setError(String(cause)); void api.status().then(value => { if (token === active.current) setStatus(value); }).catch(() => {}); } } finally { if (scanJob.current === jobId) { scanJob.current = undefined; if (token === active.current) setScanning(false); } }
  };
  const scanRef = useRef(scan); scanRef.current = scan;
  useEffect(() => {
    clear(); let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { clear(); clearTimeout(timer); if (latest.current.preferences.detectNewEntities) timer = setTimeout(() => { void scanRef.current(); }, 1100); };
    editor.on('update', changed);
    if (preferences.detectNewEntities && status?.state === 'ready') timer = setTimeout(() => { void scanRef.current(); }, 200);
    return () => { invalidate(); clearTimeout(timer); editor.off('update', changed); };
  }, [editor, projectId, eraId, contextKey, preferences.detectNewEntities, status?.state, namesKey, clear, invalidate]);
  const decide = async (candidate?: EntitySpan, restoreKey?: string, undo?: string) => {
    const captured = snapshot.current, token = active.current, binding = contextKey;
    if (!context) { if (candidate) setProvisional(previous => [...previous, candidateKey(candidate.text)]); else if (restoreKey) setProvisional(previous => previous.filter(key => key !== restoreKey)); return; }
    setBusy(true); setError('');
    try {
      const current = await getEntityCandidateDismissals({ projectId, eraId, context });
      const key = candidate ? candidateKey(candidate.text) : restoreKey!;
      const expectedVersion = current.decisions.find(row => row.key === key)?.version ?? '';
      const action = undo ? { action: 'undo' as const, receiptId: undo } : candidate ? { action: 'dismiss' as const, candidate, text: captured?.text ?? '', expectedVersion } : { action: 'restore' as const, key, expectedVersion };
      const result = await actOnEntityCandidateDismissal({ projectId, eraId, context }, action, () => {
        if (!mounted.current || editor.isDestroyed || token !== active.current || binding !== latest.current.contextKey || projectId !== latest.current.projectId || eraId !== latest.current.eraId || (candidate && (!captured || captured.doc !== editor.state.doc))) throw Error('entity_candidate_stale_or_existing');
      });
      if (mounted.current && token === active.current) { setReceipt(result.receiptId); setUndoRestore(!candidate && !undo); }
    } catch (cause) { if (mounted.current && token === active.current) setError(String(cause)); } finally { if (mounted.current && token === active.current) setBusy(false); }
  };
  const toggle = async (key: 'detectNewEntities' | 'autoLinkMentions' | 'animateNewLinks') => {
    setError(''); try { await updateEntityDetectionPreferences(projectId, { [key]: !preferences[key] }, preferences.revision); } catch (cause) { setError(String(cause)); }
  };
  const prepare = async (files?: File[]) => {
    if (preparationJob.current || scanJob.current || busy) return;
    const jobId = crypto.randomUUID(); preparationJob.current = jobId;
    setError(''); setPreparing(true);
    const current = () => mounted.current && preparationJob.current === jobId;
    const poll = setInterval(() => { void api.status().then(value => { if (current()) setStatus(value); }).catch(() => {}); }, 500);
    try {
      const value = files ? await api.importFiles!(files, { jobId }) : await api.prepare({ jobId });
      if (current()) { setStatus(value); if (files) setImportFiles([]); }
    } catch (cause) { if (current()) { setError(String(cause)); setStatus({ state: 'error', model: '' }); } }
    finally { clearInterval(poll); if (current()) { preparationJob.current = undefined; setPreparing(false); } }
  };
  const cancelPreparation = async () => {
    const jobId = preparationJob.current;
    if (!jobId || !api.cancel) return;
    preparationJob.current = undefined; setPreparing(false);
    await api.cancel(jobId);
    const value = await api.status();
    if (mounted.current && !preparationJob.current) setStatus(value);
  };
  const chooseImportFiles = (files: File[]) => {
    const names = new Set<string>(ENTITY_ASSETS.map(asset => asset.file.split('/').at(-1)!));
    if (files.some(file => !names.has(file.name))) { setError(es ? 'Elige los cuatro archivos indicados del clasificador preparado.' : 'Choose the four listed files from the prepared classifier.'); return; }
    setError('');
    setImportFiles(previous => [...new Map([...previous, ...files].map(file => [file.name, file])).values()]);
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
      {status?.state !== 'ready' ? <div><p role="status">{status?.state === 'preparing' ? `${es ? 'Preparando clasificador' : 'Preparing classifier'} ${status.progress ?? 0}%` : api.importFiles ? es ? 'Preparación inicial: 182 MB del clasificador y 27 MB del motor local. Después funciona sin conexión, en CPU.' : 'Initial preparation: 182 MB classifier and 27 MB local runtime. Then works offline on CPU.' : es ? 'Descarga única de 182 MB. Después funciona sin conexión, en CPU.' : 'One-time 182 MB download. Then works offline on CPU.'}</p><button type="button" disabled={operationBusy} onClick={() => { void prepare(); }}>{status?.state === 'error' ? es ? 'Reintentar preparación' : 'Retry preparation' : es ? 'Preparar clasificador local' : 'Prepare local classifier'}</button></div> : <><div className="flex flex-wrap gap-2"><button type="button" disabled={operationBusy} onClick={() => { void scan(); }}>{scanning ? es ? 'Analizando…' : 'Scanning…' : es ? 'Analizar documento' : 'Scan document'}</button>{scanning && <button type="button" onClick={clear}>{es ? 'Cancelar análisis' : 'Cancel scan'}</button>}</div><p role="status">{!scanning && !candidates.length ? es ? 'No hay candidatos nuevos. Puedes crear fichas manualmente en Códex.' : 'No new candidates. You can create cards manually in Codex.' : es ? `${candidates.length} candidatos nuevos · destino: ${eraId ? 'era actual' : 'Base'}` : `${candidates.length} new candidates · destination: ${eraId ? 'current era' : 'Base'}`}</p></>}
      {preparing && api.cancel && <button type="button" onClick={() => { void cancelPreparation().catch(cause => setError(String(cause))); }}>{es ? 'Cancelar preparación' : 'Cancel preparation'}</button>}
      {api.importFiles && <div className="my-3 min-w-0 space-y-2"><label className="block min-w-0"><span>{es ? 'Archivos del clasificador preparado' : 'Prepared classifier files'}</span><input className="mt-1 block min-w-0 max-w-full text-sm focus-visible:outline-2 focus-visible:outline-accent-gold" type="file" multiple accept=".json,.onnx" disabled={operationBusy} onChange={event => { chooseImportFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}/></label><p>{es ? 'Puedes añadir archivos en varias selecciones: config.json, tokenizer.json, tokenizer_config.json y onnx/model_quantized.onnx.' : 'You can add files across multiple selections: config.json, tokenizer.json, tokenizer_config.json and onnx/model_quantized.onnx.'}</p>{importFiles.map(file => <div className="flex min-w-0 flex-wrap items-center gap-2" key={file.name}><span className="min-w-0 break-all">{file.name}</span><button type="button" disabled={operationBusy} aria-label={`${es ? 'Quitar' : 'Remove'} ${file.name}`} onClick={() => setImportFiles(previous => previous.filter(value => value.name !== file.name))}>{es ? 'Quitar' : 'Remove'}</button></div>)}<button type="button" disabled={operationBusy || importFiles.length !== ENTITY_ASSETS.length} onClick={() => { void prepare(importFiles); }}>{es ? 'Importar archivos seleccionados' : 'Import selected files'} ({importFiles.length}/{ENTITY_ASSETS.length})</button></div>}
      <ul>{candidates.map((candidate, index) => <li key={`${candidate.from}:${candidate.text}`} data-selected={selected === index || undefined}><span>{candidate.text}</span><label><span className="sr-only">{es ? 'Tipo de' : 'Type of'} {candidate.text}</span><select value={types[candidate.text] ?? suggestedEntityType(candidate.label)} onChange={event => setTypes(previous => ({ ...previous, [candidate.text]: event.target.value as CodexEntryType }))}>{(['character', 'location', 'faction', 'item', 'concept', 'magic', 'custom'] as const).map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</select></label><button type="button" data-create-entity={index} disabled={operationBusy} onClick={() => { void create(candidate); }}>{es ? 'Crear ficha' : 'Create card'}</button><button type="button" disabled={operationBusy} aria-label={`${es ? 'Descartar' : 'Dismiss'} ${candidate.text}`} onClick={() => { void decide(candidate); }}>{es ? 'Descartar' : 'Dismiss'}</button></li>)}</ul>
      {!context && <p>{es ? 'Los descartes de este formulario son provisionales hasta cerrarlo.' : 'Dismissals in this form last until it closes.'}</p>}
      {(decisions?.decisions.filter(row => row.discarded) ?? provisional.map(key => ({ key, name: raw.current.find(row => candidateKey(row.text) === key)?.text ?? key }))).map(row => <button type="button" key={row.key} disabled={operationBusy} onClick={() => { void decide(undefined, row.key); }}>{es ? 'Recuperar' : 'Restore'} {row.name}</button>)}
      {receipt && <button type="button" disabled={operationBusy} onClick={() => { void decide(undefined, undefined, receipt); }}>{undoRestore ? es ? 'Deshacer recuperación' : 'Undo restoration' : es ? 'Deshacer descarte' : 'Undo dismissal'}</button>}
    </>}
    {(error || dismissalRead?.error || status?.detail) && <p role="alert">{es ? 'No se ha completado la operación. Reintenta; si las preferencias cambiaron, vuelve a abrirlas.' : 'The operation did not complete. Retry; if preferences changed, reopen them.'} <span>{error || dismissalRead?.error || status?.detail}</span></p>}
  </div></details>;
}
