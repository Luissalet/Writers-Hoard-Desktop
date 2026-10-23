import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import type {Project} from '@/types';
import {deleteProject} from '@/db/operations';
import {createLocalAudioEngine} from '@/engines/local/audio';
import {createRecordingLocalToolAudio} from '@/engines/local/audioTesting';
import {createBrowserLocalToolAudio,localAudioSessionStatus} from '@/engines/local/audioBrowser';
import {useSound} from '@/engines/local/useLocalToolAudio';
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function reviewAudioSessionRegistry():Promise<string[]>{
 const P='review-audio-exclusive-registry',scope={projectId:P},recording=createRecordingLocalToolAudio(),engine=createLocalAudioEngine(recording.backend),audio=createBrowserLocalToolAudio(scope,async()=>{if(!await db.projects.get(P))throw Error('missing');},()=>true,engine);
 try{
  await db.projects.put({id:P,title:'Audio registry fixture',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:[],createdAt:1,updatedAt:1} as Project);
  await db.localMediaAssets.put({id:P+'-media',projectId:P,title:'Fixture audio',kind:'audio',mime:'audio/wav',blob:new Blob(['fixture']),size:7,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  const ref={kind:'media' as const,id:P+'-media'};
  assert(await audio.play(ref,{bus:'sfx'}),'Initial real scoped play failed');
  assert(localAudioSessionStatus(scope).playing.length===1,'Initial scoped status absent');
  assert(await audio.play(ref,{bus:'music',focus:'exclusive',loop:true}),'Exclusive replacement failed');
  assert(audio.getState().length===1,'Exclusive actual handle absent');
  assert(localAudioSessionStatus(scope).playing.length===1,'Exclusive replacement unregisters its live owner: native status loses the playing handle');
  await db.localMediaAssets.delete(ref.id);
  for(let i=0;i<60&&audio.getState().length;i++)await pause();
  assert(audio.getState().length===0,'Exclusive replacement lost media watcher: deleted asset still plays');
  return ['Exclusive replacement remains visible to native scoped status and deletion revokes its new handle'];
 }finally{audio.dispose();if(await db.projects.get(P))await deleteProject(P);}
}
export async function reviewAudioHookRetarget():Promise<string[]>{
 const recording=createRecordingLocalToolAudio(),audio=createLocalAudioEngine(recording.backend).createOwner({resolve:async()=>({blob:new Blob(['fixture']),version:'1'})}),client={audio},root=createRoot(document.getElementById('root')!);
 function Fixture({id}:{id:string}){const sound=useSound(client,{kind:'media',id});return <><button onClick={()=>{void sound.play();}}>Play</button><output>{sound.playing?'Playing':'Stopped'}</output></>;}
 try{
  await act(async()=>{root.render(<Fixture id="one"/>);await pause();});
  await act(async()=>{document.querySelector<HTMLButtonElement>('button')!.click();await pause();});
  assert(document.querySelector('output')?.textContent==='Playing'&&audio.getState().length===1,'Fixture did not start');
  await act(async()=>{root.render(<Fixture id="two"/>);await pause();});
  assert(!audio.getState().length,'Retarget did not stop old handle');
  assert(document.querySelector('output')?.textContent==='Stopped','Retargeted useSound reports Playing after all old handles stopped');
  return ['Retargeting a real SDK hook stops its old handles and clears playing state'];
 }finally{await act(async()=>root.unmount());audio.dispose();}
}
export async function reviewAudioFailedExclusive():Promise<string[]>{
 let mode:'ready'|'reject'|'wait'='ready',release=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;}),recording=createRecordingLocalToolAudio({prepare:async()=>{if(mode==='reject')throw Error('decode failed');if(mode==='wait')await pending;}}),engine=createLocalAudioEngine(recording.backend),source={resolve:async()=>({blob:new Blob(['fixture']),version:'1'})},music=engine.createOwner(source),missing=engine.createOwner({resolve:async()=>null}),replacement=engine.createOwner(source);
 try{
  const original=await music.play({kind:'media',id:'saved-music'},{bus:'music',loop:true});assert(original,'Fixture music did not start');
  assert(await missing.play({kind:'media',id:'missing'},{focus:'exclusive'})===null,'Missing source unexpectedly started');
  assert(music.getState().some(row=>row.id===original),'Exclusive request for absent media stopped unrelated valid music before source validation');
  mode='reject';let rejected=false;try{await replacement.play({kind:'media',id:'corrupt'},{focus:'exclusive'});}catch{rejected=true;}
  assert(rejected&&music.getState().some(row=>row.id===original),'Decode failure displaced valid previous music');
  mode='wait';const abort=new AbortController(),next=replacement.play({kind:'media',id:'cancelled'},{focus:'exclusive',signal:abort.signal});await pause();abort.abort();release();
  assert(await next===null&&music.getState().some(row=>row.id===original),'Aborted exclusive preparation displaced valid previous music');
  return ['Missing, failed decode and aborted exclusive preparation all preserve previously valid playback'];
 }finally{release();music.dispose();missing.dispose();replacement.dispose();}
}
export async function reviewAudioExclusiveRace():Promise<string[]>{
 let release=()=>{},waiting=false;
 const pending=new Promise<void>(resolve=>{release=resolve;}),recording=createRecordingLocalToolAudio({prepare:async()=>{if(!waiting){waiting=true;await pending;}}}),engine=createLocalAudioEngine(recording.backend),source={resolve:async()=>({blob:new Blob(['fixture']),version:'1'})},older=engine.createOwner(source),newer=engine.createOwner(source);
 try{
  const first=older.play({kind:'media',id:'slow'},{focus:'exclusive'});while(!waiting)await pause();
  const second=await newer.play({kind:'media',id:'newest'},{focus:'exclusive'});assert(second,'Newest exclusive failed to start');release();
  assert(await first===null&&newer.getState().some(row=>row.id===second)&&!older.getState().length,'An older late exclusive displaced the newer valid playback');
  return ['An older prepared exclusive cannot displace the newer successful request'];
 }finally{release();older.dispose();newer.dispose();}
}
export async function reviewAudioResumeFailure():Promise<string[]>{
 const P='review-audio-resume-failure',originalContext=globalThis.AudioContext,activation=Object.getOwnPropertyDescriptor(navigator,'userActivation');let starts=0;
 const failedResume=Promise.reject(new Error('independent audio device resume failed'));void failedResume.catch(()=>{});
 class InertContext{
  state='suspended';currentTime=0;destination={};
  resume(){return failedResume;}
  async close(){this.state='closed';}
  async decodeAudioData(){return {};}
  createGain(){return{gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  createBufferSource(){return{buffer:null,loop:false,onended:null,connect(node:unknown){return node;},disconnect(){},start(){starts++;},stop(){}};}
 }
 globalThis.AudioContext=InertContext as unknown as typeof AudioContext;
 Object.defineProperty(navigator,'userActivation',{configurable:true,value:{isActive:true}});
 const scope={projectId:P},audio=createBrowserLocalToolAudio(scope,async()=>{},()=>true);
 try{
  await db.projects.put({id:P,title:'Resume fixture',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888888',enabledEngines:[],createdAt:1,updatedAt:1} as Project);
  await db.localMediaAssets.put({id:P+'-media',projectId:P,title:'Inert audio',kind:'audio',mime:'audio/wav',blob:new Blob(['fixture']),size:7,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
  let handle:string|null=null;try{handle=await audio.play({kind:'media',id:P+'-media'});}catch{/* A device failure may be surfaced as an error. */}
  assert(!handle&&starts===0&&localAudioSessionStatus(scope).playing.length===0,'Rejected native AudioContext.resume was ignored: voice started and reported playing');
  return ['Native backend propagates AudioContext resume rejection without starting or reporting playback'];
 }finally{audio.dispose();await pause();globalThis.AudioContext=originalContext;if(activation)Object.defineProperty(navigator,'userActivation',activation);else Reflect.deleteProperty(navigator,'userActivation');if(await db.projects.get(P))await deleteProject(P);}
}
