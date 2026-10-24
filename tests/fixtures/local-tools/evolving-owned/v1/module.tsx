/* eslint-disable react-refresh/only-export-components -- Source packages export a definition, not a React refresh boundary. */
import {useEffect,useState} from 'react';
import {defineLocalTool,defineLocalToolBlock,type LocalToolClient,type LocalToolJson,type LocalToolProps,type LocalToolSnapshot} from '@/engines/local/sdk';
type Notes={notes:string};
const initialState:Notes={notes:'Kept prose'};
const codec={version:1 as const,fields:{notes:{kind:'prose' as const}}};
const preview={version:1 as const,fields:[{key:'notes',label:{en:'Notes',es:'Notas'}}]};
const validateState=(value:LocalToolJson):value is Notes=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string';
const button='min-h-9 rounded-lg border border-border px-3 py-2 text-sm text-text-primary disabled:opacity-50';
function useNotebook(client:LocalToolClient<Notes>){
 const [snapshot,setSnapshot]=useState<LocalToolSnapshot<Notes>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[undo,setUndo]=useState<string[]>([]),[redo,setRedo]=useState<string[]>([]);
 useEffect(()=>{let live=true;const reload=()=>void client.read().then(row=>{if(live)setSnapshot(row);}).catch(()=>{if(live)setError('Could not open this notebook.');});reload();const off=client.subscribe?.(reload);return()=>{live=false;off?.();};},[client]);
 const append=async()=>{if(!snapshot||!client.state||busy)return;setBusy(true);setError('');try{const result=await client.state.apply(snapshot,[{type:'set',field:'notes',value:snapshot.data.notes+' Updated.'}]);setSnapshot(result.snapshot);if(result.receiptId){setUndo(ids=>[...ids,result.receiptId!]);setRedo([]);}}catch{setError('Could not save. Reload and try again.');}finally{setBusy(false);}};
 const reverse=async(mode:'undo'|'redo')=>{const ids=mode==='undo'?undo:redo,id=ids.at(-1);if(!id||!client.state||busy)return;setBusy(true);setError('');try{const result=await client.state[mode](id);setSnapshot(result.snapshot);if(mode==='undo'){setUndo(list=>list.slice(0,-1));if(result.receiptId)setRedo(list=>[...list,result.receiptId!]);}else{setRedo(list=>list.slice(0,-1));if(result.receiptId)setUndo(list=>[...list,result.receiptId!]);}}catch{setError('This change can no longer be undone.');}finally{setBusy(false);}};
 return{snapshot,error,busy,append,reverse,undo,redo};
}
function Notebook({client}:LocalToolProps<Notes>){const state=useNotebook(client);return <section className="space-y-3 text-text-primary"><h4 className="font-display text-lg">Evolving notebook</h4><p>{state.snapshot?.data.notes??'Opening notebook...'}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={!state.snapshot||state.busy} onClick={()=>void state.append()}>Append a note</button><button className={button} disabled={!state.undo.length||state.busy} onClick={()=>void state.reverse('undo')}>Undo notebook change</button><button className={button} disabled={!state.redo.length||state.busy} onClick={()=>void state.reverse('redo')}>Redo notebook change</button></div>{state.error&&<p role="alert">{state.error}</p>}</section>;}
// Source state is deliberately identical across releases; only the Owned face evolves.
const owned=defineLocalToolBlock({key:'notebook',scope:'host',name:{en:'Evolving notebook',es:'Cuaderno evolutivo'},initialState,codec,preview,validateState,component:Notebook});
export default defineLocalTool({namespace:'examples.evolving-owned',name:{en:'Evolving notebook',es:'Cuaderno evolutivo'},description:{en:'A versioned local Owned notebook; source notes retain their existing contract.',es:'Cuaderno local versionado; las notas fuente conservan su contrato actual.'},document:{defaultTitle:{en:'Notebook',es:'Cuaderno'},embed:'interactive'},initialState,codec,preview,validateState,component:Notebook,blocks:[owned]});
