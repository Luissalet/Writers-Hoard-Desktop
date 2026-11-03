import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolConvergenceContract} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';

/** Source3 genesis is real. All adoption traffic uses public replicas; no raw Doc/Map builders. */
export async function testRichAdoptionCore(){
 const checks:string[]=[],actors:LocalToolReplica[]=[],projectId='own-adoption-core-'+crypto.randomUUID(),namespace='tests.rich-adoption-core';let reject=false;
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const throws=(run:()=>unknown,check:(error:unknown)=>boolean=()=>true)=>{let rejected=false;try{run();}catch(error){if(!check(error))throw error;rejected=true;}if(!rejected)throw Error('expected rejection');};
 const data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'ab\u03a9cd',marks:[{type:'bold'}]}]}]},outline:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'Q',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'outline'}]}]}} as LocalToolJson;
 const common={namespace,name:{en:'Adoption core',es:'Núcleo de adopción'},description:{en:'Own adoption',es:'Adopción propia'},document:{defaultTitle:{en:'Core',es:'Núcleo'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!reject&&!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&!!v.outline,component:()=>null};
 const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'},outline:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}}});
 const target=defineLocalTool({...common,stateSchemaVersion:'2',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'},outline:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'}}}});
 try{
  eq('health89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:projectId,title:projectId,description:'Own adoption core',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:old}});
  const document=await createSourceToolDocument({projectId},namespace,'Core'),client=createLocalToolClient(projectId,old,{documentId:document.id}),started=await client.convergence!.start(await client.read()),G=started.checkpoint;
  const from={namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch},oldContract={...from,validateState:common.validateState},to:LocalToolConvergenceContract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:common.validateState,richAdoption:{transition:'rich-links-3-to-4/1',from}};
  const make=(id:string,contract:LocalToolConvergenceContract=to,checkpoint=G)=>{const replica=createLocalToolReplica(checkpoint,{authorId:id,contract});actors.push(replica);return replica;};
  const A=make('A'),B=make('B'),originalIds=A.richRange('body','P',0,5).deleteIds,durableBefore=JSON.stringify(await db.projects.get(projectId));
  eq('current capable contract reads effective3 without adopting',A.checkpoint(),G);
  const own=A.apply([{type:'rich-mark',field:'body',nodeId:'P',range:A.richRange('body','P',0,1),mark:'bold',enabled:false}]);
  const adoption=A.adopt(to);eq('adoption active4',A.checkpoint().engine.version,'4');eq('adoption has no Undo receipt',adoption.receiptId,null);eq('adoption keeps original IDs',A.richRange('body','P',0,5).deleteIds,originalIds);
  A.undo(own.receiptId!);eq('live owner Undo survives local adoption',A.read(),data);
  const G4=A.checkpoint(),C=make('C',to,G4);eq('cold adopted reader',C.read(),A.read());throws(()=>C.undo(own.receiptId!));checks.push('cold reader has no owner authority');
  const anchor=A.apply([{type:'rich-link',field:'body',nodeId:'P',range:A.richRange('body','P',0,2),href:'example.org/H1'}]),delta4=A.export(G4.stateVectorBase64),bBefore=B.checkpoint();
  throws(()=>B.receive(delta4),error=>error instanceof Error&&error.message==='local_tool_rich_adoption_dependency_missing');eq('F1 delta4 missing D is atomic',B.checkpoint(),bBefore);
  const full4=A.export();B.receive(full4);B.receive(delta4);const duplicate=B.checkpoint();B.receive(delta4);eq('F1 full then original duplicate is idempotent',B.checkpoint(),duplicate);eq('F1 A B converge',B.read(),A.read());
  const Legacy=make('Legacy',oldContract),k=Legacy.apply([{type:'rich-mark',field:'outline',nodeId:'Q',range:Legacy.richRange('outline','Q',0,1),mark:'italic',enabled:true}]),undoK=Legacy.undo(k.receiptId!),beforeK=B.checkpoint();
  throws(()=>B.receive(undoK.update),error=>error instanceof Error&&error.message==='local_tool_rich_legacy_dependency_missing');eq('F2 unknown activation target is atomic',B.checkpoint(),beforeK);
  Legacy.adopt(to);Legacy.apply([{type:'rich-link',field:'outline',nodeId:'Q',range:Legacy.richRange('outline','Q',1,3),href:'example.org/disjoint'}]);
  B.receive(Legacy.export());B.receive(undoK.update);const afterK=B.checkpoint();B.receive(undoK.update);eq('F2 active4 full repairs original3 duplicate',B.checkpoint(),afterK);eq('F2 IDs conserved',B.richRange('body','P',0,5).deleteIds,originalIds);
  eq('F2 disjoint H1 preserved',JSON.stringify(B.read()).includes('https://example.org/H1'),true);eq('F2 disjoint B link retained',JSON.stringify(B.read()).includes('https://example.org/disjoint'),true);
  const prior=B.checkpoint();reject=true;try{throws(()=>B.apply([{type:'rich-link',field:'body',nodeId:'P',range:B.richRange('body','P',2,3),href:'example.org/denied'}]));}finally{reject=false;}eq('actual policy still applies atomically',B.checkpoint(),prior);
  eq('all SDK adoption leaves durable Source3 exact',JSON.stringify(await db.projects.get(projectId)),durableBefore);
  eq('old Source still3',(await client.convergence!.export()).checkpoint!.engine.version,'3');
  A.undo(anchor.receiptId!);eq('own link Undo preserves units',A.richRange('body','P',0,5).deleteIds,originalIds);
 }finally{reject=false;for(const replica of actors)replica.destroy();if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
