import {registerPendingFlusher} from '@/services/pendingWrites';
/** Normal trusted-source example; import this definition from an installed module to enable it. */
import {useEffect,useId,useLayoutEffect,useMemo,useState} from 'react';
import {flushSync} from 'react-dom';
import {useTranslation} from '@/i18n/useTranslation';
import {nextLocalToolUndoStep,useLocalToolUndoCommand,useLocalToolUndoProvider,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '../sdk';
import type {LocalToolStateAction} from '../stateActions';
import {useLocalToolState} from '../useLocalToolState';
import {LocalToolReferencePicker} from '../ReferencePicker';
import type {LocalToolDocumentReference} from '../stateCodec';

export type LinkedNotebookState={version:1;notes:string;labels:Record<string,LocalToolJson>;items:{id:string;text:string}[];linked:LocalToolDocumentReference|null};
const button='min-h-10 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';
interface RehearsalStep {order:string[]|undefined;step:number}
interface RehearsalModel {
 client:LocalToolProps<LinkedNotebookState>['client'];active:boolean;applying:boolean;baseline?:LocalToolSnapshot<LinkedNotebookState>;order?:string[];
 undo:RehearsalStep[];redo:RehearsalStep[];error:boolean;
}

export function LinkedNotebook({client,context}:LocalToolProps<LinkedNotebookState>){
 const {locale}=useTranslation(),es=locale==='es';
 const [draft,setDraft]=useState<string>(),[item,setItem]=useState(''),[openError,setOpenError]=useState(false),flusherId=useId();
 const rehearsal=useMemo<RehearsalModel>(()=>({client,active:true,applying:false,undo:[],redo:[],error:false}),[client]);
 const [,refreshRehearsal]=useState(0),redraw=()=>refreshRehearsal(value=>value+1);
 useLayoutEffect(()=>{rehearsal.active=true;return()=>{rehearsal.active=false;};},[rehearsal]);
 const state=useLocalToolState(client,{observe:!!client.documentId,hasDraft:draft!==undefined||!!item.trim()||rehearsal.order!==undefined});
 const focus=context?.focus?.blockId;
 const rehearsalHistory=useLocalToolUndoProvider(client,focus==='notes'?undefined:context,{
  id:'rehearsal-order',model:rehearsal,label:{en:'Rehearsal order',es:'Orden de ensayo'},
  canUndo:model=>!model.applying&&model.undo.length>0,canRedo:model=>!model.applying&&model.redo.length>0,
  lastStep:(model,mode)=>model[mode].at(-1)?.step,
  async undo(model,operation){
   const last=model.undo.at(-1);if(!last||model.applying||!operation.isCurrent())return false;
   model.redo.push({order:model.order,step:nextLocalToolUndoStep()});model.undo.pop();model.order=last.order;model.error=false;redraw();return true;
  },
  async redo(model,operation){
   const last=model.redo.at(-1);if(!last||model.applying||!operation.isCurrent())return false;
   model.undo.push({order:model.order,step:nextLocalToolUndoStep()});model.redo.pop();model.order=last.order;model.error=false;redraw();return true;
  },
 });
 const resetRehearsal=()=>{rehearsal.order=undefined;rehearsal.baseline=undefined;rehearsal.undo=[];rehearsal.redo=[];rehearsal.error=false;redraw();};
 const discardRehearsal=async(discardText=false)=>{
  if(state.busy||rehearsal.applying||rehearsalHistory.busy)return;
  rehearsal.applying=true;redraw();
  try{
   if(await state.reload()&&rehearsal.active){
    resetRehearsal();
    if(discardText){setDraft(undefined);if(focus==='items'||focus==='notes')setItem('');}
   }
  }finally{if(rehearsal.active){rehearsal.applying=false;redraw();}}
 };
 const moveRehearsal=(index:number,delta:number)=>{
  if(!state.snapshot||state.busy||rehearsal.applying||rehearsalHistory.busy)return;
  const before=rehearsal.order??state.snapshot.data.items.map(row=>row.id),next=[...before],target=index+delta;
  if(target<0||target>=next.length)return;
  if(rehearsal.order===undefined)rehearsal.baseline=state.snapshot;
  [next[index],next[target]]=[next[target],next[index]];
  rehearsal.undo.push({order:rehearsal.order,step:nextLocalToolUndoStep()});rehearsal.redo=[];rehearsal.order=next;rehearsal.error=false;redraw();
 };
 const applyRehearsal=async()=>{
  const baseline=rehearsal.baseline,order=rehearsal.order;
  if(!baseline||!order||rehearsal.applying||rehearsalHistory.busy||state.busy||draft!==undefined||item.trim())return;
  rehearsal.applying=true;rehearsal.error=false;redraw();
  try{
   const saved=await rehearsal.client.read();
   if(!rehearsal.active)return;
   if(saved.revision!==baseline.revision||saved.document?.version!==baseline.document?.version||saved.document?.lineage!==baseline.document?.lineage||JSON.stringify(saved.data.items)!==JSON.stringify(baseline.data.items)){rehearsal.error=true;return;}
   const previous=baseline.data.items.map(row=>row.id),actions:LocalToolStateAction[]=[];
   for(let index=0;index<order.length;index++){
    const id=order[index];if(previous[index]===id)continue;
    previous.splice(previous.indexOf(id),1);previous.splice(index,0,id);
    actions.push({type:'list-move',field:'items',id,afterId:index?order[index-1]:null});
   }
   if(actions.length&&await state.apply(actions,baseline)&&rehearsal.active)resetRehearsal();
  }catch{if(rehearsal.active)rehearsal.error=true;}
  finally{if(rehearsal.active){rehearsal.applying=false;redraw();}}
 };
 const review=useLocalToolUndoCommand(client,focus==='notes'?undefined:context,state,{
  id:'add-review-checklist',label:{en:'Add review checklist',es:'Añadir pauta de revisión'},
  inputSchema:{type:'object',properties:{locale:{type:'string',enum:['en','es']}},additionalProperties:false},
  plan(snapshot,input){
   const items=snapshot.data.items,texts=input.locale==='es'?['Revisar la continuidad','Comprobar los nombres']:['Review continuity','Check names'];
   let afterId=items.at(-1)?.id??null;
   return texts.filter(text=>!items.some(row=>row.text===text)).map((text):LocalToolStateAction=>{
    const id=crypto.randomUUID(),action:LocalToolStateAction={type:'list-insert',field:'items',item:{id,text},afterId};
    afterId=id;
    return action;
   });
  },
 });
 const showNotes=focus!=='items',showItems=focus!=='notes',whole=showNotes&&showItems;
 const rehearsalItems=(rehearsal.order?rehearsal.baseline:state.snapshot)?.data.items??[];
 const rehearsalRows=new Map(rehearsalItems.map(row=>[row.id,row]));
 const openBlock=(blockId:string)=>{
  if(!client.documentId)return;
  setOpenError(false);
  void client.openDocument('local-tool',client.documentId,{blockId}).catch(()=>setOpenError(true));
 };
 useEffect(()=>client.documentId&&(draft!==undefined||item.trim()||rehearsal.order!==undefined)?registerPendingFlusher(
  JSON.stringify(['source-example',client.projectId,client.eraId??null,client.documentId,flusherId]),
  async()=>{
   if(item.trim()||rehearsal.order!==undefined)return false;
   if(draft===undefined)return true;
   const ok=await state.apply([{type:'set',field:'notes',value:draft}]);
   if(ok)flushSync(()=>setDraft(current=>current===draft?undefined:current));
   return ok;
  }):undefined,[client,draft,item,state,flusherId,rehearsal,rehearsal.order]);

 return <section className="space-y-4 p-5 text-text-primary" aria-label={es?'Cuaderno vinculado':'Linked notebook'}>
  <header className="flex flex-wrap items-baseline justify-between gap-2">
   <h2 className="font-display text-xl">{whole?(es?'Cuaderno vinculado':'Linked notebook'):showNotes?(es?'Notas':'Notes'):(es?'Apuntes':'Items')}</h2>
   <span className="text-sm text-text-muted">{client.eraId??(es?'Base compartida':'Shared base')}</span>
  </header>
  {showNotes&&<div className="space-y-2">
   {whole&&client.documentId&&<button type="button" className={button} onClick={()=>openBlock('notes')}>{es?'Abrir notas al lado':'Open notes beside'}</button>}
   <label className="block space-y-2 text-sm">{es?'Notas':'Notes'}
    <textarea aria-label={es?'Notas':'Notes'} rows={5} disabled={!state.snapshot||state.busy} value={draft??state.snapshot?.data.notes??''} onChange={event=>setDraft(event.target.value)} className="block w-full rounded-lg border border-border bg-elevated p-3 focus-visible:outline-2 focus-visible:outline-accent-gold"/>
   </label>
  </div>}
  <div className="flex flex-wrap gap-2">
   {showNotes&&<button type="button" className={button.replace('hover:bg-elevated','hover:bg-accent-amber')+' bg-accent-gold text-deep'} disabled={!state.snapshot||state.busy||draft===undefined} onClick={()=>{void state.apply([{type:'set',field:'notes',value:draft!}]).then(ok=>{if(ok)setDraft(undefined);});}}>{es?'Guardar notas':'Save notes'}</button>}
   <button type="button" className={button} disabled={state.busy||!state.canUndo||draft!==undefined||rehearsal.order!==undefined||(!whole&&!!item.trim())} onClick={()=>{void state.undo();}}>{es?'Deshacer':'Undo'}</button>
   <button type="button" className={button} disabled={state.busy||!state.canRedo||draft!==undefined||rehearsal.order!==undefined||(!whole&&!!item.trim())} onClick={()=>{void state.redo();}}>{es?'Rehacer':'Redo'}</button>
   <button type="button" className={button} disabled={state.busy||rehearsal.applying||rehearsalHistory.busy} onClick={()=>void discardRehearsal(true)}>{es?'Descartar borrador y recargar':'Discard draft and reload'}</button>
  </div>
  {state.error&&<p role="alert" className="max-w-prose text-sm text-danger">{es?'No se guardó el cambio. El borrador sigue aquí. Si cambió el mismo campo, revisa la versión guardada antes de reintentar.':'The change was refused. Your draft remains here. If the same field changed, review the saved version before retrying.'}</p>}
  {openError&&<p role="alert" className="max-w-prose text-sm text-danger">{es?'No se abrió el panel. Revisa si hay un borrador pendiente o si el espacio de trabajo está lleno.':'The panel did not open. Check for a pending draft or a full workspace.'}</p>}
  {showItems&&<div className={whole?'space-y-2 border-t border-border pt-4':'space-y-2'}>
   {whole&&<div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="font-medium">{es?'Apuntes':'Items'}</h3>
    {client.documentId&&<button type="button" className={button} onClick={()=>openBlock('items')}>{es?'Abrir apuntes al lado':'Open items beside'}</button>}
   </div>}
   <div className="flex flex-wrap gap-2">
    <input aria-label={es?'Nuevo apunte':'New item'} value={item} onChange={event=>setItem(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3"/>
    <button type="button" className={button} disabled={!state.snapshot||state.busy||!item.trim()} onClick={()=>{const rows=state.snapshot!.data.items;void state.apply([{type:'list-insert',field:'items',item:{id:crypto.randomUUID(),text:item},afterId:rows.at(-1)?.id??null}]).then(ok=>{if(ok)setItem('');});}}>{es?'Añadir apunte':'Add item'}</button>
    {review.available&&<button type="button" className={button} disabled={!state.snapshot||state.busy||draft!==undefined||rehearsal.order!==undefined||!!item.trim()} onClick={()=>void review.run({locale:es?'es':'en'}).catch(()=>undefined)}>{es?'Añadir pauta de revisión':'Add review checklist'}</button>}
   </div>
   <ul className="space-y-2">{state.snapshot?.data.items.map(row=><li key={row.id} className="flex items-center justify-between gap-3">
    <span className="min-w-0 break-words">{row.text}</span>
    <button type="button" className={button} disabled={state.busy} onClick={()=>{void state.apply([{type:'list-delete',field:'items',id:row.id}]);}}>{es?'Quitar':'Remove'}</button>
   </li>)}</ul>
   {rehearsalHistory.available&&<section aria-label={es?'Orden de ensayo':'Rehearsal order'} className="space-y-2 border-t border-border pt-4">
    <h3 className="font-medium">{es?'Orden de ensayo · esta sesión':'Rehearsal order · this session'}</h3>
    <p className="max-w-prose text-sm text-text-muted">{es?'Prueba otro orden sin cambiar los apuntes guardados. Aplica el ensayo cuando quieras conservarlo.':'Try another order without changing saved items. Apply the rehearsal when you want to keep it.'}</p>
    {rehearsalItems.length<2&&<p className="text-sm text-text-muted">{es?'Añade dos apuntes para ensayar su orden.':'Add two items to rehearse their order.'}</p>}
    <ol aria-label={es?'Apuntes del ensayo':'Rehearsal items'} className="space-y-2">{(rehearsal.order??rehearsalItems.map(row=>row.id)).map((id,index,ids)=>{
     const row=rehearsalRows.get(id);
     if(!row)return null;
     return <li key={id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 break-words">{row.text}</span><div className="flex flex-wrap gap-2">
      <button type="button" className={button} aria-label={es?`Subir ${row.text}`:`Move ${row.text} up`} disabled={!index||state.busy||rehearsal.applying||rehearsalHistory.busy} onClick={()=>moveRehearsal(index,-1)}>{es?'Subir':'Up'}</button>
      <button type="button" className={button} aria-label={es?`Bajar ${row.text}`:`Move ${row.text} down`} disabled={index===ids.length-1||state.busy||rehearsal.applying||rehearsalHistory.busy} onClick={()=>moveRehearsal(index,1)}>{es?'Bajar':'Down'}</button>
     </div></li>;
    })}</ol>
    <div className="flex flex-wrap gap-2">
     <button type="button" className={button} disabled={!rehearsalHistory.canUndo||rehearsalHistory.busy||rehearsal.applying} onClick={()=>void rehearsalHistory.undo().catch(()=>undefined)}>{es?'Deshacer ensayo':'Undo rehearsal'}</button>
     <button type="button" className={button} disabled={!rehearsalHistory.canRedo||rehearsalHistory.busy||rehearsal.applying} onClick={()=>void rehearsalHistory.redo().catch(()=>undefined)}>{es?'Rehacer ensayo':'Redo rehearsal'}</button>
     <button type="button" className={button} disabled={rehearsal.order===undefined||state.busy||rehearsal.applying||rehearsalHistory.busy||draft!==undefined||!!item.trim()} onClick={()=>void applyRehearsal()}>{es?'Aplicar orden':'Apply order'}</button>
     <button type="button" className={button} disabled={rehearsal.order===undefined&&!rehearsal.redo.length||state.busy||rehearsal.applying||rehearsalHistory.busy} onClick={()=>void discardRehearsal()}>{es?'Descartar ensayo':'Discard rehearsal'}</button>
    </div>
    {rehearsal.applying&&<p role="status" className="text-sm text-text-muted">{es?'Actualizando el orden…':'Updating order…'}</p>}
    {(rehearsal.error||rehearsalHistory.error)&&<p role="alert" className="max-w-prose text-sm text-danger">{es?'No se cambió el orden guardado. El ensayo sigue aquí; si los apuntes cambiaron, descártalo para partir de su versión actual.':'The saved order was not changed. Your rehearsal remains here; if the saved items changed, discard it to start from their current version.'}</p>}
   </section>}
  </div>}
  {whole&&<LocalToolReferencePicker client={client} value={state.snapshot?.data.linked??null} disabled={!state.snapshot||state.busy} onChange={reference=>state.apply([{type:'set',field:'linked',value:reference as unknown as LocalToolJson}])}/>}
 </section>;
}
