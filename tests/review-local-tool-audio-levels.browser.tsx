import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {createLocalAudioEngine,type LocalAudioLevels} from '@/engines/local/audio';
import {createLocalAudioVoice} from '@/engines/local/audioNodes';
import {createRecordingLocalToolAudio} from '@/engines/local/audioTesting';
import {useLocalToolAudioLevels} from '@/engines/local/useLocalToolAudioLevels';
import {createBrowserLocalToolAudio} from '@/engines/local/audioBrowser';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {pcmWave} from './local-tool-audio-levels.browser';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const near=(value:number,expected:number,message:string)=>assert(Math.abs(value-expected)<.0001,message+': '+value+' expected '+expected);
const pause=()=>new Promise(resolve=>setTimeout(resolve,60));

/** A nonconstant stereo waveform distinguishes RMS from peak or absolute mean. */
export async function reviewAudioVariablePcm(){
 const context=new OfflineAudioContext(2,62400,48000),sources:AudioBufferSourceNode[]=[],create=context.createBufferSource.bind(context);Object.defineProperty(context,'createBufferSource',{value:()=>{const node=create();sources.push(node);return node;}});
 const engine=createLocalAudioEngine({available:true,supportsPan:true,unlock:()=>true,prepare:async blob=>{const buffer=context.createBuffer(2,62400,48000),signal=await blob.text()==='signal',left=[1,0,-1,0],right=[.5,.5,-.5,-.5];if(signal)for(let i=0;i<buffer.length;i++){buffer.getChannelData(0)[i]=left[i%4];buffer.getChannelData(1)[i]=right[i%4];}return createLocalAudioVoice(context,buffer);},close:()=>{}}),owner=engine.createOwner({resolve:async()=>({blob:new Blob(['signal']),version:'v1'})}),duck=engine.createOwner({resolve:async()=>({blob:new Blob(['silence']),version:'v1'})});
 try{
  const id=await owner.play({kind:'media',id:'variable'},{bus:'music',volume:.4,loop:true});assert(id,'Variable PCM voice unavailable');
  const stages=[.2,.4,.6,.8,1].map(time=>context.suspend(time)),render=context.startRendering();await stages[0];
  const check=(value:LocalAudioLevels|null,gain:number)=>{assert(value,'Actual channel analyser missing');near(value.left.rms,Math.SQRT1_2*gain,'Left variable RMS');near(value.left.peak,gain,'Left peak');near(value.right.rms,.5*gain,'Right RMS');near(value.right.peak,.5*gain,'Right peak');near(value.rms,Math.sqrt(.375)*gain,'Aggregate channel power');near(value.peak,gain,'Aggregate peak');};
  check(owner.getLevels(id),.4);owner.setBusLevel('music',.5);await context.resume();await stages[1];check(owner.getLevels(id),.2);
  const quiet=await duck.play({kind:'media',id:'duck'},{bus:'voice',focus:'duck',loop:true});assert(quiet,'Silent duck fixture unavailable');await context.resume();await stages[2];check(owner.getLevels(id),.05);
  assert(duck.getLevels(quiet)?.peak===0,'Silent duck source fabricated energy');duck.stop(quiet);owner.setBusLevel('music',1);owner.update(id,{volume:1,pan:-1});await context.resume();await stages[3];
  const clipped=owner.getLevels(id);assert(clipped,'Panned variable PCM unavailable');near(clipped.left.peak,1.5,'Internal peak above one must not clamp');near(clipped.left.rms,Math.sqrt(1.25),'Internal RMS above one must not clamp');near(clipped.right.peak,0,'Hard-left right channel');
  owner.stop(id,{fadeOutMs:40});assert(owner.getLevels(id)===null,'Retired fade tail exposed old samples');await context.resume();await stages[4];await context.resume();await render;await pause();
  assert(sources.length===2&&sources.every(source=>source.buffer===null&&source.onended===null),'Ended/stopped real voice retained decoded buffer or end handler');
  return ['Actual variable stereo PCM distinguishes RMS/peak/power, measures bus and silent-voice duck, preserves peaks above one and releases real fade-tail buffers'];
 }finally{owner.dispose();duck.dispose();}
}

export async function reviewAudioNodeFallback(){
 const context=new OfflineAudioContext(2,4800,48000);Object.defineProperty(context,'createStereoPanner',{value:undefined});Object.defineProperty(context,'createAnalyser',{value:undefined});
 const engine=createLocalAudioEngine({available:true,supportsPan:false,unlock:()=>true,prepare:async()=>{const buffer=context.createBuffer(1,4800,48000);buffer.getChannelData(0).fill(.3);return createLocalAudioVoice(context,buffer);},close:()=>{}}),audio=engine.createOwner({resolve:async()=>({blob:new Blob(['fixture']),version:'v1'})});
 try{
  const id=await audio.play({kind:'media',id:'fallback'},{volume:.25});assert(id,'Real fallback graph failed to play at centre');const suspended=context.suspend(.05),render=context.startRendering();await suspended;
  assert(!audio.supportsPan&&audio.getLevels(id)===null,'Missing node capabilities fabricated pan or zero measurement');let refused=false;try{audio.update(id,{pan:.2,volume:0});}catch{refused=true;}
  assert(refused&&audio.getState()[0].volume===.25&&audio.getState()[0].pan===0,'Unsupported stereo update altered valid fallback playback');await context.resume();const output=await render;
  near(output.getChannelData(0)[1000],.075,'Real fallback left samples');near(output.getChannelData(1)[1000],.075,'Real fallback right samples');
  return ['Actual graph without panner/analysers preserves centre playback PCM, reports null measurement and rejects unsupported pan atomically'];
 }finally{audio.dispose();}
}

/** Lifecycle fixture values are explicit, not an assertion about PCM or hardware. */
export async function reviewAudioMeterVisibility(){
 let visible=true,reads=0,current=true;const originalHidden=Object.getOwnPropertyDescriptor(document,'hidden');Object.defineProperty(document,'hidden',{configurable:true,get:()=>!visible});
 const recorded=createRecordingLocalToolAudio(),prepare=recorded.backend.prepare;recorded.backend.prepare=async blob=>({...await prepare(blob),getLevels:()=>{reads++;return{rms:.3,peak:.4,left:{rms:.3,peak:.4},right:{rms:.3,peak:.4}};}});
 const audio=createLocalAudioEngine(recorded.backend).createOwner({current:()=>current,resolve:async()=>({blob:new Blob(['fixture']),version:'v1'})}),id=await audio.play({kind:'media',id:'visibility'}),root=createRoot(document.getElementById('root')!);assert(id,'Visibility lifecycle voice unavailable');
 function Meter(){const value=useLocalToolAudioLevels(audio,id);return <output>{value?.rms??'unavailable'}</output>;}
 try{
  await act(async()=>{root.render(<StrictMode><Meter/></StrictMode>);await pause();});assert(document.querySelector('output')?.textContent==='0.3','Visible sampler did not read explicit fixture');
  await act(async()=>{visible=false;document.dispatchEvent(new Event('visibilitychange'));await pause();});const hiddenReads=reads;await act(async()=>{await pause();});assert(reads===hiddenReads&&document.querySelector('output')?.textContent==='unavailable','Hidden view continued sampling or kept old meter value');
  assert(audio.getState().length===1&&!recorded.commands.some(command=>command.kind==='stop'),'Hiding opt-in meter stopped playback');
  await act(async()=>{visible=true;document.dispatchEvent(new Event('visibilitychange'));await pause();});assert(reads>hiddenReads&&document.querySelector('output')?.textContent==='0.3','Visible view did not restart current meter');
  current=false;await act(async()=>{await pause();});const expiredReads=reads;await act(async()=>{await pause();});assert(reads===expiredReads&&document.querySelector('output')?.textContent==='unavailable','Expired owner kept measuring');
  await act(async()=>root.unmount());const endedReads=reads;await pause();assert(reads===endedReads,'Unmount left RAF reads');
  return ['Real opt-in hook pauses sampling/clears values while hidden without stopping playback, resumes current view and ceases reads on lease loss/unmount'];
 }finally{audio.dispose();if(originalHidden)Object.defineProperty(document,'hidden',originalHidden);else delete (document as unknown as Record<string,unknown>).hidden;}
}

/** Production backend with an offline graph and controlled context-state facade.
 * It tests state/read side effects, never device suspension or hardware output. */
export async function reviewAudioSuspendedRead(){
 const P='review-audio-levels-suspended',context=new OfflineAudioContext(2,57600,48000),resumeRender=context.resume.bind(context),originalContext=globalThis.AudioContext,activation=Object.getOwnPropertyDescriptor(navigator,'userActivation');let state='suspended',constructs=0,resumes=0;
 Object.defineProperty(context,'state',{get:()=>state});Object.defineProperty(context,'resume',{value:async()=>{resumes++;state='running';}});Object.defineProperty(context,'close',{value:async()=>{state='closed';}});
 globalThis.AudioContext=class {constructor(){constructs++;return context;}} as unknown as typeof AudioContext;Object.defineProperty(navigator,'userActivation',{configurable:true,value:{isActive:true}});
 const audio=createBrowserLocalToolAudio({projectId:P},async()=>{},()=>true);
 try{
  await db.projects.put({id:P,title:'Controlled suspended backend',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888',enabledEngines:[],createdAt:1,updatedAt:1});const blob=pcmWave(.5,1.2);await db.localMediaAssets.put({id:P+'-media',projectId:P,title:'Offline signal',kind:'audio',mime:'audio/wav',blob,size:blob.size,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  assert(audio.getLevels('unknown')===null&&constructs===0&&resumes===0,'Idle production read constructed/resumed context');
  const id=await audio.play({kind:'media',id:P+'-media'},{volume:.4,loop:true});assert(id,'Production backend could not prepare offline graph');const suspended=context.suspend(.3),render=context.startRendering();await suspended;
  assert(audio.getLevels(id)!.rms>.19,'Production wrapper did not expose real offline samples in running facade');const count=resumes;
  for(const unavailable of ['suspended','closed']){state=unavailable;assert(audio.getLevels(id)===null,'Production wrapper exposed samples in '+unavailable+' facade');}
  assert(resumes===count&&constructs===1,'Measurement read resumed or recreated production context');state='running';assert(audio.getLevels(id)!.peak>.19,'Running context did not restore current measured window');
  audio.stop(id);assert(audio.getLevels(id)===null,'Stopped production wrapper retained samples');await resumeRender();await render;await pause();
  return ['Production backend returns null for controlled suspended/closed states without resume/context creation, while the same offline graph supplies real running PCM'];
 }finally{audio.dispose();await pause();globalThis.AudioContext=originalContext;if(activation)Object.defineProperty(navigator,'userActivation',activation);else Reflect.deleteProperty(navigator,'userActivation');await deleteProject(P);}
}
