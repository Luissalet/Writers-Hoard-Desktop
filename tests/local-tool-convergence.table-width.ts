import assert from 'node:assert/strict';
import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/types';
import type {RichBlockDocument} from '@/engines/local/convergence/blockFormat';
import type {LocalToolJson} from '@/engines/local/stateTypes';
import {validateLocalToolCodecState} from '@/engines/local/stateCodecFormat';

export function testSharedTableWidths(){
 const checks:string[]=[],equal=(label:string,a:unknown,b:unknown)=>{assert.deepEqual(a,b,label);checks.push(label);};
 const validateState=(value:LocalToolJson):value is LocalToolJson=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body;
 const old:LocalToolConvergenceContract={namespace:'tests.table-width',codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'}}},validationId:'table-width',schemaEpoch:'table-width',validateState};
 const seed=(schema:string)=>({body:{type:'block-doc',schema,blocks:[],axisOrder:[]}});
 type Replica=ReturnType<typeof createLocalToolReplica>;
 const owners:Replica[]=[];
 const open=(authorId:string,checkpoint:ReturnType<typeof createLocalToolGenesis>,contract:LocalToolConvergenceContract)=>{
  const replica=createLocalToolReplica(checkpoint,{authorId,contract});owners.push(replica);return replica;
 };
 const body=(replica:Replica)=>(replica.read() as unknown as {body:RichBlockDocument}).body;
 const table=(replica:Replica)=>replica.apply([{type:'rich-table-create',field:'body',capture:replica.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R',header:true}],columns:[{id:'C1'},{id:'C2'}]}}]);
 const width=(replica:Replica,id='C1')=>body(replica).blocks.find(block=>block.id===id)?.attrs.widthPx??null;
 const capture=(replica:Replica,id='C1')=>replica.richTableColumnWidthCapture('body','T',id);
 const resize=(replica:Replica,widthPx:number|null,id='C1',selected=capture(replica,id))=>replica.apply([{type:'rich-table-column-width',field:'body',capture:selected,widthPx}]);
 const unchangedRejection=(label:string,replica:Replica,action:()=>unknown)=>{
  const before=replica.checkpoint();assert.throws(action,undefined,label);equal(label,replica.checkpoint(),before);
 };
 try{
  const legacy=open('legacy',createLocalToolGenesis(seed('writers-blocks/3'),old),old);
  table(legacy);
  equal('incumbent engine6 and real columns are healthy',[legacy.checkpoint().engine.version,body(legacy).axisOrder],[ '6',[{tableId:'T',rows:['R'],columns:['C1','C2']}]]);
  const strict=legacy.richTableCellCapture('body','T','R','C1');
  legacy.apply([{type:'rich-table-cell-insert',field:'body',capture:strict,fragment:{id:'F',paragraph:{id:'P',text:'Ω🙂'}}}]);
  equal('incumbent text exact',body(legacy).blocks.find(block=>block.id==='P')?.content,[{type:'text',text:'Ω🙂'}]);
  const contract:LocalToolConvergenceContract={...old,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'}}}};
  const genesis=createLocalToolGenesis(seed('writers-blocks/4'),contract);
  equal('new envelope engine7 even with no table',genesis.engine.version,'7');
  equal('empty capable checkpoint exports complete',exportLocalToolConvergenceCheckpoint(genesis).pending,false);
  const A=open('A',genesis,contract),created=table(A),B=open('B',A.checkpoint(),contract);
  unchangedRejection('engine6 width capture rejects atomically',legacy,()=>capture(legacy));
  const cell=A.richTableCellCapture('body','T','R','C1'),stale=capture(A);
  equal('Auto no-op has no receipt',resize(A,null).receiptId,null);
  for(const invalid of [47,48.5,Infinity,Number.MAX_SAFE_INTEGER+1,'205'])unchangedRejection('invalid width '+invalid,A,()=>resize(A,invalid as number));
  const a=resize(A,205),b=resize(B,260);
  A.receive(b.update);B.receive(a.update);
  equal('same ID converges in reverse receive orders',A.read(),B.read());
  unchangedRejection('old width capture rejects against new winner',A,()=>resize(A,214,'C1',stale));
  const winner=width(A)===205?A:B,loser=winner===A?B:A,winning=winner===A?a:b,losing=winner===A?b:a;
  loser.receive(winner.undo(winning.receiptId!).update);
  equal('Undo winning width reveals other author',width(winner),winner===A?260:205);
  winner.receive(loser.undo(losing.receiptId!).update);
  equal('both Undo restore Auto in both peers',[width(A),width(B)],[null,null]);
  const first=resize(A,205),second=resize(B,260,'C2');
  A.receive(second.update);B.receive(first.update);
  equal('distinct IDs preserve both widths',[width(A),width(A,'C2')],[205,260]);
  B.receive(A.undo(first.receiptId!).update);
  equal('Undo A preserves B in the other column',[width(A),width(A,'C2'),width(B,'C2')],[null,260,260]);
  const priorCell=A.richTableCellCapture('body','T','R','C2'),changed=resize(B,300,'C2');
  A.receive(changed.update);
  const content=A.apply([{type:'rich-table-cell-insert',field:'body',capture:priorCell,fragment:{id:'F2',paragraph:{id:'P2',text:'after width Ω'}}}]);
  B.receive(content.update);
  equal('cell capture survives width update on its column',body(A).blocks.find(block=>block.id==='P2')?.content,[{type:'text',text:'after width Ω'}]);
  equal('old captured logical address remains identifiable',cell.columnId,'C1');
  const foreign=open('foreign',createLocalToolGenesis(seed('writers-blocks/4'),contract),contract);table(foreign);
  unchangedRejection('same IDs in another genesis cannot capture width',A,()=>resize(A,210,'C1',capture(foreign)));
  const toHide=capture(A,'C2'),hide=A.apply([{type:'rich-table-axis-hide',field:'body',capture:A.richTableAxisCapture('body','T','columns','C2')}]);
  unchangedRejection('hidden column cannot accept old width capture',A,()=>resize(A,210,'C2',toHide));
  A.undo(hide.receiptId!);
  equal('Undo hide returns width to the same ID',width(A,'C2'),300);
  A.apply([{type:'rich-table-axis-insert',field:'body',capture:A.richTableAxisCapture('body','T','columns',null),id:'C0'}]);
  equal('inserting before a sized column does not move its width',[body(A).axisOrder![0].columns,width(A,'C0'),width(A,'C2')],[['C0','C1','C2'],null,300]);
  const quiet=open('birth',genesis,contract),birth=table(quiet),resizeOnly=open('resize',quiet.checkpoint(),contract);
  quiet.receive(resize(resizeOnly,230).update);
  quiet.undo(birth.receiptId!);
  equal('width-only edit never supports a withdrawn birth',body(quiet).blocks,[]);
  equal('original table receipt exists',typeof created.receiptId,'string');
  equal('definition-free export remains complete',exportLocalToolConvergenceCheckpoint(A.checkpoint()).pending,false);
  return{ok:true,checks,closed:owners.length};
 }finally{for(const owner of owners)owner.destroy();}
}

export function testTableWidthFieldBoundaries(){
 const checks:string[]=[],equal=(label:string,a:unknown,b:unknown)=>{assert.deepEqual(a,b,label);checks.push(label);};
 const codec={version:2,fields:{
  body:{kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'},
  axes:{kind:'rich',profile:'blocks-tree/4',schema:'writers-blocks/3'},
  fixed:{kind:'rich',profile:'blocks-tree/3',schema:'writers-blocks/2'},
  outline:{kind:'rich',profile:'blocks-tree/2',schema:'writers-blocks/1'},
 }} as const;
 const initial:LocalToolJson={
  axes:{type:'block-doc',schema:'writers-blocks/3',blocks:[],axisOrder:[]},
  fixed:{type:'block-doc',schema:'writers-blocks/2',blocks:[]},
  outline:{type:'block-doc',schema:'writers-blocks/1',blocks:[]},
 };
 const contract:LocalToolConvergenceContract={namespace:'tests.table-width-boundaries',codec,validationId:'width-boundaries',schemaEpoch:'width-boundaries',validateState:(value):value is LocalToolJson=>!!value};
 const checkpoint=createLocalToolGenesis(initial,contract);
 equal('absent capable field still discriminates engine7',checkpoint.engine.version,'7');
 equal('absent width field declaration exports complete',exportLocalToolConvergenceCheckpoint(checkpoint).pending,false);
 const replica=createLocalToolReplica(checkpoint,{authorId:'mixed-fields',contract});
 try{
  equal('mixed engine7 leaves fixed and strict sibling grammars exact',replica.read(),initial);
  replica.apply([{type:'rich-table-create',field:'axes',capture:replica.richBlockEditCapture('axes',[],{parentId:null,slot:'body',afterId:null}),table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C'}]}}]);
  const before=replica.checkpoint(),read=replica.read() as unknown as {axes:RichBlockDocument};
  assert.throws(()=>replica.richTableColumnWidthCapture('axes','T','C'));
  equal('engine7 cannot resize a strict engine6 sibling',replica.checkpoint(),before);
  read.axes.blocks.find(block=>block.id==='C')!.attrs={widthPx:206};
  assert.throws(()=>validateLocalToolCodecState(read as unknown as LocalToolJson,codec));
  checks.push('the strict sibling rejects new attrs even as portable DTO');
  equal('mixed replica remains complete',exportLocalToolConvergenceCheckpoint(before).pending,false);
  return{ok:true,checks,closed:1};
 }finally{replica.destroy();}
}
