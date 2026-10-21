import {resolveProjectId,resolveProjectForEngine,requireString,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {buildWorldWiki,loadWorldWikiData} from '@/services/worldWikiExport';
import {validateWikiOptions} from './validation';
import {listWikiProfiles,getWikiProfile,saveWikiProfile,deleteWikiProfile,publishWikiProfile,getWikiEdition,restoreWikiConfiguration} from './store';
function revision(args:ToolArgs,nullable=false){if(nullable&&args.expectedRevision===null)return null;if(typeof args.expectedRevision!=='number'||!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0)throw Error('wiki_revision_required');return args.expectedRevision;}
export const WIKI_PROFILE_HANDLERS={
 async wh_wiki_profiles_list(args:ToolArgs){return{profiles:await listWikiProfiles(resolveProjectId(args))};},
 wh_wiki_profile_get:(args:ToolArgs)=>getWikiProfile(resolveProjectId(args),requireString(args,'profileId')),
 async wh_wiki_profile_save(args:ToolArgs){const projectId=await resolveProjectForEngine(args,'codex');validateWikiOptions(args.options);return saveWikiProfile(projectId,{id:typeof args.profileId==='string'?args.profileId:undefined,name:requireString(args,'name'),options:args.options},revision(args,true));},
 async wh_wiki_profile_delete(args:ToolArgs){await deleteWikiProfile(await resolveProjectForEngine(args,'codex'),requireString(args,'profileId'),revision(args)!);return{deleted:true};},
 async wh_wiki_profile_preview(args:ToolArgs){const projectId=resolveProjectId(args),profile=await getWikiProfile(projectId,requireString(args,'profileId'));return buildWorldWiki(await loadWorldWikiData(projectId,profile.options),profile.options);},
 wh_wiki_profile_publish:async(args:ToolArgs)=>publishWikiProfile(await resolveProjectForEngine(args,'codex'),requireString(args,'profileId'),revision(args)!),
 wh_wiki_edition_read:(args:ToolArgs)=>getWikiEdition(resolveProjectId(args),requireString(args,'profileId'),requireString(args,'editionId')),
 wh_wiki_profile_restore_config:async(args:ToolArgs)=>restoreWikiConfiguration(await resolveProjectForEngine(args,'codex'),requireString(args,'profileId'),requireString(args,'editionId'),revision(args)!),
};
