/* eslint-disable react-refresh/only-export-components -- A Source release exports its SDK definition. */
import {useCallback,useId,useState} from 'react';
import {defineLocalTool,useLocalToolT,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';
import {useLocalToolState} from '@/engines/local/useLocalToolState';

type Prior={id:string;label:string};
type Step={key:string;label:string;done:boolean};
type Notebook={name:string;prior:Prior[];other:Record<string,string>;steps:Step[]};
type NameDraft={value:string;baseline:LocalToolSnapshot<Notebook>;scope:string};
type StepDraft={kind:'add';label:string;baseline:LocalToolSnapshot<Notebook>;scope:string}|{kind:'edit';label:string;item:Step;baseline:LocalToolSnapshot<Notebook>;scope:string};
const namespace='examples.source-list-notebook';
const predecessorCodec={version:1 as const,fields:{name:{kind:'scalar' as const},prior:{kind:'list' as const,idKey:'id'},other:{kind:'map' as const}}};
// Complete declared V1 contract. Pure JSON calculation is documented alongside
// this proposal; acceptance must compare it with the actual normal V1 checkpoint.
const from={namespace,codec:predecessorCodec,validationId:'0b9742a0b6dc31b6bdea995583741f3ea6ff98794d497104fad95cce6d7200a0',schemaEpoch:'e72b6f9fc46b82f46045d11b3b1488104aefcd8d09131aa59df595cef2184d59'};
const initialState:Notebook={name:'Scene review',prior:[{id:'read-draft',label:'Read the draft'}],other:{focus:'Continuity'},steps:[]};
const codec={version:1 as const,fields:{...predecessorCodec.fields,steps:{kind:'list' as const,idKey:'key'}}};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validateState=(value:LocalToolJson):value is Notebook=>object(value)&&typeof value.name==='string'&&!!value.name.trim()&&Array.isArray(value.prior)&&value.prior.every(row=>object(row)&&typeof row.id==='string'&&!!row.id&&typeof row.label==='string')&&object(value.other)&&Object.values(value.other).every(item=>typeof item==='string')&&Array.isArray(value.steps)&&value.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&!!row.label.trim()&&typeof row.done==='boolean');
const locales={defaultLocale:'en',catalogs:{
 en:{heading:'Review notebook',name:'Name',save:'Save name',discardName:'Discard name draft',prior:'Earlier steps',priorEmpty:'No earlier steps.',other:'Saved context',otherEmpty:'No saved context.',unnamed:'Untitled step',steps:'Review steps',empty:'Add a step to organize the review.',stepLabel:'Step label',add:'Add step',discardAdd:'Discard new step',edit:'Edit step · {label}',editAction:'Edit',editLabel:'Edit step label',saveStep:'Save step',cancelEdit:'Cancel edit',up:'Move up',upLabel:'Move step up · {label}',down:'Move down',downLabel:'Move step down · {label}',remove:'Remove step',removeLabel:'Remove step · {label}',doneLabel:'Completed · {label}',undo:'Undo notebook change',redo:'Redo notebook change',opening:'Opening notebook…',failed:'The operation could not be completed. Discard any draft, then reload saved data.',loadFailed:'The notebook could not be opened.',retry:'Reload saved data',nameDraft:'Draft name',stepDraft:'Draft step',discard:'Discard draft',saving:'Saving…',readOnly:'Read only.'},
 es:{heading:'Cuaderno de revisión',name:'Nombre',save:'Guardar nombre',discardName:'Descartar nombre',prior:'Pasos anteriores',priorEmpty:'No hay pasos anteriores.',other:'Contexto guardado',otherEmpty:'No hay contexto guardado.',unnamed:'Paso sin título',steps:'Pasos de revisión',empty:'Añade un paso para ordenar la revisión.',stepLabel:'Nombre del paso',add:'Añadir paso',discardAdd:'Descartar paso nuevo',edit:'Editar paso · {label}',editAction:'Editar',editLabel:'Editar nombre del paso',saveStep:'Guardar paso',cancelEdit:'Cancelar edición',up:'Subir',upLabel:'Subir paso · {label}',down:'Bajar',downLabel:'Bajar paso · {label}',remove:'Quitar paso',removeLabel:'Quitar paso · {label}',doneLabel:'Completado · {label}',undo:'Deshacer cambio del cuaderno',redo:'Rehacer cambio del cuaderno',opening:'Abriendo cuaderno…',failed:'No se pudo completar la operación. Descarta cualquier borrador y recarga los datos guardados.',loadFailed:'No se pudo abrir el cuaderno.',retry:'Recargar datos guardados',nameDraft:'Borrador del nombre',stepDraft:'Borrador del paso',discard:'Descartar borrador',saving:'Guardando…',readOnly:'Solo lectura.'},
}};
const button='min-h-10 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated active:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:cursor-not-allowed disabled:opacity-50';
const primary=button+' border-accent-gold bg-accent-gold text-deep hover:bg-accent-gold/90';
const input='min-h-10 w-full min-w-0 rounded-lg border border-border bg-deep px-3 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-50';

function NotebookView({projectId,client,context}:LocalToolProps<Notebook>){
 const [nameDraft,setNameDraft]=useState<NameDraft>(),[stepDraft,setStepDraft]=useState<StepDraft>(),id=useId(),messages=useLocalToolT(client);
 const focusEdit=useCallback((node:HTMLInputElement|null)=>{node?.focus();},[]);
 const scope=JSON.stringify([projectId,context?.scope.eraId??null,context?.document?.id??null]),hasDraft=!!nameDraft||!!stepDraft;
 const state=useLocalToolState(client,{hasDraft,observe:true}),data=state.snapshot?.data,canEdit=context?.canEdit===true;
 const wrongScope=!!nameDraft&&nameDraft.scope!==scope||!!stepDraft&&stepDraft.scope!==scope;
 const discard=()=>{setNameDraft(undefined);setStepDraft(undefined);void state.reload();};
 const saveName=async()=>{if(canEdit&&nameDraft?.scope===scope&&nameDraft.value.trim()&&await state.apply([{type:'set',field:'name',value:nameDraft.value}],nameDraft.baseline))setNameDraft(undefined);};
 const saveStep=async()=>{
  if(!canEdit||!data||!stepDraft||stepDraft.scope!==scope||!stepDraft.label.trim())return;
  const saved=stepDraft.kind==='add'
   ?await state.apply([{type:'list-insert',field:'steps',item:{key:crypto.randomUUID(),label:stepDraft.label.trim(),done:false},afterId:stepDraft.baseline.data.steps.at(-1)?.key??null}],stepDraft.baseline)
   :await state.apply([{type:'list-update',field:'steps',id:stepDraft.item.key,item:{...stepDraft.item,label:stepDraft.label.trim()}}],stepDraft.baseline);
  if(saved)setStepDraft(undefined);
 };
 const blocked=state.busy||hasDraft;
 return <section className="min-w-0 space-y-5 text-text-primary" aria-label={messages('heading')}>
  <h4 className="font-display text-lg">{messages('heading')}</h4>
  {!data?(!state.error&&<p role="status">{messages('opening')}</p>):<>
   {canEdit?<form className="space-y-2" onSubmit={event=>{event.preventDefault();void saveName();}}>
    <label className="block text-sm" htmlFor={id+'-name'}>{messages('name')}</label>
    <input id={id+'-name'} className={input} value={nameDraft?.value??data.name} disabled={state.busy||!!stepDraft||wrongScope} onChange={event=>setNameDraft(current=>({value:event.target.value,baseline:current?.baseline??state.snapshot!,scope:current?.scope??scope}))} onKeyDown={event=>{if(event.key==='Escape'&&nameDraft){event.preventDefault();event.stopPropagation();discard();}}}/>
    <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={!nameDraft||wrongScope||!nameDraft.value.trim()||state.busy}>{messages('save')}</button><button type="button" className={button} disabled={!nameDraft||state.busy} onClick={discard}>{messages('discardName')}</button></div>
   </form>:<div className="space-y-1"><p className="text-sm text-text-muted">{messages('name')}</p><p className="break-words text-base">{data.name}</p><p className="text-sm text-text-muted">{messages('readOnly')}</p></div>}
   <div className="space-y-2"><h5 className="font-medium">{messages('prior')}</h5>{data.prior.length?<ol className="list-decimal space-y-1 pl-5">{data.prior.map(row=><li key={row.id} className="break-words">{row.label||messages('unnamed')}</li>)}</ol>:<p className="text-sm text-text-muted">{messages('priorEmpty')}</p>}</div>
   <div className="space-y-2"><h5 className="font-medium">{messages('other')}</h5>{Object.keys(data.other).length?<dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">{Object.entries(data.other).map(([key,value])=><div key={key} className="contents"><dt className="max-w-40 break-words text-text-muted">{key}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>:<p className="text-sm text-text-muted">{messages('otherEmpty')}</p>}</div>
   <div className="space-y-3"><h5 className="font-medium">{messages('steps')}</h5>
    {data.steps.length?<ol className="list-decimal space-y-3 pl-5">{data.steps.map((row,index)=>{
     const edit=stepDraft?.kind==='edit'&&stepDraft.item.key===row.key?stepDraft:undefined;
     return <li key={row.key} className="min-w-0 space-y-2 pl-1">
      {edit&&canEdit?<form className="space-y-2" onSubmit={event=>{event.preventDefault();void saveStep();}}>
       <label className="block text-sm" htmlFor={id+'-edit'}>{messages('editLabel')}</label>
       <input ref={focusEdit} id={id+'-edit'} className={input} value={edit.label} disabled={state.busy||wrongScope} onChange={event=>setStepDraft(current=>current?{...current,label:event.target.value}:current)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();discard();}}}/>
       <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={state.busy||wrongScope||!edit.label.trim()}>{messages('saveStep')}</button><button type="button" className={button} disabled={state.busy} onClick={discard}>{messages('cancelEdit')}</button></div>
      </form>:<>
       <label className="flex min-h-10 min-w-0 items-center gap-2"><input type="checkbox" className="h-4 w-4 shrink-0 accent-accent-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold" checked={row.done} disabled={!canEdit||blocked} aria-label={messages('doneLabel',{label:row.label})} onChange={()=>void state.apply([{type:'list-update',field:'steps',id:row.key,item:{...row,done:!row.done}}])}/><span className="min-w-0 break-words text-base">{row.label}</span></label>
       {canEdit&&<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked} aria-label={messages('edit',{label:row.label})} onClick={()=>setStepDraft({kind:'edit',label:row.label,item:{...row},baseline:state.snapshot!,scope})}>{messages('editAction')}</button><button type="button" className={button} disabled={blocked||index===0} aria-label={messages('upLabel',{label:row.label})} onClick={()=>void state.apply([{type:'list-move',field:'steps',id:row.key,afterId:index>1?data.steps[index-2].key:null}])}>{messages('up')}</button><button type="button" className={button} disabled={blocked||index===data.steps.length-1} aria-label={messages('downLabel',{label:row.label})} onClick={()=>void state.apply([{type:'list-move',field:'steps',id:row.key,afterId:data.steps[index+1].key}])}>{messages('down')}</button><button type="button" className={button} disabled={blocked} aria-label={messages('removeLabel',{label:row.label})} onClick={()=>void state.apply([{type:'list-delete',field:'steps',id:row.key}])}>{messages('remove')}</button></div>}
      </>}
     </li>;
    })}</ol>:<p className="max-w-prose text-sm text-text-muted">{messages('empty')}</p>}
    {canEdit&&<form className="space-y-2" onSubmit={event=>{event.preventDefault();void saveStep();}}>
     <label className="block text-sm" htmlFor={id+'-add'}>{messages('stepLabel')}</label>
     <input id={id+'-add'} className={input} value={stepDraft?.kind==='add'?stepDraft.label:''} disabled={state.busy||!!nameDraft||stepDraft?.kind==='edit'||wrongScope} onChange={event=>{const value=event.target.value;setStepDraft(current=>value?{kind:'add',label:value,baseline:current?.baseline??state.snapshot!,scope:current?.scope??scope}:undefined);}} onKeyDown={event=>{if(event.key==='Escape'&&stepDraft?.kind==='add'){event.preventDefault();event.stopPropagation();discard();}}}/>
     <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={state.busy||stepDraft?.kind!=='add'||!stepDraft.label.trim()||wrongScope}>{messages('add')}</button><button type="button" className={button} disabled={state.busy||stepDraft?.kind!=='add'} onClick={discard}>{messages('discardAdd')}</button></div>
    </form>}
   </div>
   {canEdit&&<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={hasDraft||state.busy||!state.canUndo} onClick={()=>void state.undo()}>{messages('undo')}</button><button type="button" className={button} disabled={hasDraft||state.busy||!state.canRedo} onClick={()=>void state.redo()}>{messages('redo')}</button></div>}
  </>}
  {hasDraft&&(!canEdit||wrongScope)&&<div className="space-y-2">{nameDraft&&<p className="break-words">{messages('nameDraft')}: {nameDraft.value}</p>}{stepDraft&&<p className="break-words">{messages('stepDraft')}: {stepDraft.label}</p>}<button type="button" className={button} disabled={state.busy} onClick={discard}>{messages('discard')}</button></div>}
  {state.busy&&<p role="status" className="text-sm text-text-muted">{messages('saving')}</p>}
  {state.error&&<div className="space-y-2"><p role="alert" className="max-w-prose text-sm text-danger">{data?messages('failed'):messages('loadFailed')}</p><button type="button" className={button} disabled={hasDraft||state.busy} onClick={()=>void state.reload()}>{messages('retry')}</button></div>}
 </section>;
}
export default defineLocalTool({namespace,stateSchemaVersion:'2',name:{en:'Review notebook with steps',es:'Cuaderno con pasos de revisión'},description:{en:'Add, edit and order review steps while keeping the saved notebook.',es:'Añade, edita y ordena pasos de revisión conservando el cuaderno guardado.'},document:{defaultTitle:{en:'Scene review',es:'Revisión de escena'},embed:'interactive'},initialState,codec,locales,sourceAdditive:{from,field:'steps',defaultValue:[]},validateState,component:NotebookView});
