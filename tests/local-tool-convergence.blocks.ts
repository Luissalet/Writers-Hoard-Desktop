import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type LocalToolConvergenceCheckpoint,type LocalToolDefinition,type RichBlockDocument,type RichBlock,type LocalToolReplicaEdit} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';

type Data=Record<string,LocalToolJson>;
type Actor=LocalToolReplica<Data>;
const paragraph=(id:string,text:string,parentId:string|null=null,afterId:string|null=null):RichBlock=>({id,type:'paragraph',attrs:{},parentId,slot:'body',afterId,content:[{type:'text',text}]});
const quote=(id:string,afterId:string|null):RichBlock=>({id,type:'blockquote',attrs:{},parentId:null,slot:'body',afterId});
export async function runRichBlocksCausals(save:(name:string,value:unknown)=>void){
 const actors:Actor[]=[],checks:string[]=[],groups:string[]=[];let failure:unknown=null,destroyed=0,ordinal=0,docsCreated=0,docsDestroyed=0;
 const keep=(label:string,value:unknown)=>save(`${String(++ordinal).padStart(3,'0')}-${label}.json`,structuredClone(value));
 const eq=(label:string,actual:unknown,expected:unknown)=>{assert.deepStrictEqual(actual,expected,label);checks.push(label);};
 const body=(p:Actor)=>p.read().body as unknown as RichBlockDocument;
 const ids=(p:Actor)=>Object.fromEntries(body(p).blocks.filter(b=>b.content).map(b=>[b.id,p.richRange('body',b.id,0,b.content!.reduce((n,t)=>n+t.text.length,0)).deleteIds]));
 const clean=(p:Actor,label:string)=>{eq(label+':conflict',p.inspect().conflict,null);eq(label+':opaque',p.read().opaque,'Élodie你🙂');};
 const edit=(label:string,result:LocalToolReplicaEdit<Data>)=>{eq(label+':receipt',typeof result.receiptId,'string');eq(label+':pending',result.pending,false);eq(label+':conflict',result.conflict,null);keep(label,result);return result;};
 async function seed(label:string,blocks:RichBlock[]){
  const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks} as unknown as LocalToolJson},namespace='tests.rich-blocks.causals2046.'+label.toLowerCase(),projectId='blocks1883-'+label,documentId=projectId+'-doc';
  const definition=defineLocalTool<Data>({namespace,name:{en:'Shared blocks',es:'Bloques compartidos'},description:{en:'Public causal blocks test',es:'Prueba causal pública de bloques'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂'&&!!v.body,component:()=>null});
  const host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1,sourceToolDocuments:[{id:documentId,namespace,title:label,generation:label,revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]});
  const client=host.createClient({projectId},false,documentId),baseline=await client.read(),started=await client.convergence!.start(baseline);keep(label+'-genesis',started);
  return{G:started.checkpoint,definition,client,data};
 }
 function make(G:LocalToolConvergenceCheckpoint,definition:LocalToolDefinition<Data>,authorId:string){const p=createLocalToolReplica(G,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;}
 try{
  const f=await seed('C1',[paragraph('P','ab'),paragraph('Q','gh',null,'P')]),a=make(f.G,f.definition,'A'),b=make(f.G,f.definition,'B'),oab=make(f.G,f.definition,'Oab'),oba=make(f.G,f.definition,'Oba'),all=[a,b,oab,oba];
  const original=ids(a),before=a.checkpoint(),capture=a.richBlockCapture('body',{nodeIds:['P','Q']});eq('C1-capture-readonly',a.checkpoint(),before);
  const hostCapture=await f.client.convergence!.richBlockCapture('body',{nodeIds:['P','Q']});eq('C1-host-capture',hostCapture.capture,capture);
  const gap=b.richRange('body','Q',1,1,{affinity:'right'}),g=b.richRange('body','Q',0,1);
  const wa=edit('C1-wrap',a.apply([{type:'rich-block-wrap',field:'body',capture,wrapper:{id:'L',type:'bullet-list',attrs:{}},items:[{id:'I1',leafId:'P'},{id:'I2',leafId:'Q'}]}]));
  const eb=edit('C1-B-text',b.apply([{type:'rich-text-splice',field:'body',nodeId:'Q',range:gap,text:'🙂你é',marks:['italic']},{type:'rich-mark',field:'body',nodeId:'Q',range:g,mark:'bold',enabled:true}]));
  const bState=b.read(),bUnits=ids(b),bContent=body(b).blocks.find(n=>n.id==='Q')!.content;eq('C1-Unicode-UTF16',bUnits.Q.length-original.Q.length,5);
  eq('C1-B-exact-marks',bContent,[{type:'text',text:'g',marks:[{type:'bold'}]},{type:'text',text:'🙂你é',marks:[{type:'italic'}]},{type:'text',text:'h'}]);
  for(const[p,updates]of [[a,[eb.update]],[b,[wa.update]],[oab,[wa.update,eb.update]],[oba,[eb.update,wa.update]]] as const)for(const update of updates){const result=p.receive(update);eq('C1-receive-pending',result.pending,false);}
  const expected:RichBlockDocument={type:'block-doc',schema:'writers-blocks/1',blocks:[{id:'I1',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:null},{id:'I2',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:'I1'},{id:'L',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},paragraph('P','ab','I1'),{...paragraph('Q','gh','I2'),content:bContent}]};
  for(const p of all){clean(p,'C1-merged');eq('C1-merged-structure',body(p),expected);eq('C1-original-P',ids(p).P,original.P);eq('C1-B-unit-identities',ids(p).Q,bUnits.Q);eq('C1-B-marks',body(p).blocks.find(n=>n.id==='Q')!.content,bContent);eq('C1-wrapper',body(p).blocks.find(n=>n.id==='P')!.parentId,'I1');eq('C1-gap-after-B',p.resolveRichPoint(gap),{nodeId:'Q',offset:6,detached:false});}
  keep('C1-merged',{data:a.read(),ids:ids(a),checkpoint:a.checkpoint()});const undo=edit('C1-UndoA',a.undo(wa.receiptId!));for(const p of all.slice(1)){const r=p.receive(undo.update);eq('C1-undo-receive-pending',r.pending,false);}
  for(const p of all){clean(p,'C1-undone');eq('C1-only-leaves',body(p).blocks.map(b=>b.id),['P','Q']);eq('C1-Undo-preserves-B-ids',ids(p),bUnits);eq('C1-Undo-preserves-B-data',p.read(),bState);eq('C1-gap-after-Undo',p.resolveRichPoint(gap),{nodeId:'Q',offset:6,detached:false});}
  const cold=make(oab.checkpoint(),f.definition,'C1-cold');eq('C1-cold',cold.read(),a.read());eq('C1-cold-ids',ids(cold),bUnits);
  const hostWrap=await f.client.state!.apply(hostCapture.snapshot,[{type:'rich-block-wrap',field:'body',capture:hostCapture.capture,wrapper:{id:'L',type:'bullet-list',attrs:{}},items:[{id:'I1',leafId:'P'},{id:'I2',leafId:'Q'}]}]);eq('C1-host-writer-receipt',typeof hostWrap.receiptId,'string');
  const imported=await f.client.convergence!.import(eb.update);eq('C1-host-import-pending',imported.pending,false);eq('C1-host-merged-data',imported.snapshot.data.body,expected);
  const hostUndo=await f.client.state!.undo(hostWrap.receiptId!);eq('C1-host-undo-preserves-B',hostUndo.snapshot.data,bState);eq('C1-host-export-pending',(await f.client.convergence!.export()).pending,false);groups.push('C1');

  const c=await seed('C2',[paragraph('PU','ab','U'),paragraph('QV','gh','V'),quote('U',null),quote('V','U')]),a2=make(c.G,c.definition,'A2'),b2=make(c.G,c.definition,'B2'),ab=make(c.G,c.definition,'Oab2'),ba=make(c.G,c.definition,'Oba2'),both=[a2,b2,ab,ba];
  const ma=edit('C2-move-A',a2.apply([{type:'rich-block-move',field:'body',capture:a2.richBlockMoveCapture('body','U',{parentId:'V',slot:'body',afterId:'QV'})}])),stateA=a2.read();
  const mb=edit('C2-move-B',b2.apply([{type:'rich-block-move',field:'body',capture:b2.richBlockMoveCapture('body','V',{parentId:'U',slot:'body',afterId:'PU'})}])),stateB=b2.read();
  eq('C2-alone-A-exact',body(a2),{type:'block-doc',schema:'writers-blocks/1',blocks:[paragraph('PU','ab','U'),paragraph('QV','gh','V'),{...quote('U','QV'),parentId:'V'},quote('V','U')]});
  eq('C2-alone-B-exact',body(b2),{type:'block-doc',schema:'writers-blocks/1',blocks:[paragraph('PU','ab','U'),paragraph('QV','gh','V'),quote('U',null),{...quote('V','PU'),parentId:'U'}]});
  assert.throws(()=>a2.richBlockMoveCapture('body','V',{parentId:'U',slot:'body',afterId:'PU'}));checks.push('C2-local-cycle-rejected');
  for(const[p,updates]of [[a2,[mb.update]],[b2,[ma.update]],[ab,[ma.update,mb.update]],[ba,[mb.update,ma.update]]] as const)for(const update of updates){const result=p.receive(update);eq('C2-receive-pending',result.pending,false);}
  // Derive the expected existing snapshot comparator from public checkpoint bytes.
  const carrier=new Y.Doc({gc:false});docsCreated++;let expectedFallback:Data,placementA:string;
  try{Y.applyUpdate(carrier,Uint8Array.from(atob(ab.checkpoint().checkpointBase64),c=>c.charCodeAt(0)));const versions=[...carrier.getMap<string>('register-versions').values()].map(v=>JSON.parse(v));const candidates=versions.filter(v=>v.root==='authored-valid-snapshot'&&v.present&&assertCandidate(v.value.data,stateA,stateB));candidates.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);assert.equal(candidates.length,2);expectedFallback=candidates.at(-1)!.value.data;placementA=versions.find(v=>v.root==='blocks3:"body":placement'&&v.key==='U'&&v.value.parentId==='V').id;}finally{carrier.destroy();docsDestroyed++;}
  let raw:unknown;for(const p of both){const conflict=p.inspect().conflict!;eq('C2-validation',conflict.kind,'validation');eq('C2-policy',conflict.policy,'authored-valid-snapshot/1');eq('C2-deterministic-fallback',p.read(),expectedFallback!);const rawBody=(conflict.raw as Data).body as unknown as RichBlockDocument;eq('C2-raw-U-parent',rawBody.blocks.find(n=>n.id==='U')!.parentId,'V');eq('C2-raw-V-parent',rawBody.blocks.find(n=>n.id==='V')!.parentId,'U');if(raw)eq('C2-raw-convergence',conflict.raw,raw);else raw=conflict.raw;}
  keep('C2-cycle',{view:ab.inspect(),checkpoint:ab.checkpoint(),stateA,stateB,expectedFallback:expectedFallback!});
  const ua=edit('C2-UndoA',a2.undo(ma.receiptId!));for(const p of both.slice(1)){const result=p.receive(ua.update);eq('C2-undo-pending',result.pending,false);}for(const p of both){clean(p,'C2-UndoA');eq('C2-exact-B',p.read(),stateB);}
  const retained=new Y.Doc({gc:false});docsCreated++;
  try{Y.applyUpdate(retained,Uint8Array.from(atob(a2.checkpoint().checkpointBase64),c=>c.charCodeAt(0)));eq('C2-A-placement-retained',retained.getMap('register-versions').has(placementA!),true);eq('C2-A-placement-deactivated',[...retained.getMap<string>('register-activations').values()].map(v=>JSON.parse(v)).some(v=>v.versionId===placementA!&&v.enabled===false),true);}finally{retained.destroy();docsDestroyed++;}
  const redo=a2.redo(ua.receiptId!);eq('C2-redo-receipt',typeof redo.receiptId,'string');eq('C2-redo-pending',redo.pending,false);for(const p of both.slice(1))eq('C2-redo-receive-pending',p.receive(redo.update).pending,false);
  for(const p of both){eq('C2-redo-raw',p.inspect().conflict!.raw,raw);eq('C2-redo-fallback',p.read(),expectedFallback!);}
  const reopened=make(ab.checkpoint(),c.definition,'C2-cold');eq('C2-cold-inspect',reopened.inspect(),a2.inspect());groups.push('C2');

  const full=await seed('C3',[paragraph('P','Antes Ω'),quote('Q','P'),paragraph('R','dentro 🙂','Q')]);
  const writer=make(full.G,full.definition,'writer'),other=make(full.G,full.definition,'other');
  const destination={parentId:null,slot:'body' as const,afterId:null};
  const action:Extract<Parameters<Actor['apply']>[0][number],{type:'rich-block-replace-with-paragraphs'}>={
   type:'rich-block-replace-with-paragraphs',field:'body',capture:writer.richBlockEditCapture('body',['P','Q'],destination),
   paragraphs:[{id:'Z',type:'paragraph',content:[{type:'text',text:'Nuevo Ω',marks:[{type:'bold'}]}]},{id:'A',type:'paragraph',content:[]},
    {id:'M',type:'paragraph',content:[{type:'text',text:'Nuevo 🙂',marks:[{type:'italic'}]}]}],
  };
  const beforeInvalid=writer.checkpoint();
  assert.throws(()=>writer.apply([{...action,capture:writer.richBlockEditCapture('body',['P'],destination)}]),/local_tool_block_edit_invalid/);
  assert.throws(()=>writer.apply([{...action,paragraphs:[{...action.paragraphs[0],id:'R'}]}]),/local_tool_block_edit_invalid/);
  eq('C3-invalid-replacement-is-atomic',writer.checkpoint(),beforeInvalid);
  const sameText=other.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:other.richRange('body','P',0,1),text:'A'}]);
  writer.receive(sameText.update);
  const originalC3=writer.read(),idsC3=ids(writer),stale=writer.checkpoint();
  eq('C3-peer-change-has-same-visible-text',originalC3,full.data);
  assert.throws(()=>writer.apply([action]),/local_tool_block_replace_stale/);
  eq('C3-stale-replacement-is-atomic',writer.checkpoint(),stale);
  const applied=edit('C3-replace',writer.apply([{...action,capture:writer.richBlockEditCapture('body',['P','Q'],destination)}]));
  eq('C3-exact-paragraphs-in-anchor-order',body(writer).blocks.map(b=>[b.id,b.afterId,b.content]),[
   ['A','Z',action.paragraphs[1].content],['M','A',action.paragraphs[2].content],['Z',null,action.paragraphs[0].content],
  ]);
  const replaced=writer.read();other.receive(applied.update);eq('C3-peer-sees-replacement',other.read(),replaced);
  const restored=edit('C3-undo',writer.undo(applied.receiptId!));eq('C3-undo-exact-data',writer.read(),originalC3);
  eq('C3-undo-original-unit-ids',ids(writer),idsC3);
  const reapplied=edit('C3-redo',writer.redo(restored.receiptId!));eq('C3-redo-exact-data',writer.read(),replaced);
  other.receive(restored.update);other.receive(reapplied.update);eq('C3-peer-sees-redo',other.read(),replaced);
  eq('C3-cold-replacement',make(writer.checkpoint(),full.definition,'cold').read(),replaced);groups.push('C3');
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const p of actors){try{p.destroy();destroyed++;}catch(error){failure??={message:String(error)};}}}
 const result={ok:failure===null,groups,checks,failure,cleanup:{created:actors.length,destroyed},carrierDocs:{created:docsCreated,destroyed:docsDestroyed},scope:'Product public API in RAM, before editor/Browser acceptance'};keep('RESULT',result);return result;
}
function assertCandidate(value:unknown,a:Data,b:Data){try{assert.deepStrictEqual(value,a);return true;}catch{try{assert.deepStrictEqual(value,b);return true;}catch{return false;}}}

/** The proposal owns its catalogue, including the ordinary text-only path. */
export async function runBlockProposalIsolation(){
 const actors:Actor[]=[],checks:string[]=[];let failure:unknown=null,destroyed=0;
 const eq=(name:string,actual:unknown,expected:unknown)=>{assert.deepStrictEqual(actual,expected,name);checks.push(name);};
 const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks:[paragraph('P','ab')]} as unknown as LocalToolJson};
 const definition=defineLocalTool<Data>({namespace:'tests.blocks1883.proposal',name:{en:'Block proposal',es:'Propuesta de bloques'},description:{en:'Proposal isolation regression',es:'Regresión de propuesta aislada'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.opaque==='Élodie你🙂'&&!JSON.stringify(value.body).includes('!'),component:()=>null});
 try{
  const host=createFakeLocalToolHost(definition,{projects:[{id:'blocks-proposal',updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:'Proposal',generation:'g',revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:'blocks-proposal'},false,'doc');
  const started=await client.convergence!.start(await client.read()),G=structuredClone(started.checkpoint);
  const make=(checkpoint:LocalToolConvergenceCheckpoint,authorId:string)=>{const p=createLocalToolReplica(checkpoint,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};
  const a=make(G,'proposal-A'),splice=a.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:a.richRange('body','P',2,2),text:'X'}]);
  eq('text-only-apply-changed',splice.changed,true);eq('text-only-apply-causal',splice.causalChanged,true);eq('text-only-apply-receipt',typeof splice.receiptId,'string');eq('text-only-apply-data',((splice.data.body as unknown as RichBlockDocument).blocks[0].content),[{type:'text',text:'abX'}]);eq('text-only-pending',splice.pending,false);
  const cold=make(G,'proposal-cold');eq('saved-genesis-read-intact',cold.read(),data);eq('saved-genesis-bytes-intact',G,started.checkpoint);
  const before={checkpoint:a.checkpoint(),read:a.read(),bindings:a.richRange('body','P',0,3)};
  assert.throws(()=>a.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:a.richRange('body','P',3,3),text:'!'}]),/local_tool_convergence_authored_state_invalid/);checks.push('policy-rejects-planned-text');
  eq('rejected-checkpoint-intact',a.checkpoint(),before.checkpoint);eq('rejected-read-intact',a.read(),before.read);eq('rejected-bindings-intact',a.richRange('body','P',0,3),before.bindings);
  const retry=a.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:a.richRange('body','P',3,3),text:'Y'}]);eq('accepted-retry-changed',retry.changed,true);eq('accepted-retry-no-future-text',(retry.data.body as unknown as RichBlockDocument).blocks[0].content,[{type:'text',text:'abXY'}]);eq('accepted-retry-keeps-units',a.richRange('body','P',0,3).deleteIds,before.bindings.deleteIds);
  const marked=a.apply([{type:'rich-mark',field:'body',nodeId:'P',range:a.richRange('body','P',0,1),mark:'bold',enabled:true}]);eq('mark-only-changed',marked.changed,true);eq('mark-only-receipt',typeof marked.receiptId,'string');eq('mark-only-data',(marked.data.body as unknown as RichBlockDocument).blocks[0].content,[{type:'text',text:'a',marks:[{type:'bold'}]},{type:'text',text:'bXY'}]);
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const p of actors){p.destroy();destroyed++;}}
 return{ok:failure===null,checks,failure,cleanup:{created:actors.length,destroyed}};
}

export async function runBlockTextCausals(){
 const actors:Actor[]=[],checks:string[]=[];let failure:unknown=null,destroyed=0;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 const body=(p:Actor)=>p.read().body as unknown as RichBlockDocument;
 const units=(p:Actor,id:string)=>p.richRange('body',id,0,body(p).blocks.find(b=>b.id===id)!.content!.reduce((n,t)=>n+t.text.length,0)).deleteIds;
 const edit=(name:string,result:LocalToolReplicaEdit<Data>)=>{eq(name+':receipt',typeof result.receiptId,'string');eq(name+':pending',result.pending,false);eq(name+':conflict',result.conflict,null);return result;};
 async function setup(label:string,blocks:RichBlock[]){
  const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks} as unknown as LocalToolJson};
  const definition=defineLocalTool<Data>({namespace:'tests.blocks1883.text.'+label,name:{en:'Tree text',es:'Texto de árbol'},description:{en:'Tree text causal',es:'Causal de texto de árbol'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂',component:()=>null});
  const host=createFakeLocalToolHost(definition,{projects:[{id:label,updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:label,generation:label,revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:label},false,'doc'),G=(await client.convergence!.start(await client.read())).checkpoint;
  const make=(authorId:string,checkpoint=G)=>{const p=createLocalToolReplica(checkpoint,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};return{a:make('A'),b:make('B'),make};
 }
 try{
  const {a,b,make}=await setup('moved',[paragraph('A','ab',null,'Z'),paragraph('M','mn',null,'A'),paragraph('Z','zz')]);
  const aUnits=units(a,'A'),mUnits=units(a,'M');edit('move',a.apply([{type:'rich-block-move',field:'body',capture:a.richBlockMoveCapture('body','M',{parentId:null,slot:'body',afterId:'Z'})}]));eq('moved-tree-adjacency',body(a).blocks.find(n=>n.id==='A')!.afterId,'M');
  const join=a.richBlockJoinCapture('body','M','A');assert.throws(()=>a.richBlockJoinCapture('body','Z','A'));checks.push('nonadjacent-tree-pair-rejected');
  const remote=edit('remote-A',b.apply([{type:'rich-text-splice',field:'body',nodeId:'A',range:b.richRange('body','A',1,1),text:'你🙂',marks:['italic']} ]));a.receive(remote.update);const joined=edit('join-after-move',a.apply([{type:'rich-block-join',field:'body',capture:join}]));
  eq('join-tree-order-not-ID-order',body(a).blocks.find(n=>n.id==='M')!.content,[{type:'text',text:'mna'},{type:'text',text:'你🙂',marks:[{type:'italic'}]},{type:'text',text:'b'}]);eq('join-prefix-units',units(a,'M').slice(0,2),mUnits);eq('join-keeps-A-units',units(a,'M').filter(id=>aUnits.includes(id)),aUnits);edit('undo-join',a.undo(joined.receiptId!));eq('undo-join-B-text',body(a).blocks.find(n=>n.id==='A')!.content!.map(t=>t.text).join(''),'a你🙂b');
  const split=a.richBlockSplitCapture('body','M',1),x=edit('remote-M',b.apply([{type:'rich-text-splice',field:'body',nodeId:'M',range:b.richRange('body','M',1,1),text:'X'}]));a.receive(x.update);const divided=edit('split',a.apply([{type:'rich-block-split',field:'body',capture:split,newNodeId:'N'}]));eq('split-prefix',body(a).blocks.find(n=>n.id==='M')!.content,[{type:'text',text:'m'}]);eq('split-concurrent-descendant',body(a).blocks.find(n=>n.id==='N')!.content,[{type:'text',text:'Xn'}]);edit('undo-split',a.undo(divided.receiptId!));eq('undo-split-preserves-B',body(a).blocks.find(n=>n.id==='M')!.content,[{type:'text',text:'mXn'}]);eq('cold-tree-text',make('cold',a.checkpoint()).read(),a.read());
  const list=await setup('items',[{id:'I1',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:null},{id:'I2',type:'list-item',attrs:{},parentId:'L',slot:'body',afterId:'I1'},{id:'L',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},paragraph('X','ab','I1'),paragraph('Y','cd','I2')]);
  const capture=list.a.richBlockJoinCapture('body','X','Y'),mark=edit('remote-list-mark',list.b.apply([{type:'rich-mark',field:'body',nodeId:'Y',range:list.b.richRange('body','Y',0,1),mark:'bold',enabled:true}]));list.a.receive(mark.update);const merge=edit('join-list-items',list.a.apply([{type:'rich-block-join',field:'body',capture}]));eq('list-item-hidden-not-text-copy',body(list.a).blocks.map(n=>n.id),['I1','L','X']);eq('list-join-keeps-remote-mark',body(list.a).blocks.find(n=>n.id==='X')!.content,[{type:'text',text:'ab'},{type:'text',text:'c',marks:[{type:'bold'}]},{type:'text',text:'d'}]);edit('undo-list-join',list.a.undo(merge.receiptId!));eq('undo-list-keeps-mark',body(list.a).blocks.find(n=>n.id==='Y')!.content,[{type:'text',text:'c',marks:[{type:'bold'}]},{type:'text',text:'d'}]);
  const empty=await setup('empty',[quote('W',null)]);eq('empty-wrapper-no-fake-leaves',body(empty.a).blocks.length,1);assert.throws(()=>empty.a.richRange('body','W',0,0));checks.push('wrapper-is-not-text-buffer');edit('insert-empty-wrapper',empty.a.apply([{type:'rich-block-insert',field:'body',capture:empty.a.richBlockEditCapture('body',[],{parentId:'W',slot:'body',afterId:null}),block:{id:'P',type:'paragraph',attrs:{}},text:'real'}]));eq('empty-wrapper-real-child',body(empty.a).blocks.find(n=>n.id==='P')!.parentId,'W');
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const p of actors){p.destroy();destroyed++;}}
 return{ok:failure===null,checks,failure,cleanup:{created:actors.length,destroyed}};
}

export async function runBlockJoinBoundaries(){
 const actors:Actor[]=[],checks:string[]=[],groups:string[]=[];let failure:unknown=null,destroyed=0;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 const body=(p:Actor)=>p.read().body as unknown as RichBlockDocument;
 const leafIds=(p:Actor,id:string)=>p.richRange('body',id,0,body(p).blocks.find(b=>b.id===id)!.content!.reduce((n,t)=>n+t.text.length,0)).deleteIds;
 const item=(id:string,afterId:string|null):RichBlock=>({id,type:'list-item',attrs:{},parentId:'L',slot:'body',afterId});
 async function setup(label:string,blocks:RichBlock[]){
  const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks:[...blocks].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)} as unknown as LocalToolJson};
  const definition=defineLocalTool<Data>({namespace:'tests.blocks1883.boundary.'+label,name:{en:'Join boundaries',es:'Fronteras de unión'},description:{en:'Public join boundary regression',es:'Regresión pública de fronteras'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂',component:()=>null});
  const host=createFakeLocalToolHost(definition,{projects:[{id:label,updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:label,generation:label,revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:label},false,'doc'),G=(await client.convergence!.start(await client.read())).checkpoint;
  const make=(authorId:string,checkpoint=G)=>{const p=createLocalToolReplica(checkpoint,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};return{a:make('A'),b:make('B'),make};
 }
 const healthy=(name:string,result:LocalToolReplicaEdit<Data>)=>{eq(name+':receipt',typeof result.receiptId,'string');eq(name+':pending',result.pending,false);eq(name+':conflict',result.conflict,null);return result;};
 try{
  const f=await setup('three',[{id:'L',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},item('z-item',null),item('y-item','z-item'),item('a-item','y-item'),paragraph('P','ab','z-item'),paragraph('Q','cd','y-item'),paragraph('R','ef','a-item')]);
  const capture=f.a.richBlockJoinCapture('body','P','Q'),pIds=leafIds(f.a,'P'),qIds=leafIds(f.a,'Q');
  const remote=healthy('remote-child-and-marks',f.b.apply([{type:'rich-block-insert',field:'body',capture:f.b.richBlockEditCapture('body',[],{parentId:'y-item',slot:'body',afterId:'Q'}),block:{id:'T',type:'paragraph',attrs:{}},text:'new',marks:['italic']},{type:'rich-mark',field:'body',nodeId:'R',range:f.b.richRange('body','R',0,1),mark:'bold',enabled:true}]));f.a.receive(remote.update);const before=f.a.read(),tIds=leafIds(f.b,'T');
  const joined=healthy('join-three',f.a.apply([{type:'rich-block-join',field:'body',capture}]));
  eq('third-item-reanchored',body(f.a).blocks.find(n=>n.id==='a-item')!.afterId,'z-item');eq('captured-right-item-retired',body(f.a).blocks.some(n=>n.id==='y-item'),false);eq('new-child-stays-effective',body(f.a).blocks.find(n=>n.id==='T')!.parentId,'z-item');eq('new-child-IDs-exact',leafIds(f.a,'T'),tIds);eq('joined-leaf-IDs',[...pIds,...qIds],leafIds(f.a,'P'));eq('third-remote-mark-kept',body(f.a).blocks.find(n=>n.id==='R')!.content,[{type:'text',text:'e',marks:[{type:'bold'}]},{type:'text',text:'f'}]);const after=f.a.read();eq('third-cold-read',f.make('cold',f.a.checkpoint()).read(),after);
  const undone=healthy('undo-three',f.a.undo(joined.receiptId!));eq('undo-exact-remote-view',f.a.read(),before);const redone=healthy('redo-three',f.a.redo(undone.receiptId!));eq('redo-exact-order-and-remote',f.a.read(),after);
  f.b.receive(joined.update);f.b.receive(undone.update);f.b.receive(redone.update);const undoB=healthy('undo-B',f.b.undo(remote.receiptId!));f.a.receive(undoB.update);eq('B-undo-retires-only-own-new-child',body(f.a).blocks.some(n=>n.id==='T'),false);eq('B-undo-keeps-A-join',body(f.a).blocks.find(n=>n.id==='P')!.content,[{type:'text',text:'abcd'}]);eq('B-undo-keeps-following-order',body(f.a).blocks.find(n=>n.id==='a-item')!.afterId,'z-item');groups.push('three-items-remote-child-undo');
  for(const moved of ['Q','P'] as const){
   const g=await setup('quote-'+moved.toLowerCase(),[paragraph('P','ab'),paragraph('Q','cd',null,'P'),{...quote('U','Q')},paragraph('T','untouched','U')]),old=g.a.richBlockJoinCapture('body','P','Q'),tBefore=leafIds(g.a,'T');
   const move=healthy('move-'+moved,g.b.apply([{type:'rich-block-move',field:'body',capture:g.b.richBlockMoveCapture('body',moved,{parentId:'U',slot:'body',afterId:'T'})}]));g.a.receive(move.update);const remoteView=g.a.read(),uBefore=body(g.a).blocks.find(n=>n.id==='U')!,t=body(g.a).blocks.find(n=>n.id==='T')!;
   const merge=healthy('stale-root-join-'+moved,g.a.apply([{type:'rich-block-join',field:'body',capture:old}]));eq('foreign-quote-retained-'+moved,body(g.a).blocks.find(n=>n.id==='U')!.parentId,uBefore.parentId);eq('foreign-quote-kind-'+moved,body(g.a).blocks.find(n=>n.id==='U')!.type,uBefore.type);eq('foreign-T-exact-'+moved,body(g.a).blocks.find(n=>n.id==='T'),t);eq('foreign-T-unit-identities-'+moved,leafIds(g.a,'T'),tBefore);eq('stale-pair-only-'+moved,body(g.a).blocks.find(n=>n.id==='P')!.content,[{type:'text',text:'abcd'}]);healthy('undo-stale-'+moved,g.a.undo(merge.receiptId!));eq('stale-Undo-exact-B-'+moved,g.a.read(),remoteView);groups.push('stale-root-'+moved);
  }
  // A newly-created item has the same kind as a captured item, but no authority.
  const g=await setup('foreign-item',[{id:'L',type:'bullet-list',attrs:{},parentId:null,slot:'body',afterId:null},item('I1',null),item('I2','I1'),paragraph('P','ab','I1'),paragraph('Q','cd','I2'),paragraph('R','other',null,'L')]),old=g.a.richBlockJoinCapture('body','P','Q');
  const wrap=healthy('foreign-wrap',g.b.apply([{type:'rich-block-wrap',field:'body',capture:g.b.richBlockCapture('body',{nodeIds:['R']}),wrapper:{id:'N',type:'bullet-list',attrs:{}},items:[{id:'J',leafId:'R'}]}])),move=healthy('move-to-new-item',g.b.apply([{type:'rich-block-move',field:'body',capture:g.b.richBlockMoveCapture('body','Q',{parentId:'J',slot:'body',afterId:'R'})}]));g.a.receive(wrap.update);g.a.receive(move.update);const foreignView=g.a.read(),r=body(g.a).blocks.find(n=>n.id==='R')!,newItem=body(g.a).blocks.find(n=>n.id==='J')!;
  const merge=healthy('join-does-not-own-new-item',g.a.apply([{type:'rich-block-join',field:'body',capture:old}]));eq('new-item-retained-exact',body(g.a).blocks.find(n=>n.id==='J'),newItem);eq('foreign-R-retained-exact',body(g.a).blocks.find(n=>n.id==='R'),r);eq('old-right-item-not-retired-elsewhere',body(g.a).blocks.some(n=>n.id==='I2'),true);healthy('undo-foreign-item',g.a.undo(merge.receiptId!));eq('foreign-item-Undo-exact-B',g.a.read(),foreignView);groups.push('foreign-item-identity-not-kind');
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const p of actors){p.destroy();destroyed++;}}
 return{ok:failure===null,groups,checks,failure,cleanup:{created:actors.length,destroyed}};
}

/** Indenting a captured leaf owns its captured item, never a replacement parent. */
export async function runBlockIndentBoundaries(){
 const actors:Actor[]=[],checks:string[]=[],groups:string[]=[];let failure:unknown=null,destroyed=0;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);};
 const body=(p:Actor)=>p.read().body as unknown as RichBlockDocument;
 const node=(p:Actor,id:string)=>body(p).blocks.find(n=>n.id===id)!;
 const ids=(p:Actor,id:string)=>p.richRange('body',id,0,node(p,id).content!.reduce((n,t)=>n+t.text.length,0)).deleteIds;
 const item=(id:string,afterId:string|null,parentId='L'):RichBlock=>({id,type:'list-item',attrs:{},parentId,slot:'body',afterId});
 const list=(id='L',parentId:string|null=null,afterId:string|null=null):RichBlock=>({id,type:'bullet-list',attrs:{},parentId,slot:'body',afterId});
 const initial=()=>[list(),item('I1',null),item('I2','I1'),paragraph('P','ab','I1'),paragraph('Q','cd','I2')];
 async function setup(label:string,blocks=initial()){
  const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks:[...blocks].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)} as unknown as LocalToolJson};
  const definition=defineLocalTool<Data>({namespace:'tests.blocks1883.indent.'+label,name:{en:'Indent boundaries',es:'Fronteras de sangría'},description:{en:'Public indent authority regression',es:'Regresión pública de autoridad de sangría'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂',component:()=>null});
  const host=createFakeLocalToolHost(definition,{projects:[{id:label,updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:label,generation:label,revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:label},false,'doc'),G=(await client.convergence!.start(await client.read())).checkpoint;
  const make=(authorId:string,checkpoint=G)=>{const p=createLocalToolReplica(checkpoint,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(p);return p;};return{a:make('A'),b:make('B'),make};
 }
 const healthy=(name:string,result:LocalToolReplicaEdit<Data>)=>{eq(name+':receipt',typeof result.receiptId,'string');eq(name+':pending',result.pending,false);eq(name+':conflict',result.conflict,null);return result;};
 const reject=(name:string,p:Actor,action:Parameters<Actor['apply']>[0][number])=>{const before={checkpoint:p.checkpoint(),read:p.read(),inspect:p.inspect()};assert.throws(()=>p.apply([action]),/local_tool_block_edit_invalid/);checks.push(name+':rejected');eq(name+':atomic-checkpoint',p.checkpoint(),before.checkpoint);eq(name+':atomic-read',p.read(),before.read);eq(name+':atomic-inspect',p.inspect(),before.inspect);};
 try{
  // The independently found scenario: B creates J/R/T, then moves Q into J.
  const f=await setup('new-parent'),capture=f.a.richBlockEditCapture('body',['Q']);
  const split=healthy('B-split',f.b.apply([{type:'rich-block-split',field:'body',capture:f.b.richBlockSplitCapture('body','Q',1),newNodeId:'R',newItemId:'J'}]));f.a.receive(split.update);
  const insert=healthy('B-insert',f.b.apply([{type:'rich-block-insert',field:'body',capture:f.b.richBlockEditCapture('body',[],{parentId:'J',slot:'body',afterId:'R'}),block:{id:'T',type:'paragraph',attrs:{}},text:'你🙂',marks:['italic']}]));f.a.receive(insert.update);
  const moved=healthy('B-move-Q',f.b.apply([{type:'rich-block-move',field:'body',capture:f.b.richBlockMoveCapture('body','Q',{parentId:'J',slot:'body',afterId:'T'})}]));f.a.receive(moved.update);
  const remote=f.a.read(),q=ids(f.a,'Q'),r=ids(f.a,'R'),t=ids(f.a,'T');reject('old-leaf-cannot-own-J',f.a,{type:'rich-block-list-indent',field:'body',capture,direction:'in',listId:'N'});
  for(const id of ['J','R','T'])eq('remote-exact-'+id,node(f.a,id),(remote.body as unknown as RichBlockDocument).blocks.find(n=>n.id===id));
  const fresh=healthy('fresh-indent-J',f.a.apply([{type:'rich-block-list-indent',field:'body',capture:f.a.richBlockEditCapture('body',['Q']),direction:'in',listId:'N'}]));eq('fresh-owns-exact-J',node(f.a,'J').parentId,'N');eq('fresh-keeps-Q-IDs',ids(f.a,'Q'),q);eq('fresh-keeps-R-IDs',ids(f.a,'R'),r);eq('fresh-keeps-T-IDs',ids(f.a,'T'),t);healthy('undo-fresh',f.a.undo(fresh.receiptId!));eq('fresh-Undo-exact-B',f.a.read(),remote);groups.push('substituted-parent-reject-and-fresh-intent');

  // Even the same item cannot confer authority over a different current list.
  const g=await setup('changed-list',[...initial(),paragraph('S','other',null,'L')]),old=g.a.richBlockEditCapture('body',['Q']);
  const wrapped=healthy('B-new-list',g.b.apply([{type:'rich-block-wrap',field:'body',capture:g.b.richBlockCapture('body',{nodeIds:['S']}),wrapper:{id:'M',type:'bullet-list',attrs:{}},items:[{id:'K',leafId:'S'}]}]));g.a.receive(wrapped.update);
  const changed=healthy('B-item-other-list',g.b.apply([{type:'rich-block-move',field:'body',capture:g.b.richBlockMoveCapture('body','I2',{parentId:'M',slot:'body',afterId:'K'})}]));g.a.receive(changed.update);
  reject('old-item-cannot-own-new-list',g.a,{type:'rich-block-list-indent',field:'body',capture:old,direction:'in',listId:'N'});groups.push('captured-item-list-identity');

  // A concurrent predecessor is not the destination observed by A.
  const h=await setup('old-predecessor'),prior=h.a.richBlockEditCapture('body',['Q']);
  const preceding=healthy('B-new-predecessor',h.b.apply([{type:'rich-block-split',field:'body',capture:h.b.richBlockSplitCapture('body','P',1),newNodeId:'R',newItemId:'J'}]));h.a.receive(preceding.update);const before=h.a.read(),j=node(h.a,'J'),ri=ids(h.a,'R');
  const indented=healthy('indent-under-captured-predecessor',h.a.apply([{type:'rich-block-list-indent',field:'body',capture:prior,direction:'in',listId:'N'}]));eq('destination-is-old-I1',node(h.a,'N').parentId,'I1');eq('new-J-unmoved',node(h.a,'J').parentId,j.parentId);eq('new-R-exact',node(h.a,'R'),(before.body as unknown as RichBlockDocument).blocks.find(n=>n.id==='R'));eq('new-R-IDs',ids(h.a,'R'),ri);healthy('undo-captured-predecessor',h.a.undo(indented.receiptId!));eq('predecessor-Undo-exact-B',h.a.read(),before);groups.push('captured-predecessor');

  // Outdent must not borrow the current owner of an observed inner list.
  const o=await setup('changed-owner',[list(),item('O1',null),item('O2','O1'),paragraph('P','ab','O1'),paragraph('S','other','O2'),list('N','O1','P'),item('I2',null,'N'),paragraph('Q','cd','I2')]),out=o.a.richBlockEditCapture('body',['Q']);
  const owner=healthy('B-list-new-owner',o.b.apply([{type:'rich-block-move',field:'body',capture:o.b.richBlockMoveCapture('body','N',{parentId:'O2',slot:'body',afterId:'S'})}]));o.a.receive(owner.update);reject('old-outdent-cannot-own-new-owner',o.a,{type:'rich-block-list-indent',field:'body',capture:out,direction:'out'});groups.push('captured-outdent-ancestors');

  // A bullet item must not enter an already-observed ordered sublist.
  const m=await setup('mixed-kinds',[...initial(),{...list('O','I1','P'),type:'ordered-list',attrs:{start:5}},item('K',null,'O'),paragraph('R','ordered','K')]),mixedBefore=m.a.read(),mixedCapture=m.a.richBlockEditCapture('body',['Q']),mixedQ=ids(m.a,'Q'),mixedR=ids(m.a,'R');
  const mixed=healthy('mixed-bullet-indent',m.a.apply([{type:'rich-block-list-indent',field:'body',capture:mixedCapture,direction:'in',listId:'N'}]));eq('mixed-new-list-kind',node(m.a,'N').type,'bullet-list');eq('mixed-new-list-owner',node(m.a,'N').parentId,'I1');eq('mixed-item-enters-N-not-O',node(m.a,'I2').parentId,'N');
  for(const id of ['O','K','R'])eq('mixed-ordered-subtree-exact-'+id,node(m.a,id),(mixedBefore.body as unknown as RichBlockDocument).blocks.find(n=>n.id===id));eq('mixed-ordered-text-IDs',ids(m.a,'R'),mixedR);eq('mixed-bullet-text-IDs',ids(m.a,'Q'),mixedQ);const mixedNested=m.a.read();
  const mixedOut=healthy('mixed-fresh-outdent-without-listId',m.a.apply([{type:'rich-block-list-indent',field:'body',capture:m.a.richBlockEditCapture('body',['Q']),direction:'out'}]));eq('mixed-outdent-exact',m.a.read(),mixedBefore);healthy('mixed-undo-outdent',m.a.undo(mixedOut.receiptId!));eq('mixed-undo-outdent-exact',m.a.read(),mixedNested);healthy('mixed-undo-indent',m.a.undo(mixed.receiptId!));eq('mixed-undo-indent-exact',m.a.read(),mixedBefore);groups.push('mixed-list-kind-preserved');

  // Current remote children inside the genuinely captured item remain valid.
  const v=await setup('same-item'),observed=v.a.richBlockEditCapture('body',['Q']);
  const contribution=healthy('B-within-captured-item',v.b.apply([{type:'rich-text-splice',field:'body',nodeId:'Q',range:v.b.richRange('body','Q',1,1),text:'你🙂',marks:['bold']},{type:'rich-block-insert',field:'body',capture:v.b.richBlockEditCapture('body',[],{parentId:'I2',slot:'body',afterId:'Q'}),block:{id:'T',type:'paragraph',attrs:{}},text:'remote'}]));v.a.receive(contribution.update);const bView=v.a.read(),qUnits=ids(v.a,'Q'),tUnits=ids(v.a,'T');
  const indent=healthy('same-item-indent',v.a.apply([{type:'rich-block-list-indent',field:'body',capture:observed,direction:'in',listId:'N'}]));eq('same-item-keeps-text',node(v.a,'Q').content,node(v.b,'Q').content);eq('same-item-keeps-Q-IDs',ids(v.a,'Q'),qUnits);eq('same-item-keeps-T-IDs',ids(v.a,'T'),tUnits);eq('same-item-keeps-T-parent',node(v.a,'T').parentId,'I2');
  const nested=v.a.read(),outdent=healthy('normal-outdent',v.a.apply([{type:'rich-block-list-indent',field:'body',capture:v.a.richBlockEditCapture('body',['Q']),direction:'out'}]));eq('outdent-exact-B',v.a.read(),bView);healthy('undo-outdent',v.a.undo(outdent.receiptId!));eq('undo-outdent-exact-nested',v.a.read(),nested);healthy('undo-indent',v.a.undo(indent.receiptId!));eq('undo-indent-exact-B',v.a.read(),bView);eq('cold-after-indent-Undo',v.make('cold',v.a.checkpoint()).read(),bView);groups.push('captured-item-remote-contributions-and-Undo');
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const p of actors){p.destroy();destroyed++;}}
 return{ok:failure===null,groups,checks,failure,cleanup:{created:actors.length,destroyed}};
}
