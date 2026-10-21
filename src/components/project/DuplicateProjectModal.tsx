import { useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useLocaleStore } from '@/stores/localeStore';
import { previewProjectDuplicate, duplicateProject, pendingProjectDuplicate, resumeProjectDuplicate } from '@/services/projectDuplicate/service';
import type { ProjectDuplicatePreview, ProjectDuplicateResult } from '@/services/projectDuplicate/types';
import type { Project } from '@/types';

export default function DuplicateProjectModal({project,onClose,onOpen}:{project:Project;onClose:()=>void;onOpen:(projectId:string)=>void}){
 const es=useLocaleStore(state=>state.locale)==='es',nameRef=useRef<HTMLInputElement>(null),operation=useRef<string>(crypto.randomUUID());
 const [title,setTitle]=useState(`${project.title} · ${es?'Copia':'Copy'}`),[preview,setPreview]=useState<ProjectDuplicatePreview>(),[result,setResult]=useState<ProjectDuplicateResult>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const inspect=async()=>{setBusy(true);setError('');try{setPreview(await previewProjectDuplicate({projectId:project.id}));operation.current=crypto.randomUUID();}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 useEffect(()=>{let active=true;void(async()=>{const saved=await pendingProjectDuplicate(project.id);if(!active)return;if(saved){operation.current=saved.operationId;setTitle(saved.title);setResult(saved);return;}const value=await previewProjectDuplicate({projectId:project.id});if(active)setPreview(value);})().catch(reason=>{if(active)setError(String(reason));});return()=>{active=false;};},[project.id]);
 const apply=async()=>{if(!preview&&!result)return;setBusy(true);setError('');try{const copied=result?await resumeProjectDuplicate(operation.current):await duplicateProject({projectId:project.id,title,operationId:operation.current,expectedSourceVersion:preview!.sourceVersion});setResult(copied);if(copied.complete)onOpen(copied.projectId);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 const field='w-full rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold';
 const details:[string,string[]][]=[
  [es?'Fichas':'Cards',['codexEntries']],[es?'Capítulos y escenas':'Chapters and scenes',['writings','scenes','dialogBlocks']],
  [es?'Mapas, lugares y cronologías':'Maps, places and timelines',['worldMaps','mapPins','generatedWorlds','worldWaypoints','atlasPlaces','atlasDivergences','timelines','timelineEvents','timelineConnections']],
  [es?'Tableros e imágenes':'Boards and images',['boards','boardNodes','boardEdges','boardLayers','boardViews','imageCollections','inspirationImages','storyboards','storyboardPanels','storyboardConnectors']],
  [es?'Historial y recuperación':'History and recovery',['writingSnapshots','documentHistory','documentArchives','worldEraVariants','worldEraAssets','manuscriptSources']],
  [es?'Comentarios y respuestas':'Comments and replies',['annotations','annotationReferences','betaComments','betaResponses']],
 ];
 return <Modal open onClose={onClose} title={es?'Duplicar proyecto':'Duplicate project'} busy={busy} initialFocusRef={nameRef}>
  <div className="space-y-5" data-testid="project-duplicate-modal">
   <p className="text-sm leading-relaxed text-text-muted">{es?'Se crea un proyecto nuevo con sus documentos, eras, historial y archivos locales. Los originales se conservan.':'Create a new project with its documents, eras, history and local files. The originals are retained.'}</p>
   <label className="block text-sm text-text-primary">{es?'Nombre de la copia':'Copy name'}<input ref={nameRef} data-testid="project-duplicate-name" value={title} disabled={busy||!!result} onChange={event=>setTitle(event.target.value)} className={`${field} mt-2`}/></label>
   {!preview&&!result&&!error&&<p role="status" className="text-sm text-text-muted">{es?'Leyendo el proyecto…':'Reading project…'}</p>}
   {preview&&<div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
    <div className="flex flex-wrap gap-x-5 gap-y-2"><span><strong>{Object.values(preview.counts).reduce((sum,count)=>sum+count,0).toLocaleString()}</strong> {es?'elementos del proyecto':'project items'}</span><span><strong>{preview.files.length}</strong> {es?'archivos gestionados':'managed files'}</span></div>
    {preview.shared.parentId&&<p className="text-text-muted">{es?'La copia será otro libro de la misma saga.':'The copy will be another book in the same saga.'}</p>}
    {project.type==='saga'&&!!project.children?.length&&<p className="text-text-muted">{es?'Se copia esta saga; sus libros continúan en la saga original.':'This saga is copied; its books stay in the original saga.'}</p>}
    {(preview.shared.referenceDocuments>0||preview.shared.nativeBindings>0)&&<p className="text-text-muted">{es?'Se mantienen las referencias a la biblioteca y a los objetos nativos compartidos.':'References to the shared library and native objects are retained.'}</p>}
    <details><summary className="cursor-pointer text-text-muted">{es?'Contenido de la copia':'Copy contents'}</summary><dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs">{details.map(([label,tables])=>[label,tables.reduce((sum,table)=>sum+(preview.counts[table]??0),0)] as const).filter(([,count])=>count>0).map(([label,count])=><div key={label} className="contents"><dt className="text-text-muted">{label}</dt><dd>{count}</dd></div>)}</dl><p className="mt-3 text-xs text-text-muted">{es?'También se conservan los demás datos y ajustes propios del proyecto.':'Other owned project data and settings are also retained.'}</p></details>
   </div>}
   {!!preview?.findings.length&&<div role="alert" className="rounded-lg border border-danger/30 p-3 text-sm"><p>{es?'Faltan archivos locales. Restáuralos en el proyecto original y vuelve a revisar.':'Local files are missing. Restore them in the original project and review again.'}</p><ul className="mt-2 space-y-1 break-all text-xs">{preview.findings.map(value=><li key={value}>{value.replace(/^managed_asset_missing:/,'')}</li>)}</ul></div>}
   {error&&<p role="alert" className="break-words text-sm text-danger">{error.includes('source_conflict')?(es?'El proyecto cambió durante la preparación. Actualiza la revisión y vuelve a duplicar.':'The project changed while preparing. Refresh the review and duplicate again.'):error}</p>}
   {result&&!result.complete&&<div role="status" className="space-y-2 rounded-lg border border-accent-gold/40 p-3 text-sm"><p>{es?'La copia ya existe. Queda pendiente completar sus recursos o referencias nativas; Reintentar continúa la misma copia.':'The copy already exists. Its resources or native references still need completion; Retry continues the same copy.'}</p><ul className="break-words text-xs text-text-muted">{result.unfinished.map(reason=><li key={reason}>{reason}</li>)}</ul><button type="button" onClick={()=>onOpen(result.projectId)} className="text-accent-gold underline">{es?'Abrir la copia creada':'Open created copy'}</button></div>}
   <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
    {!result&&<button type="button" disabled={busy} onClick={()=>void inspect()} className="mr-auto inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-text-muted hover:bg-surface disabled:opacity-50"><RefreshCw size={15}/>{es?'Actualizar revisión':'Refresh review'}</button>}
    <button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg border border-border px-4 text-sm">{es?'Cerrar':'Close'}</button>
    <button type="button" data-testid="project-duplicate-apply" disabled={busy||!title.trim()||(!result&&!preview?.canDuplicate)} onClick={()=>void apply()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep hover:brightness-110 disabled:opacity-40"><Copy size={16}/>{busy?(es?'Duplicando…':'Copying…'):result?(es?'Reintentar':'Retry'):(es?'Duplicar':'Duplicate')}</button>
   </div>
  </div>
 </Modal>;
}
