/* Public replica regressions; Yjs only reads/edits separate owned checkpoint carriers. */
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolConvergenceCheckpoint,type RichDocument} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';

type Data=Record<string,LocalToolJson>;
type Version={id:string;txId:string;root:string;key:string;present:boolean;value:any};
export async function runRichSnapshotProofMemo(save:(name:string,value:unknown)=>void){
 const actors:LocalToolReplica<Data>[]=[],groups:string[]=[],checks:string[]=[],cleanupErrors:string[]=[];
 let phase='seed',firstFailure:unknown=null,destroyed=0,docs=0,docsDestroyed=0,max=Infinity;
 const equal=(name:string,actual:unknown,expected:unknown)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
 const data:Data={body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'ab'}]}]},opaque:'Élodie你🙂'};
 const definition=defineLocalTool<Data>({namespace:'tests.rich67.proof-memo',name:{en:'Snapshot proof memo',es:'Memo de procedencia'},description:{en:'Public proof invalidation regressions',es:'Regresiones públicas de invalidación'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body&&value.opaque===data.opaque&&(value.body as unknown as RichDocument).content.reduce((n,p)=>n+p.content.reduce((m,t)=>m+t.text.length,0),0)<=max,component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:'proof-memo-project',updatedAt:1,sourceToolDocuments:[{id:'proof-memo-document',namespace:definition.namespace,title:'Proof memo',generation:'proof-memo-generation',revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:'proof-memo-project'},false,'proof-memo-document');
 const started=await client.convergence!.start(await client.read());
 const make=(name:string)=>{const p=createLocalToolReplica<Data>(started.checkpoint,{authorId:'proof-memo-'+name,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:started.checkpoint.validationId,schemaEpoch:started.checkpoint.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};
 const text=(p:LocalToolReplica<Data>)=>(p.read().body as unknown as RichDocument).content[0].content.map(t=>t.text).join('');
 const append=(p:LocalToolReplica<Data>,value:string,marks?:['bold'])=>{const end=text(p).length;return p.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:p.richRange('body','P',end,end),text:value,...(marks?{marks}:{})}]);};
 const warm=(p:LocalToolReplica<Data>)=>{for(let n=0;n<3;n++)equal('warm append remains complete',append(p,'w').pending,false);};
 const carrier=(G:LocalToolConvergenceCheckpoint,change:(doc:Y.Doc)=>void)=>{const doc=new Y.Doc({gc:false});docs++;try{Y.applyUpdate(doc,new Uint8Array(Buffer.from(G.checkpointBase64,'base64')));change(doc);return{...G,checkpointBase64:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),stateVectorBase64:Buffer.from(Y.encodeStateVector(doc)).toString('base64')};}finally{doc.destroy();docsDestroyed++;}};
 const metadata=(G:LocalToolConvergenceCheckpoint)=>{let versions:Version[]=[],activations:{versionId:string;enabled:boolean}[]=[];carrier(G,doc=>{versions=[...doc.getMap<string>('register-versions').values()].map(s=>JSON.parse(s));activations=[...doc.getMap<string>('register-activations').values()].map(s=>JSON.parse(s));});return{versions,activations};};
 const covers=(spans:{buffer:string;runId:string;from:number;to:number}[],id:string)=>{const[b,r,n]=JSON.parse(id);return spans.some(s=>s.buffer===b&&s.runId===r&&s.from<=n&&n<s.to);};
 try{
  phase='inactive-key-reuse';const live=make('live'),edit=append(live,'X',['bold']);assert.ok(edit.receiptId);equal('marked append complete',edit.pending,false);
  const x=live.richRange('body','P',2,3).deleteIds[0],root='rich3:'+JSON.stringify('body')+':marks',old=metadata(live.checkpoint()).versions.find(v=>v.root===root&&v.value.mark==='bold'&&covers(v.value.spans,x));assert.ok(old);
  equal('real author Undo complete',live.undo(edit.receiptId).pending,false);equal('Undo hides X',text(live),'ab');equal('warm before reuse',append(live,'w').pending,false);
  const range=live.richRange('body','P',3,3),descriptor=Object.getOwnPropertyDescriptor(crypto,'randomUUID'),normal=crypto.randomUUID.bind(crypto);let serial=0,forced=0,collision:ReturnType<typeof live.apply>|undefined;
  try{
   // The run is first and its mark key is second; metadata reads allocate no discarded visibility keys.
   Object.defineProperty(crypto,'randomUUID',{configurable:true,writable:true,value:()=>++serial===2?(forced++,old.key):normal()});
   collision=live.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range,text:'U',marks:['bold']}]);
  }finally{if(descriptor)Object.defineProperty(crypto,'randomUUID',descriptor);else delete(crypto as unknown as Record<string,unknown>).randomUUID;}
  equal('one declared mark UUID reused',forced,1);assert.ok(collision);assert.ok(collision.receiptId);equal('new raw data accepted',collision.conflict,null);equal('inactive retained proof rechecked without receive',collision.pending,true);equal('collision raw text',text(live),'abwU');
  const u=live.richRange('body','P',3,4).deleteIds[0],G=live.checkpoint(),meta=metadata(G),same=meta.versions.filter(v=>v.root===root&&v.key===old.key),fresh=same.find(v=>v.id!==old.id);
  equal('same key has two distinct versions',same.length,2);assert.ok(fresh&&fresh.txId!==old.txId&&covers(fresh.value.spans,u));equal('old mark inactive',meta.activations.some(a=>a.versionId===old.id&&!a.enabled),true);
  const witnesses=meta.versions.filter(v=>v.root==='authored-valid-snapshot'&&v.present&&v.value.richBindings?.body?.nodes.some((node:any)=>(node.spans??[]).some((span:any)=>span.marks?.bold===old.key&&covers([span],x))));
  equal('exact old X witness retained',witnesses.length,1);equal('old X witness inactive',meta.activations.some(a=>a.versionId===witnesses[0].id&&!a.enabled),true);
  const cold=make('cold'),packet={...live.export(),updateBase64:G.checkpointBase64};equal('cold reader agrees pending',cold.receive(packet).pending,true);equal('cold reader data exact',cold.read(),live.read());
  const filtered=carrier(G,doc=>{const versions=doc.getMap<string>('register-versions'),v=JSON.parse(versions.get(witnesses[0].id)!);v.present=false;versions.set(v.id,JSON.stringify(v));}),control=make('control');
  equal('only omitting old proof removes pending',control.receive({...packet,updateBase64:filtered.checkpointBase64}).pending,false);equal('causal control preserves same raw data',control.read(),live.read());groups.push('inactive-mark-key-reuse-observer');save('KEY-REUSE.json',{oldKey:old.key,oldVersion:old.id,newVersion:fresh!.id,oldWitness:witnesses[0].id,livePending:collision.pending,coldPending:true,controlPending:false,uuidCalls:serial});

  phase='mutable-policy';const policy=make('policy');warm(policy);const beforePolicy=policy.checkpoint();max=2;
  equal('mutable policy selects old accepted data',text(policy),'ab');assert.throws(()=>append(policy,'Y'),/local_tool_convergence_authored_state_invalid/);checks.push('policy rejection is not cached');equal('rejected policy leaves checkpoint exact',policy.checkpoint(),beforePolicy);
  max=Infinity;equal('restoring policy exposes raw data',text(policy),'abwww');equal('next valid append complete',append(policy,'Y').pending,false);groups.push('mutable-policy-not-memoized');

  phase='historical-frontier';const historic=make('historic'),oldRange=historic.richRange('body','P',0,1);warm(historic);const current=historic.richRange('body','P',5,5),beforeFrontier=historic.checkpoint();
  assert.throws(()=>historic.apply([{type:'rich-mark',field:'body',nodeId:'P',range:{...current,frontier:oldRange.frontier},mark:'bold',enabled:true}]),/local_tool_rich_capture_invalid/);checks.push('current proof cannot enter old frontier');equal('forged frontier leaves checkpoint exact',historic.checkpoint(),beforeFrontier);
  const marked=historic.apply([{type:'rich-mark',field:'body',nodeId:'P',range:oldRange,mark:'bold',enabled:true}]);equal('real historical capture accepted',marked.pending,false);assert.ok(marked.receiptId);const undone=historic.undo(marked.receiptId);equal('historical Undo complete',undone.pending,false);assert.ok(undone.receiptId);equal('historical Redo complete',historic.redo(undone.receiptId).pending,false);groups.push('historical-frontier-not-memoized');

  phase='failed-receive';const receiver=make('receiver');warm(receiver);const beforeReceive=receiver.checkpoint();assert.throws(()=>receiver.receive({...receiver.export(),genesisId:'foreign-genesis'}),/local_tool_convergence_identity_mismatch/);checks.push('foreign receive rejected');equal('failed receive atomic',receiver.checkpoint(),beforeReceive);equal('next append after failed receive complete',append(receiver,'Y').pending,false);equal('opaque field preserved',receiver.read().opaque,data.opaque);groups.push('failed-receive-invalidates');
 }catch(error){firstFailure={phase,message:String(error),stack:(error as Error).stack};}
 finally{max=Infinity;for(const actor of actors)try{actor.destroy();destroyed++;}catch(error){cleanupErrors.push(String(error));}}
 return{ok:firstFailure===null&&cleanupErrors.length===0&&groups.length===4&&actors.length===6&&destroyed===6&&docs===3&&docsDestroyed===3,groups,checks:checks.length,checkNames:checks,firstFailure,cleanupErrors,cleanup:{replicas:{created:actors.length,destroyed},carrierDocs:{created:docs,destroyed:docsDestroyed}},scope:'SDK-only live actors; metadata and one causal control on separate public Yjs carriers, no private replica Doc or Source/MCP/performance claim'};
}
