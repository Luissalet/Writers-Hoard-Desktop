import {db} from '@/db';
import {resolveProjectId,requireString,optString,withAudit,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {listLocalToolDefinitions} from '../definitions';
import {resolveProjectLocalTool} from '../releases';
import {insertLocalToolBlock,listLocalToolBlocks,readLocalToolBlock,applyLocalToolBlockActions,removeLocalToolBlock,reverseLocalToolBlock,type LocalToolBlockRead} from './operations';
import type {LocalToolBlockOwner} from './types';
import type {LocalToolStateAction} from '../stateActions';
const scope=(args:ToolArgs)=>({projectId:resolveProjectId(args),eraId:optString(args,'eraId')});
function owner(args:ToolArgs):LocalToolBlockOwner{const value=args.owner as LocalToolBlockOwner;if(!value||!['codex','writings'].includes(value.kind)||typeof value.documentId!=='string'||!value.documentId)throw Error('local_tool_block_owner_invalid');return value;}
async function audited(args:ToolArgs,run:()=>Promise<Awaited<ReturnType<typeof insertLocalToolBlock>>>){const result=await run(),target=owner(args);return withAudit(result,{projectId:resolveProjectId(args),entityId:target.documentId,kind:'update',summary:'Edit source block',before:{__localToolBlockReceipt:result.receiptId,owner:target}});}
export const LOCAL_TOOL_BLOCK_HANDLERS={
 async wh_local_tool_block_types(args:ToolArgs){const project=await db.projects.get(resolveProjectId(args));if(!project)throw Error('project_missing');return{types:listLocalToolDefinitions().flatMap(item=>{try{const source=resolveProjectLocalTool(item.namespace,project);return(source.blocks??[]).map(block=>({namespace:source.namespace,key:block.key,name:block.name,scope:block.scope,...(block.preview?{preview:block.preview}:{}),...(block.scope==='host'?{codec:block.codec}:{world:block.world}),enabled:project.enabledEngines.includes('local-tool-'+source.namespace)}));}catch{return[];}})};},
 wh_local_tool_block_list:(args:ToolArgs)=>listLocalToolBlocks(scope(args),owner(args)),
 wh_local_tool_block_read:(args:ToolArgs)=>readLocalToolBlock(scope(args),owner(args),requireString(args,'blockId')),
 wh_local_tool_block_insert:(args:ToolArgs)=>audited(args,()=>insertLocalToolBlock(scope(args),owner(args),requireString(args,'namespace'),requireString(args,'key'),requireString(args,'expectedVersion'))),
 wh_local_tool_block_apply:(args:ToolArgs)=>audited(args,()=>applyLocalToolBlockActions(scope(args),owner(args),args.baseline as LocalToolBlockRead,args.actions as LocalToolStateAction[])),
 wh_local_tool_block_remove:(args:ToolArgs)=>audited(args,()=>removeLocalToolBlock(scope(args),owner(args),requireString(args,'blockId'),requireString(args,'expectedVersion'))),
 wh_local_tool_block_undo:(args:ToolArgs)=>reverseLocalToolBlock(scope(args),owner(args),requireString(args,'receiptId'),'undo'),
 wh_local_tool_block_redo:(args:ToolArgs)=>reverseLocalToolBlock(scope(args),owner(args),requireString(args,'receiptId'),'redo'),
};
