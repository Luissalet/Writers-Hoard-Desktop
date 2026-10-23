import {useEffect,useState} from 'react';
import type {LocalToolAudio,LocalAudioLevels} from './audio';
/** Opt-in visual sampling only; reading never creates/resumes an audio context. */
export function useLocalToolAudioLevels(audio:LocalToolAudio|undefined,handleId:string|null){
 const [state,setState]=useState<{audio:typeof audio;handleId:string|null;levels:LocalAudioLevels|null}>();
 useEffect(()=>{let active=true,frame:number|undefined;const sample=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;if(!active)return;const playing=!!handleId&&audio?.getState().some(row=>row.id===handleId&&row.status==='playing');const levels=playing&&!document.hidden?audio?.getLevels?.(handleId!)??null:null;setState({audio,handleId,levels});if(playing&&!document.hidden)frame=requestAnimationFrame(sample);};sample();const off=audio?.subscribe(sample);document.addEventListener('visibilitychange',sample);return()=>{active=false;if(frame!==undefined)cancelAnimationFrame(frame);off?.();document.removeEventListener('visibilitychange',sample);};},[audio,handleId]);
 return state&&state.audio===audio&&state.handleId===handleId?state.levels:null;
}
