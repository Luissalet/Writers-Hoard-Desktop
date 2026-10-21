import {s,PROJECT_ID,type BridgeTool} from '@/services/aiBridge/schema';
const owner={type:'object',properties:{kind:{type:'string',enum:['codex','writings']},documentId:s('Actual Codex card or Writing chapter ID; never a combined-book scope ID.')},required:['kind','documentId'],additionalProperties:false};
const scope={projectId:PROJECT_ID,eraId:s('Explicit named era; omit for Shared base.'),owner};
const tool=(name:string,writes:boolean,description:string,properties:Record<string,unknown>,required:string[]):BridgeTool=>({name,writes,description,group:'research',schema:{type:'object',properties:{...scope,...properties},required,additionalProperties:false}});
export const LOCAL_TOOL_BLOCK_TOOLS:BridgeTool[]=[
 tool('wh_local_tool_block_types',false,'List compiled owned/world source block declarations for this project.',{},[]),
 tool('wh_local_tool_block_list',false,'Read portable source block envelopes and the exact version of their host document.',{},['owner']),
 tool('wh_local_tool_block_read',false,'Read one source block with its real host document version.',{blockId:s('Stable block ID.')},['owner','blockId']),
 tool('wh_local_tool_block_insert',true,'Append a declared source block to one real Codex card or Writing chapter using CAS.',{namespace:s('Compiled source namespace.'),key:s('Declared block key.'),expectedVersion:s('Exact ownerVersion from block_list or block_read.')},['owner','namespace','key','expectedVersion']),
 tool('wh_local_tool_block_apply',true,'Apply codec actions to one owned source block, preserving all surrounding prose bytes.',{baseline:{type:'object',properties:{owner,ownerVersion:s('Observed exact host version.'),envelope:{type:'object'}},required:['owner','ownerVersion','envelope'],additionalProperties:false},actions:{type:'array',items:{type:'object'},minItems:1}},['owner','baseline','actions']),
 tool('wh_local_tool_block_remove',true,'Remove one source atom using the observed host version and return a session Undo receipt.',{blockId:s('Stable block ID.'),expectedVersion:s('Observed exact host version.')},['owner','blockId','expectedVersion']),
 ...(['undo','redo']as const).map(mode=>tool('wh_local_tool_block_'+mode,true,`${mode==='undo'?'Undo':'Redo'} one source block edit only while its exact resulting host version remains current.`,{receiptId:s('Unconsumed receipt from the matching prior operation.')},['owner','receiptId'])),
];
