import type {VoiceMemoClip} from './voiceTypes';
function finite(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
export function validateVoiceMeta(value:unknown):asserts value is VoiceMemoClip{
  if(!value||typeof value!=='object')throw new Error('invalid_voice_memo');const meta=value as VoiceMemoClip;
  if(meta.version!==1||typeof meta.memoId!=='string'||!meta.memoId||typeof meta.title!=='string'||!meta.title.trim()||!Number.isSafeInteger(meta.order)||meta.order<0||!Number.isSafeInteger(meta.revision)||meta.revision<0||typeof meta.archived!=='boolean')throw new Error('invalid_voice_memo');
  if(meta.recording&&(!meta.recording.sessionId||!['recording','paused','recovered','finished'].includes(meta.recording.state)||!finite(meta.recording.elapsed)))throw new Error('invalid_voice_recording');
  if(meta.job&&(!meta.job.requestId||!Number.isSafeInteger(meta.job.baseRevision)||meta.job.baseRevision<0||meta.job.eraId!==undefined&&typeof meta.job.eraId!=='string'))throw new Error('invalid_voice_job');
  const transcript=meta.transcript;if(!transcript)return;
  if(transcript.version!==1||!Number.isSafeInteger(transcript.revision)||transcript.revision<0||!finite(transcript.duration)||transcript.device!=='cpu'||typeof transcript.language!=='string'||typeof transcript.model!=='string'||typeof transcript.prompt!=='string'||!finite(transcript.createdAt)||!Array.isArray(transcript.segments))throw new Error('invalid_voice_transcript');
  const ids=new Set<string>();let previous=0;
  for(const segment of transcript.segments){if(!segment.id||ids.has(segment.id)||!finite(segment.start)||!finite(segment.end)||segment.end<segment.start||segment.start<previous||typeof segment.text!=='string'||typeof segment.originalText!=='string'||!Array.isArray(segment.words))throw new Error('invalid_voice_segment');ids.add(segment.id);previous=segment.start;const words=new Set<string>();for(const word of segment.words){if(!word.id||words.has(word.id)||!finite(word.start)||!finite(word.end)||word.end<word.start||typeof word.text!=='string'||!finite(word.probability)||word.probability>1)throw new Error('invalid_voice_word');words.add(word.id);}}
}
