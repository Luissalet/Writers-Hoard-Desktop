import {Node} from '@tiptap/core';
import {NodeViewWrapper,ReactNodeViewRenderer,useEditorState,type Editor} from '@tiptap/react';
import {NodeSelection,TextSelection} from '@tiptap/pm/state';
import type {EditorView} from '@tiptap/pm/view';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {importPortableFigure,findFigureSource} from '../../../services/figureInterchange/retain';
import {FigureImportError} from '../../../services/figureInterchange/index';
import {isRichImageAlignment,isRichImageSize,validateRichImageAsset,type RichImageAlignment,type RichImageAsset,type RichImageSize} from '../convergence/imageFormat';
import type {RichBlockEditingAction} from '../convergence/blockEditingTypes';
import type {RichImageEditAction} from '../convergence/imageEditing';
import type {RichTableAxesAction} from '../convergence/tableAxesEditing';
import {tableCellFragmentId} from '../convergence/tableAxesFormat';
import {axisCellAtPosition} from './blockProsemirror';
import type {RichEditorSession} from './session';
import {RichImage} from './RichImage';
import {MAX_MEDIA_BYTES} from '../../media/types';
import {isCompletePng} from '../../../services/imageMetadata';
import {SOURCE_RASTER_MIMES} from '../../../services/sourceRasterFormat';

const selectedImage=(view:EditorView)=>{const {selection}=view.state;return selection instanceof NodeSelection&&selection.node.type.name==='richImage'?selection:null;};

// The document carries a descriptor. A table clipboard action resolves its bytes explicitly.
// eslint-disable-next-line react-refresh/only-export-components
export function richImageNode(session:RichEditorSession,es:boolean){
 return Node.create({name:'richImage',atom:true,selectable:true,isolating:true,
  addAttributes(){return{id:{default:null,rendered:false},asset:{default:null,rendered:false},displaySize:{default:'medium',rendered:false},...(session.imageAlignment?{alignment:{default:'left',rendered:false}}:{})};},
  renderHTML(){return['figure',{'data-writer-rich-image':''}];},
  addNodeView(){return ReactNodeViewRenderer(({node,selected})=><NodeViewWrapper contentEditable={false} className={selected?'outline outline-2 outline-accent-gold rounded':''}>
   <RichImage assets={session.assets} id={node.attrs.id} asset={node.attrs.asset} displaySize={node.attrs.displaySize} alignment={node.attrs.alignment} es={es} clipboard={session.imageCells}/>
  </NodeViewWrapper>);},
 });
}

function selectBlock(view:EditorView,id:string,atom:boolean){
 let pos:number|undefined;view.state.doc.descendants((node,offset)=>{if(node.attrs.id===id){pos=offset;return false;}});
 if(pos!==undefined)view.dispatch(view.state.tr.setSelection(atom?NodeSelection.create(view.state.doc,pos):TextSelection.create(view.state.doc,pos+1)).setMeta('addToHistory',false).scrollIntoView());
}

function removeImage(session:RichEditorSession,id:string){return session.applyBatch([{type:'rich-block-hide',field:session.field,capture:session.replica.richBlockEditCapture(session.field,[id])}]);}

// eslint-disable-next-line react-refresh/only-export-components
export function richImageKey(session:RichEditorSession,view:EditorView,key:string){
 if(!session.images||!session.editable)return false;
 const image=selectedImage(view);if(!image)return false;
 const afterId=String(image.node.attrs.id);
 if(key==='Backspace'||key==='Delete')return removeImage(session,afterId);
 if(key!=='Enter')return false;
 const id=crypto.randomUUID(),field=session.field;
 const cell=session.imageCells?axisCellAtPosition(view.state.doc,image.from):null;
 const action=cell?{type:'rich-table-cell-insert' as const,field,capture:session.replica.richTableCellCapture(field,...cell,tableCellFragmentId(session.blockDocument(),afterId)),fragment:{id:crypto.randomUUID(),paragraph:{id,text:''}}}:
  {type:'rich-block-insert' as const,field,capture:session.replica.richBlockEditCapture(field,[],{parentId:null,slot:'body' as const,afterId}),block:{id,type:'paragraph' as const,attrs:{}},text:''};
 if(session.applyBatch([action]))selectBlock(view,id,false);
 return true;
}

type FileAction=(asset:RichImageAsset)=>RichBlockEditingAction|RichImageEditAction|Extract<RichTableAxesAction,{type:'rich-table-cell-image-insert'}>;
export function ImageControls({session,editor,readOnly,es,button}:{session:RichEditorSession;editor:Editor|null;readOnly:boolean;es:boolean;button:string}){
 const selected=useEditorState({editor,selector:({editor:current})=>{
  if(!current)return null;
  const image=selectedImage(current.view);if(!image)return null;
  const {id,displaySize,alignment}=image.node.attrs;
  return {id:String(id),size:displaySize as RichImageSize,alignment:isRichImageAlignment(alignment)?alignment:undefined,sha:typeof image.node.attrs.asset?.sha256==='string'?image.node.attrs.asset.sha256 as string:''};
 }});
 const input=useRef<HTMLInputElement>(null),figureInput=useRef<HTMLInputElement>(null),request=useRef<{action:FileAction;assets:NonNullable<RichEditorSession['assets']>;figure?:boolean}|undefined>(undefined),live=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[figureSource,setFigureSource]=useState<{sha:string;text:string}|null>(null);
 const selectedSha=selected?.sha??'',assetsPort=session.assets;
 useEffect(()=>{
  let active=true;
  if(!selectedSha||!assetsPort){void Promise.resolve().then(()=>{if(active)setFigureSource(null);});return()=>{active=false;};}
  void findFigureSource(assetsPort,{sha256:selectedSha}).then(text=>{if(active)setFigureSource(text===null?null:{sha:selectedSha,text});},()=>{if(active)setFigureSource(null);});
  return()=>{active=false;};
 },[selectedSha,assetsPort]);
 const downloadFigure=()=>{
  if(!figureSource||figureSource.sha!==selectedSha)return;
  const url=URL.createObjectURL(new Blob([figureSource.text],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=`figure-${selectedSha.slice(0,12)}.vfigure`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
 };
 useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;request.current=undefined;};},[session,editor]);
 const disabled=!editor||readOnly||!session.editable||!session.assets||busy;
 const failure=()=>setError(session.imageRaster
  ?(es?'No se pudo usar la imagen. Elige un PNG, JPEG o WebP válido.':'Could not use the image. Choose a valid PNG, JPEG or WebP.')
  :(es?'No se pudo usar el PNG. Comprueba el archivo y vuelve a intentarlo.':'Could not use the PNG. Check the file and try again.'));
 const choose=(replace:boolean,figure=false)=>{
  if(disabled||!editor||!session.assets)return;
  const {field,replica,assets}=session,view=editor.view;
  try{
   let action:FileAction;
   if(replace){const image=selectedImage(view);if(!image)return;const capture=replica.richImageCapture(field,String(image.node.attrs.id),'source');action=asset=>({type:'rich-image-replace',field,capture,asset});}
   else{
    const {$from,$to}=view.state.selection,id=crypto.randomUUID();
    const cell=session.imageCells?axisCellAtPosition(view.state.doc,$from.pos):null;
    if(session.imageCells&&JSON.stringify(cell)!==JSON.stringify(axisCellAtPosition(view.state.doc,$to.pos))&&!(view.state.selection instanceof NodeSelection))throw Error('local_tool_image_cell_selection');
    if(cell){
     const target=selectedImage(view)?.node.attrs.id??$from.parent.attrs.id;
     const afterId=typeof target==='string'?tableCellFragmentId(session.blockDocument(),target):null;
     const capture=replica.richTableCellCapture(field,...cell,afterId),fragmentId=crypto.randomUUID();
     action=asset=>({type:'rich-table-cell-image-insert',field,id,fragmentId,capture,asset});
    }else{
     const root=$from.depth?$from.node(1):$from.nodeAfter,afterId=typeof root?.attrs.id==='string'?root.attrs.id:null;
     const capture=replica.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId});action=asset=>({type:'rich-image-insert',field,id,capture,asset});
    }
   }
   request.current={action,assets,figure};setError('');(figure?figureInput:input).current?.click();
  }catch{failure();}
 };
 const importFile=async(file:File|undefined)=>{
  const pending=request.current;request.current=undefined;
  if(!file||!pending||!editor||!session.editable||session.assets!==pending.assets)return;
  setBusy(true);
  try{
   if(pending.figure){
    let asset:RichImageAsset;
    try{asset=(await importPortableFigure(pending.assets,await file.text())).asset;}
    catch(cause){if(live.current)setError(cause instanceof FigureImportError?cause.message:es?'No se pudo usar la figura.':'Could not use the figure.');return;}
    validateRichImageAsset(asset,session.imageRaster);
    if(!live.current||editor.isDestroyed||!session.editable||session.assets!==pending.assets)return;
    const action=pending.action(asset);if(!session.applyBatch([action])){failure();return;}
    if(action.type==='rich-image-insert'||action.type==='rich-table-cell-image-insert')selectBlock(editor.view,action.id,true);
    return;
   }
   if(!session.imageRaster){
    const declared=file.type.trim().toLowerCase();
    if(declared?declared!=='image/png':file.size>MAX_MEDIA_BYTES||!isCompletePng(new Uint8Array(await file.arrayBuffer()))){failure();return;}
    if(!live.current||editor.isDestroyed||!session.editable||session.assets!==pending.assets)return;
   }
   const {sha256,mime,size}=await pending.assets.import(file,'image'),asset={sha256,mime,size};validateRichImageAsset(asset,session.imageRaster);
   if(!live.current||editor.isDestroyed||!session.editable||session.assets!==pending.assets)return;
   const action=pending.action(asset);if(!session.applyBatch([action])){failure();return;}
   if(action.type==='rich-image-insert'||action.type==='rich-table-cell-image-insert')selectBlock(editor.view,action.id,true);
  }catch{if(live.current)failure();}finally{if(live.current)setBusy(false);}
 };
 const control=(size?:RichImageSize)=>{
  if(!selected||disabled)return;setError('');
  try{if(size){if(!isRichImageSize(size))return;const {field,replica}=session;session.applyBatch([{type:'rich-image-resize',field,capture:replica.richImageCapture(field,selected.id,'size'),displaySize:size}]);}else removeImage(session,selected.id);}catch{failure();}
 };
 const align=(alignment:RichImageAlignment)=>{
  if(!selected||disabled||selected.alignment===alignment)return;
  setError('');
  try {
   const {field,replica}=session;
   const capture=replica.richImageCapture(field,selected.id,'alignment');
   if(session.applyBatch([{type:'rich-image-align',field,capture,alignment}]))return;
  } catch { /* Keep the current selection and show a recoverable control error. */ }
  setError(es?'No se pudo cambiar la alineación.':'Could not change the alignment.');
 };
 const alignmentLabel=es?{left:'Alinear imagen a la izquierda',center:'Centrar imagen',right:'Alinear imagen a la derecha'}:{left:'Align image left',center:'Center image',right:'Align image right'};
 return <div className="flex flex-wrap gap-2" aria-label={es?'Imagen':'Image'}>
  <input ref={input} hidden type="file" accept={session.imageRaster?[...SOURCE_RASTER_MIMES,'.png','.jpg','.jpeg','.webp'].join(','):'image/png,.png'} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void importFile(file);}}/>
  <button type="button" className={button} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(false)}>{session.imageRaster?(es?'Insertar imagen':'Insert image'):(es?'Insertar imagen PNG':'Insert PNG image')}</button>
  <input ref={figureInput} hidden type="file" accept=".vfigure,.json,application/json" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void importFile(file);}}/>
  <button type="button" className={button} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(false,true)}>{es?'Insertar figura de diagrama':'Insert diagram figure'}</button>
  {selected&&<><button type="button" className={button} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(true)}>{es?'Reemplazar imagen':'Replace image'}</button>
   {figureSource?.sha===selectedSha&&<><button type="button" className={button} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(true,true)}>{es?'Actualizar figura':'Update figure'}</button>
    <button type="button" className={button} onMouseDown={event=>event.preventDefault()} onClick={downloadFigure}>{es?'Descargar fuente de la figura':'Download figure source'}</button></>}
   {(['small','medium','full'] as const).map(size=><button key={size} type="button" className={button} disabled={disabled} aria-pressed={selected.size===size} onMouseDown={event=>event.preventDefault()} onClick={()=>control(size)}>{({small:es?'Pequeña':'Small',medium:es?'Mediana':'Medium',full:es?'Ancho completo':'Full width'})[size]}</button>)}
   {session.imageAlignment&&<div role="group" aria-label={es?'Alineación de imagen':'Image alignment'} className="flex flex-wrap gap-2">
    {(['left','center','right'] as const).map(alignment=><button key={alignment} type="button" className={button} disabled={disabled} aria-pressed={selected.alignment===alignment} onMouseDown={event=>event.preventDefault()} onClick={()=>align(alignment)}>{alignmentLabel[alignment]}</button>)}
   </div>}
   <button type="button" className={button} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>control()}>{es?'Eliminar imagen':'Remove image'}</button></>}
  {busy&&<span role="status">{es?'Importando imagen…':'Importing image…'}</span>}{error&&<span role="alert" className="text-sm text-danger">{error}</span>}
 </div>;
}
