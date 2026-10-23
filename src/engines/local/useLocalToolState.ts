import {useLocalToolAtomPending} from './blocks/pending';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {LocalToolClient,LocalToolSnapshot} from './sdk';
import type {LocalToolJson} from './stateTypes';
import type {LocalToolStateAction} from './stateActions';
import {nextLocalToolUndoStep,useLocalToolUndoController} from './stateUndoContext';
interface HistoryStep {id:string;step:number}
export function useLocalToolState<T extends LocalToolJson>(client:LocalToolClient<T>,options:{hasDraft?:boolean;observe?:boolean}={}){
 const [snapshot,setSnapshot]=useState<LocalToolSnapshot<T>>(),[loadedClient,setLoadedClient]=useState<LocalToolClient<T>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[undo,setUndo]=useState<HistoryStep[]>([]),[redo,setRedo]=useState<HistoryStep[]>([]),working=useRef(false);
 const binding=useRef<{client:LocalToolClient<T>;active:boolean}>(undefined);
 useLayoutEffect(()=>{
  const owner={client,active:true};binding.current=owner;working.current=false;setBusy(false);
  return()=>{owner.active=false;};
 },[client]);
 useEffect(()=>{
  let active=true;const owner=binding.current;
  setSnapshot(undefined);setLoadedClient(undefined);setUndo([]);setRedo([]);setError('');
  void client.read().then(value=>{if(active&&owner?.active&&binding.current===owner){setSnapshot(value);setLoadedClient(client);}}).catch(reason=>{if(active&&owner?.active&&binding.current===owner)setError(String(reason));});
  return()=>{active=false;};
 },[client]);
 useLocalToolAtomPending(!!options.hasDraft||busy);
 const hasDraft=!!options.hasDraft,observe=options.observe===true,draftRef=useRef(hasDraft);
 useLayoutEffect(()=>{draftRef.current=hasDraft;},[hasDraft]);
 useEffect(()=>{
  if(!observe)return;
  let active=true,sequence=0;const owner=binding.current;
  const current=()=>active&&owner?.active&&binding.current===owner;
  const unsubscribe=client.subscribe?.(()=>{
   const requested=++sequence;if(!current()||draftRef.current||working.current)return;
   void client.read().then(value=>{if(current()&&requested===sequence&&!draftRef.current&&!working.current)setSnapshot(value);}).catch(reason=>{if(current())setError(String(reason));});
  });
  return()=>{active=false;unsubscribe?.();};
 },[client,observe]);
 const run=async(action:(current:()=>boolean)=>Promise<void>)=>{
  const owner=binding.current;
  if(!owner?.active||owner.client!==client||working.current)return false;
  const current=()=>owner.active&&binding.current===owner;
  working.current=true;setBusy(true);setError('');
  try{await action(current);return current();}
  catch(reason){if(current())setError(reason instanceof Error?reason.message:String(reason));return false;}
  finally{if(current()){working.current=false;setBusy(false);}}
 };
 const undoState=()=>run(async current=>{
  if(loadedClient!==client||!client.state||!undo.length)return;
  const result=await client.state.undo(undo[undo.length-1].id);if(!current())return;
  setSnapshot(result.snapshot);setUndo(rows=>rows.slice(0,-1));if(result.receiptId)setRedo(rows=>[...rows,{id:result.receiptId!,step:nextLocalToolUndoStep()}]);
 });
 const redoState=()=>run(async current=>{
  if(loadedClient!==client||!client.state||!redo.length)return;
  const result=await client.state.redo(redo[redo.length-1].id);if(!current())return;
  setSnapshot(result.snapshot);setRedo(rows=>rows.slice(0,-1));if(result.receiptId)setUndo(rows=>[...rows,{id:result.receiptId!,step:nextLocalToolUndoStep()}]);
 });
 const ready=loadedClient===client&&!busy&&!hasDraft;
 useLocalToolUndoController({undoStep:ready?undo.at(-1)?.step:undefined,redoStep:ready?redo.at(-1)?.step:undefined,undo:undoState,redo:redoState});
 return{snapshot:loadedClient===client?snapshot:undefined,error,busy,canUndo:loadedClient===client&&!!undo.length,canRedo:loadedClient===client&&!!redo.length,
  reload:()=>run(async current=>{const next=await client.read();if(current()){setSnapshot(next);setLoadedClient(client);}}),
  apply:(actions:readonly LocalToolStateAction[])=>run(async current=>{
   if(loadedClient!==client||!snapshot||!client.state)throw Error('local_tool_codec_required');
   const result=await client.state.apply(snapshot,actions);if(!current())return;
   setSnapshot(result.snapshot);if(result.receiptId)setUndo(rows=>[...rows,{id:result.receiptId!,step:nextLocalToolUndoStep()}]);setRedo([]);
  }),undo:undoState,redo:redoState};
}
