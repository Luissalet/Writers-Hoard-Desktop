/* eslint-disable react-refresh/only-export-components -- A Source release exports its SDK definition. */
import {useId,useState} from 'react';
import {defineLocalTool,useLocalToolT,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';
import {useLocalToolState} from '@/engines/local/useLocalToolState';

type Notebook={name:string;other:Record<string,string>};
const initialState:Notebook={name:'Initial',other:{keep:'Other map Ω'}};
const codec={version:1 as const,fields:{name:{kind:'scalar' as const},other:{kind:'map' as const}}};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validateState=(value:LocalToolJson):value is Notebook=>object(value)&&typeof value.name==='string'&&!!value.name&&object(value.other)&&Object.values(value.other).every(item=>typeof item==='string');
const locales={defaultLocale:'en',catalogs:{en:{heading:'Notebook',name:'Name',save:'Save name',discard:'Discard draft',other:'Other saved values',undo:'Undo notebook change',redo:'Redo notebook change',nameDraft:'Draft name',opening:'Opening notebook…',failed:'Could not save. Your draft is still here.'},es:{heading:'Cuaderno',name:'Nombre',save:'Guardar nombre',discard:'Descartar borrador',other:'Otros valores guardados',undo:'Deshacer cambio del cuaderno',redo:'Rehacer cambio del cuaderno',nameDraft:'Borrador del nombre',opening:'Abriendo cuaderno…',failed:'No se pudo guardar. Se conserva el borrador.'}}};
const button='min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50';
function NotebookView({client,context}:LocalToolProps<Notebook>){
 const [draft,setDraft]=useState<{value:string;baseline:LocalToolSnapshot<Notebook>}>(),id=useId(),messages=useLocalToolT(client);
 const state=useLocalToolState(client,{hasDraft:!!draft,observe:true}),data=state.snapshot?.data,canEdit=context?.canEdit===true;
 const save=async()=>{if(draft&&await state.apply([{type:'set',field:'name',value:draft.value}],draft.baseline))setDraft(undefined);};
 return <section className="space-y-3 text-text-primary"><h4 className="font-display text-lg">{messages('heading')}</h4>
  {!data?<p>{messages('opening')}</p>:<>
   {canEdit?<div className="space-y-2"><label className="block text-sm" htmlFor={id}>{messages('name')}</label><input id={id} className="min-h-9 w-full rounded-lg border border-border bg-deep px-3 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-gold" value={draft?.value??data.name} disabled={state.busy} onChange={event=>setDraft(current=>({value:event.target.value,baseline:current?.baseline??state.snapshot!}))}/><div className="flex flex-wrap gap-2"><button className={button} disabled={!draft||state.busy} onClick={()=>void save()}>{messages('save')}</button><button className={button} disabled={!draft||state.busy} onClick={()=>setDraft(undefined)}>{messages('discard')}</button></div></div>:<p>{data.name}</p>}
   <div><h5 className="font-medium">{messages('other')}</h5><ul>{Object.entries(data.other).map(([key,value])=><li key={key}>{key}: {value}</li>)}</ul></div>
   {canEdit&&<div className="flex flex-wrap gap-2"><button className={button} disabled={!!draft||state.busy||!state.canUndo} onClick={()=>void state.undo()}>{messages('undo')}</button><button className={button} disabled={!!draft||state.busy||!state.canRedo} onClick={()=>void state.redo()}>{messages('redo')}</button></div>}
  </>}{!canEdit&&draft&&<div className="space-y-2"><p className="break-words">{messages('nameDraft')}: {draft.value}</p><button className={button} onClick={()=>setDraft(undefined)}>{messages('discard')}</button></div>}{state.error&&<p role="alert">{messages('failed')}</p>}
 </section>;
}
export default defineLocalTool({namespace:'examples.source-map-notebook',stateSchemaVersion:'1',name:{en:'Notebook',es:'Cuaderno'},description:{en:'A local notebook with saved name and values.',es:'Cuaderno local con nombre y valores guardados.'},document:{defaultTitle:{en:'Notebook',es:'Cuaderno'},embed:'interactive'},initialState,codec,locales,validateState,component:NotebookView});
