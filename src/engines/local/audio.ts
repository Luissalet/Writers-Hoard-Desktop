import {validateLocalAssetRef,type LocalAssetRef} from './assets';
export const LOCAL_AUDIO_BUSES=['music','ambience','sfx','voice','ui'] as const;
export type LocalAudioBus=typeof LOCAL_AUDIO_BUSES[number];
export type LocalAudioFocus='mix'|'duck'|'exclusive';
export type LocalAudioRef=Extract<LocalAssetRef,{kind:'source'}>|{kind:'media';id:string}
export interface LocalAudioOptions {bus?:LocalAudioBus;focus?:LocalAudioFocus;volume?:number;pan?:number;loop?:boolean;fadeInMs?:number;signal?:AbortSignal}
export interface LocalAudioUpdate {volume?:number;pan?:number;loop?:boolean;bus?:LocalAudioBus;focus?:LocalAudioFocus;fadeMs?:number}
export interface LocalAudioState {id:string;ref:LocalAudioRef;bus:LocalAudioBus;focus:LocalAudioFocus;volume:number;pan:number;loop:boolean;status:'loading'|'playing'|'paused';effectiveVolume:number}
export interface LocalAudioPosition {positionSeconds:number;durationSeconds:number}
export interface LocalAudioChannelLevels {rms:number;peak:number}
export interface LocalAudioLevels extends LocalAudioChannelLevels {left:LocalAudioChannelLevels;right:LocalAudioChannelLevels}
export interface LocalToolAudio {
 readonly available:boolean;readonly supportsPan:boolean;
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
export interface LocalAudioBackend {available:boolean;supportsPan?:boolean;unlock():boolean;resume?():Promise<boolean>;prepare(blob:Blob):Promise<LocalAudioVoice>;close():void}
export interface LocalAudioOwner {resolve(ref:LocalAudioRef):Promise<{blob:Blob;version:string}|null>;current?:()=>boolean}
const level=(value:number|undefined,fallback:number)=>{if(value===undefined)return fallback;if(!Number.isFinite(value)||value<0||value>1)throw Error('local_audio_volume_invalid');return value;};
const pan=(value:number|undefined,fallback=0)=>{const next=value??fallback;if(!Number.isFinite(next)||next<-1||next>1)throw Error('local_audio_pan_invalid');return next;};
const duration=(value:number|undefined)=>{if(value===undefined)return 0;if(!Number.isFinite(value)||value<0)throw Error('local_audio_fade_invalid');return value;};
const bus=(value:LocalAudioBus|undefined,fallback:LocalAudioBus)=>{if(value!==undefined&&!LOCAL_AUDIO_BUSES.includes(value))throw Error('local_audio_bus_invalid');return value??fallback;};
const focus=(value:LocalAudioFocus|undefined,fallback:LocalAudioFocus)=>{if(value!==undefined&&!['mix','duck','exclusive'].includes(value))throw Error('local_audio_focus_invalid');return value??fallback;};
export function validateLocalAudioRef(ref:LocalAudioRef){try{validateLocalAssetRef(ref);if((ref as LocalAssetRef).kind!=='source'&&(ref as LocalAssetRef).kind!=='media')throw Error();}catch{throw Error('local_audio_ref_invalid');}}
interface RecordEntry extends LocalAudioState {owner:symbol;voice?:LocalAudioVoice;version?:string;transportEpoch:number}
const transport=(voice:LocalAudioVoice|undefined):voice is LocalAudioVoice&Required<Pick<LocalAudioVoice,'pause'|'resume'|'seek'|'getPosition'>>=>!!voice&&typeof voice.pause==='function'&&typeof voice.resume==='function'&&typeof voice.seek==='function'&&typeof voice.getPosition==='function';
/** One coordinator per host. Backend injection enables silent deterministic contract tests. */
export function createLocalAudioEngine(backend:LocalAudioBackend){
 const records=new Map<string,RecordEntry>(),levels=new Map<LocalAudioBus,number>(),listeners=new Set<()=>void>();let serial=0,pending=0,exclusiveGeneration=0;
 const publish=()=>{for(const changed of listeners)changed();};
 const idle=()=>{if(!records.size&&!pending)backend.close();};
 const rebalance=(fadeMs=0)=>{for(const row of records.values()){const ducked=!['voice','ui'].includes(row.bus)&&[...records.values()].some(other=>other.status==='playing'&&other.focus==='duck'&&other.bus!==row.bus);row.effectiveVolume=(row.status==='paused'?0:row.volume)*(levels.get(row.bus)??1)*(ducked?.25:1);row.voice?.update(row.effectiveVolume,row.loop,fadeMs);}publish();};
 const stop=(id:string,fadeMs=0)=>{const row=records.get(id);if(!row)return;records.delete(id);row.voice?.stop(fadeMs);rebalance(fadeMs);idle();};
 return{available:backend.available,getBusLevels:()=>Object.fromEntries(LOCAL_AUDIO_BUSES.map(name=>[name,levels.get(name)??1])),createOwner(owner:LocalAudioOwner):LocalToolAudio{
  const identity=Symbol(),owned=(id:string)=>{const row=records.get(id);return row?.owner===identity?row:undefined;};let disposed=false;
  const valid=()=>!disposed&&(owner.current?.()??true);
  const api:LocalToolAudio={available:backend.available,supportsPan:backend.supportsPan===true,
   async play(ref,options={}){
    validateLocalAudioRef(ref);const selectedBus=bus(options.bus,'sfx'),selectedFocus=focus(options.focus,'mix'),volume=level(options.volume,1),fade=duration(options.fadeInMs),selectedPan=pan(options.pan);
    if(selectedPan!==0&&!backend.supportsPan)throw Error('local_audio_pan_unavailable');
    if(!valid()||options.signal?.aborted||!backend.available||!backend.unlock())return null;
    pending++;const exclusiveRequest=selectedFocus==='exclusive'?++exclusiveGeneration:undefined;
    const id=`local-audio-${++serial}`,row:RecordEntry={id,owner:identity,ref:{...ref},bus:selectedBus,focus:selectedFocus,volume,pan:selectedPan,loop:options.loop??false,status:'loading',effectiveVolume:volume,transportEpoch:0};records.set(id,row);publish();
    const abort=()=>stop(id);options.signal?.addEventListener('abort',abort,{once:true});
    try{
     const source=await owner.resolve(ref);if(!source||!valid()||!owned(id)){stop(id);return null;}
     const voice=await backend.prepare(source.blob);
     const latest=await owner.resolve(ref);
     if(!latest||latest.version!==source.version||!valid()||!owned(id)||exclusiveRequest!==undefined&&exclusiveRequest!==exclusiveGeneration){voice.stop(0);stop(id);return null;}
     if(row.pan!==0&&!voice.setPan){voice.stop(0);throw Error('local_audio_pan_unavailable');}
     try{voice.setPan?.(row.pan,0);}catch(error){voice.stop(0);throw error;}
     row.voice=voice;row.version=source.version;row.status='playing';rebalance();voice.start(row.effectiveVolume,row.loop,fade,()=>stop(id));if(exclusiveRequest!==undefined)for(const other of [...records.keys()])if(other!==id)stop(other);publish();return owned(id)?id:null;
    }catch(error){stop(id);throw error;}finally{options.signal?.removeEventListener('abort',abort);pending--;idle();}
   },
   update(id,options){const row=owned(id);if(!row||!valid())return;const nextPan=pan(options.pan,row.pan),nextVolume=level(options.volume,row.volume),nextBus=bus(options.bus,row.bus),nextFocus=focus(options.focus,row.focus),fade=duration(options.fadeMs);if(nextPan!==0&&(!backend.supportsPan||row.voice&&!row.voice.setPan))throw Error('local_audio_pan_unavailable');row.voice?.setPan?.(nextPan,fade);if(nextFocus!==row.focus)row.transportEpoch++;row.pan=nextPan;row.volume=nextVolume;row.bus=nextBus;row.focus=nextFocus;row.loop=options.loop??row.loop;if(row.status!=='paused'&&row.focus==='exclusive')for(const other of [...records.keys()])if(other!==id)stop(other);rebalance(fade);},
   pause(id){const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;row.transportEpoch++;if(row.status==='paused')return true;if(!row.voice.pause())return false;row.status='paused';rebalance();return true;},
   async resume(id){
    const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;if(row.status==='playing')return true;
    const voice=row.voice,epoch=++row.transportEpoch,exclusiveRequest=row.focus==='exclusive'?++exclusiveGeneration:undefined;pending++;
    const current=()=>owned(id)===row&&valid()&&row.transportEpoch===epoch&&(exclusiveRequest===undefined||exclusiveRequest===exclusiveGeneration);
    try{
     const source=await owner.resolve(row.ref);if(!current()){if(!valid())stop(id);return false;}if(!source||source.version!==row.version){stop(id);return false;}
     if(backend.resume&&!await backend.resume())return false;
     if(!current()){if(!valid())stop(id);return false;}
     const latest=await owner.resolve(row.ref);if(!current()){if(!valid())stop(id);return false;}if(!latest||latest.version!==row.version){stop(id);return false;}
     if(!voice.resume())return false;if(owned(id)!==row)return false;row.status='playing';
     if(row.focus==='exclusive')for(const other of [...records.keys()])if(other!==id)stop(other);rebalance();return true;
    }finally{pending--;idle();}
   },
   seek(id,seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('local_audio_position_invalid');const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return false;row.transportEpoch++;if(!row.voice.seek(seconds))return false;if(owned(id)===row)rebalance();return true;},
   getPosition(id){const row=owned(id);if(!row||!valid()||!transport(row.voice)||row.status==='loading')return null;const value=row.voice.getPosition();return value&&Number.isFinite(value.positionSeconds)&&value.positionSeconds>=0&&Number.isFinite(value.durationSeconds)&&value.durationSeconds>=0?{...value}:null;},
   stop(id,options={}){if(owned(id))stop(id,duration(options.fadeOutMs));},
   stopAll(){for(const [id,row]of records)if(row.owner===identity)stop(id);},
   dispose(){disposed=true;api.stopAll();},
   setBusLevel(selectedBus,value){if(!valid())return;bus(selectedBus,'sfx');levels.set(selectedBus,level(value,1));rebalance();},
   getLevels(id){const row=owned(id);if(!valid()||row?.status!=='playing')return null;const value=row.voice?.getLevels?.();return value&&[value.rms,value.peak,value.left.rms,value.left.peak,value.right.rms,value.right.peak].every(number=>Number.isFinite(number)&&number>=0)?{rms:value.rms,peak:value.peak,left:{...value.left},right:{...value.right}}:null;},
   getState:()=>!valid()?[]:[...records.values()].filter(row=>row.owner===identity).map(row=>({id:row.id,ref:{...row.ref},bus:row.bus,focus:row.focus,volume:row.volume,pan:row.pan,loop:row.loop,status:row.status,effectiveVolume:row.effectiveVolume})),
   subscribe(changed){listeners.add(changed);return()=>{listeners.delete(changed);};},
  };return Object.freeze(api);
 }};
}
export const silentLocalToolAudio=():LocalToolAudio=>({available:false,supportsPan:false,getLevels:()=>null,pause:()=>false,resume:async()=>false,seek:()=>false,getPosition:()=>null,play:async()=>null,update:()=>{},stop:()=>{},stopAll:()=>{},dispose:()=>{},setBusLevel:()=>{},getState:()=>[],subscribe:()=>()=>{}});
