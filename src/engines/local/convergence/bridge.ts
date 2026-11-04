import {db} from '@/db';
import {assertEngineEnabled,BridgeError,optString,requireString,resolveProjectId,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {localToolEngineId} from '../definitions';
import {resolveProjectLocalTool} from '../releases';
import {createLocalToolClient} from '../storage';
import type {LocalToolJson,LocalToolSnapshot} from '../sdk';
import type {LocalToolConvergenceUpdate} from './types';

async function client(args:ToolArgs,readOnly=false){
 const projectId=resolveProjectId(args),namespace=requireString(args,'namespace'),documentId=requireString(args,'documentId'),project=await db.projects.get(projectId);
 if(!project)throw new BridgeError('not-found','Project not found.');
 if(!readOnly)await assertEngineEnabled(projectId,localToolEngineId(namespace));
 const definition=resolveProjectLocalTool(namespace,project),scoped=createLocalToolClient(projectId,definition,{documentId,eraId:optString(args,'eraId'),readOnly,requireSelectedRelease:true,releaseHash:project.localToolInstallations?.[namespace]?.contentHash??null});
 if(!scoped.convergence)throw new BridgeError('bad-args','This source document has no declarative state codec.');
 return scoped.convergence;
}
function index(args:ToolArgs,key:string):number{const value=args[key];if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new BridgeError('bad-args','Invalid UTF-16 position.');return value;}
function affinity(args:ToolArgs):'left'|'right'{const value=args.affinity??'right';if(value!=='left'&&value!=='right')throw new BridgeError('bad-args','Invalid rich affinity.');return value;}
export const LOCAL_CONVERGENCE_HANDLERS={
 async wh_local_tool_rich_image_capture(args:ToolArgs){if(args.channel!=='source'&&args.channel!=='size'&&args.channel!=='alignment')throw new BridgeError('bad-args','Invalid image channel.');return(await client(args,true)).richImageCapture(requireString(args,'field'),requireString(args,'nodeId'),args.channel);},
 async wh_local_tool_rich_table_column_width_capture(args:ToolArgs){return(await client(args,true)).richTableColumnWidthCapture(requireString(args,'field'),requireString(args,'tableId'),requireString(args,'columnId'));},
 async wh_local_tool_rich_table_axis_capture(args:ToolArgs){if(args.axis!=='rows'&&args.axis!=='columns'||args.afterId!==null&&typeof args.afterId!=='string')throw new BridgeError('bad-args','Invalid table axis anchor.');return(await client(args,true)).richTableAxisCapture(requireString(args,'field'),requireString(args,'tableId'),args.axis,args.afterId as string|null);},
 async wh_local_tool_rich_table_cell_capture(args:ToolArgs){if(args.afterId!==undefined&&args.afterId!==null&&typeof args.afterId!=='string')throw new BridgeError('bad-args','Invalid cell fragment anchor.');return(await client(args,true)).richTableCellCapture(requireString(args,'field'),requireString(args,'tableId'),requireString(args,'rowId'),requireString(args,'columnId'),args.afterId as string|null|undefined);},
 async wh_local_tool_rich_block_empty_item_capture(args:ToolArgs){return(await client(args,true)).richBlockEmptyItemCapture(requireString(args,'field'),requireString(args,'nodeId'));},
 async wh_local_tool_rich_block_split_capture(args:ToolArgs){return(await client(args,true)).richBlockSplitCapture(requireString(args,'field'),requireString(args,'nodeId'),index(args,'at'));},
 async wh_local_tool_rich_block_join_capture(args:ToolArgs){return(await client(args,true)).richBlockJoinCapture(requireString(args,'field'),requireString(args,'leftNodeId'),requireString(args,'rightNodeId'));},
 async wh_local_tool_rich_block_edit_capture(args:ToolArgs){if(!Array.isArray(args.nodeIds)||args.nodeIds.some(id=>typeof id!=='string'||!id))throw new BridgeError('bad-args','Invalid block IDs.');return(await client(args,true)).richBlockEditCapture(requireString(args,'field'),args.nodeIds as string[],args.destination as import('./blockTypes').RichBlockPlacement|undefined);},
 async wh_local_tool_rich_block_capture(args:ToolArgs){if(!Array.isArray(args.nodeIds)||args.nodeIds.some(id=>typeof id!=='string'||!id))throw new BridgeError('bad-args','Invalid block IDs.');return(await client(args,true)).richBlockCapture(requireString(args,'field'),{nodeIds:args.nodeIds as string[]});},
 async wh_local_tool_rich_block_move_capture(args:ToolArgs){return(await client(args,true)).richBlockMoveCapture(requireString(args,'field'),requireString(args,'nodeId'),args.destination as import('./blockTypes').RichBlockPlacement);},
 async wh_local_tool_rich_range(args:ToolArgs){return(await client(args,true)).richRange(requireString(args,'field'),requireString(args,'nodeId'),index(args,'from'),index(args,'to'),{affinity:affinity(args)});},
 async wh_local_tool_rich_resolve_point(args:ToolArgs){return(await client(args,true)).resolveRichPoint(args.point as import('./richTypes').RichRange);},
 async wh_local_tool_rich_split_capture(args:ToolArgs){return(await client(args,true)).richSplitCapture(requireString(args,'field'),requireString(args,'nodeId'),index(args,'at'),{affinity:affinity(args)});},
 async wh_local_tool_rich_join_capture(args:ToolArgs){return(await client(args,true)).richJoinCapture(requireString(args,'field'),requireString(args,'leftNodeId'),requireString(args,'rightNodeId'));},
 async wh_local_tool_text_range(args:ToolArgs){const from=args.from,to=args.to;if(typeof from!=='number'||typeof to!=='number'||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from>to)throw new BridgeError('bad-args','Invalid UTF-16 range.');return(await client(args,true)).textRange(requireString(args,'field'),from,to);},
 async wh_local_tool_convergence_start(args:ToolArgs){return(await client(args)).start(args.baseline as LocalToolSnapshot<LocalToolJson>);},
 async wh_local_tool_convergence_adopt(args:ToolArgs){return(await client(args)).adopt(args.baseline as LocalToolSnapshot<LocalToolJson>,args.full as LocalToolConvergenceUpdate|undefined);},
 async wh_local_tool_convergence_export(args:ToolArgs){return(await client(args,true)).export({stateVectorBase64:optString(args,'stateVectorBase64')});},
 async wh_local_tool_convergence_import(args:ToolArgs){return(await client(args)).import(args.update as LocalToolConvergenceUpdate,{expectedLineage:optString(args,'expectedLineage')});},
};
