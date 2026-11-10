import {createLocalAudioEngine,silentLocalToolAudio,type LocalToolAudio} from '@/engines/local/audio';
import {createLocalAudioVoice} from '@/engines/local/audioNodes';
import {createRecordingLocalToolAudio} from '@/engines/local/audioTesting';
import {createLocalToolClient} from '@/engines/local/storage';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {createProject,deleteProject} from '@/db/operations';
import {db} from '@/db';
import {importLocalMedia,deleteLocalMedia} from '@/engines/media/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {pcmWave} from './local-tool-audio-levels.browser';

const assert=(value:unknown,label:string):asserts value=>{if(!value)throw Error(label);};
const equal=(label:string,actual:unknown,expected:unknown)=>assert(JSON.stringify(actual)===JSON.stringify(expected),label+': '+JSON.stringify(actual));
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
const near=(label:string,actual:number,expected:number,epsilon=.0002)=>assert(Math.abs(actual-expected)<=epsilon,label+': '+actual+' expected '+expected);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function invoke(audio:LocalToolAudio,name:'pause'|'resume'|'seek'|'getPosition',...args:unknown[]):unknown{
 const method=Reflect.get(audio,name);assert(typeof method==='function','REQUIRED_CAPABILITY: normal SDK audio lacks '+name);
 return Reflect.apply(method,audio,args);
}
function position(audio:LocalToolAudio,id:string){
 const value=invoke(audio,'getPosition',id);assert(record(value)&&typeof value.positionSeconds==='number'&&typeof value.durationSeconds==='number','Position must carry explicit finite seconds');
 assert(Number.isFinite(value.positionSeconds)&&Number.isFinite(value.durationSeconds),'Position must not invent NaN/infinite duration');
 return{positionSeconds:value.positionSeconds,durationSeconds:value.durationSeconds};
}
function graph(lengthSeconds=1.2){
 const context=new OfflineAudioContext(2,Math.round(lengthSeconds*48000),48000),sources:AudioBufferSourceNode[]=[],original=context.createBufferSource.bind(context);
 Object.defineProperty(context,'createBufferSource',{value:()=>{const node=original();sources.push(node);return node;}});
 const buffer=context.createBuffer(2,96000,48000);
 for(let channel=0;channel<2;channel++){const samples=buffer.getChannelData(channel);for(let i=0;i<samples.length;i++)samples[i]=i<48000?.2:.6;}
 const backend={available:true,supportsPan:true,unlock:()=>true,resume:async()=>true,prepare:async()=>createLocalAudioVoice(context,buffer),close:()=>{}};
 const engine=createLocalAudioEngine(backend),audio=engine.createOwner({resolve:async()=>({blob:new Blob(['own PCM descriptor']),version:'own-v1'})});
 return{context,sources,buffer,engine,audio};
}

export async function testAudioTransportRed(){
 const control=graph(.1);
 try{
  const id=await control.audio.play({kind:'media',id:'own-old-play'},{volume:.5});assert(id,'Existing public play must succeed before transport probe');
  equal('Baseline old play still owns one source',[control.audio.getState()[0].status,control.sources.length],['playing',1]);
  const rendered=await control.context.startRendering();near('Existing real PCM control',rendered.getChannelData(0)[1000],.1);
  const missing=['pause','resume','seek','getPosition'].filter(name=>typeof Reflect.get(control.audio,name)!=='function');
  console.log('AUDIO_TRANSPORT_CAPABILITY '+JSON.stringify({pcmControlPassed:true,missing}));
  assert(!missing.length,'REQUIRED_CAPABILITY: normal SDK owner lacks audio transport: '+missing.join(','));
 }finally{control.audio.dispose();}
 return ['Existing play produces actual offline PCM before the public capability assertion',...await testAudioTransportPcm()];
}

export async function testAudioTransportPcm(){
 const {context,sources,audio}=graph(),checks:string[]=[];let render:Promise<AudioBuffer>|undefined;
 try{
  const id=await audio.play({kind:'media',id:'own-transport-pcm'},{volume:.5});assert(id,'PCM transport handle missing');
  const [a,b,c,d,e]=[.2,.4,.6,.8,1].map(time=>context.suspend(time));render=context.startRendering();await a;
  const before=position(audio,id);near('Context-time playhead',before.positionSeconds,context.currentTime,128/48000);near('Decoded duration',before.durationSeconds,2);
  const first=sources[0],oldEnd=first.onended;
  equal('Pause accepted',invoke(audio,'pause',id),true);equal('Paused handle retained',[audio.getState()[0].id,audio.getState()[0].status,audio.getLevels(id)],[id,'paused',null]);
  equal('Old paused source detached',[first.buffer,first.onended],[null,null]);
  await context.resume();await b;near('Pause freezes digital position',position(audio,id).positionSeconds,before.positionSeconds,128/48000);
  const count=sources.length;equal('Paused seek accepted',invoke(audio,'seek',id,1.25),true);equal('Paused seek creates no source',[sources.length,audio.getState()[0].status],[count,'paused']);near('Paused seek position',position(audio,id).positionSeconds,1.25);
  equal('Resume accepted',await invoke(audio,'resume',id),true);equal('Resume new node same logical handle',[sources.length,audio.getState()[0].id,audio.getState()[0].status],[2,id,'playing']);
  oldEnd?.call(first,new Event('ended'));equal('Retired ended callback cannot remove resumed handle',audio.getState()[0]?.id,id);
  await context.resume();await c;near('Resumed offset advances on context clock',position(audio,id).positionSeconds,1.25+context.currentTime-.4,2*128/48000);
  const second=sources[1],secondEnd=second.onended;equal('Playing seek accepted',invoke(audio,'seek',id,.1),true);equal('Seek replaces one source',[sources.length,second.buffer,second.onended],[3,null,null]);
  secondEnd?.call(second,new Event('ended'));equal('Seek stale ended does not kill current handle',audio.getState()[0]?.id,id);
  const state=JSON.stringify(audio.getState()),startCount=sources.length,p=position(audio,id);
  for(const value of [-1,NaN,Infinity]){let rejected=false;try{invoke(audio,'seek',id,value);}catch{rejected=true;}assert(rejected,'Invalid seek must reject');equal('Invalid seek atomic',[JSON.stringify(audio.getState()),sources.length,position(audio,id)],[state,startCount,p]);}
  await context.resume();await d;audio.update(id,{loop:true});equal('Loop seek accepted',invoke(audio,'seek',id,2.25),true);near('Loop seek normalizes buffer time',position(audio,id).positionSeconds,.25);
  await context.resume();await e;audio.stop(id);equal('Stop removes position and handle',[invoke(audio,'getPosition',id),audio.getState().length],[null,0]);
  await context.resume();const output=await render;
  for(const [time,value]of [[.1,.1],[.3,0],[.5,.3],[.7,.1]])near('Actual PCM window '+time,output.getChannelData(0)[Math.round(time*48000)],value);
  assert(sources.every(source=>source.buffer===null&&source.onended===null),'Retired graph retains buffer or callback');
  checks.push('Actual offline PCM preserves paused silence and resumed/seek offsets on one logical handle without double layers','Pause/seek retire real sources and stale callbacks cannot end current playback; loop/invalid inputs/timebase are checked');
 }finally{audio.dispose();void render?.catch(()=>{});}
 const ending=graph(2.2);
 try{const id=await ending.audio.play({kind:'media',id:'own-end'});assert(id,'End fixture unavailable');const suspended=ending.context.suspend(.1),rendered=ending.context.startRendering();await suspended;invoke(ending.audio,'pause',id);invoke(ending.audio,'seek',id,2);equal('Seek end terminal even while paused',[ending.audio.getState().length,invoke(ending.audio,'getPosition',id),await invoke(ending.audio,'resume',id)],[0,null,false]);await ending.context.resume();await rendered;checks.push('Seeking non-loop duration retires a paused handle and cannot resume an ended voice');}finally{ending.audio.dispose();}
 return checks;
}

/** Explicit inert backend tests coordinator decisions; these are not PCM measurements. */
export async function testAudioTransportCoordination(){
 const log:string[]=[],blob=new Blob(['inert']),version='v1';let release=()=>{},blocked=false,current=true,rejectResume=false;
 const backend={available:true,unlock:()=>true,resume:async()=>{if(blocked)await new Promise<void>(resolve=>{release=resolve;});if(rejectResume)throw Error('controlled resume rejection');return true;},prepare:async()=>{
  let offset=0,loop=false;return{start:(_volume:number,nextLoop:boolean,_fade:number,_ended:()=>void)=>{loop=nextLoop;log.push('start');},update:(_volume:number,nextLoop:boolean)=>{loop=nextLoop;},stop:()=>log.push('stop'),pause:()=>{log.push('pause');return true;},resume:()=>{log.push('resume');return true;},seek:(seconds:number)=>{offset=loop?seconds%2:Math.min(seconds,2);return true;},getPosition:()=>({positionSeconds:offset,durationSeconds:2})};},close:()=>{}};
 const engine=createLocalAudioEngine(backend),a=engine.createOwner({current:()=>current,resolve:async()=>({blob,version})}),b=engine.createOwner({resolve:async()=>({blob,version})});
 try{
  const music=await b.play({kind:'media',id:'other'},{bus:'music',volume:.8}),duck=await a.play({kind:'media',id:'duck'},{bus:'voice',focus:'duck'});assert(music&&duck,'Focus fixture unavailable');
  near('Playing duck',b.getState()[0].effectiveVolume,.2);invoke(a,'pause',duck);near('Paused duck releases other gain',b.getState()[0].effectiveVolume,.8);equal('Paused gain is inaudible',a.getState()[0].effectiveVolume,0);
  a.update(duck,{focus:'exclusive',volume:.4,bus:'sfx'});assert(b.getState().some(row=>row.id===music),'Paused focus update preempted another handle');
  await invoke(a,'resume',duck);equal('Effective exclusive resume preempts',[b.getState().length,a.getState()[0].status],[0,'playing']);
  for(const action of ['pause','seek','stop'] as const){
   if(!a.getState().some(row=>row.id===duck))break;
   invoke(a,'pause',duck);blocked=true;const resumed=invoke(a,'resume',duck);await wait();const previous=log.filter(value=>value==='resume').length;
   if(action==='seek')invoke(a,'seek',duck,.75);else if(action==='pause')invoke(a,'pause',duck);else a.stop(duck);
   release();equal('Pending resume invalidated by '+action,await resumed,false);equal('Stale resume did not reach voice',log.filter(value=>value==='resume').length,previous);
   if(action==='seek')near('New paused seek survives stale resume',position(a,duck).positionSeconds,.75);blocked=false;
  }
  const musicAfter=await b.play({kind:'media',id:'keep-on-failure'},{bus:'music'}),failing=await a.play({kind:'media',id:'resume-fails'});assert(musicAfter&&failing,'Rejected resume fixture unavailable');
  invoke(a,'pause',failing);a.update(failing,{focus:'exclusive'});const resumeCount=log.filter(item=>item==='resume').length;
  rejectResume=true;let rejected=false;try{await invoke(a,'resume',failing);}catch{rejected=true;}rejectResume=false;
  assert(rejected,'Backend resume rejection must surface');equal('Rejected exclusive resume preserves paused voice and valid other',[a.getState().find(row=>row.id===failing)?.status,b.getState().some(row=>row.id===musicAfter),log.filter(item=>item==='resume').length],['paused',true,resumeCount]);
  blocked=true;const older=invoke(a,'resume',failing);await wait();const newest=await b.play({kind:'media',id:'newest-exclusive'},{focus:'exclusive'});assert(newest,'New exclusive failed');release();
  equal('New exclusive supersedes pending resume',[await older,b.getState()[0]?.id,a.getState().length],[false,newest,0]);blocked=false;
  for(const reason of ['version','revocation'] as const){
   let sourceVersion='old',lease=true;const c=engine.createOwner({current:()=>lease,resolve:async()=>({blob,version:sourceVersion})});
   try{const id=await c.play({kind:'media',id:'pending-'+reason});assert(id,'Pending reference fixture missing');invoke(c,'pause',id);blocked=true;const pending=invoke(c,'resume',id);await wait();const count=log.filter(item=>item==='resume').length;if(reason==='version')sourceVersion='replacement';else lease=false;release();
    equal('Reference '+reason+' invalidates resume before node restart',[await pending,log.filter(item=>item==='resume').length],[false,count]);assert(!c.getState().some(row=>row.status==='playing'),'Invalid reference resumed playback');blocked=false;
   }finally{release();c.dispose();blocked=false;}
  }
  const legacy=createLocalAudioEngine(createRecordingLocalToolAudio().backend).createOwner({resolve:async()=>({blob,version})}),silent=silentLocalToolAudio();
  try{const id=await legacy.play({kind:'media',id:'legacy'});assert(id,'Old backend play must remain available');equal('Legacy and silent transport are honest',[invoke(legacy,'getPosition',id),invoke(legacy,'pause',id),await invoke(legacy,'resume',id),invoke(legacy,'seek',id,.5),invoke(silent,'getPosition','none')],[null,false,false,false,null]);legacy.stop(id);}finally{legacy.dispose();silent.dispose();}
  current=false;a.dispose();
  return ['Controlled backend distinguishes paused duck/exclusive and preserves other voices until effective resume','Pending resumes invalidated by pause/seek/stop cannot restart a voice or overwrite the latest offset','Rejected context resume, a newer exclusive, reference version replacement and lease revocation cannot restart stale playback','Legacy custom backend and silent preserve normal lifecycle and return honest unavailable transport'];
 }finally{release();a.dispose();b.dispose();}
}

export async function testAudioTransportScopedBridge(){
 const ids=['transport-'+crypto.randomUUID(),'transport-other-'+crypto.randomUUID()],g=graph(),definition=defineLocalTool({namespace:'tests.audio-transport2475',name:{en:'Audio transport',es:'Transporte de audio'},description:{en:'Own transport fixture',es:'Prueba propia de transporte'},initialState:{},validateState:(value:LocalToolJson):value is Record<string,LocalToolJson>=>record(value),component:()=>null});
 let audio:LocalToolAudio|undefined;
 const call=async(name:string,args:Record<string,unknown>)=>{const result=await runBridgeTool(name,args);assert(result.ok,name+': '+JSON.stringify(result));assert(record(result.result),'Expected normal dispatcher object');return result.result;};
 try{
  for(const id of ids)await createProject({id,title:'Own audio fixture',description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1});
  const asset=await importLocalMedia(ids[0],new File([pcmWave(.2,2)],'fixture.wav',{type:'audio/wav'}));
  const client=createLocalToolClient(ids[0],definition,{audioEngine:g.engine});audio=client.audio;assert(audio,'Normal SDK audio missing');
  const id=await audio.play({kind:'media',id:asset.id});assert(id,'Existing public play failed');const target={projectId:ids[0],handleId:id};
  await call('wh_local_audio_control',{...target,action:'pause'});equal('Dispatcher pauses real scoped owner',audio.getState()[0].status,'paused');
  await call('wh_local_audio_control',{...target,action:'seek',seconds:.75});near('Dispatcher seeks same owner',position(audio,id).positionSeconds,.75);
  const status=await call('wh_local_audio_status',{projectId:ids[0],includePosition:true});assert(Array.isArray(status.playing)&&record(status.playing[0])&&record(status.playing[0].position),'Opt-in scoped position missing');
  equal('Status position matches same digital handle',status.playing[0].position,position(audio,id));
  const foreign=await runBridgeTool('wh_local_audio_control',{projectId:ids[1],action:'resume',handleId:id});assert(!foreign.ok,'Foreign scope resumed handle');
  await call('wh_local_audio_control',{...target,action:'resume'});equal('Scoped resume uses same handle',[audio.getState()[0].id,audio.getState()[0].status],[id,'playing']);
  const requested=await call('wh_local_audio_control',{projectId:ids[0],action:'play',assetId:asset.id});equal('Agent play is still not queued',[requested.started,requested.queued,requested.status],[false,false,'gesture-required']);
  await deleteLocalMedia(ids[0],asset.id);for(let i=0;i<80&&audio.getState().length;i++)await wait();equal('Asset watcher stops retained paused/playing handle',audio.getState().length,0);
  return ['Normal createProject/importLocalMedia/client owner is controlled through existing scoped dispatcher with honest opt-in position and foreign-scope rejection','Agent play does not fake gesture or queue; normal asset deletion revokes its current handle (not an authenticated Native claim)'];
 }finally{audio?.dispose();g.audio.dispose();for(const id of ids)if(await db.projects.get(id))await deleteProject(id);assert((await Promise.all(db.tables.map(table=>table.count()))).every(count=>count===0),'Own transport fixture leaves database rows');}
}

// Appended after the immutable 2e8a / 16,819-byte public RED and PCM/coordination/dispatcher body.
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {useSound,useAudioPlayer} from '@/engines/local/useLocalToolAudio';
import {useLocaleStore} from '@/stores/localeStore';
import SoundPad from '@/engines/local/examples/SoundPad';

export async function testAudioTransportFocusAndEnd(){
 let release:()=>void=()=>{},waiting=false;
 const events:string[]=[],backend={available:true,unlock:()=>true,resume:async()=>{if(waiting)await new Promise<void>(resolve=>{release=resolve;});return true;},prepare:async()=>({start:()=>{},update:()=>{},stop:()=>{},pause:()=>true,resume:()=>{events.push('resume');return true;},seek:()=>true,getPosition:()=>({positionSeconds:0,durationSeconds:2})}),close:()=>{}};
 const engine=createLocalAudioEngine(backend),owner=engine.createOwner({resolve:async()=>({blob:new Blob(['own']),version:'v1'})}),other=engine.createOwner({resolve:async()=>({blob:new Blob(['own']),version:'v1'})});
 try{const id=await owner.play({kind:'media',id:'changing-focus'});assert(id,'Focus fixture missing');owner.pause(id);waiting=true;const pending=owner.resume(id);await wait();owner.update(id,{focus:'exclusive'});const newer=await other.play({kind:'media',id:'newer-exclusive'},{focus:'exclusive'});assert(newer,'Newer exclusive missing');release();equal('Changed focus cannot let an old resume preempt newer exclusive',[await pending,events.length,other.getState()[0]?.id],[false,0,newer]);}finally{release();owner.dispose();other.dispose();}
 const context=new OfflineAudioContext(2,24000,48000),buffer=context.createBuffer(2,4800,48000);let ended=0;
 const voice=createLocalAudioVoice(context,buffer);voice.start(.2,false,0,()=>{ended++;});await context.startRendering();equal('Natural end notification exactly once',ended,1);equal('Naturally ended voice has no transport',[voice.getPosition?.(),voice.pause?.(),voice.resume?.(),voice.seek?.(.01)],[null,false,false,false]);voice.stop(0);equal('Stop after natural end does not duplicate notification',ended,1);
 return ['Changing paused focus invalidates an older pending resume before a newer exclusive can be preempted','Real OfflineAudioContext natural end notifies once and leaves no resumable voice'];
}

export async function testAudioTransportHooks(){
 const fixture=graph(),audio=fixture.audio,host=document.getElementById('root')!,root=createRoot(host);
 let sound:ReturnType<typeof useSound>|undefined,music:ReturnType<typeof useAudioPlayer>|undefined;
 function Hooks({id}:{id:string}){sound=useSound({audio},{kind:'media',id});music=useAudioPlayer({audio},{kind:'media',id});return <output>{sound.playing?'playing':sound.paused?'paused':'stopped'}</output>;}
 try{
  await act(async()=>{root.render(<StrictMode><Hooks id="first"/></StrictMode>);await wait();});equal('Hook mount has no playback',audio.getState().length,0);
  await act(async()=>{await sound!.play({pan:Infinity});});assert(sound!.error,'Own failed Play error missing');const failure=sound!.error;await act(async()=>{equal('Unsuccessful hook resume is false',await sound!.resume(),false);});equal('Unsuccessful resume preserves error',sound!.error,failure);const outside=await audio.play({kind:'media',id:'unrelated-publication'});assert(outside,'Publication fixture missing');await act(async()=>{audio.setBusLevel('sfx',.8);});equal('Unrelated audio publication retains own error',sound!.error,failure);audio.stop(outside);
  await act(async()=>{await sound!.play();});equal('Hook play state',[sound!.playing,sound!.paused,sound!.error],[true,false,undefined]);
  const id=audio.getState()[0].id;await act(async()=>{sound!.pause();});equal('Hook pause state',[sound!.playing,sound!.paused,audio.getState()[0].id],[false,true,id]);
  await act(async()=>{sound!.seek(.6);sound!.update({volume:.3});});near('Hook position reads same paused handle',sound!.getPosition()!.positionSeconds,.6);equal('Paused update does not resume',audio.getState()[0].status,'paused');
  await act(async()=>{await sound!.resume();});equal('Hook resumes same handle',[sound!.playing,sound!.paused,audio.getState()[0].id],[true,false,id]);
  const foreign=await audio.play({kind:'media',id:'outside-hook'});assert(foreign,'Outside hook fixture missing');await act(async()=>{sound!.stop();});equal('Hook stop preserves outside handle',audio.getState().map(row=>row.id),[foreign]);
  await act(async()=>{await music!.play();music!.pause();});equal('Player alias supports pause',music!.paused,true);
  await act(async()=>{root.render(<StrictMode><Hooks id="second"/></StrictMode>);await wait();});equal('Retarget stops old hook handles',audio.getState().length,0);equal('Retarget cannot resume old session',await sound!.resume(),false);
  await act(async()=>{await sound!.play();});await act(async()=>{root.unmount();await wait();});equal('Unmount stops current hook handles',audio.getState().length,0);
  return ['Normal useSound/useAudioPlayer hooks expose paused/playing and transport without mount autoplay, keep handle identity, isolate ownership and clean up StrictMode retarget/unmount'];
 }finally{audio.dispose();if(host.hasChildNodes())await act(async()=>{root.unmount();});}
}

export async function testAudioTransportBrowserGate(){
 const activation=Object.getOwnPropertyDescriptor(navigator,'userActivation'),oldContext=globalThis.AudioContext;
 let active=true,state:AudioContextState='running',resumeCalls=0,created=0,reject=false;
 const native=new OfflineAudioContext(2,9600,48000),originalResume=native.resume.bind(native);
 Object.defineProperty(native,'state',{configurable:true,get:()=>state});
 Object.defineProperty(native,'resume',{configurable:true,value:async()=>{resumeCalls++;if(reject)throw Error('controlled context rejection');state='running';}});
 Object.defineProperty(native,'close',{configurable:true,value:async()=>{state='closed';}});
 const constructor=function(){created++;return native;};constructor.prototype.createStereoPanner=()=>{};
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:constructor});
 Object.defineProperty(navigator,'userActivation',{configurable:true,value:{get isActive(){return active;}}});
 const projectId='audio-gate-'+crypto.randomUUID();await createProject({id:projectId,title:'Audio gate QA',description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1});const definition=defineLocalTool({namespace:'qa.audio-gate-2475',name:{en:'Gate',es:'Gesto'},description:{en:'Own gate QA',es:'Prueba propia'},initialState:{},validateState:(value:LocalToolJson):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value),component:()=>null}),client=createLocalToolClient(projectId,definition);
 try{
  const asset=await importLocalMedia(projectId,new File([pcmWave(.2,2)],'own-gate.wav',{type:'audio/wav'})),audio=client.audio!;
  const id=await audio.play({kind:'media',id:asset.id});assert(id,'Normal gesture play missing');audio.pause(id);active=false;state='suspended';equal('Suspended context without gesture does not resume',[await audio.resume(id),resumeCalls,audio.getState()[0].status],[false,0,'paused']);
  state='running';equal('Already-running authorized context resumes without new activation',await audio.resume(id),true);audio.pause(id);state='suspended';active=true;reject=true;let rejected=false;try{await audio.resume(id);}catch{rejected=true;}assert(rejected,'Context rejection must surface');equal('Rejected context leaves paused',audio.getState()[0].status,'paused');
  reject=false;active=false;await wait();equal('No autoplay queue after rejected gesture',[resumeCalls,audio.getState()[0].status],[1,'paused']);active=true;equal('Real activation may resume existing suspended context',await audio.resume(id),true);equal('No replacement context for resume',created,1);audio.pause(id);state='closed';equal('Closed context cannot be reopened by resume',[await audio.resume(id),created],[false,1]);
  return ['Production browser backend gate is exercised with a controlled context: running needs no new gesture, suspended requires real activation, rejection/closed context never enqueue autoplay or create another context (not hardware delivery)'];
 }finally{client.audio?.dispose();await deleteProject(projectId);await wait();Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:oldContext});if(activation)Object.defineProperty(navigator,'userActivation',activation);else Reflect.deleteProperty(navigator,'userActivation');Object.defineProperty(native,'resume',{configurable:true,value:originalResume});}
}

export async function testAudioTransportExample(){
 const projectId='audio-ui-'+crypto.randomUUID(),g=graph(),host=document.getElementById('root')!,root=createRoot(host);
 await createProject({id:projectId,title:'Audio UI QA',description:'Synthetic',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1});
 const definition=defineLocalTool({namespace:'qa.audio-ui-2475',name:{en:'Audio',es:'Audio'},description:{en:'Own UI QA',es:'Prueba propia'},initialState:{},validateState:(value:LocalToolJson):value is Record<string,LocalToolJson>=>record(value),component:SoundPad}),client=createLocalToolClient(projectId,definition,{audioEngine:g.engine});
 const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!;
 const until=async(check:()=>boolean,label:string)=>{for(let i=0;i<70;i++){if(check())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}throw Error(label);};
 try{
  useLocaleStore.setState({locale:'en',loaded:true});await importLocalMedia(projectId,new File([pcmWave(.2,2)],'own-ui.wav',{type:'audio/wav'}));const before=JSON.stringify(await db.projects.get(projectId));
  await act(async()=>{root.render(<StrictMode><SoundPad client={client} projectId={projectId}/></StrictMode>);await wait();});await until(()=>!!host.querySelector('option'),'Normal example did not list own audio');equal('Example does not autoplay',client.audio!.getState().length,0);
  await act(async()=>{button('Play effect').click();await wait();});await until(()=>host.textContent?.includes('Playing local sound')===true,'Example did not play');const id=client.audio!.getState()[0].id;
  assert(!button('Pause').disabled&&button('Resume').disabled,'Playing transport buttons inconsistent');await act(async()=>{button('Pause').click();});await until(()=>host.querySelector('[role=status]')?.textContent==='Paused','Example does not display pause');equal('Example pause retains handle',client.audio!.getState()[0].id,id);
  const range=host.querySelector<HTMLInputElement>('input[aria-label="Position in seconds"]')!;assert(!range.disabled&&Number(range.max)===2,'Example position range missing duration');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(range,'0.75');range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));});near('Example range seeks paused owner',client.audio!.getPosition(id)!.positionSeconds,.75);
  await act(async()=>{button('Resume').click();await wait();});await until(()=>client.audio!.getState()[0]?.status==='playing','Example resume did not use retained handle');equal('Example resume retains handle',client.audio!.getState()[0].id,id);
  await act(async()=>{button('Stop sounds').click();});await until(()=>client.audio!.getState().length===0,'Example stop failed');equal('Runtime transport never saves project state',JSON.stringify(await db.projects.get(projectId)),before);await act(async()=>{root.unmount();});
  return ['Actual SoundPad in StrictMode lists normal imported WAV, plays only on click, pauses/resumes same handle and seeks from labelled range; runtime transport leaves the project snapshot unchanged (no CSS/Brave layout claim)'];
 }finally{client.audio?.dispose();g.audio.dispose();if(host.hasChildNodes())await act(async()=>{root.unmount();});await deleteProject(projectId);assert((await Promise.all(db.tables.map(table=>table.count()))).every(count=>count===0),'Own example fixture leaves rows');}
}
