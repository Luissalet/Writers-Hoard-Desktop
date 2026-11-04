import {localToolRichTables} from '../stateCodec';
import {insertFixedTable,controlFixedTable,controlTableAxis,firstTableRow,toggleTableHeader,pasteFixedTableText,rejectCrossCellClipboard} from './tableProsemirror';
import Link from '@tiptap/extension-link';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import {useLocalToolDocumentContent} from '../liveContent/hooks';
import {documentContentHost} from '../liveContent/host';
import type {LocalToolSaveMode} from '../liveContent/types';
import LocalPresenceRichCarets from '../presence/Carets';
import type {LocalToolDocumentPresence} from '../presence/types';
import {axisCellAtPosition,blockNodes,formatBlocks,selectedBlockLeaves,blockTextKey} from './blockProsemirror';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {getSchema,Node,Mark,Extension,mergeAttributes,type Editor} from '@tiptap/core';
import {EditorContent,useEditor,useEditorState} from '@tiptap/react';
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
import {ImageControls,richImageKey,richImageNode} from './imageControls';
import {copySourceCellSelection,cutSourceCellSelection,sourceCellSelectionEnds,sourceTableCellSelection} from './tableCellSelection';
import {pasteSourceTable} from './tablePasteClipboard';
import {TableHeightControls,TableWidthControls,TableWidthSurface} from './tableWidthControls';
import type {TableColumnLayout} from './tableAxesLayout';
import {projectRichView,sessionPMDocument,blockSession,richBookmark,createRichAdmissionJournal,hasRichAcceptedWork,drainRichAccepted,commitRichComposition} from './prosemirror';

const button='min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-50';
type SchemaTransition={session:RichEditorSession;bookmark:ReturnType<typeof richBookmark>;marks:{type:string;attrs:Record<string,unknown>}[]|null;focused:boolean;collapsed:string[]};
const tags:Record<RichMark,string>={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'};
const keys:Record<RichMark,string>={bold:'Mod-b',italic:'Mod-i',underline:'Mod-u',strike:'Mod-Shift-x',code:'Mod-e'};

export default function CollaborativeRichRenderer({client,context,field,label,placeholder,className,extensions,definition,readOnly}:LocalToolCollaborativeRichProps&{definition:LocalToolDefinition;readOnly:boolean}){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[,redraw]=useState(0),[session,setSession]=useState<RichEditorSession>(),[baseline,setBaseline]=useState<RichBaseline>(),[error,setError]=useState(''),[starting,setStarting]=useState(false),[reload,setReload]=useState(0),current=useRef<RichEditorSession|undefined>(undefined),generation=useRef(0),refreshInitial=useRef<(()=>Promise<boolean>)|undefined>(undefined);
 const transition=useRef<SchemaTransition|undefined>(undefined);
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
    if(readOnly&&localToolRichTables(definition.codec?.fields[field]))return true;
    const codec=definition.codec;if(!codec)throw Error('local_tool_convergence_codec_required');const metadata=localToolConvergenceContext(definition,codec);if(!metadata)throw Error('local_tool_convergence_codec_required');
    const ready=new RichEditorSession(client,result.checkpoint,result.snapshot,{...metadata,namespace:definition.namespace,codec,validateState:definition.validateState,richAdoption:definition.richAdoption},field,()=>{
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
  if(current.current){const active=current.current,metadata=localToolConvergenceContext(definition);const changed=!metadata||metadata.validationId!==active.definitionContract.validationId||metadata.schemaEpoch!==active.definitionContract.schemaEpoch;if(changed)active.fail(Error('local_tool_rich_editor_contract_changed'),active.pending);active.rebind(client,readOnly||changed);if(active.hasBoundOnce)setSession(active);}
  else void refresh();
  const unsubscribe=client.subscribe?.(()=>{if(active){if(current.current)void current.current.refresh();else void refresh();}});return()=>{active=false;read++;generation.current=requested+1;if(refreshInitial.current===refresh)refreshInitial.current=undefined;unsubscribe?.();};
 },[client,definition,field,readOnly,reload]);
 useEffect(()=>()=>{current.current?.destroy();current.current=undefined;},[]);
 const discard=()=>{current.current?.destroy();current.current=undefined;setSession(undefined);setBaseline(undefined);setError('');setReload(n=>n+1);};
 const content=documentContentHost(context?.documentContent),{snapshot:contentSnapshot}=useLocalToolDocumentContent(client,context);
 useLayoutEffect(()=>session&&content?content.register(session,discard):undefined,[session,content]);
 const contentRoute=useRef(content);contentRoute.current=content;
 const pending=session?.pending??false;
 useLocalToolAtomPending(pending);
 useLocalToolUndoController({undoStep:session?.undoStep,redoStep:session?.redoStep,undo:async()=>session?.reverse()??false,redo:async()=>session?.reverse(true)??false});
 useEffect(()=>session?registerPendingFlusher('sdk-collaborative-rich:'+id,async()=>{if(current.current!==session||!session.pending)return true;const route=contentRoute.current,ok=await(route?route.flush(field):session.flush());flushSync(()=>redraw(n=>n+1));return ok;},false,()=>current.current===session&&session.pending):undefined,[session,id,field]);
 const start=async()=>{if(passive.kind!=='ready'||!passive.fresh||readOnly||starting||current.current)return;const requested=generation.current,refresh=refreshInitial.current;setStarting(true);setError('');try{await client.convergence!.start(passive.snapshot);if(requested===generation.current)setReload(n=>n+1);}catch(reason){if(requested===generation.current){const failure=reason instanceof Error?reason.message:String(reason);await refresh?.();if(requested===generation.current&&!current.current)setError(failure);}}finally{if(requested===generation.current)setStarting(false);}};
 if(!session)return <section className={['min-w-0 space-y-3',className].filter(Boolean).join(' ')} aria-label={heading}>
  <h4 className="font-display text-base text-text-primary">{heading}</h4>
  {passive.kind==='ready'&&<RichBaselineText assets={client.assets} blockDocument={passive.blockDocument} document={passive.document} field={field} label={heading} placeholder={placeholder} es={es}/>}
  {(error||passive.kind==='invalid')&&<p role="alert">{es?'No se pudo leer o activar el texto. El contenido disponible se conserva.':'Could not read or activate this text. Available content is preserved.'}</p>}
  {passive.kind==='loading'&&!error&&<p role="status">{es?'Cargando texto…':'Loading text…'}</p>}
  {passive.kind==='ready'&&<p role="status">{!passive.fresh?es?'Se muestra el último texto que se pudo leer.':'Showing the last text that could be read.':current.current?es?'Cargando editor…':'Loading editor…':readOnly?es?'Texto de solo lectura.':'Read-only text.':es?'Activa la edición compartida para empezar a escribir.':'Activate shared editing to start writing.'}</p>}
  {passive.kind==='ready'&&!readOnly&&<button type="button" className={button} disabled={starting||!passive.fresh||!!current.current} onClick={()=>void start()}>{es?'Activar edición compartida':'Activate shared editing'}</button>}
  {error&&<button type="button" className={button} onClick={()=>void refreshInitial.current?.()}>{es?'Volver a leer':'Read again'}</button>}
 </section>;
 return <RichSurface transition={transition} key={session.links?'links':'plain'} adopt={async()=>{if(content)await content.control('adopt',field);else session.adopt();flushSync(()=>redraw(n=>n+1));}} presence={context?.presence} session={session} extraExtensions={extensions} label={label} placeholder={placeholder} className={className} es={es} readOnly={readOnly} save={async()=>{let ok=false;try{if((contentSnapshot?.sharing||contentSnapshot?.saveMode==='automatic')&&!contentSnapshot.saveReady)return false;ok=(contentSnapshot?.sharing||contentSnapshot?.saveMode==='automatic')?await content!.control('save',field):await session.save();}catch(reason){if(!contentSnapshot?.sharing&&contentSnapshot?.saveMode!=='automatic'&&!(reason instanceof Error&&reason.message==='local_tool_live_recovery_not_shareable'))session.fail(reason,true);}flushSync(()=>redraw(n=>n+1));return ok;}} retry={async()=>{const ok=content?await content.retry(field):await session.retry();flushSync(()=>redraw(n=>n+1));return ok;}} saveMode={contentSnapshot?.saveMode} modeReady={contentSnapshot?.modeReady??false} preferenceError={contentSnapshot?.preferenceError} autosaveError={contentSnapshot?.autosaveError} chooseMode={mode=>content?.port.setSaveMode(mode)??Promise.resolve()} sharing={!!contentSnapshot?.sharing} documentSave={!!contentSnapshot?.sharing||contentSnapshot?.saveMode==='automatic'} saveReady={contentSnapshot?.saveReady??true} discard={()=>{if(content?.snapshot().sharing)void content.leave().catch(reason=>session.fail(reason,true));else discard();}}/>;
}


function RichSurface({transition,adopt,presence,sharing,documentSave,saveReady,session,extraExtensions,label,placeholder,className,es,readOnly,save,retry,discard,saveMode,modeReady,preferenceError,autosaveError,chooseMode}:{transition:{current:SchemaTransition|undefined};adopt:()=>Promise<void>;saveMode?:LocalToolSaveMode;modeReady:boolean;preferenceError?:string;autosaveError?:string;chooseMode:(mode:LocalToolSaveMode)=>Promise<void>;retry:()=>Promise<boolean>;documentSave:boolean;presence?:LocalToolDocumentPresence;sharing?:boolean;saveReady:boolean;session:RichEditorSession;extraExtensions?:AnyExtension[];label?:string;placeholder?:string;className?:string;es:boolean;readOnly:boolean;save:()=>Promise<boolean>;discard:()=>void}){
 const isBlocks=blockSession(session),collapsed=useRef(new Set<string>(transition.current?.session===session?transition.current.collapsed:[]));
 const [extra]=useState(()=>prepareRichExtraExtensions(extraExtensions,session.links)),configurationChanged=!extra.matches(extraExtensions);
 // Author diagnostic only; configuration changes do not interrupt the user's draft.
 useEffect(()=>{if(configurationChanged)console.warn('local_tool_rich_editor_extensions_fixed_for_mount');},[configurationChanged]);
 const hostEditable=useRef(!readOnly);
 useLayoutEffect(()=>{hostEditable.current=!readOnly;},[readOnly]);
 const bookmarkRef=useRef<ReturnType<typeof richBookmark>|undefined>(transition.current?.session===session?transition.current.bookmark:undefined),editorRef=useRef<Editor|null>(null),draining=useRef(false),composition=useRef<{state:EditorState;ended:boolean;frame:number}|undefined>(undefined);
 const drain=(current:Editor)=>{if(draining.current||composition.current||session.error||!hasRichAcceptedWork(session,current.state))return;draining.current=true;
  try{drainRichAccepted(session,()=>current.state,tr=>current.view.dispatch(tr));}catch(reason){session.fail(reason,true);}finally{draining.current=false;if(!session.editable)current.setEditable(false,false);}
 };
 const finishComposition=()=>{const active=composition.current,current=editorRef.current;if(!active||!current||current.isDestroyed)return;cancelAnimationFrame(active.frame);composition.current=undefined;draining.current=true;
  try{if(commitRichComposition(session,active.state,()=>current.state,tr=>current.view.dispatch(tr)))bookmarkRef.current=richBookmark(session,current.state.doc,current.state.selection.anchor,current.state.selection.head);else session.fail(Error('local_tool_rich_editor_composition_retained'),true);}
  catch(reason){session.fail(reason,true);}finally{draining.current=false;session.endComposition();if(!session.editable)current.setEditable(false,false);}
 };
 const [linkForm,setLinkForm]=useState(false),[linkUrl,setLinkUrl]=useState('');
 const [extensions]=useState(()=>[
  ...(isBlocks?blockNodes(collapsed.current,session.tables,session.axes,session.widths,session.images,session.imageCells,session.cellSpans):[
  Node.create({name:'doc',topNode:true,content:'paragraph+'}),
  Node.create({name:'paragraph',group:'block',content:'inline*',draggable:true,addAttributes(){return{id:{default:null,parseHTML:element=>element.getAttribute('data-writer-paragraph'),renderHTML:attributes=>attributes.id?{'data-writer-paragraph':attributes.id}:{}}};},parseHTML(){return[{tag:'p'}];},renderHTML({HTMLAttributes}){return['p',mergeAttributes(HTMLAttributes),0];}}),
  Node.create({name:'text',group:'inline'})
  ]),
  ...(session.images?[richImageNode(session,es)]:[]),
  ...(session.axes?[sourceTableCellSelection]:[]),
  ...RICH_MARKS.map(name=>Mark.create({name,excludes:'',parseHTML(){return[{tag:tags[name]}];},renderHTML(){return[tags[name],0];},addKeyboardShortcuts(){return{[keys[name]]:()=>this.editor.commands.toggleMark(name)};}})),
  ...(session.links?[Link.extend({inclusive:false,addAttributes(){return{...this.parent?.(),href:{default:null,parseHTML:element=>normalizeEditorLinkHref(element.getAttribute('href')??'')}};}}).configure({openOnClick:false,autolink:false,linkOnPaste:false})]:[]),
  Extension.create({name:'writerRichAdmission',addProseMirrorPlugins(){return[createRichAdmissionJournal(()=>session.editable&&hostEditable.current)];}}),
  ...extra.extensions,
 ]);
 const [initialContent]=useState(()=>isBlocks?blockPMDocumentInitial():richEditorInitialContent(session.document()));
 function blockPMDocumentInitial(){return sessionPMDocument(session,getSchema(extensions)).toJSON();}
 const editor=useEditor({extensions,content:initialContent,editable:false,immediatelyRender:false,
  onCreate({editor:ready}){editorRef.current=ready;const error=extra.error||richExtensionPluginError(ready.state);if(error)session.fail(Error(error),true);else{drain(ready);if(!session.error&&!ready.state.doc.eq(sessionPMDocument(session,ready.schema)))session.fail(Error('local_tool_rich_editor_extension_unjournaled_content'),true);}ready.setEditable(session.editable&&!readOnly,false);},
  onTransaction({editor:committed}){if(!editorRef.current)editorRef.current=committed;const error=extra.error||richExtensionPluginError(committed.state);if(error){session.fail(Error(error),true);committed.setEditable(false,false);}else if(editorRef.current===committed)drain(committed);},
  editorProps:{attributes:{class:'min-h-36 rounded-lg border border-border bg-elevated p-3 text-text-primary focus:outline-none',role:'textbox','aria-multiline':'true','aria-label':label??(es?'Texto compartido':'Shared text'),...(session.tables?{style:'white-space:pre-wrap'}:{})},handleDOMEvents:{
   copy(view,event){return copySourceCellSelection(view,event,session)||rejectCrossCellClipboard(session,view,event);},cut(view,event){return cutSourceCellSelection(session,view,event)||rejectCrossCellClipboard(session,view,event);},
   compositionstart(view){if(!session.beginComposition())return false;composition.current={state:view.state,ended:false,frame:0};return false;},
   compositionend(){const active=composition.current;if(active){active.ended=true;active.frame=requestAnimationFrame(()=>{if(composition.current===active)finishComposition();});}return false;},
  },handlePaste(view,event){if(pasteSourceTable(session,view,event))return true;if(sourceCellSelectionEnds(view.state.selection)){event.preventDefault();return true;}return pasteFixedTableText(session,view,event);},handleKeyDown(_view,event){if(event.defaultPrevented||event.altKey||event.isComposing)return false;if(composition.current?.ended)finishComposition();if(isBlocks&&!sourceCellSelectionEnds(_view.state.selection)&&!event.ctrlKey&&!event.metaKey&&(event.key==='Enter'||event.key==='Backspace'||event.key==='Delete'||event.key==='Tab')&&(richImageKey(session,_view,event.key)||blockTextKey(session,_view,event.key,event.shiftKey))){event.preventDefault();return true;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();return session.reverse(event.shiftKey);}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();return session.reverse(true);}return false;}}
 },[session]);
 useLayoutEffect(()=>{if(!editor||editor.isDestroyed)return;session.beforeViewChange=()=>{if(!composition.current&&!bookmarkRef.current)bookmarkRef.current=richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);};session.afterViewChange=()=>{if(composition.current||session.error)return;const bookmark=bookmarkRef.current??richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);bookmarkRef.current=undefined;if(session.links&&!editor.schema.marks.link){transition.current={session,bookmark,marks:editor.state.storedMarks?.map(mark=>({type:mark.type.name,attrs:{...mark.attrs}}))??null,focused:editor.isFocused,collapsed:[...collapsed.current]};editor.setEditable(false,false);return;}const projected=projectRichView(session,editor.state.tr,bookmark);if(projected.docChanged){editor.view.dispatch(projected);if(!editor.state.doc.eq(sessionPMDocument(session,editor.schema)))throw Error('local_tool_rich_editor_projection_vetoed');}};return()=>{session.beforeViewChange=undefined;session.afterViewChange=undefined;};},[editor,session,transition]);
 useLayoutEffect(()=>{if(!editor||editor.isDestroyed)return;editorRef.current=editor;editor.setEditable(session.editable&&!readOnly,false);if(composition.current||session.error)return;
  try{const carried=transition.current?.session===session?transition.current:undefined,bookmark=bookmarkRef.current??richBookmark(session,editor.state.doc,editor.state.selection.anchor,editor.state.selection.head);bookmarkRef.current=undefined;const tr=projectRichView(session,editor.state.tr,bookmark,!!carried);if(carried?.marks)tr.setStoredMarks(carried.marks.map(mark=>{const type=editor.schema.marks[mark.type];if(!type)throw Error('local_tool_rich_editor_schema_invalid');return type.create(mark.attrs);}));if(tr.docChanged||tr.selectionSet||tr.storedMarksSet)editor.view.dispatch(tr);if(carried){transition.current=undefined;if(carried.focused)editor.commands.focus(undefined,{scrollIntoView:false});}}catch(reason){session.fail(reason,true);}
 },[editor,session,session.revision,readOnly,transition]);
 // Presentation props update the existing view; neither schema nor caret is reconstructed.
 useLayoutEffect(()=>{if(editor&&!editor.isDestroyed)editor.view.setProps({attributes:{class:'min-h-36 rounded-lg border border-border bg-elevated p-3 text-text-primary focus:outline-none',role:'textbox','aria-multiline':'true','aria-label':label??(es?'Texto compartido':'Shared text'),'aria-placeholder':placeholder??(es?'Escribe aquí…':'Write here…')}});},[editor,label,placeholder,es]);
 useEffect(()=>()=>{const active=composition.current;if(active)cancelAnimationFrame(active.frame);composition.current=undefined;editorRef.current=null;},[]);
 const cellRangeSelected=useEditorState({editor,selector:({editor:current})=>!!current&&!!sourceCellSelectionEnds(current.state.selection)});
 const controlsReadOnly=readOnly||cellRangeSelected===true;
 const commit=async()=>{if(composition.current?.ended)finishComposition();return save();},recover=readOnly||!!session.error,hint=placeholder??(es?'Escribe aquí…':'Write here…');
 const editorContent=<><EditorContent editor={editor}/><LocalPresenceRichCarets presence={presence} session={session} editor={editor}/>{editor?.isEmpty&&editor.state.doc.childCount===1&&hint&&<span aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-text-muted">{hint}</span>}</>;
 return <section className={['min-w-0 space-y-3',className].filter(Boolean).join(' ')} data-sdk-collaborative-rich={session.field}>
  <h4 className="font-display text-base text-text-primary">{label??(es?'Texto compartido':'Shared text')}</h4>
  {session.canAdopt&&<button type="button" className={button} disabled={readOnly||!saveReady} onClick={()=>void adopt().catch(reason=>session.fail(reason))}>{es?'Activar enlaces':'Enable links'}</button>}
  <div className="flex flex-wrap gap-2" aria-label={es?'Formato de texto':'Text formatting'}>{RICH_MARKS.map(mark=><button key={mark} type="button" className={button} aria-pressed={editor?.isActive(mark)??false} disabled={!session.editable||controlsReadOnly} onMouseDown={event=>event.preventDefault()} onClick={()=>editor?.chain().focus().toggleMark(mark).run()}>{({bold:es?'Negrita':'Bold',italic:es?'Cursiva':'Italic',underline:es?'Subrayado':'Underline',strike:es?'Tachado':'Strike',code:es?'Código':'Code'})[mark]}</button>)}{session.links&&<button type="button" className={button} aria-pressed={editor?.isActive('link')??false} disabled={!session.editable||controlsReadOnly} onMouseDown={event=>event.preventDefault()} onClick={()=>{setLinkUrl(String(editor?.getAttributes('link').href??''));setLinkForm(true);}}>{es?'Enlace':'Link'}</button>}</div>
  {linkForm&&<form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();const href=normalizeEditorLinkHref(linkUrl);if(href&&editor&&!controlsReadOnly){const chain=editor.chain().focus();if(editor.state.selection.empty&&editor.isActive('link'))chain.extendMarkRange('link');chain.setLink({href}).run();setLinkForm(false);}}}><label className="min-w-0 flex-1 text-sm text-text-muted">{es?'Dirección del enlace':'Link address'}<input autoFocus className="mt-1 block min-h-9 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold" value={linkUrl} disabled={!session.editable||controlsReadOnly} onChange={event=>setLinkUrl(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){setLinkForm(false);editor?.commands.focus();}}}/></label><button className={button} disabled={!linkUrl.trim()||!session.editable||readOnly} type="submit">{es?'Aplicar':'Apply'}</button><button className={button} disabled={!session.editable||controlsReadOnly} type="button" onClick={()=>{if(editor&&!controlsReadOnly){const chain=editor.chain().focus();if(editor.state.selection.empty)chain.extendMarkRange('link');chain.unsetLink().run();}setLinkForm(false);}}>{es?'Quitar enlace':'Remove link'}</button><button className={button} type="button" onClick={()=>{setLinkForm(false);editor?.commands.focus();}}>{es?'Cancelar':'Cancel'}</button></form>}
  {session.images&&<ImageControls session={session} editor={editor} readOnly={controlsReadOnly} es={es} button={button}/> }
  {session.tables&&<TableControls session={session} editor={editor} readOnly={controlsReadOnly} es={es}/> }
  {isBlocks&&<div className="flex flex-wrap gap-2" aria-label={es?'Formato de bloques':'Block formatting'}>{(['paragraph','h1','h2','h3','bullet-list','ordered-list','blockquote','toggle'] as const).map(kind=><button key={kind} type="button" className={button} disabled={!session.editable||controlsReadOnly} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(editor)formatBlocks(session,selectedBlockLeaves(editor.state.doc,editor.state.selection.from,editor.state.selection.to),kind);}}>{({paragraph:es?'Párrafo':'Paragraph',h1:'H1',h2:'H2',h3:'H3','bullet-list':es?'Viñetas':'Bullet list','ordered-list':es?'Lista numerada':'Numbered list',blockquote:es?'Cita':'Blockquote',toggle:es?'Desplegable':'Toggle'})[kind]}</button>)}</div>}
  {session.widths?<TableWidthSurface session={session} readOnly={controlsReadOnly} className="tiptap-editor relative">{editorContent}</TableWidthSurface>:<div className={isBlocks?"tiptap-editor relative":"relative"}>{editorContent}</div>}
  {saveMode&&<div className="flex flex-wrap items-center gap-2 text-sm text-text-muted"><label className="flex items-center gap-2">{es?'Guardado':'Saving'}<select aria-label={es?'Modo de guardado':'Save mode'} className={button+' bg-elevated'} disabled={readOnly||!modeReady} value={saveMode} onChange={event=>void chooseMode(event.target.value as LocalToolSaveMode).catch(()=>{})}><option value="manual">Manual</option><option value="automatic">{es?'Automático':'Automatic'}</option></select></label>{saveMode==='automatic'&&<span>{es?'Guarda también los cambios recibidos en esta biblioteca.':'Also saves received changes in this library.'}</span>}</div>}
  {preferenceError&&<p role="alert" className="text-sm text-danger">{es?'No se pudo recordar el modo para los próximos documentos. Se mantiene la elección de este editor.':'Could not remember the mode for future documents. This editor keeps your choice.'}</p>}
  {autosaveError&&!session.error&&<p role="alert" className="text-sm text-danger">{es?'El guardado automático se ha detenido. Conservamos el borrador; revisa el error antes de volver a guardar.':'Automatic saving stopped. Your draft is retained; review the error before saving again.'}</p>}
  <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={readOnly||session.busy||!session.dirty||!!session.error||documentSave&&!saveReady} onClick={()=>void commit()}>{sharing?(es?'Guardar en esta biblioteca':'Save to this library'):(es?'Guardar cambios':'Save changes')}</button><button type="button" className={button} disabled={session.undoStep===undefined||readOnly} onClick={()=>session.reverse()}>{es?'Deshacer':'Undo'}</button><button type="button" className={button} disabled={session.redoStep===undefined||readOnly} onClick={()=>session.reverse(true)}>{es?'Rehacer':'Redo'}</button><button type="button" className={button} onClick={discard}>{sharing?(es?'Salir sin guardar aquí':'Leave without saving here'):(es?'Descartar y recargar':'Discard and reload')}</button>{(session.canRetry||!!autosaveError)&&<button type="button" className={button} disabled={readOnly||session.busy} onClick={()=>void retry().catch(()=>{})}>{es?'Reintentar guardado':'Retry save'}</button>}</div>
  <p role={session.error?'alert':'status'} className={session.error?'text-sm text-danger':'text-sm text-text-muted'}>{session.error?session.error.startsWith('local_tool_rich_editor_extension_')?es?'Estas extensiones no son compatibles con los párrafos y formatos de este editor. Conservamos el texto para copiarlo o descartarlo.':'These extensions are incompatible with this editor’s paragraphs and formatting. Your text is retained for copying or discarding.':es?'No se pudo completar el cambio. Conservamos tu borrador para copiarlo o descartarlo.':'The change could not be completed. Your draft is retained for copying or discarding.':session.busy?es?'Guardando…':'Saving…':session.pending||session.needsCompletion?es?'Cambios sin guardar o pendientes de completar.':'Changes are unsaved or awaiting completion.':es?'Cambios guardados. Deshacer vuelve a crear un borrador pendiente.':'Changes saved. Undo creates a new unsaved draft.'}</p>
  {recover&&<label className="block text-sm text-text-muted">{es?'Borrador conservado para copiar':'Retained draft for copying'}<textarea readOnly className="mt-1 block min-h-28 w-full rounded-lg border border-border bg-elevated p-3" value={editor?.getText()??session.document().content.map(p=>p.content.map(t=>t.text).join('')).join('\n')}/></label>}
 </section>;
}

/** Presentation-only selection subscription; legacy surfaces never mount this group. */
function TableControls({session,editor,readOnly,es}:{session:RichEditorSession;editor:Editor|null;readOnly:boolean;es:boolean}){
 const tableId=useEditorState({editor,selector:({editor:current})=>{
  const from=current?.state.selection.$from;if(!from)return null;
  for(let depth=from.depth;depth>0;depth--){const node=from.node(depth);if(node.type.name==='table')return typeof node.attrs.id==='string'?node.attrs.id:null;}
  return null;
 }});
 const cell=useEditorState({editor,selector:({editor:current})=>session.axes&&current?axisCellAtPosition(current.state.doc,current.state.selection.from):null});
 const width=useEditorState({editor,selector:({editor:current})=>{
  if(!session.widths||!current)return null;
  const {doc,selection}=current.state,selected=axisCellAtPosition(doc,selection.from);
  if(!selected)return null;
  for(let depth=selection.$from.depth;depth>0;depth--){
   const node=selection.$from.node(depth);
   if(node.type.name==='table')return (node.attrs.columnLayout as TableColumnLayout[]|null)?.find(column=>column.columnId===selected[2])?.widthPx??null;
  }
  return null;
 }});
 const height=useEditorState({editor,selector:({editor:current})=>{
  if(!session.rowHeights||!current)return null;
  const from=current.state.selection.$from;
  for(let depth=from.depth;depth>0;depth--){
   const node=from.node(depth);
   if(node.type.name==='tableRow')return typeof node.attrs.heightPx==='number'?node.attrs.heightPx:null;
  }
  return null;
 }});
 const axisLabel={rows:{before:es?'Insertar fila antes':'Insert row before',after:es?'Insertar fila después':'Insert row after',hide:es?'Eliminar fila':'Remove row'},columns:{before:es?'Insertar columna antes':'Insert column before',after:es?'Insertar columna después':'Insert column after',hide:es?'Eliminar columna':'Remove column'}};
 const headerRow=session.axes&&tableId?firstTableRow(session,tableId):undefined;
 return <div className="flex flex-wrap gap-2" aria-label={es?'Tabla':'Table'}><button type="button" className={button} disabled={!editor||!session.editable||readOnly||!!tableId} onMouseDown={e=>e.preventDefault()} onClick={()=>{if(editor)insertFixedTable(session,editor.view);}}>{es?'Insertar tabla':'Insert table'}</button>{(['up','down','hide']as const).map(action=><button key={action} type="button" className={button} disabled={!editor||!session.editable||readOnly||!tableId} onMouseDown={e=>e.preventDefault()} onClick={()=>{if(editor)controlFixedTable(session,editor.view,action);}}>{({up:es?'Subir tabla':'Move table up',down:es?'Bajar tabla':'Move table down',hide:es?'Eliminar tabla':'Remove table'})[action]}</button>)}{session.axes&&(['rows','columns']as const).flatMap(axis=>(['before','after','hide']as const).map(action=><button key={axis+action} type="button" className={button} disabled={!editor||!session.editable||readOnly||!cell} onMouseDown={e=>e.preventDefault()} onClick={()=>{if(editor)controlTableAxis(session,editor.view,axis,action);}}>{axisLabel[axis][action]}</button>))}
  {session.axes&&<button type="button" className={button} disabled={!editor||!session.editable||readOnly||!headerRow} aria-pressed={headerRow?.header===true} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(editor)toggleTableHeader(session,editor.view);}}>{es?'Fila de cabecera':'Header row'}</button>}
  {session.rowHeights&&cell&&session.editable&&!readOnly&&<TableHeightControls key={cell[1]} session={session} rowId={cell[1]} current={height??null} es={es} button={button}/>}
  {session.widths&&cell&&session.editable&&!readOnly&&<TableWidthControls key={JSON.stringify([cell[0],cell[2]])} session={session} tableId={cell[0]} columnId={cell[2]} current={width??null} es={es} button={button}/>}
 </div>;
}
