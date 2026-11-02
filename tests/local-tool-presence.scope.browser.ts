import '@/engines';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {saveWorldEra} from '@/services/worldEras/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import example from '@/engines/local/installed/examples.published-fields/module';
import {LocalDocumentPresenceHost} from '@/engines/local/presence/host';
import {queryLocalToolPresence} from '@/engines/local/presence/query';
function check(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
function gate(){let enter!:()=>void,release!:()=>void;return{entered:new Promise<void>(r=>enter=r),released:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()};}
async function entered(g:ReturnType<typeof gate>){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([g.entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No real read reached gate')),2000);})]);}finally{clearTimeout(timer);}}
export async function testLocalPresenceFinalScope(){
 const prefix='own-presence1893-scope-',owned=new Set<string>(),hosts:LocalDocumentPresenceHost[]=[],groups:string[]=[],fetch=window.fetch;let networkCalls=0;
 try{
  check(db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(x=>x===0),'Private89 fresh required');registerLocalToolModules({['./installed/'+example.namespace+'/module.tsx']:{default:example}});
  window.fetch=(...args)=>{networkCalls++;return fetch(...args);};
  const setup=async()=>{const P=prefix+crypto.randomUUID();owned.add(P);await db.projects.add({id:P,title:prefix,description:prefix,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+example.namespace],createdAt:1,updatedAt:1});const D=(await createSourceToolDocument({projectId:P},example.namespace,'Own source')).id;await saveWorldEra(P,{id:'E',name:'Own era',description:'',revision:0,createdAt:1,updatedAt:1},null);return{P,D,scope:{projectId:P,eraId:'E'},client:createLocalToolClient(P,example,{eraId:'E',documentId:D})};};
  const profile={userId:'own-scope-person',name:'Own scope',color:'#2277aa'};
  for(const kind of ['descriptor','create','join','deleted-project']as const){
   const f=await setup(),g=gate();let held=false;
   const wrapped={...f.client,read:async()=>{const value=await f.client.read();if(!held){held=true;g.enter();await g.released;}return value;}};
   // This is a normal host controller over a real DB/client; the lease stays true to exclude React as the cause.
   const host=new LocalDocumentPresenceHost(wrapped,'own-scope-'+kind,()=>true);hosts.push(host);
   const pending=kind==='create'?host.create(profile):kind==='join'?host.join('unused-room',profile):host.descriptor();await entered(g);if(kind==='deleted-project')await deleteProject(f.P);else await db.projects.update(f.P,{worldEras:[]});g.release();let error='';try{await pending;}catch(reason){error=String(reason);}check(error.includes(kind==='deleted-project'?'project_missing':'world_era_missing'),'Final real scope not revalidated for '+kind+':'+error);check(networkCalls===0,'Expired scope reached create/join network');host.dispose();groups.push(kind+' rejects deleted real scope after held client.read with lease still true');
  }
  const f=await setup(),g=gate(),originalWhere=db.worldEraVariants.where,where=originalWhere.bind(db.worldEraVariants);let held=false;
  db.worldEraVariants.where=((...args:Parameters<typeof where>)=>{const clause=where(...args),equals=clause.equals.bind(clause);clause.equals=((...values:Parameters<typeof equals>)=>{const collection=equals(...values),first=collection.first.bind(collection);collection.first=(async()=>{const row=await first();if(!held){held=true;g.enter();await g.released;}return row;})as typeof collection.first;return collection;})as typeof clause.equals;return clause;})as typeof originalWhere;
  try{const query=queryLocalToolPresence(f.scope,example.namespace,f.D);await entered(g);await db.projects.update(f.P,{worldEras:[]});g.release();let error='';try{await query;}catch(reason){error=String(reason);}check(error.includes('world_era_missing'),'Readonly presence returned a removed era');check(networkCalls===0,'Readonly query joined the relay');groups.push('Readonly query revalidates real era after a held IndexedDB variant read, without join');}finally{g.release();db.worldEraVariants.where=originalWhere;}
  return groups;
 }finally{window.fetch=fetch;for(const host of hosts)host.dispose();for(const P of owned)await deleteProject(P);if(await db.settings.get('storage.persistRequestedAt'))await db.settings.delete('storage.persistRequestedAt');const counts=await Promise.all(db.tables.map(t=>t.count()));check(counts.length===89&&counts.every(x=>x===0),'Own89cleanup incomplete');}
}

/** Real store/host with a controlled wire: multiple callers own separate ephemeral publications. */
export async function testLocalPresencePublicationOwners(){
 const P='own-presence1893-owners-'+crypto.randomUUID(),originalFetch=window.fetch,OriginalEventSource=window.EventSource,states:unknown[]=[];let host:LocalDocumentPresenceHost|undefined;
 class Stream{onmessage:null=null;onerror:null=null;close(){}}
 try{
  check(db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(x=>x===0),'Private89 fresh required');registerLocalToolModules({['./installed/'+example.namespace+'/module.tsx']:{default:example}});
  await db.projects.add({id:P,title:'Own owners',description:'Own owners',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+example.namespace],createdAt:1,updatedAt:1});const D=(await createSourceToolDocument({projectId:P},example.namespace,'Own source')).id,client=createLocalToolClient(P,example,{documentId:D});check((await client.read()).data.score===7,'Real Source health7');
  window.EventSource=Stream as unknown as typeof EventSource;window.fetch=(async(_url,options)=>{const body=JSON.parse(String(options?.body??'{}'));if(body.kind==='state')states.push(body.state);return new Response(JSON.stringify(body.kind==='join'?{room:{roomId:'own-room',members:[]}}:{connectionId:'own-wire',token:'own-token'}),{status:200});})as typeof fetch;
  host=new LocalDocumentPresenceHost(client,'own-owners-view',()=>true);await host.join('own-room',{userId:'own-owners',name:'Own owners',color:'#2277aa'});
  const wait=async(value:unknown)=>{const wanted=JSON.stringify(value),until=Date.now()+2000;while(Date.now()<until){if(JSON.stringify(states.at(-1))===wanted)return;await new Promise(r=>setTimeout(r,5));}throw Error('Wire did not publish '+wanted);};
  const A=host.port.publish({value:9});await wait({value:9});const B=host.port.publish({value:11});await wait({value:11});B();await wait({value:9});
  host.port.setLocal({value:13});await wait({value:13});host.port.clear();await wait({value:9});B();await wait({value:9});
  let rejected=false;try{host.port.publish({value:NaN});}catch{rejected=true;}check(rejected,'Invalid publication accepted');await wait({value:9});A();await wait(null);
  return['Retiring latest live producer restores previous live producer','Raw clear retires only raw producer; old revoker is idempotent','Invalid JSON preserves live producer; final own revocation emits null'];
 }finally{if(host){await host.leave();host.dispose();}window.fetch=originalFetch;window.EventSource=OriginalEventSource;await deleteProject(P);if(await db.settings.get('storage.persistRequestedAt'))await db.settings.delete('storage.persistRequestedAt');check((await Promise.all(db.tables.map(t=>t.count()))).every(x=>x===0),'Own89cleanup incomplete');}
}
