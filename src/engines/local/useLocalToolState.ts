import {useLocalToolAtomPending} from './blocks/pending';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {LocalToolClient,LocalToolSnapshot} from './sdk';
import type {LocalToolJson} from './stateTypes';
import type {LocalToolStateAction} from './stateActions';
export function useLocalToolState<T extends LocalToolJson>(client:LocalToolClient<T>,options:{hasDraft?:boolean;observe?:boolean}={}){
 const [snapshot,setSnapshot]=useState<LocalToolSnapshot<T>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[undo,setUndo]=useState<string[]>([]),[redo,setRedo]=useState<string[]>([]),working=useRef(false);
 useEffect(()=>{let active=true;setSnapshot(undefined);setUndo([]);setRedo([]);setError('');void client.read().then(value=>{if(active)setSnapshot(value);}).catch(reason=>{if(active)setError(String(reason));});return()=>{active=false;};},[client]);
 useLocalToolAtomPending(!!options.hasDraft||busy);
 const hasDraft=!!options.hasDraft,observe=options.observe===true,draftRef=useRef(hasDraft);useLayoutEffect(()=>{draftRef.current=hasDraft;},[hasDraft]);
 useEffect(()=>{if(!observe)return;let active=true,sequence=0;const unsubscribe=client.subscribe?.(()=>{const requested=++sequence;if(draftRef.current||working.current)return;void client.read().then(value=>{if(active&&requested===sequence&&!draftRef.current&&!working.current)setSnapshot(value);}).catch(reason=>{if(active)setError(String(reason));});});return()=>{active=false;unsubscribe?.();};},[client,observe]);
 const run=async(action:()=>Promise<void>)=>{if(working.current)return false;working.current=true;setBusy(true);setError('');try{await action();return true;}catch(reason){setError(reason instanceof Error?reason.message:String(reason));return false;}finally{working.current=false;setBusy(false);}};
 return{snapshot,error,busy,canUndo:!!undo.length,canRedo:!!redo.length,reload:()=>run(async()=>{setSnapshot(await client.read());}),apply:(actions:readonly LocalToolStateAction[])=>run(async()=>{if(!snapshot||!client.state)throw Error('local_tool_codec_required');const result=await client.state.apply(snapshot,actions);setSnapshot(result.snapshot);if(result.receiptId)setUndo(rows=>[...rows,result.receiptId!]);setRedo([]);}),undo:()=>run(async()=>{if(!client.state||!undo.length)return;const result=await client.state.undo(undo[undo.length-1]);setSnapshot(result.snapshot);setUndo(rows=>rows.slice(0,-1));if(result.receiptId)setRedo(rows=>[...rows,result.receiptId!]);}),redo:()=>run(async()=>{if(!client.state||!redo.length)return;const result=await client.state.redo(redo[redo.length-1]);setSnapshot(result.snapshot);setRedo(rows=>rows.slice(0,-1));if(result.receiptId)setUndo(rows=>[...rows,result.receiptId!]);})};
}
