import {validateLocalAssetRef,type LocalAssetRef} from './assets';
export const LOCAL_AUDIO_BUSES=['music','ambience','sfx','voice','ui'] as const;
export type LocalAudioBus=typeof LOCAL_AUDIO_BUSES[number];
export type LocalAudioFocus='mix'|'duck'|'exclusive';
export type LocalAudioRef=Extract<LocalAssetRef,{kind:'source'}>|{kind:'media';id:string}
export interface LocalAudioOptions {bus?:LocalAudioBus;focus?:LocalAudioFocus;volume?:number;pan?:number;loop?:boolean;fadeInMs?:number;signal?:AbortSignal}
export interface LocalAudioUpdate {volume?:number;pan?:number;loop?:boolean;bus?:LocalAudioBus;focus?:LocalAudioFocus;fadeMs?:number}
export interface LocalAudioState {id:string;ref:LocalAudioRef;bus:LocalAudioBus;focus:LocalAudioFocus;volume:number;pan:number;loop:boolean;status:'loading'|'playing'|'paused';effectiveVolume:number}
export interface LocalAudioPreparation {id:string;ref:LocalAudioRef;status:'loading'|'ready'|'error'|'unavailable'|'cancelled';version:string|null;durationSeconds:number|null;error?:string}
export interface LocalAudioPrepared {readonly durationSeconds:number;createVoice():Promise<LocalAudioVoice>}
export interface LocalAudioResolved {blob:Blob;version:string;cacheKey?:string}
export interface LocalAudioPosition {positionSeconds:number;durationSeconds:number}
export interface LocalAudioChannelLevels {rms:number;peak:number}
export interface LocalAudioLevels extends LocalAudioChannelLevels {left:LocalAudioChannelLevels;right:LocalAudioChannelLevels}
export interface LocalToolAudio {
 readonly available:boolean;readonly supportsPan:boolean;readonly supportsPreload:boolean;
 preload(refs:readonly LocalAudioRef[],options?:{signal?:AbortSignal}):Promise<readonly LocalAudioPreparation[]>;
 getPreloads():readonly LocalAudioPreparation[];releasePreload(ids?:readonly string[]):number;
 play(ref:LocalAudioRef,options?:LocalAudioOptions):Promise<string|null>;
 update(id:string,options:LocalAudioUpdate):void;
 pause(id:string):boolean;resume(id:string):Promise<boolean>;seek(id:string,seconds:number):boolean;getPosition(id:string):LocalAudioPosition|null;
 stop(id:string,options?:{fadeOutMs?:number}):void;
 stopAll():void;dispose():void;
 setBusLevel(bus:LocalAudioBus,volume:number):void;
 getLevels(id:string):LocalAudioLevels|null;
 getState():readonly LocalAudioState[];subscribe(changed:()=>void):()=>void;
}
export interface LocalAudioVoice {start(volume:number,loop:boolean,fadeMs:number,ended:()=>void):void;update(volume:number,loop:boolean,fadeMs:number):void;stop(fadeMs:number):void;setPan?(pan:number,fadeMs:number):void;getLevels?():LocalAudioLevels|null;pause?():boolean;resume?():boolean;seek?(seconds:number):boolean;getPosition?():LocalAudioPosition|null}
export interface LocalAudioBackend {available:boolean;supportsPan?:boolean;unlock():boolean;resume?():Promise<boolean>;prepare(blob:Blob):Promise<LocalAudioVoice>;decode?(blob:Blob):Promise<LocalAudioPrepared>;close():void}
export interface LocalAudioOwner {resolve(ref:LocalAudioRef):Promise<LocalAudioResolved|null>;preloadScope?:string;current?:()=>boolean}
const level=(value:number|undefined,fallback:number)=>{if(value===undefined)return fallback;if(!Number.isFinite(value)||value<0||value>1)throw Error('local_audio_volume_invalid');return value;};
const pan=(value:number|undefined,fallback=0)=>{const next=value??fallback;if(!Number.isFinite(next)||next<-1||next>1)throw Error('local_audio_pan_invalid');return next;};
const duration=(value:number|undefined)=>{if(value===undefined)return 0;if(!Number.isFinite(value)||value<0)throw Error('local_audio_fade_invalid');return value;};
const bus=(value:LocalAudioBus|undefined,fallback:LocalAudioBus)=>{if(value!==undefined&&!LOCAL_AUDIO_BUSES.includes(value))throw Error('local_audio_bus_invalid');return value??fallback;};
const focus=(value:LocalAudioFocus|undefined,fallback:LocalAudioFocus)=>{if(value!==undefined&&!['mix','duck','exclusive'].includes(value))throw Error('local_audio_focus_invalid');return value??fallback;};
export function validateLocalAudioRef(ref:LocalAudioRef){try{validateLocalAssetRef(ref);if((ref as LocalAssetRef).kind!=='source'&&(ref as LocalAssetRef).kind!=='media')throw Error();}catch{throw Error('local_audio_ref_invalid');}}
interface PreloadEntry {promise:Promise<LocalAudioPrepared>;resource?:LocalAudioPrepared;retainers:Set<string>}
interface PreparationEntry extends LocalAudioPreparation {owner:symbol;entry?:PreloadEntry;key?:string}
const audioRefKey=(ref:LocalAudioRef)=>JSON.stringify(ref.kind==='media'?['media',ref.id]:['source',ref.namespace,ref.slot,ref.releaseHash??null]);
const preparationCopy=(row:LocalAudioPreparation):LocalAudioPreparation=>({id:row.id,ref:{...row.ref},status:row.status,version:row.version,durationSeconds:row.durationSeconds,...(row.error!==undefined?{error:row.error}:{})});
interface RecordEntry extends LocalAudioState {owner:symbol;voice?:LocalAudioVoice;version?:string;cacheKey?:string;transportEpoch:number}
const transport=(voice:LocalAudioVoice|undefined):voice is LocalAudioVoice&Required<Pick<LocalAudioVoice,'pause'|'resume'|'seek'|'getPosition'>>=>!!voice&&typeof voice.pause==='function'&&typeof voice.resume==='function'&&typeof voice.seek==='function'&&typeof voice.getPosition==='function';
/** One coordinator per host. Backend injection enables silent deterministic contract tests. */
export function createLocalAudioEngine(backend:LocalAudioBackend){
 const records=new Map<string,RecordEntry>(),levels=new Map<LocalAudioBus,number>(),listeners=new Set<()=>void>();let serial=0,pending=0,exclusiveGeneration=0,ownerSerial=0;
 const preparations=new Map<string,PreparationEntry>(),cache=new Map<string,PreloadEntry>();
 const publish=()=>{for(const changed of listeners)changed();};
 const idle=()=>{if(!records.size&&!pending)backend.close();};
 const rebalance=(fadeMs=0)=>{for(const row of records.values()){const ducked=!['voice','ui'].includes(row.bus)&&[...records.values()].some(other=>other.status==='playing'&&other.focus==='duck'&&other.bus!==row.bus);row.effectiveVolume=(row.status==='paused'?0:row.volume)*(levels.get(row.bus)??1)*(ducked?.25:1);row.voice?.update(row.effectiveVolume,row.loop,fadeMs);}publish();};
 const detachPreparation=(row:PreparationEntry)=>{const entry=row.entry;if(!entry)return;entry.retainers.delete(row.id);if(row.key&&cache.get(row.key)===entry&&!entry.retainers.size)cache.delete(row.key);row.entry=undefined;};
 const releasePreparation=(id:string)=>{const row=preparations.get(id);if(!row)return false;preparations.delete(id);detachPreparation(row);publish();return true;};
 const stop=(id:string,fadeMs=0)=>{const row=records.get(id);if(!row)return;records.delete(id);row.voice?.stop(fadeMs);rebalance(fadeMs);idle();};
 return{available:backend.available,getBusLevels:()=>Object.fromEntries(LOCAL_AUDIO_BUSES.map(name=>[name,levels.get(name)??1])),createOwner(owner:LocalAudioOwner):LocalToolAudio{
  const identity=Symbol(),privateScope=`owner-${++ownerSerial}`,cacheKey=(ref:LocalAudioRef,source:LocalAudioResolved)=>JSON.stringify([owner.preloadScope===undefined?['private',privateScope]:['shared',owner.preloadScope],source.cacheKey??audioRefKey(ref),source.version]),owned=(id:string)=>{const row=records.get(id);return row?.owner===identity?row:undefined;};let disposed=false;
  const valid=()=>!disposed&&(owner.current?.()??true);
  const api:LocalToolAudio={available:backend.available,supportsPan:backend.supportsPan===true,supportsPreload:backend.available&&typeof backend.decode==='function',
   async preload(refs,options={}){
    if(!Array.isArray(refs))throw Error('local_audio_preload_refs_invalid');for(const ref of refs)validateLocalAudioRef(ref);
    return Promise.all(refs.map(value=>({...value})).map(async ref=>{
     const row:PreparationEntry={id:'local-audio-preparation-'+crypto.randomUUID(),ref:{...ref},owner:identity,status:'loading',version:null,durationSeconds:null};
     const cancelled=()=>({...preparationCopy(row),status:'cancelled' as const,durationSeconds:null});
     if(!valid()||options.signal?.aborted)return cancelled();if(!api.supportsPreload)return{...preparationCopy(row),status:'unavailable' as const};
     preparations.set(row.id,row);publish();const current=()=>valid()&&!options.signal?.aborted&&preparations.get(row.id)===row;
     const abort=()=>releasePreparation(row.id);options.signal?.addEventListener('abort',abort,{once:true});
     try{
      const source=await owner.resolve(ref);if(!current()){releasePreparation(row.id);return cancelled();}if(!source)throw Error('local_audio_source_unavailable');
      row.version=source.version;row.key=cacheKey(ref,source);let entry=cache.get(row.key);
      if(!entry){entry={retainers:new Set(),promise:Promise.resolve().then(()=>backend.decode!(source.blob))};cache.set(row.key,entry);}
      row.entry=entry;entry.retainers.add(row.id);const resource=await entry.promise;
      if(!current()){releasePreparation(row.id);return cancelled();}
      const latest=await owner.resolve(ref);if(!current()){releasePreparation(row.id);return cancelled();}
      if(!latest||cacheKey(ref,latest)!==row.key)throw Error('local_audio_preload_source_changed');
      if(!resource||!Number.isFinite(resource.durationSeconds)||resource.durationSeconds<0||typeof resource.createVoice!=='function')throw Error('local_audio_preload_invalid');
      if(cache.get(row.key)!==entry){releasePreparation(row.id);return cancelled();}
      entry.resource=resource;row.status='ready';row.durationSeconds=resource.durationSeconds;publish();return preparationCopy(row);
     }catch(error){if(!current()){releasePreparation(row.id);return cancelled();}detachPreparation(row);row.status='error';row.durationSeconds=null;row.error=error instanceof Error?error.message:String(error);publish();return preparationCopy(row);}
     finally{options.signal?.removeEventListener('abort',abort);}
    }));
   },
   getPreloads:()=>!valid()?[]:[...preparations.values()].filter(row=>row.owner===identity).map(preparationCopy),
   releasePreload(ids){if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Error('local_audio_preload_ids_invalid');let released=0;for(const row of [...preparations.values()])if(row.owner===identity&&(!ids||ids.includes(row.id)))released+=Number(releasePreparation(row.id));return released;},
   async play(ref,options={}){
    validateLocalAudioRef(ref);const selectedBus=bus(options.bus,'sfx'),selectedFocus=focus(options.focus,'mix'),volume=level(options.volume,1),fade=duration(options.fadeInMs),selectedPan=pan(options.pan);
    if(selectedPan!==0&&!backend.supportsPan)throw Error('local_audio_pan_unavailable');
    if(!valid()||options.signal?.aborted||!backend.available||!backend.unlock())return null;
    pending++;const exclusiveRequest=selectedFocus==='exclusive'?++exclusiveGeneration:undefined;
    const id=`local-audio-${++serial}`,row:RecordEntry={id,owner:identity,ref:{...ref},bus:selectedBus,focus:selectedFocus,volume,pan:selectedPan,loop:options.loop??false,status:'loading',effectiveVolume:volume,transportEpoch:0};records.set(id,row);publish();
    const abort=()=>stop(id);options.signal?.addEventListener('abort',abort,{once:true});
    try{
     const source=await owner.resolve(ref);if(!source||!valid()||!owned(id)){stop(id);return null;}
     const key=cacheKey(ref,source),entry=cache.get(key);let resource:LocalAudioPrepared|undefined;
     if(entry)try{const decoded=entry.resource??await entry.promise;if(cache.get(key)===entry&&entry.retainers.size&&decoded&&Number.isFinite(decoded.durationSeconds)&&decoded.durationSeconds>=0&&typeof decoded.createVoice==='function')resource=decoded;}catch{/* A preparation failure never removes normal Play fallback. */}
     if(!valid()||!owned(id)){stop(id);return null;}
     const voice=resource?await resource.createVoice():await backend.prepare(source.blob);
     const latest=await owner.resolve(ref);
     if(!latest||cacheKey(ref,latest)!==key||!valid()||!owned(id)||exclusiveRequest!==undefined&&exclusiveRequest!==exclusiveGeneration){voice.stop(0);stop(id);return null;}
     if(row.pan!==0&&!voice.setPan){voice.stop(0);throw Error('local_audio_pan_unavailable');}
     try{voice.setPan?.(row.pan,0);}catch(error){voice.stop(0);throw error;}
     row.voice=voice;row.version=source.version;row.cacheKey=key;row.status='playing';rebalance();voice.start(row.effectiveVolume,row.loop,fade,()=>stop(id));if(exclusiveRequest!==undefined)for(const other of [...records.keys()])if(other!==id)stop(other);publish();return owned(id)?id:null;
    }catch(error){stop(id);throw error;}finally{options.signal?.removeEventListener('abort',abort);pending--;idle();}
   },
   update(id,options){const row=owned(id);if(!row||!valid())return;const nextPan=pan(options.pan,row.pan),nextVolume=level(options.volume,row.volume),nextBus=bus(options.bus,row.bus),nextFocus=focus(options.focus,row.focus),fade=duration(options.fadeMs);if(nextPan!==0&&(!backend.supportsPan||row.voice&&!row.voice.setPan))throw Error('local_audio_pan_unavailable');row.voice?.setPan?.(nextPan,fade);if(nextFocus!==row.focus)row.transportEpoch++;row.pan=nextPan;row.volume=nextVolume;row.bus=nextBus;row.focus=nextFocus;row.loop=options.loop??row.loop;if(row.status!=='paused'&&row.focus==='exclusive')for(const other of [...records.keys()])if(other!==id)stop(other);rebalance(fade);},
   pause(id){const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;row.transportEpoch++;if(row.status==='paused')return true;if(!row.voice.pause())return false;row.status='paused';rebalance();return true;},
   async resume(id){
    const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;if(row.status==='playing')return true;
    const voice=row.voice,epoch=++row.transportEpoch,exclusiveRequest=row.focus==='exclusive'?++exclusiveGeneration:undefined;pending++;
    const current=()=>owned(id)===row&&valid()&&row.transportEpoch===epoch&&(exclusiveRequest===undefined||exclusiveRequest===exclusiveGeneration);
    try{
     const source=await owner.resolve(row.ref);if(!current()){if(!valid())stop(id);return false;}if(!source||cacheKey(row.ref,source)!==row.cacheKey){stop(id);return false;}
     if(backend.resume&&!await backend.resume())return false;
     if(!current()){if(!valid())stop(id);return false;}
     const latest=await owner.resolve(row.ref);if(!current()){if(!valid())stop(id);return false;}if(!latest||cacheKey(row.ref,latest)!==row.cacheKey){stop(id);return false;}
     if(!voice.resume())return false;if(owned(id)!==row)return false;row.status='playing';
     if(row.focus==='exclusive')for(const other of [...records.keys()])if(other!==id)stop(other);rebalance();return true;
    }finally{pending--;idle();}
   },
   seek(id,seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('local_audio_position_invalid');const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;row.transportEpoch++;if(!row.voice.seek(seconds))return false;if(owned(id)===row)rebalance();return true;},
   getPosition(id){const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return null;const value=row.voice.getPosition();return value&&Number.isFinite(value.positionSeconds)&&value.positionSeconds>=0&&Number.isFinite(value.durationSeconds)&&value.durationSeconds>=0?{...value}:null;},
   stop(id,options={}){if(owned(id))stop(id,duration(options.fadeOutMs));},
   stopAll(){for(const [id,row]of records)if(row.owner===identity)stop(id);},
   dispose(){disposed=true;api.releasePreload();api.stopAll();},
   setBusLevel(selectedBus,value){if(!valid())return;bus(selectedBus,'sfx');levels.set(selectedBus,level(value,1));rebalance();},
   getLevels(id){const row=owned(id);if(!valid()||row?.status!=='playing')return null;const value=row.voice?.getLevels?.();return value&&[value.rms,value.peak,value.left.rms,value.left.peak,value.right.rms,value.right.peak].every(number=>Number.isFinite(number)&&number>=0)?{rms:value.rms,peak:value.peak,left:{...value.left},right:{...value.right}}:null;},
   getState:()=>!valid()?[]:[...records.values()].filter(row=>row.owner===identity).map(row=>({id:row.id,ref:{...row.ref},bus:row.bus,focus:row.focus,volume:row.volume,pan:row.pan,loop:row.loop,status:row.status,effectiveVolume:row.effectiveVolume})),
   subscribe(changed){listeners.add(changed);return()=>{listeners.delete(changed);};},
  };return Object.freeze(api);
 }};
}
export const silentLocalToolAudio=():LocalToolAudio=>({available:false,supportsPan:false,supportsPreload:false,preload:async refs=>{if(!Array.isArray(refs))throw Error('local_audio_preload_refs_invalid');for(const ref of refs)validateLocalAudioRef(ref);return refs.map(ref=>({id:'local-audio-preparation-'+crypto.randomUUID(),ref:{...ref},status:'unavailable',version:null,durationSeconds:null}));},getPreloads:()=>[],releasePreload:()=>0,getLevels:()=>null,pause:()=>false,resume:async()=>false,seek:()=>false,getPosition:()=>null,play:async()=>null,update:()=>{},stop:()=>{},stopAll:()=>{},dispose:()=>{},setBusLevel:()=>{},getState:()=>[],subscribe:()=>()=>{}});
