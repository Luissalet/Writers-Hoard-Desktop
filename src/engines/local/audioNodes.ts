import type {LocalAudioVoice,LocalAudioLevels} from './audio';

/** One real voice graph; accepting BaseAudioContext also permits device-free PCM tests. */
export function createLocalAudioVoice(context:BaseAudioContext,buffer:AudioBuffer,options:{current?:()=>boolean;tail?:(ms:number)=>void}={}):LocalAudioVoice{
 const source=context.createBufferSource(),gain=context.createGain(),panner=typeof context.createStereoPanner==='function'?context.createStereoPanner():undefined;
 // Explicit stereo keeps centre/default output equal to the previous mono upmix.
 gain.channelCount=2;gain.channelCountMode='explicit';
 if(panner){panner.channelCount=2;panner.channelCountMode='explicit';}
 source.buffer=buffer;source.connect(gain);const output=panner?(gain.connect(panner),panner):gain;output.connect(context.destination);
 const split=typeof context.createChannelSplitter==='function'?context.createChannelSplitter(2):undefined;
 const analysers=split&&typeof context.createAnalyser==='function'?[context.createAnalyser(),context.createAnalyser()]:[];
 if(split&&analysers.length){output.connect(split);analysers.forEach((node,index)=>{node.fftSize=2048;split.connect(node,index);});}
 const samples=analysers.map(node=>new Float32Array(node.fftSize));let started=false,stopped=false,disconnected=false,ended:()=>void=()=>{};
 const current=()=>!stopped&&(options.current?.()??true);
 const disconnect=()=>{if(disconnected)return;disconnected=true;source.disconnect();source.onended=null;source.buffer=null;gain.disconnect();panner?.disconnect();split?.disconnect();analysers.forEach(node=>node.disconnect());};
 source.onended=()=>{const notify=ended;ended=()=>{};stopped=true;disconnect();notify();};
 const ramp=(value:number,ms:number)=>{gain.gain.cancelScheduledValues(context.currentTime);gain.gain.setValueAtTime(gain.gain.value,context.currentTime);gain.gain.linearRampToValueAtTime(value,context.currentTime+ms/1000);};
 return{
  start(volume,loop,fadeMs,onended){if(!current())throw Error('local_audio_context_expired');ended=onended;source.loop=loop;gain.gain.value=fadeMs?0:volume;if(fadeMs)ramp(volume,fadeMs);source.start();started=true;},
  update(volume,loop,fadeMs){if(!current())return;source.loop=loop;ramp(volume,fadeMs);},
  setPan(value,fadeMs){if(!current())return;if(!panner){if(value!==0)throw Error('local_audio_pan_unavailable');return;}panner.pan.cancelScheduledValues(context.currentTime);panner.pan.setValueAtTime(panner.pan.value,context.currentTime);panner.pan.linearRampToValueAtTime(value,context.currentTime+fadeMs/1000);},
  getLevels(){if(!started||!current()||analysers.length!==2)return null;const channels=analysers.map((node,index)=>{const data=samples[index];node.getFloatTimeDomainData(data);let square=0,peak=0;for(const sample of data){if(!Number.isFinite(sample))return null;square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}return{rms:Math.sqrt(square/data.length),peak};});if(!channels[0]||!channels[1])return null;const [left,right]=channels;return{left,right,rms:Math.sqrt((left.rms*left.rms+right.rms*right.rms)/2),peak:Math.max(left.peak,right.peak)} satisfies LocalAudioLevels;},
  stop(fadeMs){if(stopped)return;if(started){options.tail?.(fadeMs);ramp(0,fadeMs);stopped=true;try{source.stop(context.currentTime+fadeMs/1000);if(fadeMs===0)disconnect();}catch{disconnect();}}else{stopped=true;disconnect();}},
 };
}
