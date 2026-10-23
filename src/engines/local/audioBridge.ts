import {getEraProject} from '@/services/worldEras/store';
import {mediaAsset} from '@/engines/media/scope';
import {BridgeError,optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {localAudioSessionStatus,setLocalAudioBus,stopLocalAudioSession} from './audioBrowser';
import {LOCAL_AUDIO_BUSES,validateLocalAudioRef,type LocalAudioRef,type LocalAudioBus} from './audio';
const scope=async(args:ToolArgs)=>{const target={projectId:resolveProjectId(args),eraId:optString(args,'eraId')};await getEraProject(target);return target;};
export const LOCAL_AUDIO_HANDLERS={
 async wh_local_audio_status(args:ToolArgs){const target=await scope(args);return{...target,...localAudioSessionStatus(target),domain:'sdk-owned',legacyPlayersIncluded:false};},
 async wh_local_audio_control(args:ToolArgs){const target=await scope(args),action=requireString(args,'action');
  if(action==='stop')return{...target,stopped:stopLocalAudioSession(target,optString(args,'handleId'))};
  if(action==='bus'){const bus=requireString(args,'bus') as LocalAudioBus;if(!LOCAL_AUDIO_BUSES.includes(bus)||typeof args.volume!=='number'||!Number.isFinite(args.volume)||args.volume<0||args.volume>1)throw new BridgeError('bad-args','Use an SDK bus and volume0..1.');setLocalAudioBus(target,bus,args.volume);return{...target,bus,volume:args.volume,domain:'sdk-owned',sharedAcrossRenderer:true};}
  if(action==='play'){
   const ref=(args.ref??{kind:'media',id:requireString(args,'assetId')}) as LocalAudioRef;try{validateLocalAudioRef(ref);}catch{throw new BridgeError('bad-args','Use a local media or source/slot audio reference.');}
   if(ref.kind==='media'){const asset=await mediaAsset(target.projectId,ref.id,target.eraId);if(!asset||asset.kind!=='audio')throw new BridgeError('not-found','Audio not found in this scope.');}
   else{const {db}=await import('@/db'),{resolveProjectLocalTool}=await import('./releases'),{createLocalToolClient}=await import('./storage'),project=await db.projects.get(target.projectId);if(!project)throw new BridgeError('not-found','Project not found.');const definition=resolveProjectLocalTool(ref.namespace,project),client=createLocalToolClient(target.projectId,definition,{eraId:target.eraId,readOnly:true,requireSelectedRelease:true,releaseHash:project.localToolInstallations?.[ref.namespace]?.contentHash??null});try{const asset=ref.releaseHash?await client.assets.resolve(ref):await client.assets.slot(ref.slot);if(!asset||asset.kind!=='audio')throw new BridgeError('not-found','Audio source slot not found in this exact scope/release.');}finally{client.audio?.dispose();}}
   return{...target,...(ref.kind==='media'?{assetId:ref.id}:{}),ref,started:false,queued:false,status:'gesture-required',message:'Use the SDK sound control in this scope and press Play. Agent calls never synthesize a user gesture or enqueue autoplay.'};
  }
  throw new BridgeError('bad-args','Use play, stop or bus.');
 },
};
