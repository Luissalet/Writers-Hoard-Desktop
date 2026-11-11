/* eslint-disable react-refresh/only-export-components -- A Source release exports its SDK definition. */
import {useId,useState} from 'react';
import {defineLocalTool,useLocalToolT,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';
import {useLocalToolState} from '@/engines/local/useLocalToolState';

type Prior={id:string;label:string};
type Notebook={name:string;prior:Prior[];other:Record<string,string>};
type NameDraft={value:string;baseline:LocalToolSnapshot<Notebook>;scope:string};
const namespace='examples.source-list-notebook';
const initialState:Notebook={name:'Scene review',prior:[{id:'read-draft',label:'Read the draft'}],other:{focus:'Continuity'}};
const codec={version:1 as const,fields:{name:{kind:'scalar' as const},prior:{kind:'list' as const,idKey:'id'},other:{kind:'map' as const}}};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validateState=(value:LocalToolJson):value is Notebook=>object(value)&&typeof value.name==='string'&&!!value.name.trim()&&Array.isArray(value.prior)&&value.prior.every(row=>object(row)&&typeof row.id==='string'&&!!row.id&&typeof row.label==='string')&&object(value.other)&&Object.values(value.other).every(item=>typeof item==='string');
const locales={defaultLocale:'en',catalogs:{
 en:{heading:'Review notebook',name:'Name',save:'Save name',discard:'Discard draft',prior:'Earlier steps',priorEmpty:'No earlier steps.',other:'Saved context',otherEmpty:'No saved context.',unnamed:'Untitled step',undo:'Undo notebook change',redo:'Redo notebook change',opening:'Opening notebook…',failed:'The operation could not be completed. Discard any draft, then reload saved data.',loadFailed:'The notebook could not be opened.',retry:'Reload saved data',draft:'Draft name',saving:'Saving…',readOnly:'Read only.'},
 es:{heading:'Cuaderno de revisión',name:'Nombre',save:'Guardar nombre',discard:'Descartar borrador',prior:'Pasos anteriores',priorEmpty:'No hay pasos anteriores.',other:'Contexto guardado',otherEmpty:'No hay contexto guardado.',unnamed:'Paso sin título',undo:'Deshacer cambio del cuaderno',redo:'Rehacer cambio del cuaderno',opening:'Abriendo cuaderno…',failed:'No se pudo completar la operación. Descarta cualquier borrador y recarga los datos guardados.',loadFailed:'No se pudo abrir el cuaderno.',retry:'Recargar datos guardados',draft:'Borrador del nombre',saving:'Guardando…',readOnly:'Solo lectura.'},
}};
const button='min-h-10 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated active:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-50';
const primary=button+' border-accent-gold bg-accent-gold text-deep hover:bg-accent-gold/90';
const input='min-h-10 w-full min-w-0 rounded-lg border border-border bg-deep px-3 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-50';

function NotebookView({projectId,client,context}:LocalToolProps<Notebook>){
 const [draft,setDraft]=useState<NameDraft>(),id=useId(),messages=useLocalToolT(client);
 const scope=JSON.stringify([projectId,context?.scope.eraId??null,context?.document?.id??null]);
 const state=useLocalToolState(client,{hasDraft:!!draft,observe:true}),data=state.snapshot?.data,canEdit=context?.canEdit===true;
 const discard=()=>{setDraft(undefined);void state.reload();};
 const save=async()=>{if(canEdit&&draft?.scope===scope&&draft.value.trim()&&await state.apply([{type:'set',field:'name',value:draft.value}],draft.baseline))setDraft(undefined);};
 return <section className="min-w-0 space-y-5 text-text-primary" aria-label={messages('heading')}>
  <h4 className="font-display text-lg">{messages('heading')}</h4>
  {!data?(!state.error&&<p role="status">{messages('opening')}</p>):<>
   {canEdit?<form className="space-y-2" onSubmit={event=>{event.preventDefault();void save();}}>
    <label className="block text-sm" htmlFor={id+'-name'}>{messages('name')}</label>
    <input id={id+'-name'} className={input} value={draft?.value??data.name} disabled={state.busy||!!draft&&draft.scope!==scope} onChange={event=>setDraft(current=>({value:event.target.value,baseline:current?.baseline??state.snapshot!,scope:current?.scope??scope}))} onKeyDown={event=>{if(event.key==='Escape'&&draft){event.preventDefault();event.stopPropagation();discard();}}}/>
    <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={!draft||draft.scope!==scope||!draft.value.trim()||state.busy}>{messages('save')}</button><button type="button" className={button} disabled={!draft||state.busy} onClick={discard}>{messages('discard')}</button></div>
   </form>:<div className="space-y-1"><p className="text-sm text-text-muted">{messages('name')}</p><p className="break-words text-base">{data.name}</p><p className="text-sm text-text-muted">{messages('readOnly')}</p></div>}
   <div className="space-y-2"><h5 className="font-medium">{messages('prior')}</h5>{data.prior.length?<ol className="list-decimal space-y-1 pl-5">{data.prior.map(row=><li key={row.id} className="break-words">{row.label||messages('unnamed')}</li>)}</ol>:<p className="text-sm text-text-muted">{messages('priorEmpty')}</p>}</div>
   <div className="space-y-2"><h5 className="font-medium">{messages('other')}</h5>{Object.keys(data.other).length?<dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">{Object.entries(data.other).map(([key,value])=><div key={key} className="contents"><dt className="max-w-40 break-words text-text-muted">{key}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>:<p className="text-sm text-text-muted">{messages('otherEmpty')}</p>}</div>
   {canEdit&&<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!!draft||state.busy||!state.canUndo} onClick={()=>void state.undo()}>{messages('undo')}</button><button type="button" className={button} disabled={!!draft||state.busy||!state.canRedo} onClick={()=>void state.redo()}>{messages('redo')}</button></div>}
  </>}
  {draft&&(!canEdit||draft.scope!==scope)&&<div className="space-y-2"><p className="break-words">{messages('draft')}: {draft.value}</p><button type="button" className={button} disabled={state.busy} onClick={discard}>{messages('discard')}</button></div>}
  {state.busy&&<p role="status" className="text-sm text-text-muted">{messages('saving')}</p>}
  {state.error&&<div className="space-y-2"><p role="alert" className="max-w-prose text-sm text-danger">{data?messages('failed'):messages('loadFailed')}</p><button type="button" className={button} disabled={!!draft||state.busy} onClick={()=>void state.reload()}>{messages('retry')}</button></div>}
 </section>;
}
export default defineLocalTool({namespace,stateSchemaVersion:'1',name:{en:'Review notebook',es:'Cuaderno de revisión'},description:{en:'A saved name, earlier steps and context.',es:'Nombre, pasos anteriores y contexto guardados.'},document:{defaultTitle:{en:'Scene review',es:'Revisión de escena'},embed:'interactive'},initialState,codec,locales,validateState,component:NotebookView});
