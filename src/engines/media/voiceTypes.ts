/** Shared renderer/main/worker contract. Pure data, without DOM or database imports. */
export interface VoiceWord { id:string; start:number; end:number; text:string; probability:number }
export interface VoiceSegment { id:string; start:number; end:number; originalText:string; text:string; words:VoiceWord[]; edited?:boolean }
export interface VoiceTranscript { version:1; revision:number; language:string; model:string; device:'cpu'; duration:number; prompt:string; createdAt:number; segments:VoiceSegment[] }
export interface VoiceMemoClip {
  version:1; memoId:string; title:string; order:number; revision:number; archived:boolean;
  recording?:{sessionId:string; state:'recording'|'paused'|'recovered'|'finished'; elapsed:number;sequence?:number};
  transcript?:VoiceTranscript;
  job?:{requestId:string; baseRevision:number;eraId?:string};
}
export interface VoiceRuntimeStatus { ready:boolean; runtime:boolean; model:boolean; device:'cpu'; modelName:string; error?:string; setupRunning?:boolean }
export interface VoiceTranscriptRequest { requestId:string; bytes:Uint8Array; mime:string; language?:string; initialPrompt?:string }
export interface VoiceJob { requestId:string; state:'queued'|'running'|'done'|'error'|'cancelled'; progress:number; transcript?:Omit<VoiceTranscript,'revision'>; error?:string;applied?:boolean;conflict?:boolean }
export interface VoiceRuntimeAPI {
  voiceStatus():Promise<VoiceRuntimeStatus>;
  setupVoice():Promise<VoiceRuntimeStatus>;
  startVoiceTranscript(request:VoiceTranscriptRequest):Promise<VoiceJob>;
  voiceTranscriptStatus(requestId:string):Promise<VoiceJob>;
  cancelVoiceTranscript(requestId:string):Promise<VoiceJob>;
}
