import type {VoiceTranscript} from './voiceTypes';
export function voiceText(transcript:VoiceTranscript){return transcript.segments.map(segment=>segment.text).join('\n');}
function time(value:number,separator:string){const ms=Math.round(value*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${separator}${String(ms%1000).padStart(3,'0')}`;}
export function voiceSubtitles(transcript:VoiceTranscript,format:'srt'|'vtt'){return (format==='vtt'?'WEBVTT\n\n':'')+transcript.segments.map((segment,index)=>`${format==='srt'?`${index+1}\n`:''}${time(segment.start,format==='srt'?',':'.')} --> ${time(segment.end,format==='srt'?',':'.')}\n${segment.text}\n`).join('\n');}
