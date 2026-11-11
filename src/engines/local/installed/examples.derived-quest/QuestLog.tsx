import {useState} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import type {LocalToolProps} from '../../sdk';
import {useLocalToolState} from '../../useLocalToolState';
import type {Quest} from './module';

const button='min-h-9 rounded-lg border border-border px-3 text-sm hover:bg-elevated disabled:opacity-50';
const field='min-h-9 w-full rounded-lg border border-border bg-elevated px-3 text-sm';
export default function QuestLog({client,context}:LocalToolProps<Quest>){
 const es=useTranslation().locale==='es', [title,setTitle]=useState<string>(),[newObjective,setNewObjective]=useState('');
 const state=useLocalToolState(client,{observe:true,hasDraft:title!==undefined||!!newObjective});
 const data=state.snapshot?.data;
 const writable=!!data&&!state.busy&&context?.canEdit!==false;
 return <section aria-label={es?'Cuaderno de encargos':'Quest log'} className="space-y-4 p-4">
   <form className="flex items-end gap-2" onSubmit={event=>{event.preventDefault();if(title!==undefined&&writable)void state.apply([{type:'set',field:'title',value:title}]).then(saved=>{if(saved)setTitle(undefined);});}}>
    <label className="min-w-0 flex-1 text-sm">{es?'Nombre del encargo':'Quest name'}<input className={field} value={title??data?.title??''} onChange={event=>setTitle(event.target.value)} disabled={!writable}/></label>
    <button className={button} disabled={!writable||title===undefined}>{es?'Guardar nombre':'Save name'}</button>
   </form>
   <p aria-live="polite">{es?'Puntuación':'Score'}: {data?.score??0} · {data?.ready?(es?'Preparado':'Ready'):(es?'Por preparar':'Not ready')}</p>
   <h3 className="font-medium">{es?'Objetivos':'Objectives'}</h3>
   <ul className="space-y-2">{data?.objectives.map(item=><li key={item.id} className="flex items-center gap-2">
    <label className="mr-auto flex items-center gap-2"><input type="checkbox" checked={item.done} disabled={!writable} onChange={event=>void state.apply([{type:'list-update',field:'objectives',id:item.id,item:{...item,done:event.target.checked}}])}/>{item.text}</label>
    <button type="button" className={button} disabled={!writable} aria-label={(es?'Quitar ':'Remove ')+item.text} onClick={()=>void state.apply([{type:'list-delete',field:'objectives',id:item.id}])}>{es?'Quitar':'Remove'}</button>
   </li>)}</ul>
   <form className="flex items-end gap-2" onSubmit={event=>{event.preventDefault();if(!writable||!data||!newObjective.trim())return;void state.apply([{type:'list-insert',field:'objectives',afterId:data.objectives.at(-1)?.id??null,item:{id:crypto.randomUUID(),text:newObjective.trim(),done:false}}]).then(saved=>{if(saved)setNewObjective('');});}}>
    <label className="min-w-0 flex-1 text-sm">{es?'Nuevo objetivo':'New objective'}<input className={field} value={newObjective} onChange={event=>setNewObjective(event.target.value)} disabled={!writable}/></label>
    <button className={button} disabled={!writable||!newObjective.trim()}>{es?'Añadir objetivo':'Add objective'}</button>
   </form>
   <h3 className="font-medium">{es?'Recompensas':'Rewards'}</h3>
   {Object.keys(data?.rewards??{}).length?<dl>{Object.entries(data!.rewards).map(([key,value])=><div key={key} className="flex gap-3"><dt>{key}</dt><dd>{value}</dd></div>)}</dl>:<p className="text-sm text-text-muted">{es?'Todavía no hay recompensas.':'No rewards yet.'}</p>}
   <div className="flex flex-wrap gap-2">
    <button type="button" className={button} disabled={!state.canUndo} onClick={()=>void state.undo()}>{es?'Deshacer':'Undo'}</button>
    <button type="button" className={button} disabled={!state.canRedo} onClick={()=>void state.redo()}>{es?'Rehacer':'Redo'}</button>
    <button type="button" className={button} disabled={title===undefined&&!newObjective} onClick={()=>{setTitle(undefined);setNewObjective('');}}>{es?'Descartar borrador':'Discard draft'}</button>
   </div>
   {state.error&&<p role="alert" className="text-sm text-danger">{es?'No se guardó el cambio.':'The change was not saved.'}</p>}
  </section>;
}
