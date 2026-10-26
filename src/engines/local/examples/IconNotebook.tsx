import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {LocalToolIcon,type LocalToolProps,type LocalToolIconPage,type LocalToolSnapshot} from '../sdk';
import {useLocalToolState} from '../useLocalToolState';
import {useTranslation} from '@/i18n/useTranslation';

export type IconNotebookState={version:1;iconId:string|null;notes:string};
const button='min-h-10 rounded-lg border border-border px-3 py-2 text-sm hover:bg-elevated disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent-gold';
const pageSize=50;
export function IconNotebook({client,context}:LocalToolProps<IconNotebookState>){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[draft,setDraft]=useState<{notes:string;baseline:LocalToolSnapshot<IconNotebookState>}>(),[retry,setRetry]=useState(0);
 const state=useLocalToolState(client,{observe:true,hasDraft:draft!==undefined});
 const selected=state.snapshot?.data.iconId,binding=useMemo(()=>({client,id:selected}),[client,selected]);
 const owner=useRef<typeof binding|null>(null);
 const [exported,setExported]=useState<{binding:typeof binding;status:'busy'|'started'|'unavailable'|'error'}>();
 const currentExport=exported?.binding===binding?exported:undefined;
 useLayoutEffect(()=>{owner.current=binding;return()=>{if(owner.current===binding)owner.current=null;};},[binding]);
 const [page,setPage]=useState<{binding:typeof client;query:string;offset:number;retry:number;result?:LocalToolIconPage;error?:boolean}>();
 const current=page?.binding===client&&page.query===query&&page.offset===offset&&page.retry===retry?page:undefined;
 const editable=context?.canEdit!==false;
 useEffect(()=>{
  let active=true;
  if(client.icons)void client.icons.search(query,{offset,limit:pageSize}).then(result=>{if(active)setPage({binding:client,query,offset,retry,result});}).catch(()=>{if(active)setPage({binding:client,query,offset,retry,error:true});});
  return()=>{active=false;};
 },[client,query,offset,retry]);
 const saveNotes=async()=>{if(draft===undefined)return;const captured=draft;const ok=await state.apply([{type:'set',field:'notes',value:captured.notes}],captured.baseline);if(ok)setDraft(value=>value===captured?undefined:value);};
 const downloadSvg=async()=>{
  const icons=binding.client.icons;if(!binding.id||!icons?.resolveSvg||currentExport?.status==='busy')return;
  setExported({binding,status:'busy'});
  try{
   const icon=await icons.get(binding.id);if(owner.current!==binding)return;
   const svg=icon?await icons.resolveSvg(icon.id):null;if(owner.current!==binding)return;
   if(!icon||svg===null){setExported({binding,status:'unavailable'});return;}
   const {downloadTextFile}=await import('@/engines/writings/manuscriptExport');if(owner.current!==binding)return;
   downloadTextFile(svg,icon.name+'.svg','image/svg+xml');setExported({binding,status:'started'});
  }catch{if(owner.current===binding)setExported({binding,status:'error'});}
 };
 return <section aria-label={es?'Cuaderno de iconos':'Icon notebook'} className="min-w-0 space-y-5 p-5 text-text-primary">
  <header className="flex min-w-0 flex-wrap items-center gap-3"><LocalToolIcon client={client} icon={state.snapshot?.data.iconId} size={28}/><h2 className="font-display text-xl">{es?'Cuaderno de iconos':'Icon notebook'}</h2></header>
  {state.snapshot?.data.iconId&&<p className="break-all text-sm text-text-muted">{state.snapshot.data.iconId}</p>}
  <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={!selected||!client.icons?.resolveSvg||currentExport?.status==='busy'} onClick={()=>void downloadSvg()}>{es?'Descargar SVG':'Download SVG'}</button>
   {!client.icons?.resolveSvg?<p role="status" className="text-sm text-text-muted">{es?'Este host no ofrece SVG. Las notas siguen disponibles.':'This host does not provide SVG. Notes remain available.'}</p>:currentExport&&<p role={currentExport.status==='error'?'alert':'status'} className="text-sm text-text-primary">{currentExport.status==='busy'?(es?'Preparando SVG…':'Preparing SVG…'):currentExport.status==='started'?(es?'Descarga de SVG iniciada.':'SVG download started.'):currentExport.status==='unavailable'?(es?'No hay SVG disponible para este símbolo.':'No SVG is available for this symbol.'):(es?'No se pudo preparar el SVG. Tus notas se conservan; vuelve a intentarlo.':'Could not prepare the SVG. Your notes are preserved; try again.')}</p>}
  </div>
  <div className="space-y-3"><label htmlFor={id+'-search'} className="block text-sm">{es?'Buscar símbolo':'Search symbols'}</label><input id={id+'-search'} type="search" value={query} onChange={event=>{setQuery(event.target.value);setOffset(0);}} className="min-h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold"/>
   {!client.icons?<p role="status" className="text-sm text-text-muted">{es?'Este host no ofrece el catálogo de símbolos. Las notas siguen disponibles.':'This host does not provide the symbol catalogue. Notes remain available.'}</p>:current?.error?<div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-text-primary">{es?'No se pudo consultar el catálogo. Tus notas se conservan.':'Could not read the catalogue. Your notes are preserved.'}</p><button type="button" className={button} onClick={()=>setRetry(value=>value+1)}>{es?'Reintentar':'Retry'}</button></div>:!current?.result?<p role="status" className="text-sm text-text-muted">{es?'Cargando símbolos…':'Loading symbols…'}</p>:<>
    <p role="status" className="text-sm tabular-nums text-text-muted">{current.result.total===0?(es?'No se encontraron símbolos.':'No symbols found.'):`${offset+1}–${offset+current.result.items.length} / ${current.result.total}`}</p>
    <ul aria-label={es?'Símbolos disponibles':'Available symbols'} className="grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 p-0">{current.result.items.map(item=><li key={item.id} className="min-w-0"><button type="button" aria-pressed={state.snapshot?.data.iconId===item.id} disabled={!editable||!state.snapshot||state.busy} onClick={()=>void state.apply([{type:'set',field:'iconId',value:item.id}])} className={button+' flex w-full items-center gap-2 text-left '+(state.snapshot?.data.iconId===item.id?'bg-elevated text-accent-gold':'')}><LocalToolIcon client={client} icon={item.id}/><span className="min-w-0 break-words">{item.label}</span></button></li>)}</ul>
    <nav aria-label={es?'Páginas de símbolos':'Symbol pages'} className="flex flex-wrap gap-2"><button type="button" className={button} disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-pageSize))}>{es?'Anterior':'Previous'}</button><button type="button" className={button} disabled={offset+pageSize>=current.result.total} onClick={()=>setOffset(value=>value+pageSize)}>{es?'Siguiente':'Next'}</button></nav>
   </>}
  </div>
  <div className="space-y-2 border-t border-border pt-4"><label htmlFor={id+'-notes'} className="block text-sm">{es?'Notas':'Notes'}</label><textarea id={id+'-notes'} rows={5} value={draft?.notes??state.snapshot?.data.notes??''} disabled={!editable||!state.snapshot||state.busy} onChange={event=>{const notes=event.target.value,baseline=state.snapshot;if(baseline)setDraft(previous=>({notes,baseline:previous?.baseline??baseline}));}} className="block w-full rounded-lg border border-border bg-elevated p-3 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold"/>
   <div className="flex flex-wrap gap-2"><button type="button" className={button+' bg-accent-gold text-deep hover:bg-accent-amber'} disabled={!editable||!state.snapshot||state.busy||draft===undefined} onClick={()=>void saveNotes()}>{es?'Guardar notas':'Save notes'}</button><button type="button" className={button} disabled={!editable||state.busy||!state.canUndo||draft!==undefined} onClick={()=>void state.undo()}>{es?'Deshacer':'Undo'}</button><button type="button" className={button} disabled={!editable||state.busy||!state.canRedo||draft!==undefined} onClick={()=>void state.redo()}>{es?'Rehacer':'Redo'}</button><button type="button" className={button} disabled={state.busy||draft===undefined} onClick={()=>void state.reload().then(ok=>{if(ok)setDraft(undefined);})}>{es?'Descartar borrador y recargar':'Discard draft and reload'}</button></div>
  </div>
  {state.error&&<p role="alert" className="text-sm text-text-primary">{es?'No se pudo guardar el cambio. Conservamos tus notas; vuelve a guardar cuando hayas revisado el documento.':'Could not save the change. Your notes are preserved; save again after reviewing the document.'}</p>}
 </section>;
}
