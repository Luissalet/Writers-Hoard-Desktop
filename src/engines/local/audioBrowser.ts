import {createLocalAudioVoice} from './audioNodes';
import { liveQuery } from 'dexie';
import { mediaRows } from '@/engines/media/scope';
import { createLocalAudioEngine,type LocalAudioBackend,type LocalToolAudio } from './audio';
import type { WorldEraScope } from '@/services/worldEras/types';
/** Lazy WebAudio graph, separate from the unchanged legacy Soundscape/Reader players. */
const createBrowserBackend=():LocalAudioBackend=>{
 let context:AudioContext|undefined,closeTimer:ReturnType<typeof setTimeout>|undefined,tailUntil=0,resumed:Promise<void>=Promise.resolve();
 return{available:typeof AudioContext!=='undefined',supportsPan:typeof AudioContext!=='undefined'&&typeof AudioContext.prototype.createStereoPanner==='function',
  unlock(){if(!navigator.userActivation?.isActive)return false;if(closeTimer)clearTimeout(closeTimer);closeTimer=undefined;if(!context||context.state==='closed')context=new AudioContext();resumed=context.state==='suspended'?context.resume():Promise.resolve();void resumed.catch(()=>{});return true;},
  async prepare(blob){const current=context;if(!current)throw Error('local_audio_not_unlocked');await resumed;if(current!==context)throw Error('local_audio_context_expired');const buffer=await current.decodeAudioData(await blob.arrayBuffer()),voice=createLocalAudioVoice(current,buffer,{current:()=>current===context,tail:ms=>{tailUntil=Math.max(tailUntil,Date.now()+ms);}});
   return{...voice,getLevels:()=>current===context&&current.state==='running'?voice.getLevels?.()??null:null};
  },
  close(){const prior=context;if(!prior)return;if(closeTimer)clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(context===prior){context=undefined;void prior.close();}},Math.max(0,tailUntil-Date.now()));},
 };
};
const engine=createLocalAudioEngine(createBrowserBackend());
const activeOwners=new Map<LocalToolAudio,{scope:WorldEraScope;coordinator:typeof engine}>();
export function localAudioSessionStatus(scope:WorldEraScope,includeLevels=false){const owners=[...activeOwners].filter(([,entry])=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId);return{available:engine.available,playing:owners.flatMap(([audio])=>audio.getState().map(row=>includeLevels?{...row,levels:audio.getLevels(row.id)}:row)),busLevels:(owners[0]?.[1].coordinator??engine).getBusLevels()};}
export function stopLocalAudioSession(scope:WorldEraScope,id?:string){let stopped=0;for(const [audio,entry]of [...activeOwners])if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId)for(const row of audio.getState())if(!id||row.id===id){audio.stop(row.id);stopped++;}return stopped;}
export function panLocalAudioSession(scope:WorldEraScope,id:string,pan:number){for(const [audio,entry]of activeOwners)if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId&&audio.getState().some(row=>row.id===id)){audio.update(id,{pan});return audio.getState().find(row=>row.id===id)??null;}return null;}
export function setLocalAudioBus(scope:WorldEraScope,bus:import('./audio').LocalAudioBus,volume:number){const coordinators=new Set([...activeOwners.values()].filter(entry=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId).map(entry=>entry.coordinator));if(!coordinators.size)coordinators.add(engine);for(const coordinator of coordinators){const owner=coordinator.createOwner({resolve:async()=>null});owner.setBusLevel(bus,volume);owner.dispose();}}
export function createBrowserLocalToolAudio(scope:WorldEraScope,check:()=>Promise<unknown>,current:()=>boolean,coordinator=engine,assetResolve?:(ref:import('./assets').LocalAssetRef)=>Promise<import('./assets').LocalAssetResolved|null>):LocalToolAudio{
 const resolve=async(id:string)=>{await check();if(!current())return null;const asset=(await mediaRows(scope.projectId,scope.eraId)).find(row=>row.id===id&&row.kind==='audio');return asset?{blob:asset.blob,version:JSON.stringify([asset.id,asset.updatedAt,asset.size,asset.mime])}:null;};
 const audio=coordinator.createOwner({current,resolve:async ref=>{if(ref.kind==='media')return resolve(ref.id);const value=await assetResolve?.(ref);return value?.kind==='audio'?{blob:value.blob,version:value.version}:null;}});let stopWatch:(()=>void)|undefined,stopState:(()=>void)|undefined,pendingPlays=0;
 const clear=()=>{stopWatch?.();stopWatch=undefined;stopState?.();stopState=undefined;activeOwners.delete(audio);};
 const watch=()=>{if(stopWatch)return;const subscription=liveQuery(async()=>{await check();return mediaRows(scope.projectId,scope.eraId);}).subscribe({next:assets=>{if(!current()){audio.stopAll();return;}for(const row of audio.getState())if(row.ref.kind==='media'&&!assets.some(asset=>asset.id===(row.ref as {id:string}).id&&asset.kind==='audio'))audio.stop(row.id);for(const row of audio.getState())if(row.ref.kind==='source'&&assetResolve)void assetResolve(row.ref).then(value=>{if(!value||!current())audio.stop(row.id);}).catch(()=>audio.stop(row.id));},error:()=>audio.stopAll()});stopWatch=()=>subscription.unsubscribe();};
 return Object.freeze({...audio,play:async(ref:import('./audio').LocalAudioRef,options?:import('./audio').LocalAudioOptions)=>{pendingPlays++;activeOwners.set(audio,{scope:{...scope},coordinator});if(!stopState)stopState=audio.subscribe(()=>{if(!pendingPlays&&!audio.getState().length)clear();});watch();try{return await audio.play(ref,options);}finally{pendingPlays--;if(!pendingPlays&&!audio.getState().length)clear();}},dispose:()=>{clear();audio.dispose();}});
}
