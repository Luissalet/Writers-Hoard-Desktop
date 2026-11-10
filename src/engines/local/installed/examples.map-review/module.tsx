/* eslint-disable react-refresh/only-export-components -- Source packages export a definition, not a React refresh boundary. */
import {useEffect,useState} from 'react';
import {Check,Undo2} from 'lucide-react';
import {richProsePreviewHtml} from '@/engines/local/richProseHtml';
import {defineLocalTool,LocalToolRichProseEditor,useLocalToolLocale,useLocalToolWorldRead,type LocalToolDocumentReference,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';

type Review={target:LocalToolDocumentReference|null;note:string;reviewedVersion:string|null};
const initialState:Review={target:null,note:'',reviewedVersion:null};
const codec={version:1 as const,fields:{target:{kind:'reference' as const},note:{kind:'prose' as const,format:'rich' as const},reviewedVersion:{kind:'scalar' as const}}};
const preview={version:1 as const,fields:[{key:'note',label:{en:'Review notes',es:'Notas de revisión'}},{key:'reviewedVersion',label:{en:'Reviewed version',es:'Versión revisada'}}]};
const locales={defaultLocale:'en',catalogs:{en:{review:{title:'Map review'}},es:{review:{title:'Revisión de mapa'}}}};
const validateState=(value:LocalToolJson):value is Review=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.note!=='string'||value.reviewedVersion!==null&&typeof value.reviewedVersion!=='string')return false;
 const target=value.target;
 return target===null||!!target&&typeof target==='object'&&!Array.isArray(target)&&Object.keys(target).sort().join(',')==='documentId,kind'&&(target.kind==='maps'||target.kind==='worldgen')&&typeof target.documentId==='string'&&!!target.documentId;
};
const button='inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-40';

function MapReview({client,context}:LocalToolProps<Review>){
 const es=useLocalToolLocale(client).locale==='es';
 const [saved,setSaved]=useState<LocalToolSnapshot<Review>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState<string|null>(null);
 const [targets,setTargets]=useState<{reference:LocalToolDocumentReference;title:string}[]>([]);
 useEffect(()=>{
  let active=true,request=0;setReceipt(null);
  const refresh=()=>{const sequence=++request;void client.read().then(row=>{if(active&&sequence===request)setSaved(row);}).catch(()=>{if(active)setError(es?'No se pudo leer la revisión guardada.':'The saved review could not be read.');});};
  refresh();const off=client.subscribe?.(refresh);return()=>{active=false;off?.();};
 },[client,es]);
 useEffect(()=>{
  let active=true;
  if(!context?.map&&context?.canEdit)void Promise.all(['maps','worldgen'].map(async kind=>(await client.world.list(kind as 'maps'|'worldgen')).map(row=>({reference:{kind:kind as 'maps'|'worldgen',documentId:row.document.root.id},title:String(row.document.root.title??row.document.root.id)})))).then(rows=>{if(active)setTargets(rows.flat());}).catch(()=>{});
  return()=>{active=false;};
 },[client,context?.canEdit,context?.map]);
 const target=saved?.data.target;
 const world=useLocalToolWorldRead(client,target?.kind==='worldgen'?'worldgen':'maps',target?.documentId??'');
 const version=context?.map?.targetVersion??world.document?.version;
 const title=context?.map?.title??String(world.document?.document.root.title??(es?'Sin mapa elegido':'No map selected'));
 const reviewed=!!version&&saved?.data.reviewedVersion===version;
 const currentNotes=context?.map?.presentation.kind==='map-version';
 const run=async(action:()=>Promise<void>)=>{if(busy||!context?.canEdit)return;setBusy(true);setError('');try{await action();}catch{setError(es?'No se guardó la revisión. Conserva la nota y revisa el mapa y la versión actuales.':'The review was not saved. Keep the note and check the current map and release.');}finally{setBusy(false);}};
 return <section className="min-w-0 space-y-4" data-map-review>
  <header className="space-y-1"><h3 className="break-words font-display text-lg">{title}</h3><p className="text-sm text-text-muted">{target?.kind==='worldgen'?(es?'Mundo':'World'):(es?'Mapa':'Map')} · {context?.scope.eraId?`${es?'Época':'Era'} ${context.scope.eraId}`:'Base'}{context?.map?.provenance==='base'&&context.scope.eraId?(es?' · heredado de Base':' · inherited from Base'):''}</p></header>
  {!context?.map&&context?.canEdit&&<label className="flex min-w-0 flex-col gap-1 text-sm">{es?'Mapa revisado':'Reviewed map'}<select className="min-h-10 min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold" value={target?JSON.stringify(target):''} disabled={busy} onChange={event=>{const reference=targets.find(item=>JSON.stringify(item.reference)===event.target.value)?.reference;if(reference)void run(async()=>{const result=await client.state!.apply(await client.read(),[{type:'set',field:'target',value:reference}]);setSaved(result.snapshot);});}}><option value="">{es?'Elegir mapa':'Choose map'}</option>{targets.map(item=><option key={JSON.stringify(item.reference)} value={JSON.stringify(item.reference)}>{item.title} · {item.reference.kind}</option>)}</select></label>}
  {currentNotes&&<p role="status" className="max-w-prose text-sm text-text-muted">{es?'Esta vista histórica muestra las notas actuales en modo de solo lectura.':'This historical view shows the current notes as read only.'}</p>}
  <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-text-primary">{!target?(es?'Elige un mapa para registrar su revisión.':'Choose a map to record its review.'):reviewed?(es?'Esta versión está revisada.':'This version is reviewed.'):(es?'Revisión pendiente para la versión actual.':'The current version needs review.')}</p><button type="button" className={button} disabled={busy||!context?.canEdit||!target||!world.document} onClick={()=>void run(async()=>{
   const baseline=await client.read(),reference=baseline.data.target;if(!reference)throw Error('map_review_target_missing');
   const actual=await client.world.read(reference.kind,reference.documentId);if(!actual)throw Error('map_review_target_unavailable');
   const result=await client.state!.apply(baseline,[{type:'set',field:'reviewedVersion',value:actual.version}]);setSaved(result.snapshot);setReceipt(result.receiptId);
  })}><Check size={15}/>{es?'Registrar revisión':'Record review'}</button>{receipt&&<button type="button" className={button} disabled={busy||!context?.canEdit} onClick={()=>void run(async()=>{const result=await client.state!.undo(receipt);setSaved(result.snapshot);setReceipt(null);})}><Undo2 size={15}/>{es?'Deshacer revisión':'Undo review'}</button>}</div>
  {!context?.canEdit&&<section className="min-w-0 space-y-2"><h4 className="font-display text-base text-text-primary">{es?'Notas de revisión guardadas':'Saved review notes'}</h4>{saved?<div data-map-review-saved-note className="prose prose-sm max-w-none break-words text-text-primary" dangerouslySetInnerHTML={{__html:richProsePreviewHtml(saved.data.note)}}/>:<p role="status" className="text-sm text-text-muted">{es?'Cargando notas guardadas…':'Loading saved notes…'}</p>}</section>}
  <LocalToolRichProseEditor client={client} context={context} field="note" label={es?'Notas de revisión':'Review notes'}/>
  {error&&<p role="alert" className="max-w-prose text-sm text-danger">{error}</p>}
 </section>;
}

export default defineLocalTool<Review>({namespace:'examples.map-review',name:{en:'Map review',es:'Revisión de mapa'},description:{en:'Review the current map version and keep its notes in an independent Source document.',es:'Revisa la versión actual del mapa y guarda sus notas en un documento Source independiente.'},document:{defaultTitle:{en:'Map review',es:'Revisión de mapa'},embed:'interactive'},mapPanel:{version:1,targetField:'target',kinds:['maps','worldgen']},initialState,codec,preview,locales,validateState,component:MapReview});
