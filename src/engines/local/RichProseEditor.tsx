import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import type {Editor} from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import {useTranslation} from '@/i18n/useTranslation';
import {registerPendingFlusher} from '@/services/pendingWrites';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson,LocalToolSnapshot} from './sdk';
import type {LocalToolRichProseProps} from './RichProse';
import type {LocalToolCollaborativeRichProps} from './CollaborativeRich';
import CollaborativeRichRenderer from './collaborativeRich/Renderer';
import type {LocalToolDefinition} from './sdk';
import type {LocalToolStateCodec} from './stateCodec';
import {MAX_LOCAL_TOOL_STATE_BYTES,localToolJsonText} from './stateTypes';
import {useLocalToolState} from './useLocalToolState';
import {richProseHtml} from './richProseHtml';

/** One capability per client lease; no state revision participates in the React key. */
export function useRichProseHostContext(context:LocalToolHostContext,client:LocalToolClient<LocalToolJson>|undefined,codec:LocalToolStateCodec|undefined,definition?:LocalToolDefinition):LocalToolHostContext{
 const codecText=JSON.stringify(codec??null),{view,canEdit,scope,document}=context,projectId=scope.projectId,eraId=scope.eraId,documentId=document?.id,namespace=document?.namespace,title=document?.title;
 // A document keeps presentation through a lease rebind; the fresh client still owns all reads/writes.
 const identity=documentId?JSON.stringify([projectId,eraId??null,namespace,documentId,view]):client;
 const binding=useMemo(()=>({identity,id:crypto.randomUUID()}),[identity]);
 return useMemo(()=>{const canonical=JSON.parse(codecText) as LocalToolStateCodec|null;return{view,canEdit,scope:{projectId,eraId},...(documentId&&namespace?{document:{id:documentId,namespace,title:title??''}}:{}),renderRichProse:(props:LocalToolRichProseProps)=>{
  const descriptor=canonical?.fields[props.field];if(props.client!==client||descriptor?.kind!=='prose'||descriptor.format!=='rich')return <p role="status">{props.context?.canEdit?'Rich prose is not declared for this field.':'Rich prose is read only.'}</p>;
  return <RichProseEditor key={binding.id+':'+props.field} {...props} readOnly={!canEdit}/>;
 },renderCollaborativeRich:(props:LocalToolCollaborativeRichProps)=>{
  const descriptor=canonical?.fields[props.field];if(props.client!==client||!definition||!documentId||descriptor?.kind!=='rich'||!['paragraphs-inline/1','blocks-tree/1','paragraphs-inline/2','blocks-tree/2'].includes(descriptor.profile))return <p role="status">Collaborative rich text is not declared for this Source field.</p>;
  return <CollaborativeRichRenderer key={binding.id+':collaborative:'+props.field} {...props} definition={definition} readOnly={!canEdit||props.editable===false}/>;
 }};},[binding,codecText,view,canEdit,projectId,eraId,documentId,namespace,title,client,definition]);
}
interface Draft {html:string;baseline:LocalToolSnapshot<LocalToolJson>}
const button='min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
// Host capability hook and its private editor share this module; it is not a refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function RichProseEditor({client,field,label,extensions,readOnly}:LocalToolRichProseProps&{readOnly:boolean}){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[draft,setDraft]=useState<Draft>(),[reading,setReading]=useState(false),[imageError,setImageError]=useState(''),[editor,setEditor]=useState<Editor|null>(null),session=useMemo(()=>({reader:undefined as FileReader|undefined,generation:0,active:false}),[]),draftRef=useRef(draft);
 const state=useLocalToolState(client,{observe:true,hasDraft:!!draft||reading}),readingBaseline=useRef<LocalToolSnapshot<LocalToolJson>|undefined>(undefined),live=useRef({state,draft,reading,readOnly});
 useLayoutEffect(()=>{draftRef.current=draft;live.current={state,draft,reading,readOnly};},[state,draft,reading,readOnly]);
 useLayoutEffect(()=>{session.active=true;return()=>{session.active=false;session.generation++;session.reader?.abort();};},[session]);
 useLayoutEffect(()=>{if(editor&&!editor.isDestroyed)editor.setEditable(!readOnly&&!state.busy,false);},[editor,state.busy,readOnly]);
 const save=useCallback(async()=>{const current=live.current;if(current.readOnly||current.reading||current.state.busy)return false;if(!current.draft)return true;const captured=current.draft;const ok=await current.state.apply([{type:'set',field,value:richProseHtml(captured.html)}],captured.baseline);if(ok&&session.active&&draftRef.current===captured)flushSync(()=>setDraft(undefined));return ok;},[field,session]);
 const pending=!!draft||reading||state.busy;
 useEffect(()=>{if(pending)return registerPendingFlusher('sdk-rich-prose:'+id,save);},[id,save,pending]);
 const change=useCallback((html:string)=>{const snapshot=live.current.state.snapshot;if(!snapshot||live.current.readOnly||live.current.state.busy)return;setDraft(current=>({html,baseline:current?.baseline??structuredClone(snapshot)}));},[]);
 // Baselines supply presentation only while the newly issued client loads; they never grant write authority.
 const display=state.snapshot??draft?.baseline??(reading?readingBaseline.current:undefined);
 const raw=display?.data,content=raw&&typeof raw==='object'&&!Array.isArray(raw)&&typeof raw[field]==='string'?raw[field] as string:'';
 const upload=(file:File|undefined)=>{
  if(!file||readOnly||!live.current.state.snapshot)return;readingBaseline.current=live.current.state.snapshot;setImageError('');if(!/^image\/(?:png|jpeg|webp|gif|avif|bmp)$/i.test(file.type)||file.size>MAX_LOCAL_TOOL_STATE_BYTES){setImageError(es?'Elige una imagen raster que quepa en el estado de la herramienta. Se conserva el borrador.':'Choose a raster image that fits the tool state. Your draft is preserved.');return;}
  session.reader?.abort();const requested=++session.generation,load=new FileReader();session.reader=load;setReading(true);
  const current=()=>session.active&&session.generation===requested&&!live.current.readOnly;
  load.onload=()=>{if(!current())return;try{if(!editor||editor.isDestroyed||typeof load.result!=='string')throw Error('image');const image=richProseHtml(`<img src="${load.result}" alt="">`);if(!image)throw Error('image');const snapshot=live.current.state.snapshot;if(!snapshot)throw Error('snapshot');const data=snapshot.data;if(!data||typeof data!=='object'||Array.isArray(data))throw Error('state');localToolJsonText({...data,[field]:(draftRef.current?.html??content)+image});editor.chain().focus().setImage({src:load.result}).run();}catch{setImageError(es?'No se pudo insertar la imagen. Se conserva el borrador.':'Could not insert the image. Your draft is preserved.');}finally{setReading(false);}};
  load.onerror=()=>{if(current()){setReading(false);setImageError(es?'No se pudo leer la imagen.':'Could not read the image.');}};load.onabort=()=>{if(current())setReading(false);};load.readAsDataURL(file);
 };
 if(readOnly&&!draft&&!reading)return <p role="status">{es?'La prosa enriquecida es de solo lectura.':'Rich prose is read only.'}</p>;
 if(!display)return <p role={state.error?'alert':'status'}>{state.error||(es?'Cargando informe…':'Loading briefing…')}</p>;
 return <section data-sdk-rich-prose={field} className="min-w-0 space-y-3">
  <h4 className="font-display text-base text-text-primary">{label??(es?'Informe':'Briefing')}</h4>
  <fieldset disabled={readOnly||state.busy} className="min-w-0 border-0 p-0"><TiptapEditor contentProfile="sdk-prose" content={draft?.html??content} extensions={extensions} onChange={change} onEditorReady={setEditor} referenceContext={{projectId:client.projectId,eraId:client.eraId,scopeId:id}}/></fieldset>
  <div className="flex flex-wrap items-center gap-2"><label className="min-w-0 flex-1 text-sm text-text-muted">{es?'Imagen local':'Local image'}<input data-testid="sdk-prose-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" disabled={readOnly||state.busy||reading} className="mt-1 block w-full min-w-0 text-sm" onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/></label><button type="button" className={button} disabled={readOnly||!draft||state.busy||reading} onClick={()=>void save()}>{es?'Guardar informe':'Save briefing'}</button><button type="button" className={button} disabled={!draft&&!reading||state.busy} onClick={()=>{session.generation++;session.reader?.abort();setReading(false);setImageError('');readingBaseline.current=undefined;setDraft(undefined);if(!readOnly)void state.reload();}}>{es?'Descartar cambios':'Discard changes'}</button><button type="button" className={button} disabled={readOnly||!state.canUndo||!!draft||state.busy||reading} onClick={()=>void state.undo()}>{es?'Deshacer':'Undo'}</button><button type="button" className={button} disabled={readOnly||!state.canRedo||!!draft||state.busy||reading} onClick={()=>void state.redo()}>{es?'Rehacer':'Redo'}</button></div>
  {readOnly&&(draft||reading)&&<p role="status">{es?'La fuente ha cambiado. Puedes copiar o descartar el borrador conservado.':'The source changed. You can copy or discard the retained draft.'}</p>}{reading&&!readOnly&&<p role="status" className="text-sm text-text-muted">{es?'Leyendo imagen…':'Reading image…'}</p>}{(state.error||imageError)&&<p role="alert" className="text-sm text-danger">{state.error?es?'No se pudo guardar. Conservamos tu edición; revisa los cambios o descarta el borrador para recargar.':'Could not save. Your edits are preserved; review the changes or discard the draft to reload.':imageError}</p>}
 </section>;
}
