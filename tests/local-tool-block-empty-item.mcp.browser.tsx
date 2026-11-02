import assert from './local-tool-collaborative-rich.assert';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolJson,type LocalToolSnapshot,type RichBlock,type RichBlockDocument,type RichBlockEmptyItemCapture} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {getPendingWritesSnapshot} from '@/services/pendingWrites';
export async function testEmptyItemMcp(){
 const P='own1895-mcp-'+crypto.randomUUID(),checks:string[]=[],ledger=getPendingWritesSnapshot(),eq=(n:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,n);checks.push(n);},snapshot=()=>db.transaction('r',db.tables,()=>Promise.all(db.tables.map(t=>t.toArray())));
 const reject=async(label:string,run:()=>Promise<unknown>)=>{let error='';try{await run();}catch(reason){error=String(reason);}eq(label+' rejected',!!error,true);return error;};
 const paragraph=(id:string,parentId:string,text:string):RichBlock=>({id,type:'paragraph',attrs:{},parentId,slot:'body',afterId:null,content:text?[{type:'text',text}]:[]});
 const body=(s:LocalToolSnapshot<LocalToolJson>)=>(s.data as Record<string,LocalToolJson>).body as unknown as RichBlockDocument;
 try{
  eq('private health89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  const captureTool=getBridgeTool('wh_local_tool_rich_block_empty_item_capture')!;eq('capture advertised readonly',captureTool.writes,false);
  const stateTool=getBridgeTool('wh_local_tool_state_apply')!,branches=((stateTool.schema.properties.actions as {items:{oneOf:{properties:{type:{const:string}};required:string[]}[]}}).items.oneOf),branch=branches.find(s=>s.properties.type.const==='rich-block-exit-empty-item')!;eq('continuation optional metadata',branch.required.includes('continuationListId'),false);eq('capture required metadata',branch.required.includes('capture'),true);
  for(const mode of ['only','middle','nested'] as const){
   const NS='tests.empty-item1895.mcp-'+mode,blocks:RichBlock[]=[{id:'L',type:'ordered-list',attrs:{start:5},parentId:mode==='nested'?'Owner':null,slot:'body',afterId:mode==='nested'?'U':null},{id:'Iq',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:mode==='only'?null:'Iz'},paragraph('Q','Iq','')];
   if(mode!=='only')blocks.push({id:'Iz',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:null},{id:'Ia',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:'Iq'},paragraph('Z','Iz','before'),paragraph('A','Ia','after'));
   if(mode==='nested')blocks.push({id:'W',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},{id:'Owner',type:'list-item',attrs:{},parentId:'W',slot:'body',afterId:null},paragraph('U','Owner','owner'));
   blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const data={body:{type:'block-doc',schema:'writers-blocks/1',blocks}} as unknown as LocalToolJson,definition=defineLocalTool({namespace:NS,name:{en:'Empty item MCP',es:'MCP item vacío'},description:{en:'Normal registered executor',es:'Executor registrado normal'},document:{defaultTitle:{en:'List',es:'Lista'}},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null});
   registerLocalToolModules({['./installed/'+NS+'/module.tsx']:{default:definition}});const project=(await db.projects.get(P))!;await db.projects.update(P,{enabledEngines:[...project.enabledEngines,'local-tool-'+NS]});const D=(await createSourceToolDocument({projectId:P},NS,mode)).id,client=createLocalToolClient(P,definition,{documentId:D}),reader=createLocalToolClient(P,definition,{documentId:D,readOnly:true});await client.convergence!.start(await client.read());
   const args={namespace:NS,documentId:D,field:'body',nodeId:'Q'},before=await snapshot(),capture=await reader.callTool(captureTool.name,args) as unknown as {snapshot:LocalToolSnapshot<LocalToolJson>;capture:RichBlockEmptyItemCapture};eq(mode+' capture readonly DB',await snapshot(),before);eq(mode+' capture exact item',capture.capture.frame.itemId,'Iq');
   const action={type:'rich-block-exit-empty-item',field:'body',capture:capture.capture,...(mode==='only'?{}:{continuationListId:'N'})} as unknown as LocalToolJson,applyArgs={namespace:NS,documentId:D,baseline:capture.snapshot as unknown as LocalToolJson,actions:[action]};
   await reject(mode+' readonly write',()=>reader.callTool('wh_local_tool_state_apply',applyArgs));eq(mode+' readonly rejection DB',await snapshot(),before);
   if(mode==='middle'){const missing={type:'rich-block-exit-empty-item',field:'body',capture:capture.capture} as unknown as LocalToolJson;await reject('required continuation semantic',()=>client.callTool('wh_local_tool_state_apply',{...applyArgs,actions:[missing]}));eq('missing ID rejects atomically DB',await snapshot(),before);}
   if(mode==='only'){const enabled=(await db.projects.get(P))!.enabledEngines;await db.projects.update(P,{enabledEngines:enabled.filter(e=>e!=='local-tool-'+NS)});const disabled=await snapshot();await reader.callTool(captureTool.name,args);await reject('disabled writer',()=>client.callTool('wh_local_tool_state_apply',applyArgs));eq('disabled capture/rejection DB exact',await snapshot(),disabled);await db.projects.update(P,{enabledEngines:enabled});}
   const result=await client.callTool('wh_local_tool_state_apply',applyArgs) as unknown as {snapshot:LocalToolSnapshot<LocalToolJson>;receiptId:string|null};eq(mode+' one public receipt',typeof result.receiptId,'string');eq(mode+' Q correct parent',body(result.snapshot).blocks.find(n=>n.id==='Q')!.parentId,mode==='nested'?'Iq':null);if(mode!=='only')eq(mode+' continuation ordinal',body(result.snapshot).blocks.find(n=>n.id==='N')!.attrs,{start:7});
   const undo=await client.callTool('wh_local_tool_state_undo',{namespace:NS,documentId:D,receiptId:result.receiptId!}) as unknown as {snapshot:LocalToolSnapshot<LocalToolJson>;receiptId:string};eq(mode+' one Undo exact',undo.snapshot.data,capture.snapshot.data);const redo=await client.callTool('wh_local_tool_state_redo',{namespace:NS,documentId:D,receiptId:undo.receiptId}) as unknown as {snapshot:LocalToolSnapshot<LocalToolJson>};eq(mode+' Redo exact',redo.snapshot.data,result.snapshot.data);
  }
 }finally{if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);const end=getPendingWritesSnapshot();eq('cleanup ledger',[end.dirty,end.pending,end.failed],[ledger.dirty,ledger.pending,ledger.failed]);}
 return checks;
}
