import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Redo2, Save, Undo2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import Modal from '@/components/common/Modal';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import { registerPendingFlusher } from '@/services/pendingWrites';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
import type { GeneratedWorld, SavedWorldRegion } from '../types';
import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';
import type { CartoTheme } from '../cartography/theme';
import { stableStringify } from '../region/workerProtocol';
import { adjustSheetEdges, applySheetFrame, savedSheetFrame, sheetSpec, type SheetEdges, type SheetFrame } from './frame';
import { requestFixedSheet, type FixedSheetResult, type SheetRequest } from './client';
import { saveWorldRegionChanges, WorldRegionConflict } from './store';
import { renderFixedSheet } from './render';
import { sheetCopy } from './copy';

interface Recovery { worldId: string; value: SavedWorldRegion; base?: SavedWorldRegion; fields?: SheetFrame; edges?: Record<keyof SheetEdges, string> }
const edgeZero: SheetEdges = { west: 0, east: 0, north: 0, south: 0 };
const input = 'min-h-10 w-full min-w-0 rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
export interface FixedSheetViewProps { record: GeneratedWorld; initial: SavedWorldRegion; existing: boolean; draftKey?: string; world: WorldData; canon: { world: WorldData; edits?: string }; geography: HumanGeography; theme: CartoTheme; prepare: () => Promise<boolean>; onSaved: (regions: SavedWorldRegion[]) => void; onClose: () => void; request?: SheetRequest }

export default function FixedSheetView({ record, initial, existing, draftKey, world, canon, geography, theme, prepare, onSaved, onClose, request = requestFixedSheet }: FixedSheetViewProps) {
  const { locale } = useTranslation(), copy = sheetCopy[locale], pane = useEnginePane();
  const store = useMemo(() => createLocalDraftStore<Recovery>(`wh.world-sheets-drafts.v1.${record.projectId}`, (value): value is Recovery => { const item = value as Partial<Recovery> | null; return !!item && typeof item.worldId === 'string' && !!item.value && typeof item.value.id === 'string' && typeof item.value.title === 'string' && !!item.value.params && Number.isFinite(item.value.spanKm); }), [record.projectId]);
  const recoveryKey = JSON.stringify([record.id, draftKey ?? initial.id, pane?.instanceId ?? 'standalone']);
  const [recovery] = useState(() => { const value = store.get(recoveryKey); return value?.worldId === record.id ? value : undefined; });
  const [base, setBase] = useState<SavedWorldRegion | undefined>(recovery?.base ?? (existing ? initial : undefined));
  const [recipe] = useState(record.params);
  const [draft, setDraft] = useState(recovery?.value ?? initial), [name, setName] = useState((recovery?.value ?? initial).title);
  const [fields, setFields] = useState(() => recovery?.fields ?? savedSheetFrame(recovery?.value ?? initial));
  const [edges, setEdges] = useState<Record<keyof SheetEdges, string>>(recovery?.edges ?? { west: '0', east: '0', north: '0', south: '0' });
  const [history, setHistory] = useState<SheetFrame[]>([]), [future, setFuture] = useState<SheetFrame[]>([]);
  const [result, setResult] = useState<FixedSheetResult | null>(null), [progress, setProgress] = useState(0), [rendering, setRendering] = useState(true), [renderError, setRenderError] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [saving, setSaving] = useState(false), [discard, setDiscard] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), lock = useRef(false);
  const current = useMemo(() => ({ ...draft, title: name }), [draft, name]), dirty = stableStringify(current) !== stableStringify(base);
  const frame = useMemo(() => savedSheetFrame(draft), [draft]);
  const fieldDirty = stableStringify(fields) !== stableStringify(savedSheetFrame(draft)), edgeDirty = Object.values(edges).some(value => Number(value) !== 0);
  const hasChanges = dirty || fieldDirty || edgeDirty;
  useEffect(() => hasChanges ? registerPendingFlusher(`world-sheet:${record.id}:${recoveryKey}`, async () => false) : undefined, [hasChanges, record.id, recoveryKey]);
  useEffect(() => { if (hasChanges) store.set(recoveryKey, { worldId: record.id, base, value: current, fields, edges }); }, [base, current, hasChanges, fields, edges, record.id, recoveryKey, store]);
  useEffect(() => {
    const controller = new AbortController(); let handle: ReturnType<SheetRequest> | undefined; setRendering(true); setRenderError(false); setProgress(0); setResult(null);
    const timer = window.setTimeout(() => {
      try { handle = request(canon.world, geography, frame, { edits: canon.edits, signal: controller.signal, onProgress: (_stage, value) => { if (!controller.signal.aborted) setProgress(value); } });
        handle.promise.then(value => { if (!controller.signal.aborted) setResult(value); }).catch(failure => { if (!controller.signal.aborted && !(failure instanceof Error && failure.name === 'AbortError')) setRenderError(true); }).finally(() => { if (!controller.signal.aborted) setRendering(false); });
      } catch { if (!controller.signal.aborted) { setRenderError(true); setRendering(false); } }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); handle?.cancel(); };
  }, [canon, frame, geography, request, retry]);
  useEffect(() => { if (canvas.current && result) { try { renderFixedSheet(result, world, theme, canvas.current, 1400, name); } catch { setRenderError(true); } } }, [name, result, theme, world]);
  const apply = (frame: SheetFrame) => {
    try { const valid = sheetSpec(canon.world, frame).frame; setHistory(previous => [...previous.slice(-29), savedSheetFrame(draft)]); setFuture([]); setDraft(value => applySheetFrame(value, valid)); setFields(valid); setError(''); setStatus(''); return true; }
    catch { setError(copy.invalid); return false; }
  };
  const step = (undo: boolean) => { const stack = undo ? history : future, frame = stack.at(-1); if (!frame) return; if (undo) { setHistory(stack.slice(0, -1)); setFuture(previous => [...previous, savedSheetFrame(draft)]); } else { setFuture(stack.slice(0, -1)); setHistory(previous => [...previous, savedSheetFrame(draft)]); } setDraft(value => applySheetFrame(value, frame)); setFields(frame); setError(''); };
  const close = () => { if (saving) return; if (hasChanges) setDiscard(true); else onClose(); };
  const save = async () => {
    if (lock.current) return; lock.current = true; setSaving(true); setError(''); setStatus('');
    try {
      if (fieldDirty || edgeDirty) throw new Error('Apply fields first');
      sheetSpec(canon.world, savedSheetFrame(draft)); if (!await prepare()) throw new Error('Pending write failed');
      const value = { ...current, title: name.trim(), updatedAt: Date.now() }, regions = await saveWorldRegionChanges(record.projectId, record.id, base ? [base] : [], [value], recipe);
      setDraft(value); setBase(value); setName(value.title); store.delete(recoveryKey); onSaved(regions); setStatus(copy.saved);
    } catch (failure) { setError(failure instanceof WorldRegionConflict ? copy.conflict : copy.failure); }
    finally { lock.current = false; setSaving(false); }
  };
  const download = () => { if (!result || rendering || renderError || fieldDirty || edgeDirty) return; const output = document.createElement('canvas'); renderFixedSheet(result, world, theme, output, 1800, name); output.toBlob(blob => { if (blob) saveAs(blob, `${name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'sheet'}.png`); }, 'image/png'); };
  return <Modal open onClose={close} title={copy.title} fullscreen busy={saving} dismissible={!hasChanges}>
    <section data-testid="fixed-sheet" className="space-y-4 p-4 sm:p-6">
      <p className="max-w-prose text-sm text-text-muted">{copy.help}</p>{error && <p role="alert" className="text-sm text-danger">{error}</p>}{status && <p role="status" className="text-sm text-accent-gold">{status}</p>}
      <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <fieldset disabled={saving} className="order-2 min-w-0 space-y-4 lg:order-1">
          <label className="block space-y-1 text-xs text-text-muted">{copy.name}<input data-testid="sheet-name" className={input} maxLength={180} value={name} onChange={event => { setName(event.target.value); setStatus(''); }} /></label>
          <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); apply(fields); }}>
            {(['widthKm', 'heightKm', 'x', 'y'] as const).map(key => <label key={key} className="block space-y-1 text-xs text-text-muted">{copy[key === 'widthKm' ? 'width' : key === 'heightKm' ? 'height' : key]}<input data-testid={`sheet-${key}`} className={input} type="number" step="any" value={Number.isFinite(fields[key]) ? key === 'x' ? fields.x / world.width * 360 - 180 : key === 'y' ? 90 - fields.y / world.height * 180 : fields[key] : ''} onChange={event => { const value = event.target.value === '' ? NaN : Number(event.target.value); setFields(previous => ({ ...previous, [key]: key === 'x' ? (value + 180) / 360 * world.width : key === 'y' ? (90 - value) / 180 * world.height : value })); }} required /></label>)}
            <button className={`${button} w-full`} data-testid="sheet-apply-frame" disabled={!fieldDirty}>{copy.title}</button>
          </form>
          <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); try { if (apply(adjustSheetEdges(canon.world, savedSheetFrame(draft), Object.fromEntries(Object.entries(edges).map(([key, value]) => [key, value.trim() ? Number(value) : NaN])) as unknown as SheetEdges))) setEdges({ west: '0', east: '0', north: '0', south: '0' }); } catch { setError(copy.invalid); } }}>
            <h3 className="text-sm font-medium text-text-primary">{copy.edges}</h3><p className="text-xs text-text-muted">{copy.edgeHelp}</p><div className="grid grid-cols-2 gap-3">{(Object.keys(edgeZero) as Array<keyof SheetEdges>).map(key => <label key={key} className="space-y-1 text-xs text-text-muted">{copy[key]}<input data-testid={`sheet-edge-${key}`} className={input} type="number" step="any" value={edges[key]} onChange={event => setEdges(previous => ({ ...previous, [key]: event.target.value }))} required /></label>)}</div><button className={`${button} w-full`} data-testid="sheet-apply-edges" disabled={!edgeDirty || fieldDirty}>{copy.apply}</button>
          </form>
        </fieldset>
        <div className="order-1 min-w-0 space-y-3 lg:order-2">
          <div className="flex flex-wrap gap-2"><button type="button" className={button} data-testid="sheet-undo" disabled={!history.length || saving} onClick={() => step(true)} aria-label={copy.undo}><Undo2 size={16} aria-hidden="true" />{copy.undo}</button><button type="button" className={button} data-testid="sheet-redo" disabled={!future.length || saving} onClick={() => step(false)} aria-label={copy.redo}><Redo2 size={16} aria-hidden="true" /></button><button type="button" className={button} data-testid="sheet-save" disabled={saving || fieldDirty || edgeDirty || !name.trim()} onClick={() => void save()}><Save size={16} aria-hidden="true" />{copy.save}</button><button type="button" className={button} data-testid="sheet-export" disabled={rendering || renderError || !result || fieldDirty || edgeDirty} onClick={download}><Download size={16} aria-hidden="true" />PNG</button></div>
          <p className="text-sm text-text-primary" data-testid="sheet-dimensions">{Number(draft.spanKm.toFixed(6))} × {Number((draft.spanKm / draft.params.aspect).toFixed(6))} km</p><p className="text-xs text-text-muted">{copy.precision}</p>
          <div className="grid min-h-52 place-items-center overflow-hidden rounded-xl border border-border bg-deep p-2">
            {rendering && <p role="status" className="py-12 text-sm text-text-muted">{copy.loading} · {Math.round(progress * 100)} %</p>}
            {renderError && <div className="space-y-3 p-4"><p role="alert" className="text-sm text-danger">{copy.renderFailure}</p><button type="button" className={button} onClick={() => setRetry(value => value + 1)}>{copy.retry}</button></div>}
            <canvas ref={canvas} data-testid="sheet-canvas" aria-label={name} hidden={!result || rendering || renderError} className="h-auto max-h-[65vh] w-full object-contain [&[hidden]]:hidden" />
          </div><button type="button" className={button} data-testid="sheet-close" onClick={close}>{copy.close}</button>
        </div>
      </div>
    </section>
    <ConfirmDialog open={discard} title={copy.discard} message={copy.discardHelp} confirmLabel={copy.discard} onCancel={() => setDiscard(false)} onConfirm={() => { store.delete(recoveryKey); onClose(); }} />
  </Modal>;
}
