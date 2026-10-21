import {runCodecScenario} from './local-tool-codec.scenario';
/** Shared ID-scoped scenario. Native and explicit memory fixtures use identical IDs/data. */
export async function runDocumentScenario(invoke:(name:string,args:Record<string,unknown>)=>Promise<{ok:boolean;result:unknown}>){
 const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
 const call=async(name:string,args:Record<string,unknown>={})=>{const reply=await invoke(name,{documentId:'doc-a',...args});assert(reply.ok,name+' failed '+JSON.stringify(reply.result));return reply.result as Record<string,unknown>;};
 const beforeB=await call('wh_local_tool_read',{documentId:'doc-b'}),legacy=await call('wh_local_tool_read',{documentId:undefined});
 const common=await runCodecScenario((name,args)=>invoke(name,{documentId:'doc-a',...args}));
 const first=await call('wh_local_tool_read'),own=await call('wh_local_tool_state_apply',{baseline:first,actions:[{type:'map-set',field:'labels',key:'identity-check',value:true}]});
 assert(!(await invoke('wh_local_tool_state_undo',{documentId:'doc-b',receiptId:own.receiptId})).ok,'Receipt crossed real document identity');
 const afterB=await call('wh_local_tool_read',{documentId:'doc-b'}),afterLegacy=await call('wh_local_tool_read',{documentId:undefined});
 assert(JSON.stringify(beforeB.data)===JSON.stringify(afterB.data)&&beforeB.revision===afterB.revision,'Same-source second document changed');
 assert(JSON.stringify(legacy.data)===JSON.stringify(afterLegacy.data)&&legacy.revision===afterLegacy.revision,'Document save migrated/changed legacy namespace state');
 assert((first.document as Record<string,unknown>).id==='doc-a'&&(afterB.document as Record<string,unknown>).id==='doc-b','Snapshot does not expose exact document identity');
 return{common,second:{data:afterB.data,revision:afterB.revision,document:{id:(afterB.document as Record<string,unknown>).id,namespace:(afterB.document as Record<string,unknown>).namespace,title:(afterB.document as Record<string,unknown>).title}},legacy:{data:afterLegacy.data,revision:afterLegacy.revision}};
}
