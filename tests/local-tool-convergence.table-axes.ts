import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint,forkLocalToolGenesis} from '@/engines/local/convergence/replica';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import {convergenceBytes} from '@/engines/local/convergence/format';
import * as Y from 'yjs';
import {getSchema} from '@tiptap/core';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {RichEditorSession} from '@/engines/local/collaborativeRich/session';
import {blockNodes,blockPMLeaves} from '@/engines/local/collaborativeRich/blockProsemirror';
import {commitRichComposition,createRichAdmissionJournal,sessionPMDocument} from '@/engines/local/collaborativeRich/prosemirror';
import {tableAxesRows} from '@/engines/local/collaborativeRich/tableAxesLayout';
import {remapSourceToolDocument} from '@/engines/local/documents/portability';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {LocalToolClient} from '@/engines/local/sdk';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/formatTypes';
import type {LocalToolJson} from '@/engines/local/stateTypes';

export function testTableAxesForkOrder(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-fork',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-fork',schemaEpoch:'axes-fork',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const G=createLocalToolGenesis({body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}},contract);
 const owners:ReturnType<typeof createLocalToolReplica>[]=[];
 const open=(authorId:string,checkpoint=G)=>{const owner=createLocalToolReplica(checkpoint,{authorId,contract});owners.push(owner);return owner;};
 const A=open('A'),B=open('B');
 const insert=(owner:typeof A,id:string,afterId:string|null,row='R1',column='C1')=>owner.apply([{type:'rich-table-cell-insert',field:'body',capture:owner.richTableCellCapture('body','T',row,column,afterId),fragment:{id,paragraph:{id:'P'+id,text:id+'Ω🙂'}}}]);
 const body=(owner:typeof A)=>(owner.read() as unknown as {body:RichBlockDocument}).body;
 const grid=(owner:typeof A)=>tableAxesRows(body(owner),'T').map(({cells})=>cells.map(({children})=>children.map(node=>[node.id,node.content])));
 try{
  B.receive(A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R1',header:false},{id:'R2',header:true}],columns:[{id:'C1'},{id:'C2'}]}}]).update);
  const retired=insert(A,'FA',null);B.receive(retired.update);
  for(const [id,after,row,column] of [['Z','FA','R1','C1'],['B','Z','R1','C1'],['X',null,'R1','C1'],['D',null,'R1','C2'],['E',null,'R2','C1']] as const)A.receive(insert(B,id,after,row,column).update);
  B.receive(A.undo(retired.receiptId!).update);
  const checkpoint=A.checkpoint(),data=A.read(),visible=grid(A);
  equal('peers see the same source after Undo',B.read(),data);
  equal('non-lexical fragment order and neighboring sparse addresses',visible.map(row=>row.map(cell=>cell.map(([id])=>id))),[[['PX','PZ','PB'],['PD']],[['PE'],[]]]);
  equal('source survivor retains historical FA',body(A).blocks.find(block=>block.id==='Z')?.afterId,'FA');
  equal('source exports complete',exportLocalToolConvergenceCheckpoint(checkpoint).pending,false);
  const copy=remapSourceToolDocument({id:'origin',generation:'origin-gen',namespace:contract.namespace,title:'Source',revision:1,createdAt:1,updatedAt:1,data,codec:contract.codec,convergence:{checkpoint}},(id,prefix)=>prefix+'-'+id);
  const fork=copy.convergence!.checkpoint,C=open('C',fork);
  equal('fork has a new identity',fork.genesisId!==checkpoint.genesisId,true);
  equal('fork grid preserves text and its exact order in each cell',grid(C),visible);
  equal('fork keeps all visible IDs and axes', [body(C).blocks.map(node=>node.id),body(C).axisOrder],[body(A).blocks.map(node=>node.id),body(A).axisOrder]);
  equal('fork persisted projection matches its checkpoint',copy.data,C.read());
  equal('fork is admitted',C.inspect().conflict,null);
  equal('source remains byte exact',A.checkpoint(),checkpoint);
  equal('fork exports complete',exportLocalToolConvergenceCheckpoint(fork).pending,false);
  return{ok:true,checks,closed:owners.length};
 }finally{for(const owner of owners)owner.destroy();}
}

/** The incumbent must be healthy before a missing axes capability is diagnosed. */
export function testTableAxesCapability(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name);checks.push(name);};
 const validateState=(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body;
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-health',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'}}},validationId:'axes-health',schemaEpoch:'axes-health',validateState};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/2',blocks:[{id:'O',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'7'}]}]}};
 let closed=0;
 const checkpoint=createLocalToolGenesis(data,contract),sdk=createLocalToolReplica(checkpoint,{authorId:'health',contract});
 try{
  equal('health incumbent selects engine5',checkpoint.engine.version,'5');equal('health incumbent reads7',sdk.read(),data);
  const edit=sdk.apply([{type:'rich-text-splice',field:'body',nodeId:'O',range:sdk.richRange('body','O',0,1),text:'9'}]);
  equal('health incumbent edits9',(sdk.read() as {body:{blocks:{content:{text:string}[]}[]}}).body.blocks[0].content[0].text,'9');
  sdk.undo(edit.receiptId!);equal('health incumbent Undo exact',sdk.read(),data);equal('health incumbent definition-free export',exportLocalToolConvergenceCheckpoint(sdk.checkpoint()).pending,false);
 }finally{sdk.destroy();closed++;}
 try{
  const axes:LocalToolConvergenceContract={...contract,codec:JSON.parse('{"version":2,"fields":{"body":{"kind":"rich","profile":"blocks-tree/4","schema":"writers-blocks/3"}}}')};
  const origin:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}};
  const G=createLocalToolGenesis(origin,axes),A=createLocalToolReplica(G,{authorId:'axes',contract:axes});
  try{equal('axes explicit profile selects engine6',G.engine.version,'6');equal('axes empty read preserves its exact DTO',A.read(),origin);equal('axes empty definition-free export',exportLocalToolConvergenceCheckpoint(A.checkpoint()).pending,false);}finally{A.destroy();closed++;}
 }catch(error){throw Error(JSON.stringify({checks,closed,stage:'axes-profile',cause:String(error)}));}
 return{ok:true,checks,closed};
}

/** Observable sparse-grid actions and independent physical ordering. */
export function testTableAxesActions(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-actions',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-actions',schemaEpoch:'axes-actions',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[{id:'O',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'outsideΩ'}]}],axisOrder:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract}),B=createLocalToolReplica(G,{authorId:'B',contract});
 const body=(sdk:typeof A)=>(sdk.read() as {body:import('@/engines/local/convergence/blockFormat').RichBlockDocument}).body;
 const order=(sdk:typeof A)=>body(sdk).axisOrder!.find(o=>o.tableId==='T')!;
 const rejected=(name:string,work:()=>unknown,sdk=A)=>{const before=sdk.checkpoint();let error='';try{work();}catch(e){error=String(e);}equal(name+' rejects',!!error,true);equal(name+' checkpoint unchanged',sdk.checkpoint(),before);};
 try{
  const inserted=A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'O'}),table:{id:'T',rows:[{id:'R1',header:true},{id:'R2',header:false}],columns:[{id:'C1'},{id:'C2'}]}}]);B.receive(inserted.update);
  equal('new grid is 2x2 and no authored cell/leaf scaffold',order(A),{tableId:'T',rows:['R1','R2'],columns:['C1','C2']});equal('new grid has only outside text leaf',body(A).blocks.filter(b=>Object.hasOwn(b,'content')).map(b=>b.id),['O']);equal('new table receipt exists',typeof inserted.receiptId,'string');
  const beforeCapture=A.checkpoint();A.richTableCellCapture('body','T','R1','C1');equal('logical empty capture does not write',A.checkpoint(),beforeCapture);
  const ra=A.apply([{type:'rich-table-axis-insert',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1'),id:'RA'}]),cb=B.apply([{type:'rich-table-axis-insert',field:'body',capture:B.richTableAxisCapture('body','T','columns','C1'),id:'CB'}]);A.receive(cb.update);B.receive(ra.update);
  equal('row-column cross is 3x3',order(A),{tableId:'T',rows:['R1','RA','R2'],columns:['C1','CB','C2']});equal('row-column receive agrees',B.read(),A.read());
  const captureA=A.richTableCellCapture('body','T','RA','CB'),captureB=B.richTableCellCapture('body','T','RA','CB');
  const first=A.apply([{type:'rich-table-cell-insert',field:'body',capture:captureA,fragment:{id:'FA',paragraph:{id:'PA',text:'AΩ'}}}]),second=B.apply([{type:'rich-table-cell-insert',field:'body',capture:captureB,fragment:{id:'FB',paragraph:{id:'PB',text:'B🙂'}}}]);A.receive(second.update);B.receive(first.update);
  equal('two first real leaves preserved',body(A).blocks.filter(b=>b.id==='PA'||b.id==='PB').map(b=>[b.id,b.content?.map(t=>t.text).join('')]),[['PA','AΩ'],['PB','B🙂']]);equal('two first receive agrees',B.read(),A.read());
  const wrong={...A.richTableCellCapture('body','T','RA','C1'),afterId:'FA'};rejected('other cell fragment anchor',()=>A.apply([{type:'rich-table-cell-insert',field:'body',capture:wrong,fragment:{id:'FX',paragraph:{id:'PX',text:'bad'}}}]));
  const oldCell=A.richTableCellCapture('body','T','RA','CB'),hide=A.apply([{type:'rich-table-axis-hide',field:'body',capture:A.richTableAxisCapture('body','T','columns','CB')}]);B.receive(hide.update);
  equal('hidden column has no represented content',body(A).blocks.some(b=>b.id==='PA'||b.id==='PB'),false);equal('hide is admitted RAW without snapshot fallback',A.inspect().conflict,null);rejected('old hidden cell capture',()=>A.apply([{type:'rich-table-cell-insert',field:'body',capture:oldCell,fragment:{id:'FC',paragraph:{id:'PC',text:'bad'}}}]));
  A.undo(hide.receiptId!);equal('Undo column recovers both texts',body(A).blocks.filter(b=>b.id==='PA'||b.id==='PB').map(b=>b.content?.map(t=>t.text).join('')),['AΩ','B🙂']);
  const C=createLocalToolReplica(A.checkpoint(),{authorId:'C',contract});try{
   for(const id of [...order(C).rows])C.apply([{type:'rich-table-axis-hide',field:'body',capture:C.richTableAxisCapture('body','T','rows',id)}]);
   equal('zero rows keeps T active honest DTO',order(C).rows,[]);equal('zero rows has no fallback',C.inspect().conflict,null);rejected('zero dimension cell capture',()=>C.richTableCellCapture('body','T','RA','CB'),C);
   C.apply([{type:'rich-table-axis-insert',field:'body',capture:C.richTableAxisCapture('body','T','rows','RA'),id:'RC'}]);equal('fresh axis capture can use retired physical anchor',order(C).rows,['RC']);equal('fresh row does not revive hidden row text',body(C).blocks.some(b=>b.id==='PA'),false);
  }finally{C.destroy();}
  equal('normal definition-free export complete',exportLocalToolConvergenceCheckpoint(A.checkpoint()).pending,false);return{ok:true,checks,closed:3};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error));}finally{A.destroy();B.destroy();}
}

export function testTableAxesDependencyUndo(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-support',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-support',schemaEpoch:'axes-support',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}};let closed=0;
 for(const order of ['VU','UV']as const){
  const G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'U',contract}),V=createLocalToolReplica(G,{authorId:'V',contract}),B=createLocalToolReplica(G,{authorId:'B',contract});
  try{
   const u=A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R1',header:true}],columns:[{id:'C1'}]}}]);V.receive(u.update);B.receive(u.update);
   const v=V.apply([{type:'rich-table-axis-insert',field:'body',capture:V.richTableAxisCapture('body','T','rows','R1'),id:'R2'}]);A.receive(v.update);B.receive(v.update);
   const b=B.apply([{type:'rich-table-cell-insert',field:'body',capture:B.richTableCellCapture('body','T','R2','C1'),fragment:{id:'FB',paragraph:{id:'PB',text:'Bβ🙂'}}}]);A.receive(b.update);V.receive(b.update);
   equal(order+' health B present',(A.read() as {body:{blocks:{id:string}[]}}).body.blocks.some(b=>b.id==='PB'),true);
   for(const which of order){const sender=which==='U'?A:V,reply=sender.undo((which==='U'?u:v).receiptId!);for(const peer of [A,V,B])if(peer!==sender)peer.receive(reply.update);}
   const read=A.read() as {body:import('@/engines/local/convergence/blockFormat').RichBlockDocument};equal(order+' only required table and axes survive',read.body.blocks.map(b=>b.id),['C1','FB','PB','R2','T']);equal(order+' B text exact',read.body.blocks.find(b=>b.id==='PB')?.content,[{type:'text',text:'Bβ🙂'}]);equal(order+' honest RAW admitted',A.inspect().conflict,null);equal(order+' peers agree',B.read(),A.read());
   const off=B.undo(b.receiptId!);A.receive(off.update);V.receive(off.update);equal(order+' final witness Undo removes support',A.read(),data);
   const on=B.redo(off.receiptId!);A.receive(on.update);V.receive(on.update);equal(order+' Redo same required IDs',(A.read() as typeof read).body.blocks.map(b=>b.id),read.body.blocks.map(b=>b.id));
  }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error));}finally{for(const sdk of [A,V,B]){sdk.destroy();closed++;}}
 }
 return{ok:true,checks,closed};
}

export function testTableAxesBatchOrder(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-batch',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-batch',schemaEpoch:'axes-batch',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'batch',contract});
 const order=()=>(A.read() as {body:{axisOrder:{rows:string[];columns:string[]}[]}}).body.axisOrder[0];
 try{
  A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R1',header:false},{id:'R2',header:false}],columns:[{id:'C1'}]}}]);
  equal('health before batch',order().rows,['R1','R2']);
  const after=A.richTableAxisCapture('body','T','rows','R1'),first=A.apply([{type:'rich-table-axis-insert',field:'body',capture:after,id:'RA'},{type:'rich-table-axis-insert',field:'body',capture:after,id:'RB'}]);
  equal('two actions ordered from same physical anchor',order().rows,['R1','RB','RA','R2']);equal('batch one receipt',typeof first.receiptId,'string');equal('batch RAW admitted',A.inspect().conflict,null);
  A.undo(first.receiptId!);equal('batch Undo exact original rows',order().rows,['R1','R2']);
  A.apply([{type:'rich-table-axis-hide',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1')}]);
  const retained=A.richTableAxisCapture('body','T','rows','R1'),head=A.richTableAxisCapture('body','T','rows',null),before=A.checkpoint();let reason='';
  try{A.apply([{type:'rich-table-axis-insert',field:'body',capture:head,id:'RX'},{type:'rich-table-axis-insert',field:'body',capture:retained,id:'RY'},{type:'rich-table-axis-insert',field:'body',capture:retained,id:'RX'}]);}catch(error){reason=String(error);}
  equal('last duplicate rejects as action, not invalid intermediate bindings',reason,'Error: local_tool_table_axes_action_invalid');equal('late reject exact checkpoint',A.checkpoint(),before);
  const next=A.apply([{type:'rich-table-axis-insert',field:'body',capture:head,id:'RX'},{type:'rich-table-axis-insert',field:'body',capture:retained,id:'RY'}]);equal('retired anchor orders after staged head',order().rows,['RX','RY','R2']);equal('retired batch admitted',A.inspect().conflict,null);equal('retired batch complete',next.pending,false);
  return{ok:true,checks,closed:1};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error));}finally{A.destroy();}
}

export function testTableAxesWitnesses(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-witnesses',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-witnesses',schemaEpoch:'axes-witnesses',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[{id:'O',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'outside'}]}],axisOrder:[]}};let closed=0;
 for(const scenario of ['append','observed-move','unobserved-move']as const){
  const G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract}),B=createLocalToolReplica(G,{authorId:'B',contract});
  const body=(sdk=A)=>(sdk.read() as {body:import('@/engines/local/convergence/blockFormat').RichBlockDocument}).body;
  try{
   const u=A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'O'}),table:{id:'T',rows:[{id:'R1',header:false}],columns:[{id:'C1'}]}}]);B.receive(u.update);
   const v=A.apply([{type:'rich-table-axis-insert',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1'),id:'R2'}]);if(scenario!=='unobserved-move')B.receive(v.update);
   if(scenario==='append'){
    const w=A.apply([{type:'rich-table-cell-insert',field:'body',capture:A.richTableCellCapture('body','T','R2','C1'),fragment:{id:'F',paragraph:{id:'P',text:'AΩ'}}}]);B.receive(w.update);
    const carrier=new Y.Doc({gc:false});try{Y.applyUpdate(carrier,convergenceBytes(B.checkpoint().checkpointBase64));const count=()=>[...carrier.getMap('register-versions').values()].filter(raw=>JSON.parse(String(raw)).root==='rich3:'+JSON.stringify('body')+':routing').length,before=count();
     const b=B.apply([{type:'rich-text-splice',field:'body',nodeId:'P',range:B.richRange('body','P',2,2),text:'B🙂'}]);Y.applyUpdate(carrier,convergenceBytes(b.update.updateBase64));equal('append has no routingB',count(),before);A.receive(b.update);
     equal('append health A and B text',(body().blocks.find(b=>b.id==='P')?.content??[]).map(t=>t.text).join(''),'AΩB🙂');
     for(const receipt of [w.receiptId!,v.receiptId!,u.receiptId!]){const inverse=A.undo(receipt);B.receive(inverse.update);equal('append survives independent inverse '+receipt.slice(0,8),body().blocks.find(b=>b.id==='P')?.content,[{type:'text',text:'B🙂'}]);}
     equal('append keeps exactly required table axis IDs',body().blocks.map(b=>b.id),['C1','F','O','P','R2','T']);equal('append no fallback',A.inspect().conflict,null);
     A.receive(B.undo(b.receiptId!).update);equal('append final B Undo removes support',A.read(),data);
    }finally{carrier.destroy();}
   }else{
    const b=B.apply([{type:'rich-block-move',field:'body',capture:B.richBlockMoveCapture('body','T',{parentId:null,slot:'body',afterId:null})}]);A.receive(b.update);if(scenario==='unobserved-move')B.receive(v.update);
    equal(scenario+' health new table placement',body().blocks.find(b=>b.id==='T')?.afterId,null);
    const off=A.undo(v.receiptId!);B.receive(off.update);equal(scenario+' observed axes only',body().axisOrder![0].rows,scenario==='observed-move'?['R1','R2']:['R1']);equal(scenario+' no fallback',A.inspect().conflict,null);
    A.receive(B.undo(b.receiptId!).update);equal(scenario+' no old witness restores axis',body().axisOrder![0].rows,['R1']);
   }
  }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{A.destroy();B.destroy();closed+=2;}
 }
 return{ok:true,checks,closed,carrierDocsClosed:1};
}

export function testTableAxesConcurrentOrder(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-concurrent',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-concurrent',schemaEpoch:'axes-concurrent',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract}),B=createLocalToolReplica(G,{authorId:'B',contract}),C=createLocalToolReplica(G,{authorId:'C',contract});
 const order=(sdk=A)=>(sdk.read() as {body:{axisOrder:{rows:string[];columns:string[]}[]}}).body.axisOrder[0];
 try{
  const u=A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R1',header:false},{id:'R2',header:false}],columns:[{id:'C1'},{id:'C2'}]}}]);B.receive(u.update);
  const a=A.apply([{type:'rich-table-axis-insert',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1'),id:'RA'}]),b=B.apply([{type:'rich-table-axis-insert',field:'body',capture:B.richTableAxisCapture('body','T','rows','R1'),id:'RB'}]);
  equal('missing table dependency is pending',C.receive(b.update).pending,true);equal('pending never invents table',C.read(),data);C.receive(u.update);C.receive(a.update);A.receive(b.update);B.receive(a.update);
  const rows=order().rows;equal('both concurrent rows occupy captured gap',rows.length===4&&rows[0]==='R1'&&rows[3]==='R2'&&rows.slice(1,3).sort().join(',')==='RA,RB',true);equal('all physical orders agree',[order(B).rows,order(C).rows],[rows,rows]);equal('duplicate update is not novel',A.receive(b.update).causalChanged,false);
  B.receive(A.undo(a.receiptId!).update);equal('Undo A preserves B row',order(B).rows,['R1','RB','R2']);A.receive(B.undo(b.receiptId!).update);equal('Undo B restores original axes',order().rows,['R1','R2']);
  const full=A.export();B.receive(full);const h1=A.apply([{type:'rich-table-axis-hide',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1')}]),h2=B.apply([{type:'rich-table-axis-hide',field:'body',capture:B.richTableAxisCapture('body','T','rows','R2')}]);A.receive(h2.update);B.receive(h1.update);equal('concurrent final row hides leave honest T',[order().rows,order(B).rows],[[],[]]);equal('no snapshot fallback on final hides',A.inspect().conflict,null);B.receive(A.undo(h1.receiptId!).update);equal('Undo one hide returns only own row',order(B).rows,['R1']);
  return{ok:true,checks,closed:3};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{A.destroy();B.destroy();C.destroy();}
}

/** Programmatic PM composition over the real session; no physical IME claim. */
export function testTableAxesComposition(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-compose',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-compose',schemaEpoch:'axes-compose',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}},G=createLocalToolGenesis(data,contract),maker=createLocalToolReplica(G,{authorId:'maker',contract});
 let closed=0;
 try{
  maker.apply([{type:'rich-table-create',field:'body',capture:maker.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R1',header:false}],columns:[{id:'C1'}]}}]);
  const checkpoint=maker.checkpoint(),snapshot={revision:1,updatedAt:1,data:maker.read(),document:{id:'D',namespace:contract.namespace,title:'Own composition',version:'fixture-1',lineage:'fixture-1'}},client={projectId:'own',documentId:'D',namespace:contract.namespace}as LocalToolClient<LocalToolJson>;
  for(const scenario of ['valid','cancel','hidden']as const){
   const session=new RichEditorSession(client,checkpoint,snapshot,contract,'body',()=>{},()=>1),peer=createLocalToolReplica(checkpoint,{authorId:'peer',contract}),schema=getSchema(blockNodes(new Set(),true,true));
   try{
    const doc=sessionPMDocument(session,schema),empty=blockPMLeaves(doc).find(n=>n.node.attrs.cellAddress)!,before=EditorState.create({schema,doc,selection:TextSelection.create(doc,empty.pos+1),plugins:[createRichAdmissionJournal()]}),raw=session.replica.checkpoint();let state=before,updates=0;
    const off=session.onDraft(()=>updates++);try{
     equal(scenario+' composition starts',session.beginComposition(),true);state=state.applyTransaction(state.tr.insertText('你🙂')).state;equal(scenario+' provisional has no write',session.replica.checkpoint(),raw);
     if(scenario==='cancel')state=state.applyTransaction(state.tr.delete(empty.pos+1,empty.pos+4)).state;
     if(scenario==='hidden'){const hide=peer.apply([{type:'rich-table-axis-hide',field:'body',capture:peer.richTableAxisCapture('body','T','columns','C1')}]);equal('remote hide is deferred during provisional composition',session.receiveDraft(hide.update),'deferred');}
     const committed=commitRichComposition(session,before,()=>state,tr=>{state=state.applyTransaction(tr).state;});session.endComposition();
     equal(scenario+' accepted result',committed,scenario!=='hidden');
     if(scenario==='valid'){equal('one real composed leaf',session.document().content.map(p=>p.content.map(t=>t.text).join('')),['你🙂']);equal('one outgoing draft after composition',updates,1);equal('one Undo restores exact logical empty',session.reverse(),true);equal('valid Undo exact data',session.replica.read(),snapshot.data);equal('no second Undo',session.reverse(),false);}
     else{equal(scenario+' checkpoint unchanged',session.replica.checkpoint(),raw);equal(scenario+' no author Undo',session.undoStep===undefined,true);equal(scenario+' no published draft',updates,0);if(scenario==='hidden')equal('hidden rejected composition text remains in PM recovery',state.doc.textContent,'你🙂');}
    }finally{off();}
   }finally{session.destroy();peer.destroy();closed+=2;}
  }
  return{ok:true,checks,closed:closed+1};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{maker.destroy();}
}

export function testTableAxesMixedFields(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-mixed',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'},fixed:{kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'},strict:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'}}},validationId:'axes-mixed',schemaEpoch:'axes-mixed',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.fixed&&!!v.strict};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]},fixed:{type:'block-doc',schema:'writers-blocks/2',blocks:[]},strict:{type:'block-doc',schema:'writers-blocks/1',blocks:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract});
 const rejected=(name:string,work:()=>unknown)=>{const before=A.checkpoint();let rejected=false;try{work();}catch{rejected=true;}equal(name,rejected,true);equal(name+' no change',A.checkpoint(),before);};
 try{
  const withoutBody={fixed:data.fixed,strict:data.strict},absent=createLocalToolGenesis(withoutBody,contract);equal('absent capable field still engine6',absent.engine.version,'6');equal('absent field export complete',exportLocalToolConvergenceCheckpoint(absent).pending,false);
  const fixed={id:'FT',columns:['FC'],rows:[{id:'FR',cells:[{id:'FX',columnId:'FC',paragraph:{id:'FP',text:'fixedΩ'}}]}]},destination={parentId:null,slot:'body' as const,afterId:null};
  A.apply([{type:'rich-table-insert',field:'fixed',capture:A.richBlockEditCapture('fixed',[],destination),table:fixed}]);equal('fixed sister preserves fixed grid under engine6',(A.read() as {fixed:{blocks:{id:string}[]}}).fixed.blocks.map(b=>b.id),['FP','FR','FT','FX']);
  rejected('fixed sister cannot capture axes',()=>A.richTableAxisCapture('fixed','FT','rows',null));rejected('strict sister cannot insert fixed table',()=>A.apply([{type:'rich-table-insert',field:'strict',capture:A.richBlockEditCapture('strict',[],destination),table:fixed}]));
  const oldContract:LocalToolConvergenceContract={...contract,codec:{version:2,fields:{fixed:contract.codec.fields.fixed,strict:contract.codec.fields.strict}}};
  const older=createLocalToolGenesis(withoutBody,oldContract);equal('same ordinary fields on old origin select engine5',older.engine.version,'5');rejected('old checkpoint does not open as profile6',()=>createLocalToolReplica(older,{authorId:'wrong',contract}).destroy());rejected('new checkpoint does not open with old field contract',()=>createLocalToolReplica(absent,{authorId:'wrong',contract:oldContract}).destroy());
  A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],destination),table:{id:'T',rows:[{id:'R1',header:false}],columns:[{id:'C1'}]}}]);A.apply([{type:'rich-table-axis-hide',field:'body',capture:A.richTableAxisCapture('body','T','rows','R1')}]);
  const saved=A.read(),fork=forkLocalToolGenesis(saved,contract),F=createLocalToolReplica(fork,{authorId:'fork',contract});try{equal('explicit fresh origin keeps zero dimension and all visible data',F.read(),saved);equal('fresh origin has independent genesis',fork.genesisId!==G.genesisId,true);equal('fork definition-free export complete',exportLocalToolConvergenceCheckpoint(fork).pending,false);}finally{F.destroy();}
  return{ok:true,checks,closed:2};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{A.destroy();}
}

export function testTableAxesRejectedBirth(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-reject-birth',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'reject-birth',schemaEpoch:'reject-birth',validateState:(v:LocalToolJson):v is LocalToolJson=>!JSON.stringify(v).includes('"tableId":"REJECT"')};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[{id:'O',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'7'}]}],axisOrder:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract});
 try{
  equal('health origin read',A.read(),data);const before=A.checkpoint();let failure='';
  try{A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'O'}),table:{id:'REJECT',rows:[{id:'R',header:false}],columns:[{id:'C'}]}}]);}catch(error){failure=String(error);}
  equal('current policy rejects prepared table',failure,'Error: local_tool_convergence_authored_state_invalid');equal('rejected table has no committed bytes',A.checkpoint(),before);
  const next=A.apply([{type:'rich-text-splice',field:'body',nodeId:'O',range:A.richRange('body','O',0,1),text:'9'}]);equal('later valid edit has no phantom pending dependency',next.pending,false);equal('later valid edit gets its own receipt',typeof next.receiptId,'string');A.undo(next.receiptId!);equal('later Undo exact, no rejected table',A.read(),data);
  return{ok:true,checks,closed:1};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{A.destroy();}
}

export function testTableAxesActionShape(){
 const checks:string[]=[],equal=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const contract:LocalToolConvergenceContract={namespace:'tests.axes-shape',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'axes-shape',schemaEpoch:'axes-shape',validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'};
 const data:LocalToolJson={body:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]}},G=createLocalToolGenesis(data,contract),A=createLocalToolReplica(G,{authorId:'A',contract});
 try{
  const made=A.apply([{type:'rich-table-create',field:'body',capture:A.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C'}]}}]);equal('healthy table creation before malformed actions',made.pending,false);
  const cap=A.richTableAxisCapture('body','T','rows','R'),before=A.checkpoint();let calls=0,reason='';
  const forged=Object.defineProperty({type:'rich-table-axis-insert' as const,field:'body',capture:cap,id:'GHOST'},'capture',{enumerable:true,get(){calls++;return cap;}});
  try{A.apply([forged]);}catch(error){reason=String(error);}equal('capture getter rejected before evaluation and write',[reason,calls,convergenceCanonical(A.checkpoint())===convergenceCanonical(before)],['Error: local_tool_convergence_format_invalid',0,true]);
  const inherited=Object.assign(Object.create({id:'GHOST'}),{type:'rich-table-axis-insert',field:'body',capture:cap});reason='';try{A.apply([inherited]);}catch(error){reason=String(error);}equal('inherited action payload rejected before writer',[reason,convergenceCanonical(A.checkpoint())===convergenceCanonical(before)],['Error: local_tool_convergence_format_invalid',true]);
  const valid=A.apply([{type:'rich-table-axis-insert',field:'body',capture:cap,id:'R2'}]);equal('normal action after malformed actions completes',[valid.pending,typeof valid.receiptId],[false,'string']);return{ok:true,checks,closed:1};
 }catch(error){throw Error(JSON.stringify(checks)+'; '+String(error),{cause:error});}finally{A.destroy();}
}
