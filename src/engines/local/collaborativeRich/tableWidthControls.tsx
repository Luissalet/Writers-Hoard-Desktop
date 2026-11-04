import {useEffect,useId,useLayoutEffect,useRef,type ReactNode,type PointerEvent as ReactPointerEvent} from 'react';
import {convergenceCanonical} from '../convergence/format';
import {MIN_TABLE_COLUMN_WIDTH,MIN_TABLE_ROW_HEIGHT,validTableColumnWidth,validTableRowHeight} from '../convergence/tableAxesFormat';
import type {RichBlockEditCapture} from '../convergence/blockEditingTypes';
import type {RichTableColumnWidthCapture} from '../convergence/tableAxesEditing';
import type {RichEditorSession} from './session';
import {tableWidthStyle} from './tableAxesLayout';
import './tableWidths.css';

type DragBase={pointerId:number;startPx:number;table:HTMLTableElement};
type Drag=DragBase&({axis:'column';start:number;capture:RichTableColumnWidthCapture}|{axis:'row';start:number;capture:RichBlockEditCapture;tableId:string;rowId:string});
const pointerSize=(drag:Drag,event:PointerEvent)=>Math.max(drag.axis==='column'?MIN_TABLE_COLUMN_WIDTH:MIN_TABLE_ROW_HEIGHT,
 Math.round(drag.startPx+(drag.axis==='column'?event.clientX:event.clientY)-drag.start));
const columnTarget=({identity,field,tableId,columnId,table,column,birth,widthPx}:RichTableColumnWidthCapture)=>
 convergenceCanonical([identity,field,tableId,columnId,table,column,birth,widthPx]);
function rowTarget(capture:RichBlockEditCapture,rowId:string){
 const binding=capture.bindings.find(item=>item.id===rowId);
 if(!binding)return null;
 const {kindVersionId,membershipVersionId,placementVersionId,rowHeightVersionId}=binding;
 return convergenceCanonical([capture.identity,capture.field,rowId,kindVersionId,membershipVersionId,placementVersionId,rowHeightVersionId??null]);
}
function applyHeight(session:RichEditorSession,capture:RichBlockEditCapture,heightPx:number|null){
 if(!session.editable)return;
 try{session.applyBatch([{type:'rich-table-row-height',field:session.field,capture,heightPx}]);}
 catch(reason){session.fail(reason,true);}
}
function applyWidth(session:RichEditorSession,capture:RichTableColumnWidthCapture,widthPx:number|null){
 if(!session.editable||capture.widthPx===widthPx)return;
 try{session.applyBatch([{type:'rich-table-column-width',field:session.field,capture,widthPx}]);}
 catch(reason){session.fail(reason,true);}
}

/** A private style sheet paints the preview without mutating ProseMirror's observed DOM. */
function useTableWidthDrag(session:RichEditorSession,enabled:boolean){
 const id=useId(),sheet=useRef<HTMLStyleElement>(null),drag=useRef<Drag|undefined>(undefined);
 useEffect(()=>{
  if(!enabled)return;
  const preview=sheet.current;
  const cancel=()=>{drag.current=undefined;if(preview)preview.textContent='';};
  const current=()=>{
   const active=drag.current;
   if(!active)return undefined;
   try{
    if(!session.editable||!active.table.isConnected){cancel();return undefined;}
    const unchanged=active.axis==='row'?
     rowTarget(active.capture,active.rowId)===rowTarget(session.replica.richBlockEditCapture(session.field,[active.rowId]),active.rowId):
     columnTarget(active.capture)===columnTarget(session.replica.richTableColumnWidthCapture(session.field,active.capture.tableId,active.capture.columnId));
    if(!unchanged){cancel();return undefined;}
    return active;
   }catch{cancel();return undefined;}
  };
  const move=(event:PointerEvent)=>{
   const active=drag.current;if(!active||event.pointerId!==active.pointerId||!preview)return;
   if(!active.table.isConnected){cancel();return;}
   const size=pointerSize(active,event);
   if(active.axis==='row'){
    if(!validTableRowHeight(size))return;
    const tableSelector=`#${CSS.escape(id)} table[data-writer-block=${CSS.escape(active.tableId)}]`;
    preview.textContent=`${tableSelector} tr[data-writer-block=${CSS.escape(active.rowId)}]{height:${size}px!important}`;
    event.preventDefault();
    return;
   }
   const width=size;
   if(!validTableColumnWidth(width))return;
   const columns=[...active.table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')].map(col=>{
    const columnId=col.getAttribute('data-writer-column')!;
    return {columnId,widthPx:columnId===active.capture.columnId?width:parseFloat(col.style.width)||null};
   });
   const style=tableWidthStyle(columns);
   if(!style)return;
   const target=`#${CSS.escape(id)} table[data-writer-block=${CSS.escape(active.capture.tableId)}]`;
   preview.textContent=`${target}{width:${style.width}!important;min-width:${style.minWidth??'0'}!important}${target} col[data-writer-column=${CSS.escape(active.capture.columnId)}]{width:${width}px!important}`;
   event.preventDefault();
  };
  const up=(event:PointerEvent)=>{
   if(drag.current?.pointerId!==event.pointerId)return;
   const active=current();cancel();
   if(!active)return;
   const size=pointerSize(active,event);
   if(size===active.startPx)return;
   if(active.axis==='row'){if(validTableRowHeight(size))applyHeight(session,active.capture,size);}
   else if(validTableColumnWidth(size))applyWidth(session,active.capture,size);
  };
  const pointerCancel=(event:PointerEvent)=>{if(event.pointerId===drag.current?.pointerId)cancel();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&drag.current){event.preventDefault();cancel();}};
  const unsubscribe=session.subscribeState(()=>{current();});
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',pointerCancel);
  window.addEventListener('blur',cancel);
  window.addEventListener('keydown',escape);
  return()=>{
   cancel();unsubscribe();
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',pointerCancel);
   window.removeEventListener('blur',cancel);
   window.removeEventListener('keydown',escape);
  };
 },[enabled,id,session]);
 const onPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(!enabled||!session.editable||!event.isPrimary||event.button!==0||drag.current||!(event.target instanceof Element))return;
  const cell=event.target.closest<HTMLTableCellElement>('td[data-writer-cell-address],th[data-writer-cell-address]');
  const table=cell?.closest<HTMLTableElement>('table[data-writer-column-widths]');
  if(!cell||!table||!event.currentTarget.contains(table))return;
  const bounds=cell.getBoundingClientRect();
  const atColumnEdge=event.clientX>=bounds.right-7&&event.clientX<=bounds.right+1;
  const atRowEdge=session.rowHeights&&!atColumnEdge&&event.clientY>=bounds.bottom-6&&event.clientY<=bounds.bottom;
  if(!atColumnEdge&&!atRowEdge)return;
  try{
   const [tableId,rowId,columnId]=JSON.parse(cell.getAttribute('data-writer-cell-address')!) as [string,string,string];
   const pointerId=event.pointerId;
   if(atRowEdge){
    const capture=session.replica.richBlockEditCapture(session.field,[rowId]);
    drag.current={axis:'row',pointerId,start:event.clientY,startPx:Math.max(MIN_TABLE_ROW_HEIGHT,Math.round(bounds.height)),table,tableId,rowId,capture};
   }else{
    const capture=session.replica.richTableColumnWidthCapture(session.field,tableId,columnId);
    drag.current={axis:'column',pointerId,start:event.clientX,startPx:Math.max(MIN_TABLE_COLUMN_WIDTH,Math.round(bounds.width)),table,capture};
   }
   event.preventDefault();
   event.stopPropagation();
  }catch{/* The visible column may have been withdrawn before this event. */}
 };
 return {id,sheet,onPointerDown};
}

export function TableWidthSurface({session,readOnly,className,children}:{session:RichEditorSession;readOnly:boolean;className:string;children:ReactNode}){
 const {id,sheet,onPointerDown}=useTableWidthDrag(session,!readOnly&&session.widths);
 return <div className={className} id={id} data-writer-width-surface={readOnly?undefined:''} data-writer-height-surface={readOnly||!session.rowHeights?undefined:''} onPointerDownCapture={onPointerDown}>
  <style ref={sheet}/>
  {children}
 </div>;
}

export function TableWidthControls({session,tableId,columnId,current,es,button}:{session:RichEditorSession;tableId:string;columnId:string;current:number|null;es:boolean;button:string}){
 const input=useRef<HTMLInputElement>(null);
 useLayoutEffect(()=>{if(input.current)input.current.value=current===null?'':String(current);},[current]);
 const submit=(width:number|null)=>{
  let capture;
  try{capture=session.replica.richTableColumnWidthCapture(session.field,tableId,columnId);}
  catch{return;}
  applyWidth(session,capture,width);
 };
 return <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();const width=input.current?.valueAsNumber;if(validTableColumnWidth(width))submit(width);}}>
  <label className="grid gap-1 text-sm text-text-muted">{es?'Ancho de columna (px)':'Column width (px)'}
   <input ref={input} className={button+' w-24 bg-elevated'} type="number" min={MIN_TABLE_COLUMN_WIDTH} step="1" placeholder="Auto" required />
  </label>
  <button type="submit" className={button}>{es?'Aplicar ancho':'Apply width'}</button>
  <button type="button" className={button} disabled={current===null} onClick={()=>submit(null)}>{es?'Ancho automático':'Automatic width'}</button>
 </form>;
}

export function TableHeightControls({session,rowId,current,es,button}:{session:RichEditorSession;rowId:string;current:number|null;es:boolean;button:string}){
 const input=useRef<HTMLInputElement>(null);
 useLayoutEffect(()=>{if(input.current)input.current.value=current===null?'':String(current);},[current]);
 const submit=(height:number|null)=>{
  let capture;
  try{capture=session.replica.richBlockEditCapture(session.field,[rowId]);}
  catch{return;}
  applyHeight(session,capture,height);
 };
 return <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();const height=input.current?.valueAsNumber;if(validTableRowHeight(height))submit(height);}}>
  <label className="grid gap-1 text-sm text-text-muted">{es?'Altura de fila (px)':'Row height (px)'}
   <input ref={input} className={button+' w-24 bg-elevated'} type="number" min={MIN_TABLE_ROW_HEIGHT} step="1" placeholder="Auto" required />
  </label>
  <button type="submit" className={button}>{es?'Aplicar altura':'Apply height'}</button>
  <button type="button" className={button} disabled={current===null} onClick={()=>submit(null)}>{es?'Altura automática':'Automatic height'}</button>
 </form>;
}
