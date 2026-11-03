import example from '@/engines/local/installed/examples.published-fields/module';
import {LocalPresenceTransport} from '@/engines/local/presence/transport';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolClient} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {convergenceCanonical,convergenceIdentityOf} from '@/engines/local/convergence/format';
import {contentPacketFingerprint} from '@/engines/local/convergence/richAdoption';
import {RichEditorSession} from '@/engines/local/collaborativeRich/session';
import {LocalDocumentContentHost} from '@/engines/local/liveContent/host';
import {LocalDocumentPresenceHost} from '@/engines/local/presence/host';

/** Source/SDK/host/transport original; HTTP/EventSource controlled, not a real room. */
export async function testPresencePromotionRace(){
 const checks:string[]=[],observed:unknown[]=[],failures:string[]=[];
 Reflect.set(window,'__linksProgress',checks);
 const eq=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const tick=()=>new Promise(r=>setTimeout(r,5));
 const until=async(f:()=>boolean,name:string)=>{const end=Date.now()+4000;while(!f()){if(Date.now()>end)throw Error('timeout '+name);await tick();}};
 const originalFetch=window.fetch,OriginalEventSource=window.EventSource;
 for(const scenario of ['promotion3to4','equalIdentity4'] as const){
  const P='own-presence-adoption-race-'+crypto.randomUUID(),namespace='tests.presence-adoption-race';let presence:LocalDocumentPresenceHost|undefined,content:LocalDocumentContentHost|undefined,session:RichEditorSession|undefined,actor:ReturnType<typeof createLocalToolReplica>|undefined;
  let live=true,holdNext=false,held=false,release=()=>{},armSurface=false,wireLeaves=0,wireCloses=0,contentFrames=0;const gate=new Promise<void>(r=>release=r),routes:string[]=[],streams:Stream[]=[];
  class Stream {onmessage:((e:{data:string})=>void)|null=null;onerror:null=null;events=new Map<string,(e:{data:string})=>void>();closed=false;constructor(){streams.push(this);}addEventListener(name:string,fn:(e:{data:string})=>void){this.events.set(name,fn);}close(){this.closed=true;}}
  try{
   eq(scenario+' fresh89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
   await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
   const initial={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'baseΩ'}]}]}} as LocalToolJson,common={namespace,name:{en:'Own promotion race',es:'Carrera propia'},description:{en:'Disposable',es:'Desechable'},document:{defaultTitle:{en:'Own',es:'Propio'}},initialState:initial,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null};
   const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}}}),install=(d:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:d}});install(old);
   const D=await createSourceToolDocument({projectId:P},namespace,'Race'),seed=createLocalToolClient(P,old,{documentId:D.id}),G=(await seed.convergence!.start(await seed.read())).checkpoint;
   const target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from:{namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'}}}});install(target);
   const real=createLocalToolClient(P,target,{documentId:D.id}),client={...real,read:async()=>{const value=await real.read();if(holdNext){holdNext=false;held=true;await gate;}return value;}} as LocalToolClient<LocalToolJson>,contract={namespace,codec:target.codec!,...localToolConvergenceContext(target)!,validateState:target.validateState,richAdoption:target.richAdoption};
   const F=(()=>{const producer=createLocalToolReplica(G,{authorId:'public-promotion-producer',contract});try{producer.adopt(contract);return producer.export();}finally{producer.destroy();}})();actor=createLocalToolReplica(G,{authorId:'public-remote',contract});eq(scenario+' public SDK4 health',F.engine.version,'4');
   session=new RichEditorSession(client,G,await client.read(),contract,'body',()=>{},()=>1);session.rebind(client,false);await session.refresh();eq(scenario+' Source session3 health',session.error,'');eq(scenario+' original Unicode Source health',session.replica.read(),initial);
   content=new LocalDocumentContentHost('own-race-'+scenario,()=>live,client);content.register(session,()=>{});presence=new LocalDocumentPresenceHost(client,content.instanceId,()=>live,content);
   const document=await presence.descriptor(true);let roomDocument=document,roomContent=content.seed();const roomId='own-room-'+scenario;
   const room=()=>({roomId,document:roomDocument,members:[{connectionId:'wire-A',instanceId:content!.instanceId,sessionId:'own-session',profile:{userId:'own-A',name:'Own A',color:'#2277aa'},state:null,surface:{},activeOrder:0}]});
   window.EventSource=Stream as unknown as typeof EventSource;
   window.fetch=(async(url,options)=>{const input=JSON.parse(String(options?.body)),route=String(url).split('/').at(-1);routes.push(route+':'+(input.kind??''));let result:unknown={};
    if(route==='connect')result={connectionId:'wire-A',token:'qa-token'};
    if(route==='update'){
     if(input.kind==='join-prepare'||input.kind==='join')result={room:room(),content:roomContent};
     if(input.kind==='surface'&&armSurface){armSurface=false;holdNext=true;}
     if(input.kind==='leave')wireLeaves++;
     if(input.kind==='content'||input.kind==='content-adopt'){contentFrames++;actor!.receive(input.update);roomContent=actor!.export();roomDocument={...document,convergence:convergenceIdentityOf(roomContent)};result={room:room(),content:roomContent};}
    }
    if(route==='close')wireCloses++;
    return new Response(JSON.stringify(result),{status:200});
   }) as typeof fetch;
   await presence.join(roomId,{userId:'own-A',name:'Own A',color:'#2277aa'},document,true);
   eq(scenario+' joined same room',presence.roomId,roomId);eq(scenario+' sharing healthy',content.snapshot().sharing,true);
   await until(()=>contentFrames>0,'initial3 publish completes');eq(scenario+' joined session remains3 before explicit incoming',session.convergenceIdentity.engine.version,'3');
   const incoming=()=>{actor!.receive(F);roomContent=F;roomDocument={...document,convergence:convergenceIdentityOf(F)};streams.at(-1)!.events.get('content')!({data:JSON.stringify({roomId,contentSessionId:roomId,messageId:'snapshot:'+contentPacketFingerprint(F),update:F})});};
   if(scenario==='equalIdentity4'){incoming();await until(()=>session!.convergenceIdentity.engine.version==='4','warm4');await tick();eq(scenario+' warm valid4',await presence.valid(),true);}
   const before=JSON.stringify(await db.projects.get(P)),epoch=content.snapshot().networkEpoch;
   armSurface=true;presence.surface({body:{cursor:1}},true);await until(()=>held,'final actual read held');incoming();await until(()=>session!.convergenceIdentity.engine.version==='4','incoming4 accepted');await tick();release();await tick();await tick();await tick();
   const beforeLink=contentFrames,range=session.replica.richRange('body','P',0,1);await content.port.apply('body',[{type:'rich-link',field:'body',nodeId:'P',range,href:'https://example.test/race?field=body#own'}]);await tick();await tick();
   const linkDelivered=contentFrames>beforeLink&&convergenceCanonical(actor.read())===convergenceCanonical(session.replica.read());await content.port.control('undo','body');await until(()=>convergenceCanonical(actor!.read())===convergenceCanonical(session!.replica.read()),'Undo reaches remote SDK');eq(scenario+' Undo removes own href on remote',JSON.stringify(actor.read()).includes('https://example.test/race?field=body#own'),false);
   const remoteEdit=actor.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:actor.richRange('body','P',5,5),text:' remoteβ'}]);streams.at(-1)!.events.get('content')!({data:JSON.stringify({roomId,contentSessionId:roomId,messageId:'snapshot:'+contentPacketFingerprint(remoteEdit.update),update:remoteEdit.update})});await until(()=>convergenceCanonical(actor!.read())===convergenceCanonical(session!.replica.read()),'remote SDK edit returns to local Source session');eq(scenario+' original lease still valid after both directions',await presence.valid(),true);
   const record={scenario,wireLeaves,wireCloses,hostRoom:presence.roomId,sharing:content.snapshot().sharing,epochBefore:epoch,epochAfter:content.snapshot().networkEpoch,linkDelivered,contentFrames,presence:presence.snapshot(),content:content.snapshot(),routes};observed.push(record);Reflect.set(window,'__linksObserved',observed);checks.push('OBSERVED '+JSON.stringify(record));
   eq(scenario+' Manual Source stays exact',JSON.stringify(await db.projects.get(P)),before);
   if(wireLeaves!==0||wireCloses!==0||presence.roomId!==roomId||content.snapshot().networkEpoch!==epoch||!linkDelivered)failures.push(scenario+' lost healthy membership/Link delivery');
  }finally{
   release();if(presence){await presence.leave();presence.dispose();}content?.dispose();session?.destroy();actor?.destroy();live=false;window.fetch=originalFetch;window.EventSource=OriginalEventSource;if(await db.projects.get(P))await deleteProject(P);if(await db.settings.get('storage.persistRequestedAt'))await db.settings.delete('storage.persistRequestedAt');eq(scenario+' cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  }
 }
 if(failures.length)throw Error(failures.join('; '));return checks;
}

/** Public transport binding callbacks use original PresenceHost descriptor/real scope, with explicit leases. */
export async function testPresenceRetargetRace(){
 const checks:string[]=[],P='own-presence-retarget-'+crypto.randomUUID(),originalFetch=window.fetch,OriginalEventSource=window.EventSource;let host:LocalDocumentPresenceHost|undefined,wire:LocalPresenceTransport|undefined,release=()=>{},leaseA=true,leaseB=true;
 Reflect.set(window,'__linksProgress',checks);const eq=(n:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(n+': '+JSON.stringify([a,b]));checks.push(n);};
 class Stream{onmessage=null;onerror=null;addEventListener(){}close(){}}
 try{
  eq('fresh89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);registerLocalToolModules({['./installed/'+example.namespace+'/module.tsx']:{default:example}});await db.projects.add({id:P,title:P,description:P,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+example.namespace],createdAt:1,updatedAt:1});const D=await createSourceToolDocument({projectId:P},example.namespace,'Own'),client=createLocalToolClient(P,example,{documentId:D.id});host=new LocalDocumentPresenceHost(client,'own-validator',()=>leaseB);const document=await host.descriptor();
  const trace:unknown[]=[];let member:string|undefined,surfaces=0;
  window.EventSource=Stream as unknown as typeof EventSource;window.fetch=(async(url,options)=>{const body=JSON.parse(String(options?.body)),route=String(url).split('/').at(-1);trace.push({route,kind:body.kind,epoch:body.epoch});let result:unknown={};if(route==='connect')result={connectionId:'own-connection',token:'own-token'};if(body.kind==='join'){member=body.epoch;result={room:{roomId:'own-room',document,members:[]}};}if(body.kind==='leave'&&member===body.epoch)member=undefined;if(body.kind==='surface')surfaces++;return new Response(JSON.stringify(result),{status:200});})as typeof fetch;
  wire=new LocalPresenceTransport(window.location.origin);await wire.connect({userId:'own-person',name:'Own person',color:'#2277aa'},()=>leaseB);
  let validations=0,entered=()=>{};const enteredPromise=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const valid=async()=>{const actual=await host!.descriptor();return convergenceCanonical(actual)===convergenceCanonical(document);};
  await wire.join({roomId:'own-room',instanceId:'same-instance',epoch:'old-epoch',document,current:async()=>{const verified=await valid();validations++;if(validations===4){entered();await gate;}return leaseA&&verified;},reconnected:()=>{}});
  const oldUpdate=wire.update('same-instance','old-epoch',1,'surface',{body:{cursor:1}}).then(()=>'',e=>String(e));await Promise.race([enteredPromise,new Promise((_,rej)=>setTimeout(()=>rej(Error('held final current not reached')),3000))]);
  await wire.join({roomId:'own-room',instanceId:'same-instance',epoch:'new-epoch',document,current:async()=>leaseB&&await valid(),reconnected:()=>{}});eq('successor joined before old validation resolves',member,'new-epoch');leaseA=false;release();const error=await oldUpdate;eq('old revoked lease rejects',error.includes('presence_host_unavailable'),true);const before=surfaces;await wire.update('same-instance','new-epoch',2,'surface',{body:{cursor:2}});checks.push('OBSERVED '+JSON.stringify({member:member??null,surfaces,trace}));leaseB=false;let revoked='';try{await host.descriptor();}catch(e){revoked=String(e);}eq('original host descriptor rejects revoked lease',revoked.includes('presence_host_unavailable'),true);eq('old update cannot retire successor membership',member??null,'new-epoch');eq('successor still emits own surface',surfaces,before+1);return checks;
 }finally{release();if(wire){await wire.leave('same-instance');await wire.beginOperation()();}if(host){await host.leave();host.dispose();}leaseB=false;window.fetch=originalFetch;window.EventSource=OriginalEventSource;if(await db.projects.get(P))await deleteProject(P);if(await db.settings.get('storage.persistRequestedAt'))await db.settings.delete('storage.persistRequestedAt');eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
}
