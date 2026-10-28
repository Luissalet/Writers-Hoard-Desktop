import type {LocalToolClient,LocalToolDefinition,LocalToolSnapshot} from './sdk';
import {cloneLocalToolJson,HOST_DEFAULTS_NAMESPACE,localToolNamespace,type LocalToolJson} from './stateTypes';
import {localToolFieldKey,type LocalToolStateCodec} from './stateCodec';
import {readLocalToolState,prepareLocalToolSave,type LocalToolStateProject} from './clientContract';
import {createLocalToolStateActions,type LocalToolActionResult} from './stateRuntime';

export type LocalToolDefaultEntry={present:false}|{present:true;value:LocalToolJson};
export interface LocalToolDefaultSnapshot{projectId:string;namespace:string;key:string;revision:number|null;entry:LocalToolDefaultEntry}
export interface LocalToolDefaultResult{snapshot:LocalToolDefaultSnapshot;receiptId:string|null}
export interface LocalToolDefaults{
 get(key:string):Promise<LocalToolDefaultSnapshot>;
 set(key:string,value:LocalToolJson,expected:LocalToolDefaultSnapshot):Promise<LocalToolDefaultResult>;
 undo(key:string,receiptId:string):Promise<LocalToolDefaultResult>;
 redo(key:string,receiptId:string):Promise<LocalToolDefaultResult>;
 subscribe(changed:()=>void):()=>void;
}
type DefaultsData={values:Record<string,LocalToolJson>};
type DefaultsState=LocalToolSnapshot<DefaultsData>;
interface DefaultsTransaction{read():Promise<DefaultsState>;save(data:DefaultsData,expectedRevision:number|null):Promise<DefaultsState>;onCommit(callback:()=>void):void;onAbort(callback:()=>void):void}
export interface LocalToolDefaultsPort{receiptScope:string;read():Promise<DefaultsState>;atomic<R>(run:(transaction:DefaultsTransaction)=>Promise<R>):Promise<R>}
const object=(value:LocalToolJson):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function validateKey(key:string){if(!localToolFieldKey(key))throw Error('local_tool_default_key_invalid');}
const pair=(namespace:string,key:string)=>JSON.stringify([namespace,key]);
const codec:LocalToolStateCodec={version:1,fields:{values:{kind:'map'}}};
// This host-only definition deliberately has no persisted codec and is not an author namespace.
const definition:LocalToolDefinition<DefaultsData>={apiVersion:1,namespace:HOST_DEFAULTS_NAMESPACE,name:{en:'Tool defaults',es:'Preferencias de herramientas'},description:{en:'Shared opaque preferences.',es:'Preferencias compartidas opacas.'},initialState:{values:{}},component:()=>null,validateState:(value:LocalToolJson):value is DefaultsData=>{
 if(!object(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'values')||!object(value.values))return false;
 for(const token of Object.keys(value.values)){
  let decoded:unknown;try{decoded=JSON.parse(token);}catch{return false;}
  if(!Array.isArray(decoded)||decoded.length!==2||!localToolNamespace(decoded[0])||!localToolFieldKey(decoded[1])||JSON.stringify(decoded)!==token)return false;
 }
 return true;
}};
export const readDefaultsState=(project:LocalToolStateProject):DefaultsState=>readLocalToolState(project,definition);
export const prepareDefaultsSave=<P extends LocalToolStateProject>(project:P,data:DefaultsData,expectedRevision:number|null)=>prepareLocalToolSave(project,definition,data,expectedRevision);

/** Pure service shared by the database host and author fake. Physical identity excludes documents/eras/releases. */
export function createLocalToolDefaults<T extends LocalToolJson>(host:LocalToolClient<T>,port:LocalToolDefaultsPort):LocalToolDefaults{
 const projectId=host.projectId,namespace=host.namespace;
 const project=(key:string,state:DefaultsState):LocalToolDefaultSnapshot=>{
  const token=pair(namespace,key),values=state.data.values;
  return{projectId,namespace,key,revision:state.revision,entry:Object.hasOwn(values,token)?{present:true,value:cloneLocalToolJson(values[token])}:{present:false}};
 };
 const expected=(key:string,value:LocalToolDefaultSnapshot):DefaultsState=>{
  const safe=cloneLocalToolJson(value as unknown as LocalToolJson);
  if(!object(safe)||Object.keys(safe).length!==5||safe.projectId!==projectId||safe.namespace!==namespace||safe.key!==key||safe.revision!==null&&(!Number.isSafeInteger(safe.revision)||typeof safe.revision!=='number'||safe.revision<0)||!object(safe.entry))throw Error('local_tool_default_baseline_invalid');
  const entry=safe.entry;
  if(entry.present===false?Object.keys(entry).length!==1:entry.present!==true||Object.keys(entry).length!==2||!Object.hasOwn(entry,'value')||safe.revision===null)throw Error('local_tool_default_baseline_invalid');
  return{revision:safe.revision as number|null,updatedAt:null,data:{values:entry.present?{[pair(namespace,key)]:entry.value}:{}},provenance:'base'};
 };
 const actions=(key:string)=>{
  validateKey(key);
  return createLocalToolStateActions<DefaultsData>(codec,JSON.stringify([port.receiptScope,HOST_DEFAULTS_NAMESPACE,projectId,namespace,key]),run=>port.atomic(transaction=>{
   const client:LocalToolClient<DefaultsData>={...host,read:transaction.read,save:transaction.save,state:undefined,convergence:undefined};
   return run({client,onCommit:transaction.onCommit,onAbort:transaction.onAbort});
  }));
 };
 const result=(key:string,value:LocalToolActionResult<DefaultsData>):LocalToolDefaultResult=>({snapshot:project(key,value.snapshot),receiptId:value.receiptId});
 return Object.freeze({
  async get(key:string){validateKey(key);return project(key,await port.read());},
  async set(key:string,value:LocalToolJson,baseline:LocalToolDefaultSnapshot){validateKey(key);const safe=cloneLocalToolJson(value),before=expected(key,baseline);return result(key,await actions(key).apply(before,[{type:'map-set',field:'values',key:pair(namespace,key),value:safe}]));},
  async undo(key:string,id:string){return result(key,await actions(key).undo(id));},
  async redo(key:string,id:string){return result(key,await actions(key).redo(id));},
  subscribe:(changed:()=>void)=>host.subscribe?.(changed)??(()=>{}),
 });
}
