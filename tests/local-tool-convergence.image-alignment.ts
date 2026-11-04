import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {collectLocalToolCheckpointImages,createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import {collectRoomImageAssets} from '@/engines/local/convergence/imageRefs';
import {convergenceBase64,convergenceBytes} from '@/engines/local/convergence/format';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/types';
import type {LocalToolJson} from '@/engines/local/stateTypes';

const first={sha256:'a'.repeat(64),mime:'image/png',size:291} as const;
const second={sha256:'b'.repeat(64),mime:'image/png',size:295} as const;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[]};
const legacy={kind:'rich',profile:'blocks-tree/6',schema:'writers-blocks/5'} as const;
const aligned={kind:'rich',profile:'blocks-tree/7',schema:'writers-blocks/6'} as const;
const blockDoc=(schema:string)=>({type:'block-doc',schema,blocks:[paragraph],axisOrder:[]});
const oldData={body:blockDoc(legacy.schema)};
const data={body:blockDoc(aligned.schema),legacy:blockDoc(legacy.schema)};
const contract:LocalToolConvergenceContract={
 namespace:'tests.image-alignment',validationId:'image-alignment-policy',schemaEpoch:'image-alignment-epoch',
 codec:{version:2,fields:{body:aligned,legacy,absent:legacy}},
 validateState:(value):value is LocalToolJson=>!!value&&typeof value==='object'&&!Array.isArray(value),
};
const oldContract:LocalToolConvergenceContract={...contract,codec:{version:2,fields:{body:legacy}}};
type Replica=ReturnType<typeof createLocalToolReplica>;
const insert=(replica:Replica,field='body')=>replica.apply([{type:'rich-image-insert',field,capture:replica.richBlockEditCapture(field,[],{parentId:null,slot:'body',afterId:'P'}),id:'I',asset:first}]);
const image=(replica:Replica,field:'body'|'legacy'='body')=>(replica.read() as typeof data)[field].blocks.find(block=>block.id==='I')?.attrs??null;
const check=()=>{
 const checks:string[]=[];
 return{checks,equal(label:string,value:unknown,expected:unknown){assert.deepEqual(value,expected,label);checks.push(label);console.log('PASS '+label);},
  reject(label:string,run:()=>unknown){assert.throws(run,undefined,label);checks.push(label);console.log('PASS '+label);}};
};

export function testSharedImageAlignment(){
 const {checks,equal,reject}=check();
 const old=createLocalToolGenesis(oldData,oldContract);
 equal('incumbent image profile still seeds engine9',old.engine.version,'9');
 const oldReplica=createLocalToolReplica(old,{authorId:'legacy',contract:oldContract});
 try{insert(oldReplica);equal('old image attributes remain literal',image(oldReplica),{asset:first,displaySize:'medium'});}finally{oldReplica.destroy();}
 const genesis=createLocalToolGenesis(data,contract);
 equal('alignment profile seeds engine10',genesis.engine.version,'10');
 reject('old reader contract cannot open engine10',()=>createLocalToolReplica(genesis,{authorId:'old-reader',contract:oldContract}));
 const a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract});
 try{
  b.receive(insert(a).update);
  equal('new image has explicit left',image(a),{asset:first,displaySize:'medium',alignment:'left'});
  b.receive(insert(a,'legacy').update);
  equal('mixed legacy image stays literal',image(a,'legacy'),{asset:first,displaySize:'medium'});
  reject('legacy sibling cannot capture alignment',()=>a.richImageCapture('legacy','I','alignment'));
  reject('absent legacy sibling cannot capture alignment',()=>a.richImageCapture('absent','I','alignment'));
  const align=a.richImageCapture('body','I','alignment');
  const changed=b.apply([{type:'rich-image-replace',field:'body',capture:b.richImageCapture('body','I','source'),asset:second},
   {type:'rich-image-resize',field:'body',capture:b.richImageCapture('body','I','size'),displaySize:'full'}]);
  a.receive(changed.update);
  const adjusted=a.apply([{type:'rich-image-align',field:'body',capture:align,alignment:'right'}]);
  b.receive(adjusted.update);
  const merged={asset:second,displaySize:'full',alignment:'right'};
  equal('alignment capture survives independent source and size edits',[image(a),image(b)],[merged,merged]);
  const before=a.checkpoint();
  reject('stale alignment capture rejects',()=>a.apply([{type:'rich-image-align',field:'body',capture:align,alignment:'center'}]));
  equal('stale alignment leaves checkpoint exact',a.checkpoint(),before);
  const undone=a.undo(adjusted.receiptId!);b.receive(undone.update);
  equal('undo alignment preserves source and size',[image(a),image(b)],Array(2).fill({...merged,alignment:'left'}));
  b.receive(a.redo(undone.receiptId!).update);
  equal('redo restores right under full',image(b),merged);
  a.receive(b.apply([{type:'rich-image-resize',field:'body',capture:b.richImageCapture('body','I','size'),displaySize:'small'}]).update);
  equal('changing full to small keeps right',image(a),{...merged,displaySize:'small'});
  const checkpoint=a.checkpoint(),portable=exportLocalToolConvergenceCheckpoint(checkpoint);
  equal('portable state is complete',portable.pending,false);
  equal('both image descriptors retained for archive',collectLocalToolCheckpointImages(checkpoint,contract.codec).sort((x,y)=>x.sha256.localeCompare(y.sha256)),[first,second]);
  equal('both image descriptors retained for relay',collectRoomImageAssets(portable.update),[first,second]);
  const forged=new Y.Doc({gc:false});
  try{
   Y.applyUpdate(forged,convergenceBytes(checkpoint.checkpointBase64));
   forged.getMap('image-alignment-fields').set('value',JSON.stringify(['body','legacy']));
   const altered={...checkpoint,checkpointBase64:convergenceBase64(Y.encodeStateAsUpdate(forged)),stateVectorBase64:convergenceBase64(Y.encodeStateVector(forged))};
   reject('portable history rejects mutation of the alignment declaration',()=>exportLocalToolConvergenceCheckpoint(altered));
   reject('normal reader also rejects forged field authority',()=>createLocalToolReplica(altered,{authorId:'forged',contract}));
  }finally{forged.destroy();}
 }finally{a.destroy();b.destroy();}
 return checks;
}

export function testConcurrentImageAlignment(){
 const {checks,equal}=check();
 const genesis=createLocalToolGenesis(data,contract),a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract});
 try{
  b.receive(insert(a).update);
  const aligned=a.apply([{type:'rich-image-align',field:'body',capture:a.richImageCapture('body','I','alignment'),alignment:'right'}]);
  const changed=b.apply([{type:'rich-image-replace',field:'body',capture:b.richImageCapture('body','I','source'),asset:second},
   {type:'rich-image-resize',field:'body',capture:b.richImageCapture('body','I','size'),displaySize:'small'}]);
  a.receive(changed.update);b.receive(aligned.update);
  equal('concurrent alignment and replace/resize commute in both orders',[image(a),image(b)],Array(2).fill({asset:second,displaySize:'small',alignment:'right'}));
  b.receive(a.undo(aligned.receiptId!).update);
  equal('concurrent undo changes only the alignment',[image(a),image(b)],Array(2).fill({asset:second,displaySize:'small',alignment:'left'}));
 }finally{a.destroy();b.destroy();}
 return checks;
}

export function testImageAlignmentBirthUndo(){
 const {checks,equal}=check();
 for(const early of [false,true]){
  const genesis=createLocalToolGenesis(data,contract);
  const a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract});
  try{
   const born=insert(a);b.receive(born.update);
   const adjusted=b.apply([{type:'rich-image-align',field:'body',capture:b.richImageCapture('body','I','alignment'),alignment:'center'}]);
   if(early)a.receive(adjusted.update);
   const withdrawn=a.undo(born.receiptId!);
   if(!early){equal('no support before remote alignment',image(a),null);a.receive(adjusted.update);}
   b.receive(withdrawn.update);
   const expected={asset:first,displaySize:'medium',alignment:'center'};
   equal('alignment supports birth after undo '+early,[image(a),image(b)],[expected,expected]);
   const gone=b.undo(adjusted.receiptId!);a.receive(gone.update);
   equal('last support undo hides '+early,[image(a),image(b)],[null,null]);
   a.receive(b.redo(gone.receiptId!).update);
   equal('redo recovers same image '+early,image(a),expected);
   const hide=a.apply([{type:'rich-block-hide',field:'body',capture:a.richBlockEditCapture('body',['I'])}]);b.receive(hide.update);
   equal('explicit hide wins '+early,[image(a),image(b)],[null,null]);
  }finally{a.destroy();b.destroy();}
 }
 return checks;
}
