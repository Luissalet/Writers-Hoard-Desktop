import { db } from '@/db';
import {mediaAsset,mediaRows,saveMediaAsset} from './scope';
import { trackPendingWrite } from '@/services/pendingWrites';
import { LocalVoiceRecorder } from './recorder';
import { addVoiceRecording } from './voiceModel';
import { MAX_MEDIA_BYTES,MAX_PROJECT_MEDIA_BYTES,mediaFilename,type LocalMediaAsset } from './types';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
interface CaptureOptions{eraId?:string;memoId?:string;title:string;onSaved?:(asset:LocalMediaAsset)=>void;onAutoPause?:()=>void;onError?:(error:unknown)=>void;elapsed:()=>number}
/** Recorder snapshots are durable every MediaRecorder chunk; retry is idempotent by sequence. */
export class VoiceMemoCapture{
  private projectId:string;private options:CaptureOptions;
  readonly id=crypto.randomUUID();private sessionId=crypto.randomUUID();private recorder:LocalVoiceRecorder;private chunks:Blob[]=[];private queue:Promise<unknown>=Promise.resolve();private sequence=0;private latest:{blob:Blob;state:'recording'|'paused'|'finished';elapsed:number;sequence:number}|null=null;private stopped=false;private stopping:Promise<LocalMediaAsset>|null=null;private asset:LocalMediaAsset|undefined;
  constructor(projectId:string,options:CaptureOptions){this.projectId=projectId;this.options=options;this.recorder=new LocalVoiceRecorder({onChunk:chunk=>{this.chunks.push(chunk);this.schedule('recording');},onAutoPause:()=>{this.schedule('paused');options.onAutoPause?.();}});}
  async start(){await this.recorder.start();}
  pause(){this.recorder.pause();this.schedule('paused');}
  resume(){this.recorder.resume();this.schedule('recording');}
  private schedule(state:'recording'|'paused'|'finished',blob=new Blob(this.chunks,{type:this.chunks[0]?.type||'audio/webm'})){
    if(!blob.size)return;const snapshot={blob,state,elapsed:this.options.elapsed(),sequence:++this.sequence};this.latest=snapshot;
    this.queue=this.queue.catch(()=>undefined).then(()=>trackPendingWrite(this.persist(snapshot),()=>this.latest?this.persist(this.latest):Promise.resolve(),`voice-capture:${this.id}`));void this.queue.catch(error=>this.options.onError?.(error));
  }
  private async persist(snapshot:NonNullable<VoiceMemoCapture['latest']>){
    if(snapshot.blob.size>MAX_MEDIA_BYTES)throw new Error('media_capacity');const recording={sessionId:this.sessionId,state:snapshot.state,elapsed:snapshot.elapsed,sequence:snapshot.sequence};
    if(!this.asset){this.asset=await addVoiceRecording(this.projectId,new File([snapshot.blob],mediaFilename({title:this.options.title,mime:snapshot.blob.type,kind:'audio'}),{type:snapshot.blob.type}),{assetId:this.id,memoId:this.options.memoId,title:this.options.title,recording},this.options.eraId);}
    else await db.transaction('rw',db.tables,async()=>{const current=await mediaAsset(this.projectId,this.id,this.options.eraId);if(!current?.voiceMemo)throw new Error('voice_recording_missing');if((current.voiceMemo.recording?.sequence??0)>=snapshot.sequence)return;const all=await mediaRows(this.projectId,this.options.eraId);if(all.reduce((sum,item)=>sum+item.size,0)-current.size+snapshot.blob.size>MAX_PROJECT_MEDIA_BYTES)throw new Error('media_capacity');await saveMediaAsset(this.projectId,{...current,blob:snapshot.blob,size:snapshot.blob.size,voiceMemo:{...current.voiceMemo,recording},updatedAt:Date.now()},current,this.options.eraId,{checkpoint:snapshot.state!=='finished'});});
    notifyDataChanged({source:'other',table:'localMediaAssets',projectId:this.projectId,entityId:this.id});const saved=await mediaAsset(this.projectId,this.id,this.options.eraId);if(saved){this.asset=saved;this.options.onSaved?.(saved);}return saved;
  }
  stop():Promise<LocalMediaAsset>{if(this.stopping)return this.stopping;this.stopped=true;return this.stopping=(async()=>{try{const blob=await this.recorder.stop();this.schedule('finished',blob);await this.queue;if(!this.asset)throw new Error('empty_voice_recording');return this.asset;}finally{this.recorder.dispose();}})();}
  dispose(){if(!this.stopped)void this.stop().catch(error=>this.options.onError?.(error));}
}
