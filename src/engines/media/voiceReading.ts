import type {VoiceTranscript} from './voiceTypes';
import {voiceText,voiceSubtitles} from './transcriptText';
import {validateVoiceMeta} from './voiceValidation';
import type {LocalMediaAsset} from './types';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const clock=(value:number)=>`${Math.floor(value/60)}:${String(Math.floor(value)%60).padStart(2,'0')}`;
/** Authored, validated transcript only. No jobs, prompt, DB IDs or model service. */
export function voiceReadingMarkup(asset:Pick<LocalMediaAsset,'voiceMemo'|'title'>,locale:'es'|'en',source?:{url:string;filename:string}):string{
 const meta=asset.voiceMemo;if(!meta?.transcript)return '';validateVoiceMeta(meta);const transcript:VoiceTranscript=meta.transcript,es=locale==='es';
 const words=(segment:VoiceTranscript['segments'][number])=>segment.words.map(word=>`<button type="button" data-voice-seek="${word.start}" data-voice-end="${word.end}" data-voice-word aria-label="${es?'Escuchar':'Listen to'} ${esc(word.text.trim())}">${esc(word.text)}</button>`).join('');
 const download=(format:'txt'|'srt'|'vtt')=>`<a download="${esc(asset.title.replace(/[<>:"/\\|?*]/g,'_'))}.${format}" href="data:text/plain;charset=utf-8,${esc(encodeURIComponent(format==='txt'?voiceText(transcript):voiceSubtitles(transcript,format)))}">${format.toUpperCase()}</a>`;
 const original=source&&/^(blob:|data:audio\/)/.test(source.url)?`<a download="${esc(source.filename)}" href="${esc(source.url)}">${es?'Audio original':'Original audio'}</a>`:'';
 return `<section class="wh-voice-reading" data-wh-voice-reading><details open><summary>${es?'Transcripción':'Transcript'} · ${esc(transcript.language)}</summary><div class="wh-voice-downloads">${original}${(['txt','srt','vtt']as const).map(download).join(' · ')}</div><div class="wh-voice-segments">${transcript.segments.map(segment=>`<div class="wh-voice-segment"><button type="button" data-voice-seek="${segment.start}" aria-label="${es?'Ir a':'Seek to'} ${clock(segment.start)}">${clock(segment.start)}</button>${segment.edited?`<p>${esc(segment.text)}</p><details><summary>${es?'Texto editado; anclajes del audio original':'Edited text; original audio anchors'}</summary><p>${words(segment)||esc(segment.originalText)}</p></details>`:`<p>${segment.words.length?words(segment):esc(segment.text)}</p>`}</div>`).join('')}</div><p class="wh-voice-status" role="status"></p></details></section>`;
}
export const VOICE_READING_CSS='.wh-voice-reading{margin:16px 0;font:inherit}.wh-voice-reading summary{cursor:pointer;min-height:36px}.wh-voice-downloads{display:flex;flex-wrap:wrap;gap:12px;font-size:.85em;margin:12px 0}.wh-voice-reading .wh-voice-downloads a{color:inherit;text-underline-offset:3px}.wh-voice-reading :focus-visible{outline:2px solid currentColor;outline-offset:2px}.wh-voice-segments{max-height:28rem;overflow:auto}.wh-voice-segment{padding:12px 0;border-top:1px solid currentColor}.wh-voice-segment p{white-space:pre-wrap;margin:8px 0}.wh-voice-segment button{font:inherit;min-height:32px;border:0;border-radius:3px;background:transparent;color:inherit;padding:2px 4px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.wh-voice-segment button[aria-current=true]{background:#e7c777;color:#202b2a}.wh-voice-segment details{font-size:.85em}.wh-voice-status{font-size:.85em}@media print{.wh-voice-segments{max-height:none;overflow:visible}.wh-voice-downloads,.wh-voice-status{display:none}}';
/** Serializable standalone runtime; all inputs come from the generated DOM. */
export function installVoiceReading(root:ParentNode):()=>void{
 const cleanup:Array<()=>void>=[];
 for(const section of root.querySelectorAll<HTMLElement>('[data-wh-voice-reading]')){
  const media=section.closest('figure')?.querySelector<HTMLMediaElement>('audio,video');if(!media)continue;
  const buttons=[...section.querySelectorAll<HTMLButtonElement>('button[data-voice-seek]')],status=section.querySelector<HTMLElement>('[role=status]'),es=media.ownerDocument.documentElement.lang==='es';
  const update=()=>{for(const button of buttons){const active=button.hasAttribute('data-voice-word')&&media.currentTime>=Number(button.dataset.voiceSeek)&&media.currentTime<Number(button.dataset.voiceEnd);if(active)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');}};
  for(const button of buttons){const seek=()=>{const seconds=Number(button.dataset.voiceSeek);if(!Number.isFinite(seconds)||seconds<0)return;try{media.currentTime=Number.isFinite(media.duration)?Math.min(seconds,media.duration):seconds;update();if(status)status.textContent='';if(button.hasAttribute('data-voice-word'))void media.play().catch(()=>{if(status)status.textContent=es?'Usa los controles de audio para reproducir.':'Use the audio controls to play.';});}catch{if(status)status.textContent=es?'El audio aún no está listo. Usa los controles de reproducción.':'Audio is not ready yet. Use the playback controls.';}};button.addEventListener('click',seek);cleanup.push(()=>button.removeEventListener('click',seek));}
  media.addEventListener('timeupdate',update);cleanup.push(()=>media.removeEventListener('timeupdate',update));update();
 }
 return()=>cleanup.forEach(dispose=>dispose());
}
