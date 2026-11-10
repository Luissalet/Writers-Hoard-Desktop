import {createLocalAudioVoice} from './audioNodes';
import { liveQuery } from 'dexie';
import { mediaRows } from '@/engines/media/scope';
import { createLocalAudioEngine,type LocalAudioBackend,type LocalToolAudio,type LocalAudioRef,type LocalAudioOptions } from './audio';
import type { WorldEraScope } from '@/services/worldEras/types';
/** Lazy WebAudio graph, separate from the unchanged legacy Soundscape/Reader players. */
const createBrowserBackend=():LocalAudioBackend=>{
 let context:AudioContext|undefined,closeTimer:ReturnType<typeof setTimeout>|undefined,tailUntil=0,resumed:Promise<void>=Promise.resolve();
 const running=()=>context?.state==='running';
 const voiceFor=async(buffer:AudioBuffer)=>{const current=context;if(!current)throw Error('local_audio_not_unlocked');await resumed;if(current!==context)throw Error('local_audio_context_expired');const voice=createLocalAudioVoice(current,buffer,{current:()=>current===context,tail:ms=>{tailUntil=Math.max(tailUntil,Date.now()+ms);}});return{...voice,getLevels:()=>current===context&&current.state==='running'?voice.getLevels?.()??null:null};};
 return{available:typeof AudioContext!=='undefined',supportsPan:typeof AudioContext!=='undefined'&&typeof AudioContext.prototype.createStereoPanner==='function',
  unlock(){if(!navigator.userActivation?.isActive)return false;if(closeTimer)clearTimeout(closeTimer);closeTimer=undefined;if(!context||context.state==='closed')context=new AudioContext();resumed=context.state==='suspended'?context.resume():Promise.resolve();void resumed.catch(()=>{});return true;},
  async resume(){const prior=context;if(!prior||prior.state==='closed')return false;if(prior.state==='running')return true;if(!navigator.userActivation?.isActive)return false;await prior.resume();return prior===context&&running();},
  async decode(blob){const decoder=new OfflineAudioContext(2,1,48000),buffer=await decoder.decodeAudioData(await blob.arrayBuffer());return{durationSeconds:buffer.duration,createVoice:()=>voiceFor(buffer)};},
  async prepare(blob){const current=context;if(!current)throw Error('local_audio_not_unlocked');await resumed;if(current!==context)throw Error('local_audio_context_expired');const buffer=await current.decodeAudioData(await blob.arrayBuffer());if(current!==context)throw Error('local_audio_context_expired');return voiceFor(buffer);},
  close(){const prior=context;if(!prior)return;if(closeTimer)clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(context===prior){context=undefined;void prior.close();}},Math.max(0,tailUntil-Date.now()));},
 };
};
const bindingKey=(ref:import('./assets').LocalAssetRef)=>ref.kind==='source'?JSON.stringify(['source',ref.namespace,ref.slot]):JSON.stringify([ref.kind,ref.id]);
const engine=createLocalAudioEngine(createBrowserBackend());
const coldOwners=new Map<string,LocalToolAudio>();
const activeOwners=new Map<LocalToolAudio,{scope:WorldEraScope;coordinator:typeof engine}>();
export function localAudioSessionStatus(scope:WorldEraScope,includeLevels=false,includePosition=false,includePreloads=false){const owners=[...activeOwners].filter(([,entry])=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId);return{available:engine.available,playing:owners.flatMap(([audio])=>audio.getState().map(row=>({...row,...(includeLevels?{levels:audio.getLevels(row.id)}:{}),...(includePosition?{position:audio.getPosition(row.id)}:{})}))),...(includePreloads?{preparations:owners.flatMap(([audio])=>audio.getPreloads())}:{}),busLevels:(owners[0]?.[1].coordinator??engine).getBusLevels()};}
export function stopLocalAudioSession(scope:WorldEraScope,id?:string){let stopped=0;for(const [audio,entry]of [...activeOwners])if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId)for(const row of audio.getState())if(!id||row.id===id){audio.stop(row.id);stopped++;}return stopped;}
export function panLocalAudioSession(scope:WorldEraScope,id:string,pan:number){for(const [audio,entry]of activeOwners)if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId&&audio.getState().some(row=>row.id===id)){audio.update(id,{pan});return audio.getState().find(row=>row.id===id)??null;}return null;}
export async function transportLocalAudioSession(scope:WorldEraScope,id:string,action:'pause'|'resume'|'seek',seconds?:number){for(const [audio,entry]of activeOwners)if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId&&audio.getState().some(row=>row.id===id)){const changed=action==='resume'?await audio.resume(id):action==='pause'?audio.pause(id):audio.seek(id,seconds!);return{changed,handle:audio.getState().find(row=>row.id===id)??null,position:audio.getPosition(id)};}return null;}
export function setLocalAudioBus(scope:WorldEraScope,bus:import('./audio').LocalAudioBus,volume:number){const coordinators=new Set([...activeOwners.values()].filter(entry=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId).map(entry=>entry.coordinator));if(!coordinators.size)coordinators.add(engine);for(const coordinator of coordinators){const owner=coordinator.createOwner({resolve:async()=>null});owner.setBusLevel(bus,volume);owner.dispose();}}
/** One durable default-backend owner per MCP scope, created only by explicit preload. */
export async function preloadLocalAudioSession(scope:WorldEraScope,refs:readonly LocalAudioRef[]){
 const key=JSON.stringify([scope.projectId,scope.eraId??null]);let audio=coldOwners.get(key);
 if(!audio){
  const {getEraProject}=await import('@/services/worldEras/store');audio=coldOwners.get(key);if(audio)return audio.preload(refs);
  const check=()=>getEraProject(scope),current=()=>coldOwners.get(key)===audio;
  const assetResolve=async(ref:import('./assets').LocalAssetRef)=>{if(ref.kind!=='source')return null;const project=await check(),{resolveProjectLocalTool}=await import('./releases'),{createBrowserLocalToolAssets}=await import('./assetBrowser'),definition=resolveProjectLocalTool(ref.namespace,project);return createBrowserLocalToolAssets(scope,definition,check,()=>{throw Error('local_tool_query_is_read_only');}).resolve(ref);};
  audio=createBrowserLocalToolAudio(scope,check,current,engine,assetResolve);coldOwners.set(key,audio);
 }
 return audio.preload(refs);
}
export function releaseLocalAudioSessionPreloads(scope:WorldEraScope,ids?:readonly string[]){let released=0;for(const [audio,entry]of [...activeOwners])if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId)released+=audio.releasePreload(ids);return released;}
export function createBrowserLocalToolAudio(scope:WorldEraScope,check:()=>Promise<unknown>,current:()=>boolean,coordinator=engine,assetResolve?:(ref:import('./assets').LocalAssetRef)=>Promise<import('./assets').LocalAssetResolved|null>):LocalToolAudio{
 const resolve=async(ref:LocalAudioRef)=>{await check();if(!current())return null;if(ref.kind==='media'){const asset=(await mediaRows(scope.projectId,scope.eraId)).find(row=>row.id===ref.id&&row.kind==='audio');return asset?{blob:asset.blob,version:JSON.stringify([asset.id,asset.updatedAt,asset.size,asset.mime]),cacheKey:JSON.stringify(['media',asset.id])}:null;}const value=await assetResolve?.(ref);return value?.kind==='audio'?{blob:value.blob,version:JSON.stringify([value.version,bindingKey(value.ref)]),cacheKey:bindingKey(value.ref)}:null;};
 const audio=coordinator.createOwner({current,preloadScope:JSON.stringify([scope.projectId,scope.eraId??null]),resolve});let stopWatch:(()=>void)|undefined,stopState:(()=>void)|undefined,pendingRequests=0;
 const clear=()=>{stopWatch?.();stopWatch=undefined;stopState?.();stopState=undefined;activeOwners.delete(audio);for(const [key,owner]of coldOwners)if(owner===result){coldOwners.delete(key);audio.dispose();}};
 const idle=()=>{if(!pendingRequests&&!audio.getState().length&&!audio.getPreloads().length)clear();};
 const revoke=()=>{audio.releasePreload();audio.stopAll();};
 const watch=()=>{if(stopWatch)return;const subscription=liveQuery(async()=>{await check();return mediaRows(scope.projectId,scope.eraId);}).subscribe({next:assets=>{if(!current()){revoke();return;}for(const row of audio.getState())if(row.ref.kind==='media'&&!assets.some(asset=>asset.id===(row.ref as {id:string}).id&&asset.kind==='audio'))audio.stop(row.id);for(const row of audio.getState())if(row.ref.kind==='source'&&assetResolve)void assetResolve(row.ref).then(value=>{if(!value||!current())audio.stop(row.id);}).catch(()=>audio.stop(row.id));for(const row of audio.getPreloads())if(row.version!==null)void resolve(row.ref).then(value=>{if(!value||!current()||value.version!==row.version)audio.releasePreload([row.id]);}).catch(()=>audio.releasePreload([row.id]));},error:revoke});stopWatch=()=>subscription.unsubscribe();};
 const register=()=>{pendingRequests++;activeOwners.set(audio,{scope:{...scope},coordinator});if(!stopState)stopState=audio.subscribe(idle);watch();};
 const result:LocalToolAudio=Object.freeze({...audio,preload:async(refs:readonly LocalAudioRef[],options?:{signal?:AbortSignal})=>{register();try{return await audio.preload(refs,options);}finally{pendingRequests--;idle();}},play:async(ref:LocalAudioRef,options?:LocalAudioOptions)=>{register();try{return await audio.play(ref,options);}finally{pendingRequests--;idle();}},dispose:()=>{clear();audio.dispose();}});return result;
}
