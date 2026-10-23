import type {LocalAudioBackend,LocalAudioVoice} from './audio';
export interface LocalAudioRecordedCommand {kind:'unlock'|'prepare'|'start'|'update'|'stop'|'close';id?:number;volume?:number;loop?:boolean;fadeMs?:number}
/** An explicit recording backend, never a claim that samples reached a speaker. */
export function createRecordingLocalToolAudio(options:{available?:boolean;gesture?:()=>boolean;prepare?:()=>Promise<void>}={}){
 const commands:LocalAudioRecordedCommand[]=[],ended=new Map<number,()=>void>();let serial=0;
 const backend:LocalAudioBackend={available:options.available??true,unlock(){commands.push({kind:'unlock'});return options.gesture?.()??true;},async prepare(){const id=++serial;commands.push({kind:'prepare',id});await options.prepare?.();const voice:LocalAudioVoice={start(volume,loop,fadeMs,onended){ended.set(id,onended);commands.push({kind:'start',id,volume,loop,fadeMs});},update(volume,loop,fadeMs){commands.push({kind:'update',id,volume,loop,fadeMs});},stop(fadeMs){ended.delete(id);commands.push({kind:'stop',id,fadeMs});}};return voice;},close(){commands.push({kind:'close'});}};
 return{backend,commands,end:(id:number)=>{const callback=ended.get(id);ended.delete(id);callback?.();}};
}
