import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createLocalAudioEngine,type LocalAudioRef} from '@/engines/local/audio';
import {createRecordingLocalToolAudio} from '@/engines/local/audioTesting';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {createLocalToolClient} from '@/engines/local/storage';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import SoundPad from '@/engines/local/examples/SoundPad';
import {useLocalToolAudioLifecycle} from '@/engines/local/useLocalToolAudioLifecycle';
import type {LocalMediaAsset} from '@/engines/media/types';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {useLocaleStore} from '@/stores/localeStore';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,35)),ref:LocalAudioRef={kind:'media',id:'sound'};
const asset=(projectId:string,id='sound'):LocalMediaAsset=>({id,projectId,title:'Local effect',kind:'audio',mime:'audio/wav',blob:new Blob(['silent fixture'],{type:'audio/wav'}),size:14,notes:'',tags:[],linkedEntryIds:[],createdAt:1,updatedAt:1});
const definition=defineLocalTool({namespace:'qa.sdk-audio',name:{en:'Sound pad',es:'Sonidos'},description:{en:'Local sound controls',es:'Sonidos locales'},initialState:{value:1},validateState:(value:LocalToolJson):value is {value:number}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.value==='number',component:SoundPad});
export async function testLocalToolAudioEngine():Promise<string[]>{
 const passed:string[]=[],recording=createRecordingLocalToolAudio(),engine=createLocalAudioEngine(recording.backend),blob=new Blob(['sound']);
 const source={resolve:async()=>({blob,version:'v1'})},a=engine.createOwner(source),b=engine.createOwner(source);
 const ambience=await a.play(ref,{bus:'ambience',volume:.8,loop:true}),effect=await b.play(ref,{bus:'sfx',volume:.5});assert(ambience&&effect&&a.getState().length===1&&b.getState().length===1,'SDK mix did not coexist');
 a.stop(effect);a.update(effect,{volume:0});assert(b.getState()[0].volume===.5,'An owner changed another owner handle');
 const voice=await b.play(ref,{bus:'voice',focus:'duck',volume:.6});assert(voice&&a.getState()[0].effectiveVolume===.2&&b.getState().find(row=>row.id===voice)?.effectiveVolume===.6,'Duck gain or voice exception differs');
 a.setBusLevel('ambience',.5);assert(a.getState()[0].effectiveVolume===.1,'Bus level does not participate in ducked gain');b.stop(voice);assert(a.getState()[0].effectiveVolume===.4,'Stopping duck did not restore bus');
 const music=await b.play(ref,{bus:'music',focus:'exclusive',fadeInMs:40});assert(music&&!a.getState().length&&b.getState().length===1,'Exclusive did not replace SDK slots');b.stop(music,{fadeOutMs:60});assert(recording.commands.some(command=>command.kind==='stop'&&command.fadeMs===60),'Fade-out was not passed to graph');a.dispose();const keeper=await b.play(ref,{volume:.7});a.setBusLevel('sfx',0);assert(keeper&&b.getState()[0].effectiveVolume===.7,'Disposed owner changed shared bus');b.dispose();
 passed.push('Shared SDK engine mixes owners, enforces handle ownership, applies duck/bus gain with voice exception, replaces exclusive playback and forwards fades');
 let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;}),slow=createRecordingLocalToolAudio({prepare:()=>pending}),raceEngine=createLocalAudioEngine(slow.backend),race=raceEngine.createOwner(source),abort=new AbortController(),play=race.play(ref,{signal:abort.signal});await pause();abort.abort();release();assert(await play===null&&!slow.commands.some(command=>command.kind==='start'),'Aborted preparation started audio late');
 let version='v1';const altered=createRecordingLocalToolAudio({prepare:async()=>{version='v2';}}),stale=createLocalAudioEngine(altered.backend).createOwner({resolve:async()=>({blob,version})});assert(await stale.play(ref)===null&&!altered.commands.some(command=>command.kind==='start'),'Changed source version started stale audio');
 const noGesture=createRecordingLocalToolAudio({gesture:()=>false}),dropped=createLocalAudioEngine(noGesture.backend).createOwner(source);assert(await dropped.play(ref)===null&&!noGesture.commands.some(command=>command.kind==='prepare'),'Autoplay attempt decoded or played');race.dispose();stale.dispose();dropped.dispose();
 passed.push('Abort/unmount-style cancellation and source version change prevent late start; unavailable user activation never prepares or plays');
 return passed;
}
export async function testLocalToolAudioClients():Promise<string[]>{
 const P='local-audio-client',Q=P+'-other',host=document.getElementById('root')!,root=createRoot(host),passed:string[]=[];
 const project={id:P,title:'Audio client QA',description:'',mode:'custom' as const,type:'standalone' as const,status:'draft' as const,color:'#888888',enabledEngines:['local-tool-qa.sdk-audio'],createdAt:1,updatedAt:1};
 const recording=createRecordingLocalToolAudio(),engine=createLocalAudioEngine(recording.backend);let current=true;
 const client=createLocalToolClient(P,definition,{audioEngine:engine,isCurrent:()=>current});
 function Mounted(){useLocalToolAudioLifecycle(client.audio);return <SoundPad client={client} projectId={P}/>;}
 const until=async(check:()=>boolean,message:string)=>{for(let i=0;i<80;i++){if(check())return;await act(async()=>{await pause();});}throw Error(message);};
 try{
  useLocaleStore.setState({locale:'en',loaded:true});await db.projects.bulkPut([project,{...project,id:Q}]);await db.localMediaAssets.bulkPut([asset(P),asset(Q,'foreign')]);const before=JSON.stringify(await db.projects.get(P));
  assert(await client.audio!.play({kind:'media',id:'foreign'})===null,'Native SDK resolved foreign sound');
  const startsBefore=recording.commands.filter(command=>command.kind==='start').length;await act(async()=>{root.render(<StrictMode><Mounted/></StrictMode>);await pause();});await until(()=>host.querySelector('option')?.textContent==='Local effect','Actual SDK example did not list scoped media');assert(recording.commands.filter(command=>command.kind==='start').length===startsBefore,'Mount autoplayed');
  await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Play effect')!.click();await pause();});await until(()=>host.textContent?.includes('Playing local sound')===true,'Actual hook did not play after click');
  assert(client.audio!.getState().length===1&&JSON.stringify(await db.projects.get(P))===before,'Listening wrote project state or replay disposed StrictMode client');
  const call=async(action:string,args:Record<string,unknown>={})=>{const reply=await runBridgeTool(action,{projectId:P,...args});assert(reply.ok,JSON.stringify(reply));return reply.result as Record<string,unknown>;};
  const status=await call('wh_local_audio_status');assert((status.playing as unknown[]).length===1&&status.legacyPlayersIncluded===false,'Native dispatcher does not see actual SDK session');
  await call('wh_local_audio_control',{action:'bus',bus:'sfx',volume:.5});assert(client.audio!.getState()[0].effectiveVolume===.075,'Native bus control did not adjust actual SDK handle');
  const started=recording.commands.filter(command=>command.kind==='start').length,requested=await call('wh_local_audio_control',{action:'play',assetId:'sound'});assert(requested.started===false&&requested.queued===false&&requested.status==='gesture-required'&&recording.commands.filter(command=>command.kind==='start').length===started,'Native play faked a gesture or queued autoplay');
  const foreignStatus=await runBridgeTool('wh_local_audio_status',{projectId:Q});assert(foreignStatus.ok&&((foreignStatus.result as {playing:unknown[]}).playing.length===0),'Native status exposed other project playback');
  const stopped=await call('wh_local_audio_control',{action:'stop'});assert(stopped.stopped===1&&client.audio!.getState().length===0,'Native stop did not stop scoped SDK sound');
  await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Play effect')!.click();await pause();});await until(()=>client.audio!.getState().length===1,'Replay after native stop');
  await act(async()=>{await db.localMediaAssets.delete('sound');await pause();});await until(()=>client.audio!.getState().length===0,'Deleted medium kept playing');
  await act(async()=>{root.unmount();await pause();});current=false;assert(await client.audio!.play(ref)===null,'Unmounted client played again');
  passed.push('Real native scoped SDK client + actual SoundPad/hooks survive StrictMode, do not autoplay or write; foreign media rejected, deleted media stops and unmounted lease cannot replay');
  passed.push('Registered native audio dispatcher reads actual SDK handles, adjusts bus gain, stops scoped playback, isolates foreign status and returns honest gesture-required without audio start/queue');
  const fakeRecording=createRecordingLocalToolAudio(),fake=createFakeLocalToolHost(definition,{projects:[{id:P,enabledEngines:project.enabledEngines}],media:[{projectId:P,asset:asset(P)}]},{audio:fakeRecording.backend}),fakeClient=fake.createClient({projectId:P});const handle=await fakeClient.audio!.play(ref);assert(handle&&fakeRecording.commands.some(command=>command.kind==='start'),'Author fake did not record audio contract');fakeClient.audio!.dispose();const silent=createFakeLocalToolHost(definition,{projects:[{id:P,enabledEngines:project.enabledEngines}]}).createClient({projectId:P});assert(!silent.audio!.available&&await silent.audio!.play(ref)===null,'Default fake claims audible playback');
  passed.push('Author kit records the same engine contract with explicit inert backend; default fake honestly reports unavailable and never starts audio');
  const transactionRecording=createRecordingLocalToolAudio(),transactionHost=createFakeLocalToolHost(definition,{projects:[{id:P,enabledEngines:project.enabledEngines}],media:[{projectId:P,asset:asset(P)}]},{audio:transactionRecording.backend,tools:[{tool:{name:'qa_audio_abort',description:'Temporary client cleanup probe',writes:true,schema:{type:'object',properties:{projectId:{type:'string'}},required:[],additionalProperties:false}},run:async(_args,temporary)=>{assert(await temporary.audio!.play(ref),'Temporary audio did not start in inert test backend');throw Error('intentional_abort');}}]});
  let refused=false;try{await transactionHost.createClient({projectId:P}).callTool('qa_audio_abort');}catch{refused=true;}assert(refused&&transactionRecording.commands.some(command=>command.kind==='stop'),'Aborted fixture transaction leaked its temporary owner');
  passed.push('Temporary author-kit transaction owners stop on abort and cannot outlive their draft scope');
  return passed;
 }finally{current=false;client.audio?.dispose();for(const id of [P,Q])if(await db.projects.get(id))await deleteProject(id);}
}
