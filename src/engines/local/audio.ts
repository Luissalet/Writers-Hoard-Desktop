export const LOCAL_AUDIO_BUSES=['music','ambience','sfx','voice','ui'] as const;
export type LocalAudioBus=typeof LOCAL_AUDIO_BUSES[number];
export type LocalAudioFocus='mix'|'duck'|'exclusive';
export interface LocalAudioRef {kind:'media';id:string}
export interface LocalAudioOptions {bus?:LocalAudioBus;focus?:LocalAudioFocus;volume?:number;loop?:boolean;fadeInMs?:number;signal?:AbortSignal}
export interface LocalAudioUpdate {volume?:number;loop?:boolean;bus?:LocalAudioBus;focus?:LocalAudioFocus;fadeMs?:number}
export interface LocalAudioState {id:string;ref:LocalAudioRef;bus:LocalAudioBus;focus:LocalAudioFocus;volume:number;loop:boolean;status:'loading'|'playing';effectiveVolume:number}
export interface LocalToolAudio {
 readonly available:boolean;
 play(ref:LocalAudioRef,options?:LocalAudioOptions):Promise<string|null>;
 update(id:string,options:LocalAudioUpdate):void;
 stop(id:string,options?:{fadeOutMs?:number}):void;
 stopAll():void;dispose():void;
 setBusLevel(bus:LocalAudioBus,volume:number):void;
 getState():readonly LocalAudioState[];subscribe(changed:()=>void):()=>void;
}
export interface LocalAudioVoice {start(volume:number,loop:boolean,fadeMs:number,ended:()=>void):void;update(volume:number,loop:boolean,fadeMs:number):void;stop(fadeMs:number):void}
export interface LocalAudioBackend {available:boolean;unlock():boolean;prepare(blob:Blob):Promise<LocalAudioVoice>;close():void}
export interface LocalAudioOwner {resolve(ref:LocalAudioRef):Promise<{blob:Blob;version:string}|null>;current?:()=>boolean}
const level=(value:number|undefined,fallback:number)=>{if(value===undefined)return fallback;if(!Number.isFinite(value)||value<0||value>1)throw Error('local_audio_volume_invalid');return value;};
const duration=(value:number|undefined)=>{if(value===undefined)return 0;if(!Number.isFinite(value)||value<0)throw Error('local_audio_fade_invalid');return value;};
const bus=(value:LocalAudioBus|undefined,fallback:LocalAudioBus)=>{if(value!==undefined&&!LOCAL_AUDIO_BUSES.includes(value))throw Error('local_audio_bus_invalid');return value??fallback;};
const focus=(value:LocalAudioFocus|undefined,fallback:LocalAudioFocus)=>{if(value!==undefined&&!['mix','duck','exclusive'].includes(value))throw Error('local_audio_focus_invalid');return value??fallback;};
export function validateLocalAudioRef(ref:LocalAudioRef){if(!ref||ref.kind!=='media'||typeof ref.id!=='string'||!ref.id)throw Error('local_audio_ref_invalid');}
interface RecordEntry extends LocalAudioState {owner:symbol;voice?:LocalAudioVoice}
/** One coordinator per host. Backend injection enables silent deterministic contract tests. */
export function createLocalAudioEngine(backend:LocalAudioBackend){
 const records=new Map<string,RecordEntry>(),levels=new Map<LocalAudioBus,number>(),listeners=new Set<()=>void>();let serial=0,pending=0,exclusiveGeneration=0;
 const publish=()=>{for(const changed of listeners)changed();};
 const idle=()=>{if(!records.size&&!pending)backend.close();};
 const rebalance=(fadeMs=0)=>{for(const row of records.values()){const ducked=!['voice','ui'].includes(row.bus)&&[...records.values()].some(other=>other.status==='playing'&&other.focus==='duck'&&other.bus!==row.bus);row.effectiveVolume=row.volume*(levels.get(row.bus)??1)*(ducked?.25:1);row.voice?.update(row.effectiveVolume,row.loop,fadeMs);}publish();};
 const stop=(id:string,fadeMs=0)=>{const row=records.get(id);if(!row)return;records.delete(id);row.voice?.stop(fadeMs);rebalance(fadeMs);idle();};
 return{available:backend.available,getBusLevels:()=>Object.fromEntries(LOCAL_AUDIO_BUSES.map(name=>[name,levels.get(name)??1])),createOwner(owner:LocalAudioOwner):LocalToolAudio{
  const identity=Symbol(),owned=(id:string)=>{const row=records.get(id);return row?.owner===identity?row:undefined;};let disposed=false;
  const valid=()=>!disposed&&(owner.current?.()??true);
  const api:LocalToolAudio={available:backend.available,
   async play(ref,options={}){
    validateLocalAudioRef(ref);const selectedBus=bus(options.bus,'sfx'),selectedFocus=focus(options.focus,'mix'),volume=level(options.volume,1),fade=duration(options.fadeInMs);
    if(!valid()||options.signal?.aborted||!backend.available||!backend.unlock())return null;
    pending++;const exclusiveRequest=selectedFocus==='exclusive'?++exclusiveGeneration:undefined;
    const id=`local-audio-${++serial}`,row:RecordEntry={id,owner:identity,ref:{...ref},bus:selectedBus,focus:selectedFocus,volume,loop:options.loop??false,status:'loading',effectiveVolume:volume};records.set(id,row);publish();
    const abort=()=>stop(id);options.signal?.addEventListener('abort',abort,{once:true});
    try{
     const source=await owner.resolve(ref);if(!source||!valid()||!owned(id)){stop(id);return null;}
     const voice=await backend.prepare(source.blob);
     const latest=await owner.resolve(ref);
     if(!latest||latest.version!==source.version||!valid()||!owned(id)||exclusiveRequest!==undefined&&exclusiveRequest!==exclusiveGeneration){voice.stop(0);stop(id);return null;}
     row.voice=voice;row.status='playing';rebalance();voice.start(row.effectiveVolume,row.loop,fade,()=>stop(id));if(exclusiveRequest!==undefined)for(const other of [...records.keys()])if(other!==id)stop(other);publish();return owned(id)?id:null;
    }catch(error){stop(id);throw error;}finally{options.signal?.removeEventListener('abort',abort);pending--;idle();}
   },
   update(id,options){const row=owned(id);if(!row||!valid())return;row.volume=level(options.volume,row.volume);row.bus=bus(options.bus,row.bus);row.focus=focus(options.focus,row.focus);row.loop=options.loop??row.loop;if(row.focus==='exclusive')for(const other of [...records.keys()])if(other!==id)stop(other);rebalance(duration(options.fadeMs));},
   stop(id,options={}){if(owned(id))stop(id,duration(options.fadeOutMs));},
   stopAll(){for(const [id,row]of records)if(row.owner===identity)stop(id);},
   dispose(){disposed=true;api.stopAll();},
   setBusLevel(selectedBus,value){if(!valid())return;bus(selectedBus,'sfx');levels.set(selectedBus,level(value,1));rebalance();},
   getState:()=>[...records.values()].filter(row=>row.owner===identity).map(row=>({id:row.id,ref:{...row.ref},bus:row.bus,focus:row.focus,volume:row.volume,loop:row.loop,status:row.status,effectiveVolume:row.effectiveVolume})),
   subscribe(changed){listeners.add(changed);return()=>{listeners.delete(changed);};},
  };return Object.freeze(api);
 }};
}
export const silentLocalToolAudio=():LocalToolAudio=>({available:false,play:async()=>null,update:()=>{},stop:()=>{},stopAll:()=>{},dispose:()=>{},setBusLevel:()=>{},getState:()=>[],subscribe:()=>()=>{}});
