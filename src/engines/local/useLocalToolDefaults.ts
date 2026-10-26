import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {LocalToolClient,LocalToolJson} from './sdk';
import type {LocalToolDefaultResult,LocalToolDefaultSnapshot} from './defaults';
import {cloneLocalToolJson} from './stateTypes';
import {nextLocalToolUndoStep,useLocalToolUndoController} from './stateUndoContext';

interface Step{id:string;step:number}
interface View{snapshot?:LocalToolDefaultSnapshot;loading:boolean;busy:boolean;error:string;undo:Step[];redo:Step[];proposal?:{value:LocalToolJson}}
const initial=():View=>({loading:true,busy:false,error:'',undo:[],redo:[]});
/** Live, revocable preference binding. It never applies a preference to tool/document state. */
export function useLocalToolDefaults<T extends LocalToolJson>(client:LocalToolClient<T>,key:string){
 const token=useMemo(()=>({client,key}),[client,key]);
 const [view,setView]=useState<View>(initial),owner=useRef<{token:object;client:LocalToolClient<T>;key:string;active:boolean;sequence:number;working:boolean;dirty:boolean;view:View;read:(clearError?:boolean)=>Promise<boolean>}>(undefined);
 useLayoutEffect(()=>{
  const binding={token,client,key,active:true,sequence:0,working:false,dirty:false,view:initial(),read:async()=>false};owner.current=binding;
  const publish=(change:Partial<View>)=>{if(!binding.active||owner.current!==binding)return;binding.view={...binding.view,...change};setView(binding.view);};
  binding.read=async(clearError=false)=>{
   if(!binding.active||owner.current!==binding||!client.defaults)return false;
   if(binding.working){binding.dirty=true;return false;}
   const sequence=++binding.sequence;publish({loading:true});
   try{const snapshot=await client.defaults.get(key);if(!binding.active||owner.current!==binding||sequence!==binding.sequence)return false;publish({snapshot,loading:false,...(clearError?{error:''}:{})});return true;}
   catch(reason){if(binding.active&&owner.current===binding&&sequence===binding.sequence)publish({loading:false,error:reason instanceof Error?reason.message:String(reason)});return false;}
  };
  publish({loading:!!client.defaults});
  return()=>{binding.active=false;binding.sequence++;};
 },[client,key,token]);
 useEffect(()=>{
  const binding=owner.current;if(!binding||binding.client!==client||binding.key!==key)return;
  void binding.read();const stop=client.defaults?.subscribe(()=>{binding.sequence++;if(binding.working)binding.dirty=true;else void binding.read();});
  return()=>stop?.();
 },[client,key,token]);
 const current=()=>{const binding=owner.current;return binding?.active&&binding.token===token?binding:undefined;};
 const run=async(mode:'set'|'undo'|'redo',value?:LocalToolJson)=>{
  const binding=current(),service=client.defaults;if(!binding||!service||binding.working||binding.view.loading||!binding.view.snapshot)return false;
  const before=binding.view,history=mode==='undo'?before.undo:before.redo;if(mode!=='set'&&!history.length)return false;
  const proposal=mode==='set'?{value:cloneLocalToolJson(value!)}:before.proposal;
  binding.working=true;binding.sequence++;binding.view={...before,busy:true,error:'',proposal};setView(binding.view);
  const valid=()=>binding.active&&owner.current===binding;
  try{
   const result:LocalToolDefaultResult=mode==='set'?await service.set(key,proposal!.value,before.snapshot!):await service[mode](key,history.at(-1)!.id);
   if(!valid())return false;
   const next={...binding.view,snapshot:result.snapshot,loading:false,error:'',...(mode==='set'?{proposal:undefined,redo:[]}:mode==='undo'?{undo:before.undo.slice(0,-1)}:{redo:before.redo.slice(0,-1)})};
   if(result.receiptId){const step={id:result.receiptId,step:nextLocalToolUndoStep()};if(mode==='undo')next.redo=[...next.redo,step];else next.undo=[...next.undo,step];}
   binding.view=next;setView(next);return true;
  }catch(reason){if(valid()){binding.view={...binding.view,error:reason instanceof Error?reason.message:String(reason)};setView(binding.view);}return false;}
  finally{if(valid()){binding.working=false;binding.view={...binding.view,busy:false};setView(binding.view);if(binding.dirty){binding.dirty=false;void binding.read();}}}
 };
 const binding=current(),state=binding?view:initial(),ready=!!binding&&!state.busy&&!state.loading;
 const undo=()=>run('undo'),redo=()=>run('redo');
 useLocalToolUndoController({undoStep:ready?state.undo.at(-1)?.step:undefined,redoStep:ready?state.redo.at(-1)?.step:undefined,undo,redo});
 return{snapshot:state.snapshot,loading:state.loading,busy:state.busy,error:state.error,available:!!client.defaults,canUndo:!!state.undo.length,canRedo:!!state.redo.length,hasProposal:!!state.proposal,
  reload:()=>current()?.read(true)??Promise.resolve(false),set:(value:LocalToolJson)=>run('set',value),retry:()=>{const proposal=current()?.view.proposal;return proposal?run('set',proposal.value):Promise.resolve(false);},undo,redo};
}
