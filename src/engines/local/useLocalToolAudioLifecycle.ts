import {useEffect,useRef} from 'react';
import type {LocalToolAudio} from './audio';
/** Stop synchronously; defer irreversible disposal across StrictMode's same-client replay. */
export function useLocalToolAudioLifecycle(audio:LocalToolAudio|undefined){
 const committed=useRef<{audio:LocalToolAudio;token:object}|undefined>(undefined);
 useEffect(()=>{if(!audio)return;const token={};committed.current={audio,token};return()=>{audio.stopAll();queueMicrotask(()=>{if(committed.current?.audio!==audio||committed.current?.token===token)audio.dispose();});};},[audio]);
}
