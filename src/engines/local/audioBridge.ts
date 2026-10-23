import {getEraProject} from '@/services/worldEras/store';
import {mediaAsset} from '@/engines/media/scope';
import {BridgeError,optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {localAudioSessionStatus,setLocalAudioBus,stopLocalAudioSession} from './audioBrowser';
import {LOCAL_AUDIO_BUSES,type LocalAudioBus} from './audio';
const scope=async(args:ToolArgs)=>{const target={projectId:resolveProjectId(args),eraId:optString(args,'eraId')};await getEraProject(target);return target;};
export const LOCAL_AUDIO_HANDLERS={
 async wh_local_audio_status(args:ToolArgs){const target=await scope(args);return{...target,...localAudioSessionStatus(target),domain:'sdk-owned',legacyPlayersIncluded:false};},
 async wh_local_audio_control(args:ToolArgs){const target=await scope(args),action=requireString(args,'action');
  if(action==='stop')return{...target,stopped:stopLocalAudioSession(target,optString(args,'handleId'))};
  if(action==='bus'){const bus=requireString(args,'bus') as LocalAudioBus;if(!LOCAL_AUDIO_BUSES.includes(bus)||typeof args.volume!=='number'||!Number.isFinite(args.volume)||args.volume<0||args.volume>1)throw new BridgeError('bad-args','Use an SDK bus and volume0..1.');setLocalAudioBus(target,bus,args.volume);return{...target,bus,volume:args.volume,domain:'sdk-owned',sharedAcrossRenderer:true};}
  if(action==='play'){const id=requireString(args,'assetId'),asset=await mediaAsset(target.projectId,id,target.eraId);if(!asset||asset.kind!=='audio')throw new BridgeError('not-found','Audio not found in this scope.');return{...target,assetId:id,started:false,queued:false,status:'gesture-required',message:'Use the SDK sound control in this scope and press Play. Agent calls never synthesize a user gesture or enqueue autoplay.'};}
  throw new BridgeError('bad-args','Use play, stop or bus.');
 },
};
