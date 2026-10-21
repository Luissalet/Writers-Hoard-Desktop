import { useMemo,useRef,useState } from 'react';
import { Pencil,Highlighter,Eraser,Undo2,Check } from 'lucide-react';
import type { PanelProps } from './StatsPanel';
import { applySheetInk,type SheetInkStroke } from './ink';
import { sheetPaper } from './paper';
import { strokeOutline,type StrokePoint } from '@/engines/board/freehand';
import { button } from './uiStyles';

export default function SheetPaper({sheet,locale,update}:PanelProps){
  const es=locale==='es',paper=useMemo(()=>sheetPaper(sheet,locale),[sheet,locale]);
  const [editing,setEditing]=useState(false),[tool,setTool]=useState<SheetInkStroke['tool']>('pen'),[color,setColor]=useState('#272b2b'),[width,setWidth]=useState(3),[preview,setPreview]=useState<StrokePoint[]>([]);
  const session=useRef<{id:number;points:StrokePoint[]}|null>(null);
  const pressure=(event:{pressure:number;pointerType:string})=>event.pointerType==='pen'?Math.max(0,Math.min(1,event.pressure)):undefined;
  const point=(event:{clientX:number;clientY:number;pressure:number;pointerType:string},svg:SVGSVGElement)=>{const bounds=svg.getBoundingClientRect();return{x:Math.max(0,Math.min(1000,(event.clientX-bounds.left)*1000/bounds.width)),y:Math.max(0,Math.min(paper.height,(event.clientY-bounds.top)*1000/bounds.width)),pressure:pressure(event)};};
  const undo=()=>update(current=>applySheetInk(current,{kind:'undo'}));
  return <section className="space-y-3" data-testid="sheet-paper-view">
    {sheet.preset==='5e-stat-block'&&<label className="flex flex-wrap items-center gap-2 text-sm text-text-muted">{es?'Diseño del papel':'Paper layout'}<select className={button} aria-label={es?'Diseño del papel':'Paper layout'} value={sheet.paperLayout??'record'} onChange={event=>{const paperLayout=event.target.value as 'record'|'stat-block';update(current=>({...current,paperLayout}));}}><option value="record">{es?'Registro completo':'Complete record'}</option><option value="stat-block">{es?'Bloque de estadísticas':'Stat block'}</option></select><span className="max-w-prose text-xs">{es?'El cambio se guarda con la ficha. La tinta conserva sus coordenadas; vuelve al registro para recuperar su distribución anterior.':'Save the sheet to keep this choice. Ink keeps its coordinates; return to the record to recover its previous layout.'}</span></label>}
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={es?'Tinta de ficha':'Sheet ink'}>
      <button type="button" className={button} aria-pressed={editing} onClick={()=>setEditing(value=>!value)}>{editing?<Check size={15}/>:<Pencil size={15}/>} {editing?(es?'Terminar':'Done'):(es?'Dibujar':'Draw')}</button>
      {editing&&<>{([{id:'pen',Icon:Pencil,label:es?'Lápiz':'Pen'},{id:'marker',Icon:Highlighter,label:es?'Marcador':'Marker'},{id:'eraser',Icon:Eraser,label:es?'Borrar':'Erase'}] as const).map(({id,Icon,label})=><button key={id} type="button" className={`${button} aria-pressed:border-accent-gold aria-pressed:bg-accent-gold/15 aria-pressed:text-accent-gold`} aria-pressed={tool===id} onClick={()=>setTool(id)}><Icon size={15}/>{label}</button>)}<label className="flex items-center gap-2 text-sm text-text-muted">{es?'Color':'Color'}<input type="color" value={color} onChange={event=>setColor(event.target.value)} aria-label={es?'Color de tinta':'Ink color'}/></label><label className="flex items-center gap-2 text-sm text-text-muted">{es?'Anchura':'Width'}<input type="range" min="1" max="24" value={width} onChange={event=>setWidth(Number(event.target.value))} aria-label={es?'Anchura de tinta':'Ink width'}/>{width}</label></>}
      <button type="button" className={button} disabled={!sheet.ink?.strokes.length} onClick={undo}><Undo2 size={15}/>{es?'Deshacer tinta':'Undo ink'}</button>
    </div>
    <p className="max-w-prose text-sm text-text-muted">{es?'La tinta conserva su posición en el papel al cambiar la anchura de ventana. Al editar el contenido, el texto puede moverse bajo los trazos. Guarda la ficha para conservarlos.':'Ink keeps its paper position when the window width changes. Editing content can move text beneath the marks. Save the sheet to keep them.'}</p>
    <div className="relative w-full rounded-lg border border-border" data-testid="sheet-paper-surface">
      <div dangerouslySetInnerHTML={{__html:paper.svg}}/>
      {editing&&<svg className="absolute inset-0 h-full w-full" viewBox={`0 0 1000 ${paper.height}`} style={{touchAction:'none',cursor:'crosshair'}} tabIndex={0} aria-label={es?'Dibujar sobre el papel':'Draw on paper'} data-testid="sheet-ink-canvas"
        onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();undo();}}}
        onPointerDown={event=>{if(event.button!==0||event.currentTarget.closest('fieldset')?.disabled)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Synthetic pen events have no native capture. */}const points=[point(event,event.currentTarget)];session.current={id:event.pointerId,points};setPreview(points);}}
        onPointerMove={event=>{const current=session.current;if(!current||current.id!==event.pointerId)return;event.preventDefault();const samples=event.nativeEvent.getCoalescedEvents?.()??[];for(const sample of samples.length?samples:[event])current.points.push(point(sample,event.currentTarget));setPreview([...current.points]);}}
        onPointerCancel={()=>{session.current=null;setPreview([]);}}
        onPointerUp={event=>{const current=session.current;if(!current||current.id!==event.pointerId)return;event.preventDefault();const last=point(event,event.currentTarget);last.pressure=current.points.at(-1)?.pressure;current.points.push(last);session.current=null;setPreview([]);try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Platform may release first. */}const stroke:SheetInkStroke={id:crypto.randomUUID(),tool,color,width,points:current.points};update(value=>applySheetInk(value,{kind:'stroke',stroke}));}}>
        {preview.length>0&&<path d={strokeOutline(preview,width)} fill={tool==='eraser'?'#c4463a':color} fillOpacity={tool==='eraser'?.25:tool==='marker'?.32:1} pointerEvents="none"/>}
      </svg>}
    </div>
  </section>;
}
