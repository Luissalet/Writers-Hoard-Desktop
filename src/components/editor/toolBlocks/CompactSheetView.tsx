import { useEffect, useId, useRef, useState } from 'react';
import CocSummaryCard from '@/engines/character-sheets/CocSummaryCard';
import type { CocSummary } from '@/engines/character-sheets/cocSummary';
import { undoSheetChange } from '@/engines/character-sheets/sheetUndo';
import { useLocalToolAtomPending } from '@/engines/local/blocks/pending';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { flushPendingWrites, registerPendingFlusher } from '@/services/pendingWrites';

/** Only editable live hosts supply canWrite; reader/export use the callback-free card. */
export default function CompactSheetView({ summary, projectId, eraId, locale, canWrite }: { summary: CocSummary; projectId: string; eraId?: string; locale: 'es'|'en'; canWrite?: () => boolean }) {
  const [difficulty,setDifficulty]=useState<'regular'|'hard'|'extreme'>('regular'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<string>(),[status,setStatus]=useState('');
  const mounted=useRef(true),active=useRef(false),owner=useId(),current=useRef(canWrite);current.current=canWrite;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLocalToolAtomPending(busy);
  const es=locale==='es';
  const perform=async(subjectId?:string)=>{
    if(active.current||!current.current?.())return;
    active.current=true;setBusy(true);setError('');
    try{
      const flushed=await flushPendingWrites();
      if(!mounted.current||!current.current?.())return;
      if(!flushed.ok)throw Error(es?'Guarda o resuelve los cambios pendientes antes de tirar.':'Save or resolve pending changes before rolling.');
      const work=(async()=>{
        if(subjectId){
          const reply=await runBridgeTool('wh_sheet_coc_action',{projectId,eraId,sheetId:summary.id,revision:summary.revision,action:'roll',subjectId,difficulty});
          if(!reply.ok)throw Error(reply.error??reply.code);
          const result=reply.result as {sheet:{rolls:{label:string;total:number;outcome:string}[]};__audit?:{before?:{__sheetReceipt?:string}}};
          if(mounted.current){setReceipt(result.__audit?.before?.__sheetReceipt);const roll=result.sheet.rolls[0];setStatus(roll?`${roll.label}: ${roll.total} · ${roll.outcome}`:'');}
        }else if(receipt){
          await undoSheetChange({projectId,eraId},receipt);
          if(mounted.current){setReceipt(undefined);setStatus(es?'Tirada deshecha.':'Roll undone.');}
        }
      })();
      // Navigation/host save waits for the same native write, without retrying random dice.
      const unregister=registerPendingFlusher(owner,()=>work.then(()=>true,()=>false));
      try{await work;}finally{unregister();}
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:String(reason));}
    finally{active.current=false;if(mounted.current)setBusy(false);}
  };
  return <div aria-busy={busy} data-compact-sheet-view>
    {canWrite&&<div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-text-primary"><label>{es?'Dificultad':'Difficulty'} <select aria-label={es?'Dificultad del resumen':'Summary difficulty'} disabled={busy} value={difficulty} onChange={event=>setDifficulty(event.target.value as typeof difficulty)} className="min-h-9 rounded border border-border bg-deep px-2"><option value="regular">{es?'Normal':'Regular'}</option><option value="hard">{es?'Difícil':'Hard'}</option><option value="extreme">{es?'Extrema':'Extreme'}</option></select></label>{receipt&&<button type="button" disabled={busy} className="min-h-9 rounded border border-border px-3" onClick={()=>{void perform();}}>{es?'Deshacer tirada':'Undo roll'}</button>}</div>}
    <CocSummaryCard summary={summary} locale={locale} onRoll={canWrite&&!busy?subjectId=>{void perform(subjectId);}:undefined}/>
    {status&&<p role="status" className="mt-2 text-sm text-text-primary">{status}</p>}{error&&<p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </div>;
}
