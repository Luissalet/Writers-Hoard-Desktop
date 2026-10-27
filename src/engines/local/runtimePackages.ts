import {recordRuntimeError,runtimeErrorType,type RuntimeErrorPhase} from './runtimeErrors';
import {db} from '@/db';
import {notifyDataChanged} from '@/engines/_shared/dataChanged';
import {getLocalToolCatalog} from './definitions';
import {prepareLocalToolRegistrations} from './registry';
import {canonicalRuntimeJson,inspectRuntimePacket,runtimeBase64,runtimeDecodeBase64,type CheckedRuntimePacket} from './runtimeFormat.mjs';
import type {RuntimeMemberRelease} from './releaseMetadata';
import type {LocalToolDefinition} from './sdk';
import type {LocalRuntimePackageRow,RuntimePackageFailure,RuntimePackageInput} from './runtimeTypes';
const loaded=new Set<string>(),failures=new Map<string,RuntimePackageFailure>();
const packageOwner=(checked:CheckedRuntimePacket)=>({packageNamespace:checked.manifest.namespace,contentHash:checked.manifest.contentHash});
function notifyPublished(checked:CheckedRuntimePacket){const hash=checked.manifest.contentHash;try{notifyDataChanged({source:'other',table:'localToolPackages'});}catch(error){failures.set(hash,{phase:'notify',message:error instanceof Error?error.message:String(error)});recordRuntimeError(packageOwner(checked),'notify',error);}}
let tail:Promise<unknown>=Promise.resolve();
const serialized=<T>(run:()=>Promise<T>):Promise<T>=>{const next=tail.then(run,run);tail=next.catch(()=>undefined);return next;};
function inputBytes(file:RuntimePackageInput){if(!file||typeof file.name!=='string'||!file.name||!['application/json','application/octet-stream'].includes(file.mime)||typeof file.base64!=='string'||Object.keys(file).sort().join(',')!=='base64,mime,name')throw Error('local_runtime_package_file_invalid');return runtimeDecodeBase64(file.base64);}
const summary=(checked:CheckedRuntimePacket)=>({manifest:structuredClone(checked.manifest),fileSha256:checked.fileSha256,bytes:checked.bytes});
export async function inspectLocalRuntimePackage(file:RuntimePackageInput){const checked=await inspectRuntimePacket(inputBytes(file));return {...summary(checked),installed:!!await db.localToolPackages.get(checked.manifest.contentHash)};}
async function prepare(checked:CheckedRuntimePacket){
 let phase:RuntimeErrorPhase='load';
 try{
 const manifest=checked.manifest,url=URL.createObjectURL(new Blob([new Uint8Array(checked.files.get(manifest.entry)!).buffer],{type:'text/javascript'}));
 let module:Record<string,unknown>;
 try{module=await import(/* @vite-ignore */ url);}finally{URL.revokeObjectURL(url);}
 if(Object.keys(module).sort().join(',')!=='createPackage,packageNamespace,runtimeVersion,version'||module.runtimeVersion!==1||module.packageNamespace!==manifest.namespace||module.version!==manifest.version||typeof module.createPackage!=='function')throw Error('local_runtime_package_exports_mismatch');
 const {localRuntimeHost}=await import('./runtimeHost');phase='factory';
 const result=(module.createPackage as (host:unknown)=>unknown)(localRuntimeHost) as {members?:{namespace:string;version:string;definition:LocalToolDefinition}[]};
 if(!result||Object.keys(result).join(',')!=='members'||!Array.isArray(result.members)||result.members.length!==manifest.members.length)throw Error('local_runtime_package_members_mismatch');
 phase='prepare';const seen=new Set<string>();
 const entries=result.members.map(member=>{
  const meta=manifest.members.find(item=>item.namespace===member.namespace),source=member.definition;
  if(!meta||seen.has(member.namespace)||member.version!==meta.version||source?.namespace!==meta.namespace||Object.keys(member).sort().join(',')!=='definition,namespace,version'||!!source.app!==(meta.kind==='app')||meta.kind==='app'&&canonicalRuntimeJson(source.app?.descriptor)!==canonicalRuntimeJson(meta.descriptor))throw Error('local_runtime_package_members_mismatch');
  if(meta.kind==='app'&&(typeof source.app?.Host!=='function'||typeof source.app?.Surface!=='function'))throw Error('local_runtime_package_app_components_invalid');
  seen.add(member.namespace);
  const assetFiles=Object.fromEntries(manifest.files.filter(file=>file.path!==manifest.entry).map(file=>[file.path,async()=>new Blob([new Uint8Array(checked.files.get(file.path)!).buffer],{type:file.mime})]));
  const definition={...source,assetFiles};
  const release:RuntimeMemberRelease={format:'writers-hoard-local-runtime-member/1',apiVersion:1,runtimeVersion:1,namespace:meta.namespace,version:meta.version,contentHash:manifest.contentHash,packageNamespace:manifest.namespace,kind:meta.kind,files:manifest.files};
  return {definition,release,origin:{kind:'runtime' as const,packageHash:manifest.contentHash,namespace:meta.namespace}};
 });
 for(const entry of entries)for(const namespace of entry.definition.app?.descriptor.tools??[]){const own=entries.find(item=>item.definition.namespace===namespace)?.definition,catalog=getLocalToolCatalog(namespace);if(namespace===entry.definition.namespace||!(own?.document||catalog?.development?.document||[...catalog?.releases.values()??[]].some(row=>row.definition.document)))throw Error('local_app_document_tool_unavailable');}
 return prepareLocalToolRegistrations(entries);
 }catch(error){throw Object.assign(new Error(error instanceof Error?error.message:String(error)),{runtimePhase:phase,runtimeErrorType:runtimeErrorType(error)});}
}
export async function installLocalRuntimePackage(file:RuntimePackageInput){return serialized(async()=>{
 const checked=await inspectRuntimePacket(inputBytes(file)),hash=checked.manifest.contentHash;
 let phase:RuntimeErrorPhase='prepare',publishedNow=false;
 try{
  const existing=await db.localToolPackages.get(hash);
  if(existing&&existing.fileSha256!==checked.fileSha256)throw Error('local_runtime_package_identity_conflict');
  if(!loaded.has(hash)){
   const batch=await prepare(checked);
   phase='persist';
   if(!existing)await db.transaction('rw',db.localToolPackages,async()=>{const current=await db.localToolPackages.get(hash);if(current){if(current.fileSha256!==checked.fileSha256)throw Error('local_runtime_package_identity_conflict');return;}await db.localToolPackages.add({contentHash:hash,namespace:checked.manifest.namespace,manifest:checked.manifest,packet:checked.packet,fileName:file.name.split(/[\\/]/).at(-1)!,mime:'application/json',fileSha256:checked.fileSha256,installedAt:Date.now(),memberNamespaces:checked.manifest.members.map(member=>member.namespace)});});
   // Commit contains only preconstructed trusted Map/string registrations.
   // No author callback, validation or await remains after DB confirmation.
   phase='publish';batch.publish();loaded.add(hash);publishedNow=true;
  }
  failures.delete(hash);if(publishedNow)notifyPublished(checked);
  return {installed:true as const,alreadyInstalled:!!existing,...summary(checked),rebuildRequired:false as const,members:checked.manifest.members.map(member=>({namespace:member.namespace,contentHash:hash,kind:member.kind,available:true as const}))};
 }catch(error){const actual=(error as {runtimePhase?:RuntimeErrorPhase})?.runtimePhase??phase;failures.set(hash,{phase:actual,message:error instanceof Error?error.message:String(error)});recordRuntimeError(packageOwner(checked),actual,error);throw Object.assign(new Error(error instanceof Error?error.message:String(error)),{runtimePhase:actual,runtimeErrorType:runtimeErrorType(error)});}
 });}
export async function listLocalRuntimePackages(namespace?:string){const rows=await db.localToolPackages.toArray();return {packages:rows.filter(row=>!namespace||row.namespace===namespace||row.memberNamespaces.includes(namespace)).sort((a,b)=>a.namespace<b.namespace?-1:a.namespace>b.namespace?1:a.contentHash<b.contentHash?-1:a.contentHash>b.contentHash?1:0).map(row=>({manifest:structuredClone(row.manifest),fileSha256:row.fileSha256,bytes:row.packet.byteLength,installedAt:row.installedAt,status:loaded.has(row.contentHash)?'available' as const:'unavailable' as const,...(failures.has(row.contentHash)?{error:failures.get(row.contentHash)}:{})}))};}
export async function exportLocalRuntimePackage(contentHash:string){const row=await db.localToolPackages.get(contentHash);if(!row)throw Error('local_runtime_package_not_found');const checked=await inspectRuntimePacket(row.packet);return {file:{name:row.fileName,mime:row.mime,base64:runtimeBase64(checked.packet)},bytes:checked.bytes,fileSha256:checked.fileSha256,contentHash,truncated:false as const};}
const availableDocument=(namespace:string)=>{const catalog=getLocalToolCatalog(namespace);return !!catalog?.development?.document||[...catalog?.releases.values()??[]].some(row=>!!row.definition.document);};
function missingPackageDependencies(checked:CheckedRuntimePacket){
 const own=new Set(checked.manifest.members.map(member=>member.namespace));
 return [...new Set(checked.manifest.members.flatMap(member=>member.kind==='app'?member.descriptor.tools:[]))].filter(namespace=>!own.has(namespace)&&!availableDocument(namespace));
}
/** Explicit startup/Retry only. A data backup or list call never evaluates code. */
export async function loadLocalRuntimePackages(){return serialized(async()=>{
 const rows=await db.localToolPackages.toArray();
 let pending:{hash:string;checked:CheckedRuntimePacket}[]=[];
 for(const row of rows){
  if(loaded.has(row.contentHash))continue;
  let checked:CheckedRuntimePacket|undefined;
  try{checked=await inspectRuntimePacket(row.packet);if(checked.manifest.contentHash!==row.contentHash||checked.fileSha256!==row.fileSha256)throw Error('local_runtime_package_inventory_hash_mismatch');pending.push({hash:row.contentHash,checked});}
  catch(error){failures.set(row.contentHash,{phase:'load',message:error instanceof Error?error.message:String(error)});if(checked)recordRuntimeError(packageOwner(checked),'load',error);}
 }
 while(pending.length){
  const waiting:typeof pending=[];let progressed=false;
  for(const item of pending){
   if(missingPackageDependencies(item.checked).length){waiting.push(item);continue;}
   progressed=true;
   let phase:RuntimeErrorPhase='prepare';
   try{const batch=await prepare(item.checked);phase='publish';batch.publish();loaded.add(item.hash);failures.delete(item.hash);notifyPublished(item.checked);}
   catch(error){const actual=(error as {runtimePhase?:RuntimeErrorPhase})?.runtimePhase??phase;failures.set(item.hash,{phase:actual,message:error instanceof Error?error.message:String(error)});recordRuntimeError(packageOwner(item.checked),actual,error);}
  }
  if(!progressed){for(const item of waiting){failures.set(item.hash,{phase:'prepare',message:'local_app_document_tool_unavailable: '+missingPackageDependencies(item.checked).join(', ')});recordRuntimeError(packageOwner(item.checked),'prepare',new Error('local_app_document_tool_unavailable'));}break;}
  pending=waiting;
 }
 return listLocalRuntimePackages();
});}
export type {LocalRuntimePackageRow};
