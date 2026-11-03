import assert from 'node:assert/strict';
import http from 'node:http';
import {createPresenceRelay} from '../electron/presence/server';
import {createLocalToolGenesis,createLocalToolReplica} from '../src/engines/local/convergence/replica';
import {convergenceIdentityOf} from '../src/engines/local/convergence/format';
import type {LocalToolConvergenceContract,LocalToolConvergenceUpdate} from '../src/engines/local/convergence/types';
import type {LocalToolJson} from '../src/engines/local/stateTypes';

export async function testLiveContentRelay(){
 const names:string[]=[],contract:LocalToolConvergenceContract={namespace:'tests.live1913-relay',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},validationId:'v1',schemaEpoch:'1',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const G=createLocalToolGenesis({body:{type:'doc',content:[{type:'paragraph',id:'P',content:[{type:'text',text:'base'}]}]}},contract),a=createLocalToolReplica(G,{authorId:'Ada',contract}),b=createLocalToolReplica(G,{authorId:'Rin',contract}),o=createLocalToolReplica(G,{authorId:'observer',contract});
 let host='';const relay=createPresenceRelay(()=>[host]),server=http.createServer((req,res)=>{void relay.handle(req,res);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address==='object');host='127.0.0.1:'+address.port;const origin='http://'+host,aborts:AbortController[]=[],reads:Promise<void>[]=[];
 const check=(name:string,value:unknown)=>{assert(value,name);names.push(name);};
 const post=async(route:string,value:unknown,code=200)=>{const r=await fetch(origin+'/__wh_presence/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),body=await r.json();assert.equal(r.status,code,JSON.stringify(body));return body;};
 const monitor=async(c:{connectionId:string;token:string})=>{const abort=new AbortController();aborts.push(abort);const r=await fetch(origin+'/__wh_presence/events?'+new URLSearchParams(c),{signal:abort.signal}),reader=r.body!.getReader(),frames:any[]=[];reads.push((async()=>{let buffer='';try{for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=new TextDecoder().decode(chunk.value);for(let end;(end=buffer.indexOf('\n\n'))>=0;){const raw=buffer.slice(0,end);buffer=buffer.slice(end+2);if(raw.startsWith('event: content\ndata: '))frames.push(JSON.parse(raw.slice('event: content\ndata: '.length)));}}}catch(error){if(!abort.signal.aborted)throw error;}})());return frames;};
 const wait=async(test:()=>boolean)=>{const deadline=Date.now()+3000;while(!test()){if(Date.now()>deadline)throw Error('live SSE deadline');await new Promise(r=>setTimeout(r,5));}};
 try{
  const Ada=await post('connect',{profile:{userId:'ada',name:'Ada',color:'#2266aa'}}),Rin=await post('connect',{profile:{userId:'rin',name:'Rin',color:'#aa2266'}}),Person=await post('connect',{profile:{userId:'person',name:'Person',color:'#667788'}}),A=await monitor(Ada),B=await monitor(Rin),P=await monitor(Person);
  const document={projectId:'own-relay1913',eraId:null,namespace:contract.namespace,documentId:'D',lineage:'G',convergence:convergenceIdentityOf(G)},roomId=(await post('create',{...Ada,document,content:a.export()})).roomId;
  const join=(c:any,instanceId:string,content=true)=>post('update',{...c,kind:'join',roomId,instanceId,epoch:'epoch-'+instanceId,document,content});await join(Ada,'A');const initial=await join(Rin,'B');b.receive(initial.content);const people=await join(Person,'P',false);check('presence-only member gets no checkpoint',!Object.hasOwn(people,'content'));
  const first=a.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:a.richRange('body','P',4,4),text:' AΩ'}]),second=b.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:b.richRange('body','P',4,4),text:' B李🙂'}]);
  const publish=(c:any,instanceId:string,update:LocalToolConvergenceUpdate,messageId:string,status=200)=>post('update',{...c,kind:'content',roomId,instanceId,epoch:'epoch-'+instanceId,update,messageId},status);
  await publish(Ada,'A',first.update,'logical-9');await publish(Rin,'B',second.update,'logical-1');await wait(()=>A.length>=2&&B.length>=2);
  check('SSE snapshots have immutable session and message identity',B.every(frame=>frame.contentSessionId===roomId&&/^snapshot:[0-9a-f]{64}$/.test(frame.messageId)));
  o.receive(B.at(-1).update);const text=JSON.stringify(o.read());check('unseen lower logical order retains both authors',text.includes('AΩ')&&text.includes('B李🙂'));check('content never enters people/cursors frames',P.length===0);
  const duplicate=await publish(Ada,'A',first.update,'logical-9');check('same ID same bytes idempotent',duplicate.duplicate===true);const collision=await publish(Ada,'A',second.update,'logical-9',400);check('same ID different bytes rejected',collision.error==='local_tool_live_message_collision');
  await publish(Person,'P',first.update,'unauthorized',400);check('presence-only publication denied',true);
  await post('update',{...Ada,kind:'leave',roomId,instanceId:'A',epoch:'epoch-A'});await publish(Ada,'A',first.update,'late-old',400);check('retired epoch cannot append',true);
  const rejoin=await post('update',{...Ada,kind:'join',roomId,instanceId:'A',epoch:'epoch-A2',document,content:true});a.receive(rejoin.content);check('explicit rejoin catches up surviving room',JSON.stringify(a.read()).includes('B李🙂'));
  const plain=(await post('create',{...Ada,document})).roomId;const incompatible=await post('update',{...Rin,kind:'join',roomId:plain,instanceId:'cannot-upgrade',epoch:'new',document,content:true},400);check('people room never silently upgrades',incompatible.error==='local_tool_live_room_people_only');
  return{ok:true,checks:names.length,names};
 }finally{for(const abort of aborts)abort.abort();relay.close();await Promise.all(reads);await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));a.destroy();b.destroy();o.destroy();assert.equal(server.listening,false);}
}
