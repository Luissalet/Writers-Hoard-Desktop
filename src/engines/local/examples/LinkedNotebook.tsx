import {registerPendingFlusher} from '@/services/pendingWrites';
/** Normal trusted-source example; import this definition from an installed module to enable it. */
import {useEffect,useId,useState} from 'react';
import {flushSync} from 'react-dom';
import {useTranslation} from '@/i18n/useTranslation';
import {useLocalToolUndoCommand,type LocalToolJson,type LocalToolProps} from '../sdk';
import type {LocalToolStateAction} from '../stateActions';
import {useLocalToolState} from '../useLocalToolState';
import {LocalToolReferencePicker} from '../ReferencePicker';
import type {LocalToolDocumentReference} from '../stateCodec';

export type LinkedNotebookState={version:1;notes:string;labels:Record<string,LocalToolJson>;items:{id:string;text:string}[];linked:LocalToolDocumentReference|null};
const button='min-h-10 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';

export function LinkedNotebook({client,context}:LocalToolProps<LinkedNotebookState>){
 const {locale}=useTranslation(),es=locale==='es';
 const [draft,setDraft]=useState<string>(),[item,setItem]=useState(''),[openError,setOpenError]=useState(false),flusherId=useId();
 const state=useLocalToolState(client,{observe:!!client.documentId,hasDraft:draft!==undefined||!!item.trim()});
 const focus=context?.focus?.blockId;
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
 const openBlock=(blockId:string)=>{
  if(!client.documentId)return;
  setOpenError(false);
  void client.openDocument('local-tool',client.documentId,{blockId}).catch(()=>setOpenError(true));
 };
 useEffect(()=>client.documentId&&(draft!==undefined||item.trim())?registerPendingFlusher(
  JSON.stringify(['source-example',client.projectId,client.eraId??null,client.documentId,flusherId]),
  async()=>{
   if(item.trim())return false;
   if(draft===undefined)return true;
   const ok=await state.apply([{type:'set',field:'notes',value:draft}]);
   if(ok)flushSync(()=>setDraft(current=>current===draft?undefined:current));
   return ok;
  }):undefined,[client,draft,item,state,flusherId]);

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
   <button type="button" className={button} disabled={state.busy||!state.canUndo||draft!==undefined||(!whole&&!!item.trim())} onClick={()=>{void state.undo();}}>{es?'Deshacer':'Undo'}</button>
   <button type="button" className={button} disabled={state.busy||!state.canRedo||draft!==undefined||(!whole&&!!item.trim())} onClick={()=>{void state.redo();}}>{es?'Rehacer':'Redo'}</button>
   <button type="button" className={button} disabled={state.busy} onClick={()=>{void state.reload().then(ok=>{if(ok){setDraft(undefined);if(!whole)setItem('');}});}}>{es?'Descartar borrador y recargar':'Discard draft and reload'}</button>
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
    {review.available&&<button type="button" className={button} disabled={!state.snapshot||state.busy||draft!==undefined||!!item.trim()} onClick={()=>void review.run({locale:es?'es':'en'}).catch(()=>undefined)}>{es?'Añadir pauta de revisión':'Add review checklist'}</button>}
   </div>
   <ul className="space-y-2">{state.snapshot?.data.items.map(row=><li key={row.id} className="flex items-center justify-between gap-3">
    <span className="min-w-0 break-words">{row.text}</span>
    <button type="button" className={button} disabled={state.busy} onClick={()=>{void state.apply([{type:'list-delete',field:'items',id:row.id}]);}}>{es?'Quitar':'Remove'}</button>
   </li>)}</ul>
  </div>}
  {whole&&<LocalToolReferencePicker client={client} value={state.snapshot?.data.linked??null} disabled={!state.snapshot||state.busy} onChange={reference=>state.apply([{type:'set',field:'linked',value:reference as unknown as LocalToolJson}])}/>}
 </section>;
}
