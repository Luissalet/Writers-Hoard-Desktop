import {requireString,optString,resolveProjectForEngine,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {listCodexOptionLists,saveCodexOptionList,deleteCodexOptionList,applyCodexOptionList,OPTION_LIST_LIBRARY_SCOPE,type CodexOptionListDraft} from './optionLists';
const scope=async(args:ToolArgs)=>({projectId:await resolveProjectForEngine(args,'codex'),eraId:optString(args,'eraId')});
const revision=(args:ToolArgs,key:string):number=>{const value=args[key];if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('codex_option_list_revision_required');return value;};
const info=(eraId?:string)=>({libraryScope:OPTION_LIST_LIBRARY_SCOPE,requestedEraId:eraId});
export const CODEX_OPTION_LIST_HANDLERS={
 async wh_codex_option_lists(args:ToolArgs){const target=await scope(args);return{...info(target.eraId),lists:await listCodexOptionLists(target)};},
 async wh_codex_option_list_save(args:ToolArgs){const target=await scope(args),draft=args.list;if(!draft||typeof draft!=='object'||Array.isArray(draft))throw Error('codex_option_list_invalid');const saved=await saveCodexOptionList(target,draft as CodexOptionListDraft,args.expectedRevision===null?null:revision(args,'expectedRevision'));return{...info(target.eraId),list:saved};},
 async wh_codex_option_list_delete(args:ToolArgs){const target=await scope(args);await deleteCodexOptionList(target,requireString(args,'listId'),revision(args,'expectedRevision'));return{...info(target.eraId),deleted:true};},
 async wh_codex_option_list_apply(args:ToolArgs){const target=await scope(args),result=await applyCodexOptionList(target,{listId:requireString(args,'listId'),templateId:requireString(args,'templateId'),propertyId:requireString(args,'propertyId'),expectedListRevision:revision(args,'expectedListRevision'),expectedTemplateRevision:revision(args,'expectedTemplateRevision')});return{...info(target.eraId),...result};},
};
