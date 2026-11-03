import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolConvergenceContract} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {sourceCoverage} from '@/engines/local/liveContent/coverage';

/** Real RW/CAS and original client; no facade or alternate writer. */
export async function testRichAdoptionSource(){
 const checks:string[]=[],actors:LocalToolReplica[]=[],projectId='own-adoption-source-'+crypto.randomUUID(),namespace='tests.rich-adoption-source';
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'ab\u03a9cd'}]}]},outline:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'Q',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'outline'}]}]}} as LocalToolJson;
 const common={namespace,name:{en:'Adoption Source',es:'Source de adopción'},description:{en:'Own adoption Source',es:'Source propia de adopción'},document:{defaultTitle:{en:'Source',es:'Source'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&!!v.outline,component:()=>null};
 const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'},outline:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}}});
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:projectId,title:projectId,description:'Own adoption Source',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  const install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
  install(old);const document=await createSourceToolDocument({projectId},namespace,'Source'),oldClient=createLocalToolClient(projectId,old,{documentId:document.id}),started=await oldClient.convergence!.start(await oldClient.read()),G=started.checkpoint;
  const from={namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch},target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'},outline:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'}}}});
  install(target);const client=createLocalToolClient(projectId,target,{documentId:document.id}),readonly=createLocalToolClient(projectId,target,{documentId:document.id,readOnly:true}),to:LocalToolConvergenceContract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption};
  const A=createLocalToolReplica(G,{authorId:'A',contract:to});actors.push(A);const ids=A.richRange('body','P',0,5).deleteIds,read=await client.read(),raw=JSON.stringify(await db.projects.get(projectId));
  eq('read remains effective3',read.convergence!.engine.version,'3');eq('start existing Source3 no change',(await client.convergence!.start(read)).changed,false);
  eq('export remains literal3',(await client.convergence!.export()).checkpoint,G);await client.convergence!.richRange('body','P',0,5);await client.convergence!.richBlockSplitCapture('outline','Q',2);eq('read start export capture write nothing',JSON.stringify(await db.projects.get(projectId)),raw);
  let wrongFull='';try{await client.convergence!.adopt(read,(await client.convergence!.export()).update!);}catch(error){wrongFull=error instanceof Error?error.message:String(error);}eq('adopt rejects unadopted FULL3 input',wrongFull,'local_tool_rich_adoption_invalid');eq('FULL3 adopt rejection preserves Source exact',JSON.stringify(await db.projects.get(projectId)),raw);
  A.adopt(to);const D=A.checkpoint();A.apply([{type:'rich-link',field:'body',nodeId:'P',range:A.richRange('body','P',0,2),href:'example.org/H'}]);const H=A.export(),delta=A.export(D.stateVectorBase64);
  let missing='';try{await client.convergence!.import(delta,{expectedLineage:read.document!.lineage});}catch(error){missing=error instanceof Error?error.message:String(error);}eq('Source delta without D requests full',missing,'local_tool_rich_adoption_dependency_missing');eq('Source missing D atomic',JSON.stringify(await db.projects.get(projectId)),raw);
  let denied=false;try{await readonly.convergence!.adopt(read,H);}catch{denied=true;}eq('readonly cannot adopt',denied,true);eq('readonly attempt exact',JSON.stringify(await db.projects.get(projectId)),raw);
  const J=A.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:A.richRange('body','P',5,5),text:'J'}]);
  const result=await client.convergence!.adopt(read,H);eq('Source explicit adoption active4',result.checkpoint.engine.version,'4');eq('Source same lineage',result.snapshot.document!.lineage,read.document!.lineage);eq('Source same document',result.snapshot.document!.id,read.document!.id);
  eq('ACKH does not cover J',sourceCoverage(result.checkpoint)(J.update),false);eq('Source H excludes J',JSON.stringify(result.snapshot.data).includes('J'),false);
  const B=createLocalToolReplica(result.checkpoint,{authorId:'cold',contract:to});actors.push(B);eq('Source IDs preserved',B.richRange('body','P',0,5).deleteIds,ids);eq('Source H href',JSON.stringify(B.read()).includes('https://example.org/H'),true);
  await client.convergence!.import(A.export(),{expectedLineage:read.document!.lineage});const saved=await client.convergence!.export();eq('later own import covers J',sourceCoverage(saved.checkpoint!)(J.update),true);eq('later Source exact',saved.snapshot.data,A.read());
  db.close();await db.open();eq('cold Source adopted checkpoint',(await client.convergence!.export()).checkpoint,saved.checkpoint);
  let stale=false;const prior=JSON.stringify(await db.projects.get(projectId));try{await client.convergence!.adopt(read,H);}catch{stale=true;}eq('stale preparation baseline rejected',stale,true);eq('stale attempt Source exact',JSON.stringify(await db.projects.get(projectId)),prior);
  const observed=await client.read(),fixedH=structuredClone(A.export()),hData=structuredClone(A.read());A.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:A.richRange('body','P',0,0),text:'later-not-in-H'}]);const later=A.export();
  const capturedWrite=client.convergence!.adopt(observed,fixedH);fixedH.updateBase64=later.updateBase64;await capturedWrite;
  eq('SDK adopt captures supplied H before its first await',(await client.read()).data,hData);eq('mutating caller H does not admit later contribution',JSON.stringify((await client.read()).data).includes('later-not-in-H'),false);

 }finally{for(const actor of actors)actor.destroy();if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
