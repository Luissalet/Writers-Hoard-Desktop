import {resolveProjectId,optString,requireString,withAudit,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {readWritingToolDock,applyWritingToolDock,applyWritingToolDockBlock,reverseWritingToolDock,type ToolDockOwner,type ToolDockAction} from './store';
import type {LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import type {LocalToolStateAction} from '@/engines/local/stateActions';
const scope=(args:ToolArgs)=>({projectId:resolveProjectId(args),eraId:optString(args,'eraId')});
const owner=(args:ToolArgs)=>args.owner as ToolDockOwner;
async function audited(args:ToolArgs,run:()=>Promise<Awaited<ReturnType<typeof applyWritingToolDock>>>){const result=await run(),target=owner(args);return withAudit(result,{projectId:resolveProjectId(args),entityId:target.kind==='project'?resolveProjectId(args):target.documentId,kind:'update',summary:'Edit writing tool dock',before:{__writingToolDockReceipt:result.receiptId,owner:target}});}
export const WRITING_TOOL_DOCK_HANDLERS={
 wh_writing_tool_dock_read:(args:ToolArgs)=>readWritingToolDock(scope(args),owner(args)),
 wh_writing_tool_dock_apply:(args:ToolArgs)=>audited(args,()=>applyWritingToolDock(scope(args),owner(args),requireString(args,'expectedVersion'),args.actions as ToolDockAction[])),
 async wh_writing_tool_dock_block_read(args:ToolArgs){const read=await readWritingToolDock(scope(args),owner(args)),block=read.layout?.blocks.find(row=>row.id===requireString(args,'blockId'));if(!block)throw Error('tool_dock_block_missing');return{owner:read.owner,version:read.version,block};},
 wh_writing_tool_dock_block_apply:(args:ToolArgs)=>audited(args,()=>applyWritingToolDockBlock(scope(args),owner(args),requireString(args,'expectedVersion'),args.baseline as LocalToolOwnedBlockEnvelope,args.actions as LocalToolStateAction[])),
 wh_writing_tool_dock_undo:(args:ToolArgs)=>reverseWritingToolDock(scope(args),owner(args),requireString(args,'receiptId'),'undo'),
 wh_writing_tool_dock_redo:(args:ToolArgs)=>reverseWritingToolDock(scope(args),owner(args),requireString(args,'receiptId'),'redo'),
};
