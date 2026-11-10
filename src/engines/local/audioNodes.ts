import type {LocalAudioVoice,LocalAudioLevels} from './audio';

/** A retained decoded buffer and graph, with a fresh one-shot source for every audible segment. */
export function createLocalAudioVoice(context:BaseAudioContext,buffer:AudioBuffer,options:{current?:()=>boolean;tail?:(ms:number)=>void}={}):LocalAudioVoice{
 let decoded:AudioBuffer|null=buffer,source:AudioBufferSourceNode|undefined;
 const duration=buffer.duration,gain=context.createGain(),panner=typeof context.createStereoPanner==='function'?context.createStereoPanner():undefined;
 gain.channelCount=2;gain.channelCountMode='explicit';
 if(panner){panner.channelCount=2;panner.channelCountMode='explicit';}
 const output=panner?(gain.connect(panner),panner):gain;output.connect(context.destination);
 source=context.createBufferSource();source.buffer=decoded;source.connect(gain);
 const split=typeof context.createChannelSplitter==='function'?context.createChannelSplitter(2):undefined;
 const analysers=split&&typeof context.createAnalyser==='function'?[context.createAnalyser(),context.createAnalyser()]:[];
 if(split&&analysers.length){output.connect(split);analysers.forEach((node,index)=>{node.fftSize=2048;split.connect(node,index);});}
 const samples=analysers.map(node=>new Float32Array(node.fftSize));
 let started=false,playing=false,finished=false,stopping=false,loop=false,offset=0,startedAt=0,ended:()=>void=()=>{};
 const current=()=>!finished&&!stopping&&(options.current?.()??true);
 const normalized=(seconds:number)=>loop&&duration>0?seconds%duration:Math.min(seconds,duration);
 const position=()=>normalized(offset+(playing?Math.max(0,context.currentTime-startedAt):0));
 const detach=(stop=true)=>{const prior=source;source=undefined;if(!prior)return;prior.onended=null;prior.disconnect();if(stop)try{prior.stop();}catch{/* already ended */}prior.buffer=null;};
 const finish=(notify:boolean)=>{if(finished)return;finished=true;playing=false;detach();decoded=null;gain.disconnect();panner?.disconnect();split?.disconnect();analysers.forEach(node=>node.disconnect());const callback=ended;ended=()=>{};if(notify)callback();};
 const ramp=(value:number,ms:number)=>{gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setValueAtTime(gain.gain.value,context.currentTime);gain.gain.linearRampToValueAtTime(value,context.currentTime+ms/1000);};
 const begin=()=>{if(!decoded||!current())return false;if(!loop&&offset>=duration){finish(true);return true;}let next=source;if(!next){next=context.createBufferSource();next.buffer=decoded;next.connect(gain);source=next;}next.loop=loop;next.onended=()=>{if(source!==next||finished)return;finish(true);};startedAt=context.currentTime;playing=true;try{next.start(0,offset);}catch(error){playing=false;detach();throw error;}return true;};
 return{
  start(volume,repeats,fadeMs,onended){if(!current()||started)throw Error('local_audio_context_expired');started=true;ended=onended;loop=repeats;gain.gain.value=fadeMs?0:volume;if(fadeMs)ramp(volume,fadeMs);begin();},
  update(volume,repeats,fadeMs){if(!current())return;if(loop!==repeats){offset=position();startedAt=context.currentTime;loop=repeats;}if(source)source.loop=loop;ramp(volume,fadeMs);},
  pause(){if(!current()||!started)return false;if(!playing)return true;offset=position();playing=false;detach();return true;},
  resume(){if(!current()||!started)return false;return playing||begin();},
  seek(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('local_audio_position_invalid');if(!current()||!started)return false;const wasPlaying=playing;offset=normalized(seconds);playing=false;detach();if(!loop&&offset>=duration){finish(true);return true;}return wasPlaying?begin():true;},
  getPosition(){return current()&&started?{positionSeconds:position(),durationSeconds:duration}:null;},
  setPan(value,fadeMs){if(!current())return;if(!panner){if(value!==0)throw Error('local_audio_pan_unavailable');return;}panner.pan.cancelScheduledValues(context.currentTime);panner.pan.setValueAtTime(panner.pan.value,context.currentTime);panner.pan.linearRampToValueAtTime(value,context.currentTime+fadeMs/1000);},
  getLevels(){if(!playing||!current()||analysers.length!==2)return null;const channels=analysers.map((node,index)=>{const data=samples[index];node.getFloatTimeDomainData(data);let square=0,peak=0;for(const sample of data){if(!Number.isFinite(sample))return null;square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}return{rms:Math.sqrt(square/data.length),peak};});if(!channels[0]||!channels[1])return null;const [left,right]=channels;return{left,right,rms:Math.sqrt((left.rms*left.rms+right.rms*right.rms)/2),peak:Math.max(left.peak,right.peak)} satisfies LocalAudioLevels;},
  stop(fadeMs){if(finished||stopping)return;if(playing&&fadeMs>0&&source){options.tail?.(fadeMs);ramp(0,fadeMs);stopping=true;try{source.stop(context.currentTime+fadeMs/1000);}catch{finish(false);}}else finish(false);},
 };
}
