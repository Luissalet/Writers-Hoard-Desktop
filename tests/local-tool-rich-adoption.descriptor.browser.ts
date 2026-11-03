import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolJson,type LocalToolConvergenceContract} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {RichEditorSession} from '@/engines/local/collaborativeRich/session';
import {LocalDocumentContentHost} from '@/engines/local/liveContent/host';

/** Pause the real second project read after its IDB value exists; original client unchanged. */
export async function testRichAdoptionDescriptorRace(){
 const checks:string[]=[],P='own-adoption-descriptor-'+crypto.randomUUID(),namespace='tests.adoption-descriptor';let session:RichEditorSession|undefined,host:LocalDocumentContentHost|undefined;
 Reflect.set(window,'__linksProgress',checks);
 const eq=(name:string,a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]}} as LocalToolJson,common={namespace,name:{en:'Descriptor adoption',es:'Descriptor de adopción'},description:{en:'Own descriptor race',es:'Carrera propia de descriptor'},document:{defaultTitle:{en:'Descriptor',es:'Descriptor'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null};
 const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}}}),install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
 const originalGet=db.projects.get;let release=()=>{};
 try{
  eq('health89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);await db.projects.add({id:P,title:P,description:'Own descriptor race',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});install(old);const document=await createSourceToolDocument({projectId:P},namespace,'Descriptor'),oldClient=createLocalToolClient(P,old,{documentId:document.id}),started=await oldClient.convergence!.start(await oldClient.read()),G=started.checkpoint;
  const target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from:{namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}}});install(target);const client=createLocalToolClient(P,target,{documentId:document.id}),contract:LocalToolConvergenceContract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption};
  session=new RichEditorSession(client,G,await client.read(),contract,'body',()=>{},()=>1);session.rebind(client,false);await session.refresh();eq('healthy direct session3',session.error,'');host=new LocalDocumentContentHost('own-descriptor',()=>true,client);host.register(session,()=>{});
  let seen=0,arrived=()=>{};const captured=new Promise<void>(resolve=>{arrived=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  db.projects.get=((...args:Parameters<typeof originalGet>)=>{const nth=++seen;return originalGet.apply(db.projects,args).then(async row=>{if(nth===2){arrived();await gate;}return row;});}) as typeof originalGet;
  const descriptor=host.sourceDescriptor();await captured;db.projects.get=originalGet;const adopted=await client.convergence!.adopt(await client.read()),saved=JSON.stringify(await originalGet.call(db.projects,P));eq('external normal adoption committed4',adopted.checkpoint.engine.version,'4');release();const actual=await descriptor;eq('descriptor verifies newly durable4 after old snapshot',actual.identity.engine.version,'4');eq('descriptor Source identity is current4',actual.source.engine.version,'4');eq('read-side preparation writes nothing',JSON.stringify(await db.projects.get(P)),saved);eq('no spurious recovery error',session.error,'');
 }finally{release();db.projects.get=originalGet;host?.dispose();session?.destroy();if(await db.projects.get(P))await deleteProject(P);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
