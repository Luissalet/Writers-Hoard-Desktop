import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolStateAction} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';

/** Capability control on valid old contracts, not an invalid future descriptor. */
export async function testLinksBaseline3(){
 const failures:string[]=[],checks:string[]=[],actors:LocalToolReplica[]=[],projectId='own-links-baseline3-'+crypto.randomUUID();
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);(globalThis as typeof globalThis&{__linksProgress?:string[]}).__linksProgress=checks;};
 const marks=['bold','italic','underline','strike','code'] as const,content=[{type:'text',text:'abÃŽÂ©cd',marks:marks.map(type=>({type}))}];
 try{
  eq('health private database89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:projectId,title:projectId,description:'Own links baseline',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  for(const tree of[false,true]){
   const namespace='tests.links-baseline3.'+(tree?'tree':'paragraphs'),data={body:tree?{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content}]}:{type:'doc',content:[{id:'P',type:'paragraph',content}]}} as LocalToolJson;
   const definition=defineLocalTool({namespace,name:{en:'Links baseline',es:'Base de enlaces'},description:{en:'Old contract control',es:'Control de contrato anterior'},document:{defaultTitle:{en:'Control',es:'Control'}},initialState:data,codec:{version:2,fields:{body:tree?{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}:{kind:'rich',profile:'paragraphs-inline/1'}}},validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null});
   registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
   const D=await createSourceToolDocument({projectId},namespace,'Control'),client=createLocalToolClient(projectId,definition,{documentId:D.id}),read=await client.read();eq(namespace+' read',read.data,data);
   const started=await client.convergence!.start(read),G=started.checkpoint;eq(namespace+' engine','3',G.engine.version);
   const replica=(authorId:string)=>{const r=createLocalToolReplica(G,{authorId,contract:{namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(r);return r;},A=replica('ownA'),B=replica('ownB');
   const original=A.richRange('body','P',0,5).deleteIds,observed=await client.convergence!.richRange('body','P',1,4),before=JSON.stringify(await db.projects.get(projectId));
   await client.convergence!.export();await client.read();eq(namespace+' capture/export readonly',JSON.stringify(await db.projects.get(projectId)),before);
   const b=B.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:B.richRange('body','P',5,5),text:'ÃŽÂ²'}]);A.receive(b.update);const a=A.apply([{type:'rich-mark',field:'body',nodeId:'P',range:A.richRange('body','P',0,1),mark:'bold',enabled:false}]);A.undo(a.receiptId!);
   eq(namespace+' original units',A.richRange('body','P',0,5).deleteIds,original);
   if(tree){const split=A.apply([{type:'rich-block-split',field:'body',capture:A.richBlockSplitCapture('body','P',2),newNodeId:'Q'}]);A.undo(split.receiptId!);}else{const split=A.apply([{type:'rich-split',field:'body',capture:A.richSplitCapture('body','P',2),newNodeId:'Q'}]);A.undo(split.receiptId!);}
   await client.convergence!.import(A.export(),{expectedLineage:started.snapshot.document!.lineage});const saved=await client.read();eq(namespace+' saved has remote text',JSON.stringify(saved.data).includes('ÃŽÂ²'),true);
   db.close();await db.open();const cold=await client.convergence!.export(),C=createLocalToolReplica(cold.checkpoint!,{authorId:'cold',contract:{namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(C);eq(namespace+' cold view',C.read(),saved.data);eq(namespace+' cold identities',C.richRange('body','P',0,5).deleteIds,original);
   const raw=JSON.stringify(await db.projects.get(projectId));let failure='';try{await client.state!.apply(await client.read(),[{type:'rich-link',field:'body',nodeId:'P',range:observed.range,href:'https://example.org/path?ref=writer#anchor'} as unknown as LocalToolStateAction]);}catch(error){failure=error instanceof Error?error.message:String(error);}
   try{eq(namespace+' new capability rejected',failure.length>0,true);}catch(error){failures.push(String(error));}eq(namespace+' rejection leaves Source exact',JSON.stringify(await db.projects.get(projectId)),raw);checks.push(namespace+' rejection='+failure);
  }
 }finally{for(const r of actors)r.destroy();if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 if(failures.length)throw Error(JSON.stringify({failures,checks}));return checks;
}
