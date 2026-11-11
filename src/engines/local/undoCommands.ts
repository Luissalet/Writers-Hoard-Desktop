import {useContext,useLayoutEffect,useRef} from 'react';
import type {BridgeToolSchema} from '@/services/aiBridge/schema';
import {localOperationInput,validateLocalOperationSchema} from './operationSchema';
import type {LocalToolClient,LocalToolHostContext,LocalToolSnapshot} from './sdk';
import type {LocalToolStateAction} from './stateActions';
import {ToolUndoContext} from './stateUndoContext';
import type {LocalToolJson} from './stateTypes';

interface CommandScope {projectId:string;eraId?:string;namespace:string;documentId:string}
export interface LocalToolCommandMount extends CommandScope {
 readonly instanceId:string;
 readonly client:object;
 isCurrent():boolean;
 checkAccess():Promise<boolean>;
}
type CommandInput=Readonly<Record<string,LocalToolJson>>;
type CommandPlan<T extends LocalToolJson>=(snapshot:LocalToolSnapshot<T>)=>readonly LocalToolStateAction[];
export interface LocalToolUndoCommand<T extends LocalToolJson> {
 id:string;
 label:{en:string;es:string};
 inputSchema:BridgeToolSchema;
 plan(snapshot:LocalToolSnapshot<T>,input:CommandInput):readonly LocalToolStateAction[];
}
interface CommandState<T extends LocalToolJson> {
 applyCommand(client:LocalToolClient<T>,plan:CommandPlan<T>,isCurrent:()=>boolean,checkAccess:()=>Promise<boolean>):Promise<boolean>;
}
interface Descriptor {id:string;label:{en:string;es:string};inputSchema:BridgeToolSchema}
interface Entry {
 mount:LocalToolCommandMount;
 id:string;
 capture():{descriptor:Descriptor;apply(input:CommandInput,isCurrent:()=>boolean,checkAccess:()=>Promise<boolean>):Promise<boolean>};
}
const commands=new Map<string,Entry>();
const key=(instanceId:string,id:string)=>JSON.stringify([instanceId,id]);
const sameScope=(a:CommandScope,b:CommandScope)=>a.projectId===b.projectId&&a.eraId===b.eraId&&a.namespace===b.namespace&&a.documentId===b.documentId;
const live=(entry:Entry)=>commands.get(key(entry.mount.instanceId,entry.id))===entry&&entry.mount.isCurrent();

export class LocalToolCommandInputError extends Error {}
export async function listLocalToolUndoCommands(scope:CommandScope){
 const entries=[...commands.values()].filter(entry=>sameScope(entry.mount,scope)&&live(entry));
 const checked=await Promise.all(entries.map(entry=>entry.mount.checkAccess()));
 return entries.flatMap((entry,index)=>checked[index]&&live(entry)?
  [{instanceId:entry.mount.instanceId,...entry.capture().descriptor}]:[]);
}
export async function runLocalToolUndoCommand(scope:CommandScope,instanceId:string,commandId:string,input:unknown,expected?:Entry){
 const entry=commands.get(key(instanceId,commandId));
 if(!entry||expected&&entry!==expected||!sameScope(entry.mount,scope)||!live(entry))return{available:false,applied:false};
 const {descriptor,apply}=entry.capture();
 let args:CommandInput;
 try{args=localOperationInput(descriptor.inputSchema,input===undefined?{}:input);}
 catch(reason){throw new LocalToolCommandInputError(reason instanceof Error?reason.message:String(reason));}
 let accessible=true;
 const applied=await apply(args,()=>live(entry),async()=>{accessible=await entry.mount.checkAccess();return accessible;});
 return{available:applied||accessible&&live(entry),applied};
}

/** Declare a reversible author action on the same state controller as the editor. */
export function useLocalToolUndoCommand<T extends LocalToolJson>(client:LocalToolClient<T>,context:LocalToolHostContext|undefined,state:CommandState<T>,spec:LocalToolUndoCommand<T>){
 const undo=useContext(ToolUndoContext),mount=context?.undoCommands,id=spec.id,latest=useRef({state,spec});
 const registered=useRef<Entry|undefined>(undefined);
 const available=!!undo&&!!context?.canEdit&&mount?.client===client;
 useLayoutEffect(()=>{latest.current={state,spec};});
 useLayoutEffect(()=>{
  if(!available||!mount||!mount.isCurrent())return;
  const commandKey=key(mount.instanceId,id);
  if(commands.has(commandKey))throw Error('local_tool_undo_command_duplicate');
  const entry:Entry={mount,id,capture:()=>{
   const {spec:command,state:controller}=latest.current,{label,inputSchema,plan}=command;
   if(command.id!==id||!/^[a-z][a-z0-9_-]*$/.test(id)||!label.en.trim()||!label.es.trim()||inputSchema.type!=='object'||typeof plan!=='function')throw Error('local_tool_undo_command_invalid');
   validateLocalOperationSchema(inputSchema);
   return {descriptor:structuredClone({id,label,inputSchema}),apply:(input,isCurrent,checkAccess)=>
    controller.applyCommand(client,snapshot=>plan(snapshot,input),isCurrent,checkAccess)};
  }};
  entry.capture();
  commands.set(commandKey,entry);
  registered.current=entry;
  return()=>{
   if(commands.get(commandKey)===entry)commands.delete(commandKey);
   if(registered.current===entry)registered.current=undefined;
  };
 },[available,client,mount,id]);
 return{available,run:(input?:CommandInput)=>{
  const current=registered.current;
  if(!available||!current||current.mount!==mount||current.id!==id)return Promise.resolve({available:false,applied:false});
  return runLocalToolUndoCommand(current.mount,current.mount.instanceId,id,input,current);
 }};
}
