import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolConvergenceContract} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {RichEditorSession} from '@/engines/local/collaborativeRich/session';

/** Direct normal Session with real original client; distinct from mounted React/relay acceptance. */
export async function testRichAdoptionSession(){
 const checks:string[]=[],actors:LocalToolReplica[]=[],sessions:RichEditorSession[]=[],projectId='own-adoption-session-'+crypto.randomUUID(),namespace='tests.rich-adoption-session';
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]},outline:{type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'Q',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'tree'}]}]}} as LocalToolJson;
 const common={namespace,name:{en:'Adoption Session',es:'Sesión de adopción'},description:{en:'Own adoption Session',es:'Sesión propia de adopción'},document:{defaultTitle:{en:'Session',es:'Sesión'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body&&!!v.outline,component:()=>null};
 const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'},outline:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}}});
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:projectId,title:projectId,description:'Own adoption Session',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});
  const install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});install(old);
  const document=await createSourceToolDocument({projectId},namespace,'Session'),oldClient=createLocalToolClient(projectId,old,{documentId:document.id}),started=await oldClient.convergence!.start(await oldClient.read()),G=started.checkpoint,from={namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch};
  const target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'},outline:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'}}}});install(target);
  const client=createLocalToolClient(projectId,target,{documentId:document.id}),contract:LocalToolConvergenceContract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption};
  let step=0,jInserted=false,insertOnBusy=false;let session:RichEditorSession;
  const notify=()=>{if(insertOnBusy&&session.busy&&!jInserted){jInserted=true;session.applyBatch([{type:'rich-text-splice',field:'body',nodeId:'P',range:session.replica.richRange('body','P',4,4),text:'J'}]);}};
  session=new RichEditorSession(client,G,started.snapshot,contract,'body',notify,()=>++step);sessions.push(session);await session.refresh();eq('mount effective3 not links',session.links,false);eq('explicit adoption available',session.canAdopt,true);
  const oldUnits=session.replica.richRange('body','P',0,4).deleteIds;session.applyBatch([{type:'rich-mark',field:'body',nodeId:'P',range:session.replica.richRange('body','P',0,1),mark:'bold',enabled:true}]);eq('local adoption succeeds',session.adopt(),true);eq('local adoption enables links',session.links,true);eq('live old owner Undo succeeds',session.reverse(),true);
  session.applyBatch([{type:'rich-link',field:'body',nodeId:'P',range:session.replica.richRange('body','P',0,2),href:'example.org/H'}]);await session.refresh();eq('Source3 refresh does not revoke draft4',session.error,'');eq('Source3 refresh does not confirm D',session.dirty,true);eq('Source still3 before Save',(await client.convergence!.export()).checkpoint!.engine.version,'3');
  insertOnBusy=true;eq('Save H succeeds',await session.save(),true);insertOnBusy=false;eq('busy callback inserted J',jInserted,true);const h=await client.read();eq('FULLH excludes later J',JSON.stringify(h.data).includes('J'),false);eq('J remains dirty',session.dirty,true);eq('next Save J succeeds',await session.save(),true);eq('next Source includes J',JSON.stringify((await client.read()).data).includes('J'),true);eq('clean after second ACK',session.pending,false);eq('original units exact',session.replica.richRange('body','P',0,4).deleteIds,oldUnits);
  // An ORIGINAL3 Undo targets K absent from the receiver; metadata/read is not progress.
  const Legacy=createLocalToolReplica(G,{authorId:'legacy',contract:{...from,validateState:target.validateState}});actors.push(Legacy);const K=Legacy.apply([{type:'rich-mark',field:'outline',nodeId:'Q',range:Legacy.richRange('outline','Q',0,1),mark:'italic',enabled:true}]),X=Legacy.undo(K.receiptId!),original=JSON.stringify(X.update),full=session.replica.export();
  eq('missing K requeued',session.receiveDraft(X.update),'needs-full');eq('missing K does not create permanent error',session.error,'');eq('missing K not shareable',session.shareable,false);session.receiveDraft(full);session.receiveDraft(full);eq('same F without K still waits',session.needsFull,true);
  eq('composition starts',session.beginComposition(),true);session.receiveDraft(K.update);session.endComposition();eq('empty composition replays K and original',session.needsFull,false);eq('repaired sharing ready',session.shareable,true);eq('repaired original unchanged',JSON.stringify(X.update),original);eq('repaired errors empty',session.error,'');
 }finally{for(const s of sessions)s.destroy();for(const actor of actors)actor.destroy();if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
