import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Box, Download, LoaderCircle, RotateCcw, RotateCw, Upload, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';
import { db } from '@/db';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { ConfirmDialog,useDeepLinkParam } from '@/engines/_shared';
import { downloadBlobFile, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import { addModelAsset, assetBytes, assetFromFile, ModelError, removeModelAsset, type ModelAsset, type ModelErrorCode } from './model';
import { createModelViewport, type Lighting, type ModelViewport } from './viewport';
import { modelCopy } from './locales';

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold hover:text-accent-gold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

export function ModelView({ asset,compact=false }: { asset: ModelAsset;compact?:boolean }) {
  const { locale } = useTranslation();
  const copy = modelCopy(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<ModelViewport | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | ModelErrorCode>('loading');
  const [wireframe, setWireframe] = useState(false);
  const [lighting, setLighting] = useState<Lighting>('studio');
  const [animations, setAnimations] = useState<string[]>([]);
  const [animation, setAnimation] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const controller = new AbortController();
    let active: ModelViewport | null = null;
    void createModelViewport(container, asset, '', error => { if (!cancelled) setStatus(error.code); }, controller.signal).then(result => {
      if (cancelled) { result.dispose(); return; }
      active = result; viewport.current = result; setAnimations(result.animations); setStatus('ready');
    }).catch(error => { if (!cancelled) setStatus(error instanceof ModelError ? error.code : 'failed'); });
    return () => { cancelled = true; controller.abort(); active?.dispose(); viewport.current = null; };
  }, [asset]);
  useEffect(() => { containerRef.current?.querySelector('canvas')?.setAttribute('aria-label', copy.canvas); }, [copy.canvas, status]);
  const ready = status === 'ready';
  return <div>
    <div className="flex flex-wrap items-center gap-2 mb-3" aria-label={copy.canvas}>
      <button type="button" className={buttonClass} disabled={!ready} onClick={() => viewport.current?.reset()}><RotateCcw size={15} aria-hidden="true" />{copy.reset}</button>
      <button type="button" className={buttonClass} disabled={!ready} aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => viewport.current?.zoom('in')}><ZoomIn size={17} /></button>
      <button type="button" className={buttonClass} disabled={!ready} aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => viewport.current?.zoom('out')}><ZoomOut size={17} /></button>
      <button type="button" className={buttonClass} disabled={!ready} aria-label={copy.rotateLeft} title={copy.rotateLeft} onClick={() => viewport.current?.rotate('left')}><RotateCcw size={17} /></button>
      <button type="button" className={buttonClass} disabled={!ready} aria-label={copy.rotateRight} title={copy.rotateRight} onClick={() => viewport.current?.rotate('right')}><RotateCw size={17} /></button>
      <label className="inline-flex items-center gap-2 px-2 text-sm text-text-primary"><input type="checkbox" checked={wireframe} disabled={!ready} onChange={event => { setWireframe(event.target.checked); viewport.current?.setWireframe(event.target.checked); }} className="accent-accent-gold" />{copy.wireframe}</label>
      <label className="inline-flex items-center gap-2 text-sm text-text-muted">{copy.lighting}<select value={lighting} disabled={!ready} onChange={event => { const value = event.target.value as Lighting; setLighting(value); viewport.current?.setLighting(value); }} className="bg-elevated text-text-primary border border-border rounded-lg px-2 py-2"><option value="studio">{copy.studio}</option><option value="soft">{copy.soft}</option><option value="daylight">{copy.daylight}</option></select></label>
      {animations.length > 0 && <>
        <label className="inline-flex items-center gap-2 text-sm text-text-muted">{copy.animation}<select value={animation} onChange={event => { const value = Number(event.target.value); setAnimation(value); viewport.current?.setAnimation(value, playing); }} className="bg-elevated text-text-primary border border-border rounded-lg px-2 py-2">{animations.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></label>
        <button type="button" className={buttonClass} disabled={!ready} onClick={() => { setPlaying(value => !value); viewport.current?.setAnimation(animation, !playing); }}>{playing ? copy.pause : copy.play}</button>
      </>}
    </div>
    <div className={`relative border border-border rounded-xl overflow-hidden bg-surface ${compact?'h-[300px]':'min-h-[340px] h-[min(65vh,680px)]'}`}>
      <div ref={containerRef} className="absolute inset-0" data-testid="model-viewport" />
      {status === 'loading' && <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-text-muted bg-surface"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{copy.loading}</p>}
      {status !== 'loading' && status !== 'ready' && <p role="alert" className="absolute inset-0 flex items-center justify-center p-8 text-center text-text-primary bg-surface">{copy[status]}</p>}
    </div>
    <p role="status" className="sr-only">{ready ? copy.ready : ''}</p>
    <p className="mt-3 text-xs text-text-muted">{copy.help}</p>
  </div>;
}

export default function ModelViewerEngine({ projectId }: EngineComponentProps) {
  const { locale } = useTranslation();
  const copy = modelCopy(locale);
  const project = useLiveQuery(async () => await db.projects.get(projectId) ?? null, [projectId]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ModelErrorCode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ModelAsset | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const assets = project?.modelAssets ?? [];
  const asset = assets.find(value => value.id === selectedId) ?? assets[0];
  const deepLink=useDeepLinkParam('entity'); const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&assets.some(asset=>asset.id===deepLink)){setSelectedId(deepLink);setAppliedLink(deepLink);}
  async function importFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true); setError(null);
    try { const next = await assetFromFile(file); await addModelAsset(projectId, next); setSelectedId(next.id); }
    catch (failure) { setError(failure instanceof ModelError ? failure.code : 'save'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold text-text-primary">{copy.title}</h2><p className="text-sm text-text-muted mt-1">{copy.description}</p></div>
      <button type="button" disabled={busy || !project} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-gold text-deep font-semibold text-sm hover:bg-accent-amber disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-deep">
        {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}{busy ? copy.importing : copy.import}
      </button>
      <input ref={inputRef} type="file" accept=".glb,model/gltf-binary" aria-label={copy.import} className="hidden" onChange={event => void importFile(event.target.files?.[0])} />
    </div>
    {error && <p role="alert" className="text-sm text-danger">{copy[error]}</p>}
    {project === undefined ? <p role="status" className="text-text-muted">{copy.loading}</p> : project === null ? <p role="alert" className="text-text-muted">{copy.missingProject}</p> : asset ? <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-muted">{copy.model}<select value={asset.id} onChange={event => { setSelectedId(event.target.value); setError(null); }} className="bg-elevated text-text-primary border border-border rounded-lg px-3 py-2 max-w-[min(50vw,360px)]">{assets.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <span className="text-xs text-text-muted">{(asset.size / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 2 })} MB</span>
        <button type="button" className={buttonClass} onClick={() => { try { downloadBlobFile(new Blob([assetBytes(asset)], { type: 'model/gltf-binary' }), `${sanitizeFilename(asset.name.replace(/\.glb$/i, ''))}.glb`); } catch (failure) { setError(failure instanceof ModelError ? failure.code : 'failed'); } }}><Download size={15} aria-hidden="true" />{copy.download}</button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => setPendingDelete(asset)}><Trash2 size={15} aria-hidden="true" />{copy.remove}</button>
      </div>
      <ModelView key={`${projectId}-${asset.id}`} asset={asset} />
    </> : <div className="border border-dashed border-border rounded-xl py-20 px-6 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
      <Box size={40} className="mx-auto text-accent-gold mb-4" aria-hidden="true" /><h3 className="text-lg text-text-primary mb-2">{copy.empty}</h3><p className="text-sm text-text-muted">{copy.format}</p>
    </div>}
    <ConfirmDialog open={!!pendingDelete} destructive message={copy.confirmRemove.replace('{name}', pendingDelete?.name ?? '')} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
      const target = pendingDelete; if (!target) return;
      try { await removeModelAsset(projectId, target.id); setPendingDelete(null); }
      catch { setError('save'); setPendingDelete(null); }
    }} />
  </section>;
}
