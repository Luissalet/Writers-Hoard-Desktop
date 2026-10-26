import { bindEraOperation, useWorldEraScope, useEraProject } from '@/services/worldEras/hooks';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Box, Download, LoaderCircle, RotateCcw, RotateCw, Upload, ZoomIn, ZoomOut, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { ConfirmDialog,useDeepLinkParam } from '@/engines/_shared';
import { downloadBlobFile, sanitizeFilename } from '@/engines/writings/manuscriptExport';
import { addModelAsset as addModelAssetScoped, assetBytes, assetFromFiles, modelStoredBytes, originalModelDownload, ModelError, removeModelAsset as removeModelAssetScoped, type ModelAsset, type ModelErrorCode } from './model';
import { createModelViewport, type CameraDirection, type CameraMode, type Lighting, type ModelViewport } from './viewport';
import { modelCopy } from './locales';
import { animationPresentationRows, type AnimationPresentationAction } from './animationPresentation';
import { editModelAnimationPresentation, undoModelAnimationPresentation } from './animationActions';
import { readWorldDocument } from '@/services/worldEras/store';
import { WorldEraConflict } from '@/services/worldEras/types';
import { recordUndoable, UndoStaleError } from '@/services/undoJournal';

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold hover:text-accent-gold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

interface PresentationEditor { version: string | null; apply: (change: AnimationPresentationAction, version: string) => Promise<void> }
export function ModelView({ asset,compact=false,editor }: { asset: ModelAsset;compact?:boolean;editor?:PresentationEditor }) {
  const { locale } = useTranslation();
  const copy = modelCopy(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<ModelViewport | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | ModelErrorCode>('loading');
  const [wireframe, setWireframe] = useState(false);
  const [lighting, setLighting] = useState<Lighting>('studio');
  const [loadedAnimations, setLoadedAnimations] = useState<{id:string;dataUrl:string;size:number;names:string[]}|null>(null);
  const [animation, setAnimation] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [autoRotate, setAutoRotate] = useState(compact && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [labelDraft, setLabelDraft] = useState<{index:number;version:string;text:string}|null>(null);
  const [presentationBusy, setPresentationBusy] = useState(false);
  const [presentationError, setPresentationError] = useState<string|null>(null);
  const operation = useRef(0);
  const { id, dataUrl, size } = asset;
  const loaded = loadedAnimations?.id===id&&loadedAnimations.dataUrl===dataUrl&&loadedAnimations.size===size;
  const animations = loaded ? loadedAnimations.names : [];
  useEffect(() => () => { operation.current++; }, []);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const controller = new AbortController();
    let active: ModelViewport | null = null;
    operation.current++;
    const binary = { id, dataUrl, size, name: '', createdAt: 0 };
    void createModelViewport(container, binary, '', error => { if (!cancelled) setStatus(error.code); }, controller.signal, mode => { if (!cancelled) setCameraMode(mode); }).then(result => {
      if (cancelled) { result.dispose(); return; }
      active = result; viewport.current = result;
      setLoadedAnimations({id,dataUrl,size,names:result.animations});setAnimation(0);setPlaying(false);setLoop(true);setWireframe(false);setLighting('studio');setCameraMode('orbit');setLabelDraft(null);setPresentationError(null);setPresentationBusy(false);setStatus('ready');
    }).catch(error => { if (!cancelled) setStatus(error instanceof ModelError ? error.code : 'failed'); });
    return () => { cancelled = true; controller.abort(); active?.dispose(); viewport.current = null; };
  }, [id, dataUrl, size]);
  useEffect(() => { containerRef.current?.querySelector('canvas')?.setAttribute('aria-label', copy.canvas); }, [copy.canvas, status]);
  const ready = status === 'ready' && loaded;
  const displayStatus = status==='ready'&&!loaded?'loading':status;
  const presentation = animations.length ? animationPresentationRows(animations, asset.animationPresentation) : { order: [], clips: [] };
  const position = presentation.order.indexOf(animation);
  const currentDraft = labelDraft?.index === animation ? labelDraft : null;
  async function changePresentation(change: AnimationPresentationAction, version: string | null = editor?.version ?? null) {
    if (!editor || !version || presentationBusy) return;
    const token = ++operation.current;
    setPresentationBusy(true); setPresentationError(null);
    try {
      await editor.apply(change, version);
      if (token === operation.current) setLabelDraft(null);
    } catch (failure) {
      if (token === operation.current) setPresentationError(failure instanceof WorldEraConflict ? copy.animationConflict : copy.animationSave);
    } finally { if (token === operation.current) setPresentationBusy(false); }
  }
  function adjacent(offset:number) {
    const next = presentation.order[(position + offset + presentation.order.length) % presentation.order.length];
    setAnimation(next); viewport.current?.setAnimation(next, playing, loop);
  }
  useEffect(() => { if (ready) viewport.current?.setAutoRotate(autoRotate); }, [ready, autoRotate]);
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
        <button type="button" className={buttonClass} disabled={!ready || animations.length < 2} aria-label={locale === 'es' ? 'Animación anterior' : 'Previous animation'} data-testid="model-animation-previous" onClick={() => adjacent(-1)}>‹</button>
        <label className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-text-muted">{copy.animation}<select data-testid="model-animation" value={animation} onChange={event => { const value = Number(event.target.value); setAnimation(value); viewport.current?.setAnimation(value, playing, loop); }} className="min-w-0 max-w-full bg-elevated text-text-primary border border-border rounded-lg px-2 py-2">{presentation.clips.map(clip => <option key={clip.index} value={clip.index}>{clip.label}</option>)}</select></label>
        <button type="button" className={buttonClass} disabled={!ready || animations.length < 2} aria-label={locale === 'es' ? 'Animación siguiente' : 'Next animation'} data-testid="model-animation-next" onClick={() => adjacent(1)}>›</button>
        <button type="button" className={buttonClass} disabled={!ready} data-testid="model-animation-play" onClick={() => { setPlaying(value => !value); viewport.current?.setAnimation(animation, !playing, loop); }}>{playing ? copy.pause : copy.play}</button>
        <label className="inline-flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" className="accent-accent-gold" data-testid="model-animation-loop" checked={loop} disabled={!ready} onChange={event => { setLoop(event.target.checked); viewport.current?.setAnimation(animation, playing, event.target.checked); }} />{locale === 'es' ? 'En bucle' : 'Loop'}</label>
        <span className="text-xs text-text-muted" data-testid="model-animation-count">{position + 1}/{animations.length}</span>
      </>}
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-text-muted">
      <label className="inline-flex items-center gap-2">{copy.camera}<select aria-label={copy.camera} value={cameraMode} disabled={!ready} onChange={event => viewport.current?.setCameraMode(event.target.value as CameraMode)} className="rounded-lg border border-border bg-elevated px-2 py-2 text-text-primary focus-visible:outline-accent-gold"><option value="orbit">{copy.orbit}</option><option value="fly">{copy.fly}</option></select></label>
      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={autoRotate} disabled={!ready || cameraMode === 'fly'} onChange={event => setAutoRotate(event.target.checked)} className="accent-accent-gold" />{copy.autoRotate}</label>
      {editor && animations.length > 0 && <form className="flex max-w-full flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void changePresentation({action:'rename',index:animation,label:currentDraft?.text ?? asset.animationPresentation?.labels?.[String(animation)] ?? ''},currentDraft?.version ?? editor.version); }}>
        <label className="inline-flex max-w-full items-center gap-2">{copy.animationLabel}<input aria-label={copy.animationLabel} value={currentDraft?.text ?? asset.animationPresentation?.labels?.[String(animation)] ?? ''} placeholder={presentation.clips.find(clip=>clip.index===animation)?.label} disabled={!ready || !editor.version || presentationBusy} onChange={event => { const text=event.target.value;setLabelDraft(previous=>({index:animation,version:previous?.index===animation?previous.version:editor.version!,text})); }} className="w-40 max-w-full rounded-lg border border-border bg-elevated px-2 py-2 text-text-primary placeholder:text-text-muted focus-visible:outline-accent-gold" /></label>
        <button type="submit" className={buttonClass} disabled={!ready || !editor.version || presentationBusy || !currentDraft}>{copy.saveAnimationLabel}</button>
        <button type="button" className={buttonClass} aria-label={copy.animationEarlier} title={copy.animationEarlier} disabled={!ready || !editor.version || presentationBusy || !!currentDraft || position<1} onClick={()=>{void changePresentation({action:'move',index:animation,position:position-1});}}><ArrowUp size={16} aria-hidden="true" /></button>
        <button type="button" className={buttonClass} aria-label={copy.animationLater} title={copy.animationLater} disabled={!ready || !editor.version || presentationBusy || !!currentDraft || position>=animations.length-1} onClick={()=>{void changePresentation({action:'move',index:animation,position:position+1});}}><ArrowDown size={16} aria-hidden="true" /></button>
        <button type="button" className={buttonClass} disabled={!ready || !editor.version || presentationBusy || !!currentDraft || asset.animationPresentation===undefined} onClick={()=>{void changePresentation({action:'reset'});}}>{copy.resetAnimationPresentation}</button>
        {presentationError && <p role="alert" className="w-full text-sm text-text-primary">{presentationError}</p>}
        {presentationError && currentDraft && <div className="flex min-w-0 w-full flex-wrap items-center gap-2 text-sm text-text-primary"><span className="min-w-0 max-w-full break-words">{copy.animationCurrentLabel}: {presentation.clips.find(clip=>clip.index===animation)?.label}</span><button type="button" className={buttonClass} disabled={!editor.version||presentationBusy} onClick={()=>{if(editor.version){setLabelDraft({...currentDraft,version:editor.version});setPresentationError(null);}}}>{copy.reviewAnimationVersion}</button></div>}
      </form>}
      {cameraMode === 'fly' && <div className="flex flex-wrap gap-2" aria-label={copy.move}>
        {(['forward', 'back', 'left', 'right', 'up', 'down'] as CameraDirection[]).map(direction => <button key={direction} type="button" disabled={!ready} className={buttonClass} onClick={() => viewport.current?.move(direction)}>{copy[direction]}</button>)}
      </div>}
    </div>
    <div className={`relative border border-border rounded-xl overflow-hidden bg-surface ${compact?'h-[300px]':'min-h-[340px] h-[min(65vh,680px)]'}`}>
      <div ref={containerRef} className="absolute inset-0" data-testid="model-viewport" />
      {displayStatus === 'loading' && <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-text-muted bg-surface"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{copy.loading}</p>}
      {displayStatus !== 'loading' && displayStatus !== 'ready' && <p role="alert" className="absolute inset-0 flex items-center justify-center p-8 text-center text-text-primary bg-surface">{copy[displayStatus]}</p>}
    </div>
    <p role="status" className="sr-only">{ready ? copy.ready : ''}</p>
    <p className="mt-3 text-xs text-text-muted">{copy.help}</p>
  </div>;
}

export default function ModelViewerEngine({ projectId }: EngineComponentProps) {
  const { locale } = useTranslation();
  const copy = modelCopy(locale);
  const scope = useWorldEraScope(projectId);
  const addModelAsset = bindEraOperation(addModelAssetScoped, scope.eraId, 2);
  const removeModelAsset = bindEraOperation(removeModelAssetScoped, scope.eraId, 2);
  const project = useEraProject(projectId);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ModelErrorCode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ModelAsset | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<HTMLInputElement>(null);
  useEffect(() => { directoryRef.current?.setAttribute('webkitdirectory', ''); }, []);
  const assets = project?.modelAssets ?? [];
  const asset = assets.find(value => value.id === selectedId) ?? assets[0];
  const [animationRead, setAnimationRead] = useState<{asset:ModelAsset;scopeKey:string;version:string}|null>(null);
  const scopeKey = JSON.stringify([scope.projectId,scope.eraId,asset?.id]);
  useEffect(()=>{
    if(!asset)return;
    let active=true;
    void readWorldDocument(scope,'model-viewer',asset.id).then(read=>{
      if(active&&read&&JSON.stringify(read.document.root)===JSON.stringify(asset))setAnimationRead({asset,scopeKey,version:read.version});
    }).catch(()=>{});
    return()=>{active=false;};
  },[asset,scope,scopeKey]);
  async function saveAnimationPresentation(change:AnimationPresentationAction,version:string){
    if(!asset) return;
    const target={...scope},modelId=asset.id;
    await editModelAnimationPresentation(target,modelId,change,version,result=>{
      if(!result.receiptId)return;
      const receiptId=result.receiptId;
      recordUndoable({projectId,kind:'asset',label:copy.animationPresentation,notice:copy.animationSaved,undo:async()=>{
        try{await undoModelAnimationPresentation(target,receiptId);}
        catch(failure){if(failure instanceof WorldEraConflict||failure instanceof Error&&failure.message==='model_animation_receipt_missing')throw new UndoStaleError();throw failure;}
      }});
    });
  }
  const deepLink=useDeepLinkParam('entity'); const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&assets.some(asset=>asset.id===deepLink)){setSelectedId(deepLink);setAppliedLink(deepLink);}
  async function importFiles(files: FileList | File[] | null) {
    if (!files?.length || busy) return;
    setBusy(true); setError(null);
    try { const next = await assetFromFiles(Array.from(files)); await addModelAsset(projectId, next); setSelectedId(next.id); }
    catch (failure) { setError(failure instanceof ModelError ? failure.code : 'save'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold text-text-primary">{copy.title}</h2><p className="text-sm text-text-muted mt-1">{copy.description}</p></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy || !project} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-gold text-deep font-semibold text-sm hover:bg-accent-amber disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-deep">
        {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}{busy ? copy.importing : copy.import}
      </button>
      <button type="button" disabled={busy || !project} onClick={() => directoryRef.current?.click()} className={buttonClass}>{copy.importFolder}</button></div>
      <input ref={inputRef} type="file" multiple accept=".glb,.gltf,.fbx,.obj,.mtl,.stl,.ply,.bin,.png,.jpg,.jpeg,.webp,.avif" aria-label={copy.import} className="hidden" onChange={event => void importFiles(event.target.files)} />
      <input ref={directoryRef} type="file" multiple aria-label={copy.importFolder} className="hidden" onChange={event => void importFiles(event.target.files)} />
    </div>
    <p className="max-w-prose text-xs leading-relaxed text-text-muted">{copy.format}</p>
    {error && <p role="alert" className="text-sm text-danger">{copy[error]}</p>}
    {project === undefined ? <p role="status" className="text-text-muted">{copy.loading}</p> : project === null ? <p role="alert" className="text-text-muted">{copy.missingProject}</p> : asset ? <>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-muted">{copy.model}<select value={asset.id} onChange={event => { setSelectedId(event.target.value); setError(null); }} className="bg-elevated text-text-primary border border-border rounded-lg px-3 py-2 max-w-[min(50vw,360px)]">{assets.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <span className="text-xs tabular-nums text-text-muted">{(modelStoredBytes(asset) / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 2 })} MB</span>
        <button type="button" className={buttonClass} onClick={() => { try { downloadBlobFile(new Blob([assetBytes(asset)], { type: 'model/gltf-binary' }), `${sanitizeFilename(asset.name.replace(/\.(glb|gltf|fbx|obj|stl|ply)$/i, ''))}.glb`); } catch (failure) { setError(failure instanceof ModelError ? failure.code : 'failed'); } }}><Download size={15} aria-hidden="true" />{copy.download}</button>
        {(asset as ModelAsset).sourceFiles?.length ? <button type="button" className={buttonClass} onClick={() => { void originalModelDownload(asset).then(({ blob, name }) => downloadBlobFile(blob, sanitizeFilename(name))).catch(failure => setError(failure instanceof ModelError ? failure.code : 'failed')); }}><Download size={15} aria-hidden="true" />{copy.original}</button> : null}
        <button type="button" className={buttonClass} disabled={busy} onClick={() => setPendingDelete(asset)}><Trash2 size={15} aria-hidden="true" />{copy.remove}</button>
      </div>
      <ModelView key={`${projectId}-${scope.eraId??''}-${asset.id}`} asset={asset} editor={{version:animationRead?.asset===asset&&animationRead.scopeKey===scopeKey?animationRead.version:null,apply:saveAnimationPresentation}} />
    </> : <div className="border border-dashed border-border rounded-xl py-20 px-6 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFiles(event.dataTransfer.files); }}>
      <Box size={40} className="mx-auto text-accent-gold mb-4" aria-hidden="true" /><h3 className="text-lg text-text-primary mb-2">{copy.empty}</h3><p className="text-sm text-text-muted">{copy.format}</p>
    </div>}
    <ConfirmDialog open={!!pendingDelete} destructive message={copy.confirmRemove.replace('{name}', pendingDelete?.name ?? '')} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
      const target = pendingDelete; if (!target) return;
      try { await removeModelAsset(projectId, target.id); setPendingDelete(null); }
      catch { setError('save'); setPendingDelete(null); }
    }} />
  </section>;
}
