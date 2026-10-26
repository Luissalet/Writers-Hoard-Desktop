import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {LocalToolIcon,type LocalToolProps,type LocalToolIconPage,type LocalToolSnapshot} from '../sdk';
import {useLocalToolState} from '../useLocalToolState';
import {useLocalToolDefaults} from '../useLocalToolDefaults';
import {useTranslation} from '@/i18n/useTranslation';

export type IconNotebookState={version:1;iconId:string|null;notes:string};
const button='min-h-10 rounded-lg border border-border px-3 py-2 text-sm hover:bg-elevated disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent-gold';
const pageSize=50;
export function IconNotebook({client,context}:LocalToolProps<IconNotebookState>){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[draft,setDraft]=useState<{notes:string;baseline:LocalToolSnapshot<IconNotebookState>}>(),[retry,setRetry]=useState(0);
 const state=useLocalToolState(client,{observe:true,hasDraft:draft!==undefined});
 const favorite=useLocalToolDefaults(client,'favorite-icon');
 const favoriteBinding=useMemo(()=>({client,snapshot:favorite.snapshot}),[client,favorite.snapshot]),favoriteOwner=useRef<typeof favoriteBinding|null>(null);
 const [favoriteIcon,setFavoriteIcon]=useState<{binding:typeof favoriteBinding;id:string;label:string}|null>();
 const [usingFavorite,setUsingFavorite]=useState<typeof favoriteBinding>();
 const [favoriteUseError,setFavoriteUseError]=useState<typeof favoriteBinding>();
 useLayoutEffect(()=>{favoriteOwner.current=favoriteBinding;return()=>{if(favoriteOwner.current===favoriteBinding)favoriteOwner.current=null;};},[favoriteBinding]);
 useEffect(()=>{
  let active=true;setFavoriteIcon(undefined);const entry=favoriteBinding.snapshot?.entry;
  if(!entry?.present||typeof entry.value!=='string'||!client.icons){setFavoriteIcon(null);return;}
  void client.icons.get(entry.value).then(icon=>{if(active&&favoriteOwner.current===favoriteBinding)setFavoriteIcon(icon?{binding:favoriteBinding,id:icon.id,label:icon.label}:null);}).catch(()=>{if(active&&favoriteOwner.current===favoriteBinding)setFavoriteIcon(null);});
  return()=>{active=false;};
 },[client,favoriteBinding]);
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
 const applyFavorite=async()=>{
  const captured=favoriteBinding,source=state.snapshot;
  if(!source||!favoriteIcon||favoriteIcon.binding!==captured||usingFavorite===captured)return;
  setUsingFavorite(captured);setFavoriteUseError(undefined);
  try{const icon=await captured.client.icons?.get(favoriteIcon.id);if(favoriteOwner.current===captured&&icon)await state.apply([{type:'set',field:'iconId',value:icon.id}],source);}
  catch{if(favoriteOwner.current===captured)setFavoriteUseError(captured);}
  finally{if(favoriteOwner.current===captured)setUsingFavorite(undefined);}
 };
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
  <div aria-label={es?'Favorito compartido':'Shared favorite'} className="space-y-3 border-t border-border pt-4">
   <h3 className="text-sm font-medium">{es?'Favorito de esta herramienta en el mundo':'This tool’s favorite in this world'}</h3>
   {!favorite.available?<p role="status" className="text-sm text-text-muted">{es?'Este host no ofrece preferencias compartidas. Las notas siguen disponibles.':'This host does not provide shared preferences. Notes remain available.'}</p>:<>
    <p role="status" className="break-words text-sm text-text-primary">{favorite.busy?(es?'Guardando favorito…':'Saving favorite…'):favorite.loading?(es?'Consultando favorito…':'Reading favorite…'):!favorite.snapshot?(es?'No se ha podido consultar el favorito.':'Could not read the favorite.'):!favorite.snapshot.entry.present?(es?'Aún no hay favorito compartido.':'No shared favorite yet.'):favoriteIcon?.binding===favoriteBinding?`${es?'Favorito':'Favorite'}: ${favoriteIcon.label}`:favoriteIcon===undefined?(es?'Consultando símbolo favorito…':'Reading favorite symbol…'):(es?'El favorito guardado no está disponible en este catálogo.':'The saved favorite is unavailable in this catalogue.')}</p>
    <p className="text-sm text-text-muted">{es?'Guardar favorito no guarda las notas. Usarlo sólo cambia el símbolo de este cuaderno.':'Saving a favorite does not save notes. Using it changes only this notebook’s symbol.'}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable||!selected||!favorite.snapshot||favorite.loading||favorite.busy} onClick={()=>{if(selected)void favorite.set(selected);}}>{es?'Guardar favorito':'Save favorite'}</button><button type="button" className={button} disabled={!editable||!state.snapshot||state.busy||!favoriteIcon||favoriteIcon.binding!==favoriteBinding||usingFavorite===favoriteBinding} onClick={()=>void applyFavorite()}>{es?'Usar favorito':'Use favorite'}</button><button type="button" className={button} disabled={!editable||favorite.busy||favorite.loading||!favorite.canUndo} onClick={()=>void favorite.undo()}>{es?'Deshacer favorito':'Undo favorite'}</button><button type="button" className={button} disabled={!editable||favorite.busy||favorite.loading||!favorite.canRedo} onClick={()=>void favorite.redo()}>{es?'Rehacer favorito':'Redo favorite'}</button></div>
    {favorite.error&&<p role="alert" className="text-sm text-text-primary">{es?'No se pudo actualizar el favorito. Conservamos la propuesta y tus notas. Recarga el favorito antes de volver a guardarlo.':'Could not update the favorite. Your proposal and notes are preserved. Reload the favorite before saving again.'}</p>}
    {favoriteUseError===favoriteBinding&&<p role="alert" className="text-sm text-text-primary">{es?'No se pudo consultar el símbolo favorito. Tus notas se conservan; vuelve a intentarlo.':'Could not read the favorite symbol. Your notes are preserved; try again.'}</p>}
    {(favorite.error||favorite.hasProposal)&&<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={favorite.busy||favorite.loading} onClick={()=>void favorite.reload()}>{es?'Recargar favorito':'Reload favorite'}</button>{favorite.hasProposal&&<button type="button" className={button} disabled={!editable||favorite.busy||favorite.loading||!!favorite.error} onClick={()=>void favorite.retry()}>{es?'Reintentar guardar favorito':'Retry saving favorite'}</button>}</div>}
   </>}
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
