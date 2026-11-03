import {useLocalToolDocumentContent} from '../liveContent/hooks';
import {documentContentHost} from '../liveContent/host';
import LocalPresenceRichCarets from '../presence/Carets';
import type {LocalToolDocumentPresence} from '../presence/types';
import {blockNodes,formatBlocks,selectedBlockLeaves,blockTextKey} from './blockProsemirror';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {getSchema,Node,Mark,Extension,mergeAttributes,type Editor} from '@tiptap/core';
import {EditorContent,useEditor} from '@tiptap/react';
import type {EditorState} from '@tiptap/pm/state';
import type {AnyExtension} from '@tiptap/core';
import {prepareRichExtraExtensions,richExtensionPluginError,richEditorInitialContent} from './extensions';
import {richBaselineView,RichBaselineText,type RichBaseline} from './Baseline';
import {useTranslation} from '@/i18n/useTranslation';
import {registerPendingFlusher} from '@/services/pendingWrites';
import type {LocalToolDefinition} from '../sdk';
import type {LocalToolCollaborativeRichProps} from '../CollaborativeRich';
import {localToolConvergenceContext} from '../convergence/context';
import {RICH_MARKS,type RichMark} from '../convergence/richTypes';
import {useLocalToolAtomPending} from '../blocks/pending';
import {nextLocalToolUndoStep,useLocalToolUndoController} from '../stateUndoContext';
import {RichEditorSession} from './session';
import {projectRichView,sessionPMDocument,blockSession,richBookmark,createRichAdmissionJournal,hasRichAcceptedWork,drainRichAccepted,commitRichComposition} from './prosemirror';

const button='min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
const tags:Record<RichMark,string>={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'};
const keys:Record<RichMark,string>={bold:'Mod-b',italic:'Mod-i',underline:'Mod-u',strike:'Mod-Shift-x',code:'Mod-e'};

export default function CollaborativeRichRenderer({client,context,field,label,placeholder,className,extensions,definition,readOnly}:LocalToolCollaborativeRichProps&{definition:LocalToolDefinition;readOnly:boolean}){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[,redraw]=useState(0),[session,setSession]=useState<RichEditorSession>(),[baseline,setBaseline]=useState<RichBaseline>(),[error,setError]=useState(''),[starting,setStarting]=useState(false),[reload,setReload]=useState(0),current=useRef<RichEditorSession|undefined>(undefined),generation=useRef(0),refreshInitial=useRef<(()=>Promise<boolean>)|undefined>(undefined);
 const passive=session?{kind:'loading' as const}:richBaselineView(baseline,client,definition,field),heading=label??(es?'Texto compartido':'Shared text');
 useLayoutEffect(()=>{
  const requested=++generation.current;let active=true,read=0;
  setError('');setStarting(false);
  const liveSession=():RichEditorSession|undefined=>current.current;
  const refresh=async():Promise<boolean>=>{
   if(!active||requested!==generation.current)return false;
   const beforeRead=liveSession();if(beforeRead){await beforeRead.refresh();return !beforeRead.error;}
   const sequence=++read;
   setBaseline(previous=>previous?.client===client&&previous.definition===definition&&previous.field===field?{...previous,stale:true}:previous);
   try{
    const result=await client.convergence!.export();if(!active||requested!==generation.current||sequence!==read)return false;
    const captured:RichBaseline={client,definition,field,snapshot:result.snapshot};
    if(richBaselineView(captured,client,definition,field).kind!=='ready')throw Error('local_tool_rich_baseline_invalid');
    const afterRead=liveSession();if(afterRead){await afterRead.refresh();return !afterRead.error;}
    setBaseline(captured);setError('');
    if(!result.checkpoint||client.eraId&&result.snapshot.provenance==='base')return true;
    const codec=definition.codec;if(!codec)throw Error('local_tool_convergence_codec_required');const metadata=localToolConvergenceContext(definition,codec);if(!metadata)throw Error('local_tool_convergence_codec_required');
    const ready=new RichEditorSession(client,result.checkpoint,result.snapshot,{...metadata,namespace:definition.namespace,codec,validateState:definition.validateState},field,()=>{
     if(current.current!==ready)return;
     if(ready.hasBoundOnce)setSession(ready);
     else if(ready.error){
      // No editor/lifecycle/gesture has been exposed. Keep the passive snapshot and
      // retry from a fresh read; never destroy an already presented draft session.
      setError(ready.error);setBaseline(previous=>previous?.client===client&&previous.definition===definition&&previous.field===field?{...previous,stale:true}:previous);current.current=undefined;ready.destroy();
     }
     redraw(n=>n+1);
    },nextLocalToolUndoStep);
    current.current=ready;ready.rebind(client,readOnly);return true;
   }catch(reason){if(active&&requested===generation.current&&sequence===read){setError(reason instanceof Error?reason.message:String(reason));setBaseline(previous=>previous?.client===client&&previous.definition===definition&&previous.field===field?{...previous,stale:true}:previous);}return false;}
  };
  refreshInitial.current=refresh;
  if(current.current){const active=current.current,metadata=localToolConvergenceContext(definition);const changed=!metadata||metadata.validationId!==active.contract.validationId||metadata.schemaEpoch!==active.contract.schemaEpoch;if(changed)active.fail(Error('local_tool_rich_editor_contract_changed'),active.pending);active.rebind(client,readOnly||changed);if(active.hasBoundOnce)setSession(active);}
  else void refresh();
  const unsubscribe=client.subscribe?.(()=>{if(active){if(current.current)void current.current.refresh();else void refresh();}});return()=>{active=false;read++;generation.current=requested+1;if(refreshInitial.current===refresh)refreshInitial.current=undefined;unsubscribe?.();};
 },[client,definition,field,readOnly,reload]);
 useEffect(()=>()=>{current.current?.destroy();current.current=undefined;},[]);
 const discard=()=>{current.current?.destroy();current.current=undefined;setSession(undefined);setBaseline(undefined);setError('');setReload(n=>n+1);};
 const content=documentContentHost(context?.documentContent),{snapshot:contentSnapshot}=useLocalToolDocumentContent(client,context);
 useLayoutEffect(()=>session&&content?content.register(session,discard):undefined,[session,content]);
 const pending=session?.pending??false;
 useLocalToolAtomPending(pending);
 useLocalToolUndoController({undoStep:session?.undoStep,redoStep:session?.redoStep,undo:async()=>session?.reverse()??false,redo:async()=>session?.reverse(true)??false});
 useEffect(()=>session?registerPendingFlusher('sdk-collaborative-rich:'+id,async()=>{if(current.current!==session||!session.pending)return true;const ok=await session.flush();flushSync(()=>redraw(n=>n+1));return ok;},false,()=>current.current===session&&session.pending):undefined,[session,id]);
 const start=async()=>{if(passive.kind!=='ready'||!passive.fresh||readOnly||starting||current.current)return;const requested=generation.current,refresh=refreshInitial.current;setStarting(true);setError('');try{await client.convergence!.start(passive.snapshot);if(requested===generation.current)setReload(n=>n+1);}catch(reason){if(requested===generation.current){const failure=reason instanceof Error?reason.message:String(reason);await refresh?.();if(requested===generation.current&&!current.current)setError(failure);}}finally{if(requested===generation.current)setStarting(false);}};
 if(!session)return <section className={['min-w-0 space-y-3',className].filter(Boolean).join(' ')} aria-label={heading}>
  <h4 className="font-display text-base text-text-primary">{heading}</h4>
  {passive.kind==='ready'&&<RichBaselineText blockDocument={passive.blockDocument} document={passive.document} field={field} label={heading} placeholder={placeholder} es={es}/>}
  {(error||passive.kind==='invalid')&&<p role="alert">{es?'No se pudo leer o activar el texto. El contenido disponible se conserva.':'Could not read or activate this text. Available content is preserved.'}</p>}
  {passive.kind==='loading'&&!error&&<p role="status">{es?'Cargando texto…':'Loading text…'}</p>}
  {passive.kind==='ready'&&<p role="status">{!passive.fresh?es?'Se muestra el último texto que se pudo leer.':'Showing the last text that could be read.':current.current?es?'Cargando editor…':'Loading editor…':readOnly?es?'Texto de solo lectura.':'Read-only text.':es?'Activa la edición compartida para empezar a escribir.':'Activate shared editing to start writing.'}</p>}
  {passive.kind==='ready'&&!readOnly&&<button type="button" className={button} disabled={starting||!passive.fresh||!!current.current} onClick={()=>void start()}>{es?'Activar edición compartida':'Activate shared editing'}</button>}
  {error&&<button type="button" className={button} onClick={()=>void refreshInitial.current?.()}>{es?'Volver a leer':'Read again'}</button>}
 </section>;
 return <RichSurface presence={context?.presence} session={session} extraExtensions={extensions} label={label} placeholder={placeholder} className={className} es={es} readOnly={readOnly} save={async()=>{let ok=false;try{if(contentSnapshot?.sharing&&!contentSnapshot.saveReady)return false;ok=contentSnapshot?.sharing?await content!.control('save',field):await session.save();}catch(reason){if(!(reason instanceof Error&&reason.message==='local_tool_live_recovery_not_shareable'))session.fail(reason,true);}flushSync(()=>redraw(n=>n+1));return ok;}} sharing={!!contentSnapshot?.sharing} saveReady={contentSnapshot?.saveReady??true} discard={()=>{if(content?.snapshot().sharing)void content.leave().catch(reason=>session.fail(reason,true));else discard();}}/>;
}


function RichSurface({presence,sharing,saveReady,session,extraExtensions,label,placeholder,className,es,readOnly,save,discard}:{presence?:LocalToolDocumentPresence;sharing?:boolean;saveReady:boolean;session:RichEditorSession;extraExtensions?:AnyExtension[];label?:string;placeholder?:string;className?:string;es:boolean;readOnly:boolean;save:()=>Promise<boolean>;discard:()=>void}){
 const isBlocks=blockSession(session),collapsed=useRef(new Set<string>());
 const [extra]=useState(()=>prepareRichExtraExtensions(extraExtensions)),configurationChanged=!extra.matches(extraExtensions);
 // Author diagnostic only; configuration changes do not interrupt the user's draft.
 useEffect(()=>{if(configurationChanged)console.warn('local_tool_rich_editor_extensions_fixed_for_mount');},[configurationChanged]);
 const hostEditable=useRef(!readOnly);
 useLayoutEffect(()=>{hostEditable.current=!readOnly;},[readOnly]);
 const bookmarkRef=useRef<ReturnType<typeof richBookmark>|undefined>(undefined),editorRef=useRef<Editor|null>(null),draining=useRef(false),composition=useRef<{state:EditorState;ended:boolean;frame:number}|undefined>(undefined);
 const drain=(current:Editor)=>{if(draining.current||composition.current||session.error||!hasRichAcceptedWork(session,current.state))return;draining.current=true;
  try{drainRichAccepted(session,()=>current.state,tr=>current.view.dispatch(tr));}catch(reason){session.fail(reason,true);}finally{draining.current=false;if(!session.editable)current.setEditable(false,false);}
 };
 const finishComposition=()=>{const active=composition.current,current=editorRef.current;if(!active||!current||current.isDestroyed)return;cancelAnimationFrame(active.frame);composition.current=undefined;draining.current=true;
  try{if(commitRichComposition(session,active.state,()=>current.state,tr=>current.view.dispatch(tr)))bookmarkRef.current=richBookmark(session,current.state.doc,current.state.selection.anchor,current.state.selection.head);else session.fail(Error('local_tool_rich_editor_composition_retained'),true);}
  catch(reason){session.fail(reason,true);}finally{draining.current=false;session.endComposition();if(!session.editable)current.setEditable(false,false);}
 };
 const [extensions]=useState(()=>[
  ...(isBlocks?blockNodes(collapsed.current):[
  Node.create({name:'doc',topNode:true,content:'paragraph+'}),
  Node.create({name:'paragraph',group:'block',content:'inline*',draggable:true,addAttributes(){return{id:{default:null,parseHTML:element=>element.getAttribute('data-writer-paragraph'),renderHTML:attributes=>attributes.id?{'data-writer-paragraph':attributes.id}:{}}};},parseHTML(){return[{tag:'p'}];},renderHTML({HTMLAttributes}){return['p',mergeAttributes(HTMLAttributes),0];}}),
  Node.create({name:'text',group:'inline'})
  ]),
  ...RICH_MARKS.map(name=>Mark.create({name,excludes:'',parseHTML(){return[{tag:tags[name]}];},renderHTML(){return[tags[name],0];},addKeyboardShortcuts(){return{[keys[name]]:()=>this.editor.commands.toggleMark(name)};}})),
  Extension.create({name:'writerRichAdmission',addProseMirrorPlugins(){return[createRichAdmissionJournal(()=>session.editable&&hostEditable.current)];}}),
  ...extra.extensions,
 ]);
 const [initialContent]=useState(()=>isBlocks?blockPMDocumentInitial():richEditorInitialContent(session.document()));
 function blockPMDocumentInitial(){return sessionPMDocument(session,getSchema(extensions)).toJSON();}
 const editor=useEditor({extensions,content:initialContent,editable:false,immediatelyRender:false,
  onCreate({editor:ready}){editorRef.current=ready;const error=extra.error||richExtensionPluginError(ready.state);if(error)session.fail(Error(error),true);else{drain(ready);if(!session.error&&!ready.state.doc.eq(sessionPMDocument(session,ready.schema)))session.fail(Error('local_tool_rich_editor_extension_unjournaled_content'),true);}ready.setEditable(session.editable&&!readOnly,false);},
  onTransaction({editor:committed}){if(!editorRef.current)editorRef.current=committed;const error=extra.error||richExtensionPluginError(committed.state);if(error){session.fail(Error(error),true);committed.setEditable(false,false);}else if(editorRef.current===committed)drain(committed);},
  editorProps:{attributes:{class:'min-h-36 rounded-lg border border-border bg-elevated p-3 text-text-primary focus:outline-none',role:'textbox','aria-multiline':'true','aria-label':label??(es?'Texto compartido':'Shared text')},handleDOMEvents:{
   compositionstart(view){if(!session.beginComposition())return false;composition.current={state:view.state,ended:false,frame:0};return false;},
   compositionend(){const active=composition.current;if(active){active.ended=true;active.frame=requestAnimationFrame(()=>{if(composition.current===active)finishComposition();});}return false;},
  },handleKeyDown(_view,event){if(event.defaultPrevented||event.altKey||event.isComposing)return false;if(composition.current?.ended)finishComposition();if(isBlocks&&!event.ctrlKey&&!event.metaKey&&(event.key==='Enter'||event.key==='Backspace'||event.key==='Tab')&&blockTextKey(session,_view,event.key,event.shiftKey)){event.preventDefault();return true;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();return session.reverse(event.shiftKey);}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();return session.reverse(true);}return false;}}
 },[session]);
 useLayoutEffect(()=>{if(!editor||editor.isDestroyed)return;session.beforeViewChange=()=>{if(!composition.current&&!bookmarkRef.current)bookmarkRef.current=richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);};session.afterViewChange=()=>{if(composition.current||session.error)return;const bookmark=bookmarkRef.current??richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);bookmarkRef.current=undefined;const projected=projectRichView(session,editor.state.tr,bookmark);if(projected.docChanged){editor.view.dispatch(projected);if(!editor.state.doc.eq(sessionPMDocument(session,editor.schema)))throw Error('local_tool_rich_editor_projection_vetoed');}};return()=>{session.beforeViewChange=undefined;session.afterViewChange=undefined;};},[editor,session]);
 useLayoutEffect(()=>{if(!editor||editor.isDestroyed)return;editorRef.current=editor;editor.setEditable(session.editable&&!readOnly,false);if(composition.current||session.error)return;
  try{const bookmark=bookmarkRef.current??richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);bookmarkRef.current=undefined;const tr=projectRichView(session,editor.state.tr,bookmark);if(tr.docChanged)editor.view.dispatch(tr);}catch(reason){session.fail(reason,true);}
 },[editor,session,session.revision,readOnly]);
 // Presentation props update the existing view; neither schema nor caret is reconstructed.
 useLayoutEffect(()=>{if(editor&&!editor.isDestroyed)editor.view.setProps({attributes:{class:'min-h-36 rounded-lg border border-border bg-elevated p-3 text-text-primary focus:outline-none',role:'textbox','aria-multiline':'true','aria-label':label??(es?'Texto compartido':'Shared text'),'aria-placeholder':placeholder??(es?'Escribe aquí…':'Write here…')}});},[editor,label,placeholder,es]);
 useEffect(()=>()=>{const active=composition.current;if(active)cancelAnimationFrame(active.frame);composition.current=undefined;editorRef.current=null;},[]);
 const commit=async()=>{if(composition.current?.ended)finishComposition();return save();},recover=readOnly||!!session.error,hint=placeholder??(es?'Escribe aquí…':'Write here…');
 return <section className={['min-w-0 space-y-3',className].filter(Boolean).join(' ')} data-sdk-collaborative-rich={session.field}>
  <h4 className="font-display text-base text-text-primary">{label??(es?'Texto compartido':'Shared text')}</h4>
  <div className="flex flex-wrap gap-2" aria-label={es?'Formato de texto':'Text formatting'}>{RICH_MARKS.map(mark=><button key={mark} type="button" className={button} aria-pressed={editor?.isActive(mark)??false} disabled={!session.editable||readOnly} onMouseDown={event=>event.preventDefault()} onClick={()=>editor?.chain().focus().toggleMark(mark).run()}>{({bold:es?'Negrita':'Bold',italic:es?'Cursiva':'Italic',underline:es?'Subrayado':'Underline',strike:es?'Tachado':'Strike',code:es?'Código':'Code'})[mark]}</button>)}</div>
  {isBlocks&&<div className="flex flex-wrap gap-2" aria-label={es?'Formato de bloques':'Block formatting'}>{(['paragraph','h1','h2','h3','bullet-list','ordered-list','blockquote','toggle'] as const).map(kind=><button key={kind} type="button" className={button} disabled={!session.editable||readOnly} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(editor)formatBlocks(session,selectedBlockLeaves(editor.state.doc,editor.state.selection.from,editor.state.selection.to),kind);}}>{({paragraph:es?'Párrafo':'Paragraph',h1:'H1',h2:'H2',h3:'H3','bullet-list':es?'Viñetas':'Bullet list','ordered-list':es?'Lista numerada':'Numbered list',blockquote:es?'Cita':'Blockquote',toggle:es?'Desplegable':'Toggle'})[kind]}</button>)}</div>}
  <div className={isBlocks?"tiptap-editor relative":"relative"}><EditorContent editor={editor}/><LocalPresenceRichCarets presence={presence} session={session} editor={editor}/>{editor?.isEmpty&&editor.state.doc.childCount===1&&hint&&<span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-text-muted">{hint}</span>}</div>
  <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={readOnly||session.busy||!session.dirty||!!session.error||!!sharing&&!saveReady} onClick={()=>void commit()}>{sharing?(es?'Guardar en esta biblioteca':'Save to this library'):(es?'Guardar cambios':'Save changes')}</button><button type="button" className={button} disabled={session.undoStep===undefined||readOnly} onClick={()=>session.reverse()}>{es?'Deshacer':'Undo'}</button><button type="button" className={button} disabled={session.redoStep===undefined||readOnly} onClick={()=>session.reverse(true)}>{es?'Rehacer':'Redo'}</button><button type="button" className={button} onClick={discard}>{sharing?(es?'Salir sin guardar aquí':'Leave without saving here'):(es?'Descartar y recargar':'Discard and reload')}</button>{session.canRetry&&<button type="button" className={button} disabled={readOnly||session.busy} onClick={()=>void session.retry()}>{es?'Reintentar guardado':'Retry save'}</button>}</div>
  <p role={session.error?'alert':'status'} className={session.error?'text-sm text-danger':'text-sm text-text-muted'}>{session.error?session.error.startsWith('local_tool_rich_editor_extension_')?es?'Estas extensiones no son compatibles con los párrafos y formatos de este editor. Conservamos el texto para copiarlo o descartarlo.':'These extensions are incompatible with this editor’s paragraphs and formatting. Your text is retained for copying or discarding.':es?'No se pudo completar el cambio. Conservamos tu borrador para copiarlo o descartarlo.':'The change could not be completed. Your draft is retained for copying or discarding.':session.busy?es?'Guardando…':'Saving…':session.pending||session.needsCompletion?es?'Cambios sin guardar o pendientes de completar.':'Changes are unsaved or awaiting completion.':es?'Cambios guardados. Deshacer vuelve a crear un borrador pendiente.':'Changes saved. Undo creates a new unsaved draft.'}</p>
  {recover&&<label className="block text-sm text-text-muted">{es?'Borrador conservado para copiar':'Retained draft for copying'}<textarea readOnly className="mt-1 block min-h-28 w-full rounded-lg border border-border bg-elevated p-3" value={editor?.getText()??session.document().content.map(p=>p.content.map(t=>t.text).join('')).join('\n')}/></label>}
 </section>;
}
