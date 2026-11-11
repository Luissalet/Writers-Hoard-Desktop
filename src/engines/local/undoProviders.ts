import {useContext,useLayoutEffect,useRef,useState} from 'react';
import {ToolUndoContext,useLocalToolUndoController} from './stateUndoContext';
import type {LocalToolClient,LocalToolHostContext} from './sdk';
import type {LocalToolCommandMount} from './undoCommands';
import type {LocalToolJson} from './stateTypes';

export type LocalToolUndoMode='undo'|'redo';
export interface LocalToolUndoProvider<M extends object> {
 id:string;
 model:M;
 label?:{en:string;es:string};
 canUndo(model:M):boolean;
 canRedo(model:M):boolean;
 undo(model:M,operation:{isCurrent():boolean}):Promise<boolean>;
 redo(model:M,operation:{isCurrent():boolean}):Promise<boolean>;
 lastStep?(model:M,mode:LocalToolUndoMode):number|undefined;
}
interface Scope {projectId:string;eraId?:string;namespace:string;documentId:string}
interface Captured {
 label?:{en:string;es:string};
 canUndo():boolean;canRedo():boolean;
 lastStep?(mode:LocalToolUndoMode):number|undefined;
 invoke(mode:LocalToolUndoMode,operation:{isCurrent():boolean}):Promise<boolean>;
}
interface Status {
 canUndo:boolean;canRedo:boolean;
 undoStep?:number;redoStep?:number;
 unrankedUndo?:boolean;unrankedRedo?:boolean;
 error?:string;
}
interface Entry {
 mount:LocalToolCommandMount;id:string;token:string;model:object;
 capture():Captured;
 busy:boolean;error:string;pending?:Status;
 publish():void;
}
const providers=new Map<string,Entry>();
const sameScope=(a:Scope,b:Scope)=>a.projectId===b.projectId&&a.eraId===b.eraId&&a.namespace===b.namespace&&a.documentId===b.documentId;
const live=(entry:Entry)=>providers.get(entry.token)===entry&&entry.mount.isCurrent();
const message=(reason:unknown)=>(reason instanceof Error?reason.message:String(reason))||'local_tool_undo_provider_invalid';
function captureProvider<M extends object>(spec:LocalToolUndoProvider<M>):Captured {
 const {model,canUndo,canRedo,undo,redo,lastStep,label}=spec;
 if(typeof canUndo!=='function'||typeof canRedo!=='function'||typeof undo!=='function'||typeof redo!=='function'||lastStep!==undefined&&typeof lastStep!=='function'||label&&(!label.en.trim()||!label.es.trim()))throw Error('local_tool_undo_provider_invalid');
 return{...(label?{label:{en:label.en,es:label.es}}:{}),canUndo:()=>canUndo(model),canRedo:()=>canRedo(model),...(lastStep?{lastStep:(mode:LocalToolUndoMode)=>lastStep(model,mode)}:{}),invoke:(mode,operation)=>(mode==='undo'?undo:redo)(model,operation)};
}
function inspect(captured:Captured):Status {
 try{
  const canUndo=captured.canUndo(),canRedo=captured.canRedo();
  if(typeof canUndo!=='boolean'||typeof canRedo!=='boolean')throw Error('local_tool_undo_provider_invalid');
  const result:Status={canUndo,canRedo};
  for(const mode of ['undo','redo'] as const){
   if(!(mode==='undo'?canUndo:canRedo))continue;
   if(!captured.lastStep){if(mode==='undo')result.unrankedUndo=true;else result.unrankedRedo=true;continue;}
   const step=captured.lastStep(mode);
   if(!Number.isSafeInteger(step)||step===undefined||step<=0)throw Error('local_tool_undo_provider_invalid');
   if(mode==='undo')result.undoStep=step;else result.redoStep=step;
  }
  return result;
 }catch(reason){return{canUndo:false,canRedo:false,error:message(reason)};}
}
function status(capture:()=>Captured):Status {
 try{return inspect(capture());}
 catch(reason){return{canUndo:false,canRedo:false,error:message(reason)};}
}
function report(entry:Entry,error:string){
 if(!live(entry))return;
 entry.error=error;entry.publish();
}
export async function listLocalToolUndoProviders(scope:Scope){
 const entries=[...providers.values()].filter(entry=>sameScope(entry.mount,scope)&&live(entry));
 const checked=await Promise.all(entries.map(entry=>entry.mount.checkAccess()));
 return entries.flatMap((entry,index)=>{
  if(!checked[index]||!live(entry))return[];
  try{
   const captured=entry.capture(),current=inspect(captured),{label}=captured;
   if(current.error)report(entry,current.error);
   return[{instanceId:entry.mount.instanceId,providerId:entry.id,providerToken:entry.token,...(label?{label}:{}),canUndo:current.canUndo,canRedo:current.canRedo}];
  }catch(reason){report(entry,message(reason));return[];}
 });
}
export async function runLocalToolUndoProvider(scope:Scope,instanceId:string,providerId:string,providerToken:string,mode:LocalToolUndoMode){
 const entry=providers.get(providerToken);
 if(!entry||entry.id!==providerId||entry.mount.instanceId!==instanceId||!sameScope(entry.mount,scope)||!live(entry))return{available:false,applied:false};
 if(entry.busy)return{available:true,applied:false};
 // Capture a model's callbacks before awaiting access, never by its logical id later.
 let captured:Captured;
 try{captured=entry.capture();}catch(reason){report(entry,message(reason));throw reason;}
 const current=inspect(captured);
 if(current.error){report(entry,current.error);throw Error(current.error);}
 entry.busy=true;entry.error='';entry.pending=current;entry.publish();
 try{
  let accessible:boolean;
  try{accessible=await entry.mount.checkAccess();}
  catch(reason){if(!live(entry))return{available:false,applied:false};throw reason;}
  if(!accessible||!live(entry))return{available:false,applied:false};
  const ready=inspect(captured);
  if(ready.error)throw Error(ready.error);
  if(!(mode==='undo'?ready.canUndo:ready.canRedo))return{available:true,applied:false};
  const applied=await captured.invoke(mode,{isCurrent:()=>live(entry)});
  if(typeof applied!=='boolean')throw Error('local_tool_undo_provider_invalid');
  return{available:applied||live(entry),applied};
 }catch(reason){report(entry,message(reason));throw reason;}
 finally{
  entry.busy=false;entry.pending=undefined;
  if(live(entry))entry.publish();
 }
}

/** Register a live author-owned model; its stack is never serialized into Writer. */
export function useLocalToolUndoProvider<T extends LocalToolJson,M extends object>(client:LocalToolClient<T>,context:LocalToolHostContext|undefined,handle:LocalToolUndoProvider<M>|null){
 const boundary=useContext(ToolUndoContext),mount=context?.undoCommands,latest=useRef(handle),registered=useRef<Entry|undefined>(undefined);
 const [,refresh]=useState(0),model=handle?.model,id=handle?.id;
 const offered=!!boundary&&!!context?.canEdit&&mount?.client===client&&!!handle;
 useLayoutEffect(()=>{latest.current=handle;});
 useLayoutEffect(()=>{
  if(!offered||!mount||!mount.isCurrent())return;
  if(!model||typeof model!=='object'&&typeof model!=='function'||typeof id!=='string'||!/^[a-z][a-z0-9_-]*$/.test(id))throw Error('local_tool_undo_provider_invalid');
  if([...providers.values()].some(entry=>entry.mount===mount&&entry.id===id))throw Error('local_tool_undo_provider_duplicate');
  const entry:Entry={mount,id,model,token:`source-undo-provider-${crypto.randomUUID()}`,busy:false,error:'',publish:()=>refresh(value=>value+1),capture:()=>{
   const spec=latest.current;
   if(!spec||spec.model!==model||spec.id!==id)throw Error('local_tool_undo_provider_invalid');
   return captureProvider(spec);
  }};
  entry.capture();providers.set(entry.token,entry);registered.current=entry;entry.publish();
  return()=>{providers.delete(entry.token);if(registered.current===entry)registered.current=undefined;};
 },[offered,boundary,client,mount,model,id]);
 const entry=registered.current,currentEntry=offered&&entry&&entry.mount===mount&&entry.model===model&&entry.id===id&&live(entry)?entry:undefined;
 const execute=(mode:LocalToolUndoMode)=>currentEntry?runLocalToolUndoProvider(currentEntry.mount,currentEntry.mount.instanceId,currentEntry.id,currentEntry.token,mode):Promise.resolve({available:false,applied:false});
 // Render reads this render's handle; dispatch and keyboard read the committed handle.
 const current:Status=currentEntry&&handle?currentEntry.pending??status(()=>captureProvider(handle)):{canUndo:false,canRedo:false};
 // A broken live getter consumes one attempt and reports locally, without falling through.
 useLocalToolUndoController(()=>{
  const value:Status=currentEntry&&live(currentEntry)?currentEntry.pending??status(currentEntry.capture):{canUndo:false,canRedo:false};
  return{undoStep:value.undoStep,redoStep:value.redoStep,unrankedUndo:!!value.error||value.unrankedUndo,unrankedRedo:!!value.error||value.unrankedRedo,
   undo:async()=> (await execute('undo')).applied,redo:async()=> (await execute('redo')).applied};
 });
 return{available:!!currentEntry,canUndo:current.canUndo,canRedo:current.canRedo,get busy(){return!!currentEntry?.busy;},error:currentEntry?.error||current.error||'',undo:()=>execute('undo'),redo:()=>execute('redo')};
}
