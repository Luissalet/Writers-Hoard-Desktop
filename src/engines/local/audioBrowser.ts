import { liveQuery } from 'dexie';
import { mediaRows } from '@/engines/media/scope';
import { createLocalAudioEngine,type LocalAudioBackend,type LocalToolAudio } from './audio';
import type { WorldEraScope } from '@/services/worldEras/types';
/** Lazy WebAudio graph, separate from the unchanged legacy Soundscape/Reader players. */
const createBrowserBackend=():LocalAudioBackend=>{
 let context:AudioContext|undefined,closeTimer:ReturnType<typeof setTimeout>|undefined,tailUntil=0,resumed:Promise<void>=Promise.resolve();
 return{available:typeof AudioContext!=='undefined',
  unlock(){if(!navigator.userActivation?.isActive)return false;if(closeTimer)clearTimeout(closeTimer);closeTimer=undefined;if(!context||context.state==='closed')context=new AudioContext();resumed=context.state==='suspended'?context.resume():Promise.resolve();void resumed.catch(()=>{});return true;},
  async prepare(blob){const current=context;if(!current)throw Error('local_audio_not_unlocked');await resumed;if(current!==context)throw Error('local_audio_context_expired');const buffer=await current.decodeAudioData(await blob.arrayBuffer()),source=current.createBufferSource(),gain=current.createGain();let started=false,ended:()=>void=()=>{};source.buffer=buffer;source.connect(gain).connect(current.destination);source.onended=()=>{source.disconnect();gain.disconnect();ended();};
   const ramp=(value:number,ms:number)=>{gain.gain.cancelScheduledValues(current.currentTime);gain.gain.setValueAtTime(gain.gain.value,current.currentTime);gain.gain.linearRampToValueAtTime(value,current.currentTime+ms/1000);};
   return{start(volume,loop,fadeMs,onended){if(current!==context)throw Error('local_audio_context_expired');ended=onended;source.loop=loop;gain.gain.value=fadeMs?0:volume;if(fadeMs)ramp(volume,fadeMs);started=true;source.start();},update(volume,loop,fadeMs){source.loop=loop;ramp(volume,fadeMs);},stop(fadeMs){if(started){tailUntil=Math.max(tailUntil,Date.now()+fadeMs);ramp(0,fadeMs);try{source.stop(current.currentTime+fadeMs/1000);}catch{/* ended */}}else{source.disconnect();gain.disconnect();}}};
  },
  close(){const prior=context;if(!prior)return;if(closeTimer)clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(context===prior){context=undefined;void prior.close();}},Math.max(0,tailUntil-Date.now()));},
 };
};
const engine=createLocalAudioEngine(createBrowserBackend());
const activeOwners=new Map<LocalToolAudio,{scope:WorldEraScope;coordinator:typeof engine}>();
export function localAudioSessionStatus(scope:WorldEraScope){const owners=[...activeOwners].filter(([,entry])=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId);return{available:engine.available,playing:owners.flatMap(([audio])=>audio.getState()),busLevels:(owners[0]?.[1].coordinator??engine).getBusLevels()};}
export function stopLocalAudioSession(scope:WorldEraScope,id?:string){let stopped=0;for(const [audio,entry]of [...activeOwners])if(entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId)for(const row of audio.getState())if(!id||row.id===id){audio.stop(row.id);stopped++;}return stopped;}
export function setLocalAudioBus(scope:WorldEraScope,bus:import('./audio').LocalAudioBus,volume:number){const coordinators=new Set([...activeOwners.values()].filter(entry=>entry.scope.projectId===scope.projectId&&entry.scope.eraId===scope.eraId).map(entry=>entry.coordinator));if(!coordinators.size)coordinators.add(engine);for(const coordinator of coordinators){const owner=coordinator.createOwner({resolve:async()=>null});owner.setBusLevel(bus,volume);owner.dispose();}}
export function createBrowserLocalToolAudio(scope:WorldEraScope,check:()=>Promise<unknown>,current:()=>boolean,coordinator=engine):LocalToolAudio{
 const resolve=async(id:string)=>{await check();if(!current())return null;const asset=(await mediaRows(scope.projectId,scope.eraId)).find(row=>row.id===id&&row.kind==='audio');return asset?{blob:asset.blob,version:JSON.stringify([asset.id,asset.updatedAt,asset.size,asset.mime])}:null;};
 const audio=coordinator.createOwner({current,resolve:ref=>resolve(ref.id)});let stopWatch:(()=>void)|undefined,stopState:(()=>void)|undefined,pendingPlays=0;
 const clear=()=>{stopWatch?.();stopWatch=undefined;stopState?.();stopState=undefined;activeOwners.delete(audio);};
 const watch=()=>{if(stopWatch)return;const subscription=liveQuery(async()=>{await check();return mediaRows(scope.projectId,scope.eraId);}).subscribe({next:assets=>{if(!current()){audio.stopAll();return;}for(const row of audio.getState())if(!assets.some(asset=>asset.id===row.ref.id&&asset.kind==='audio'))audio.stop(row.id);},error:()=>audio.stopAll()});stopWatch=()=>subscription.unsubscribe();};
 return Object.freeze({...audio,play:async(ref:import('./audio').LocalAudioRef,options?:import('./audio').LocalAudioOptions)=>{pendingPlays++;activeOwners.set(audio,{scope:{...scope},coordinator});if(!stopState)stopState=audio.subscribe(()=>{if(!pendingPlays&&!audio.getState().length)clear();});watch();try{return await audio.play(ref,options);}finally{pendingPlays--;if(!pendingPlays&&!audio.getState().length)clear();}},dispose:()=>{clear();audio.dispose();}});
}
