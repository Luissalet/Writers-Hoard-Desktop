import assert from 'node:assert/strict';
import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint} from '@/engines/local/convergence/replica';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/types';
import type {LocalToolJson} from '@/engines/local/stateTypes';

const assetA={sha256:'fc36789738be8ca73521c494dbb66434d135ea74c2282a5f687b85b195c76bff',mime:'image/png',size:291} as const;
const assetB={sha256:'b'.repeat(64),mime:'image/png',size:295} as const;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[]};
const oldData={body:{type:'block-doc',schema:'writers-blocks/4',blocks:[paragraph],axisOrder:[]}};
const data={body:{...oldData.body,schema:'writers-blocks/5'}};
const contract:LocalToolConvergenceContract={
 namespace:'tests.shared-image',validationId:'image-policy',schemaEpoch:'image-epoch',
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/6',schema:'writers-blocks/5'},old:{kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'}}},
 validateState:(value):value is LocalToolJson=>!!value&&typeof value==='object'&&!Array.isArray(value),
};
const oldContract:LocalToolConvergenceContract={...contract,codec:{...contract.codec,fields:{body:{kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'}}}};

export function testSharedImageProfile(){
 const checks:string[]=[];
 const same=(label:string,value:unknown,expected:unknown)=>{assert.deepEqual(value,expected,label);checks.push(label);console.log('PASS '+label);};
 const reject=(label:string,run:()=>unknown)=>{assert.throws(run,undefined,label);checks.push(label);console.log('PASS '+label);};
 const old=createLocalToolGenesis(oldData,oldContract);
 same('old profile still seeds engine7',old.engine.version,'7');
 same('old profile still exports without definition',exportLocalToolConvergenceCheckpoint(old).pending,false);
 const genesis=createLocalToolGenesis(data,contract);
 same('the opt-in seeds engine9 even before there is an image',genesis.engine.version,'9');
 reject('old contract rejects engine9',()=>createLocalToolReplica(genesis,{authorId:'old',contract:oldContract}));
 const a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract});
 const view=(replica:typeof a)=>replica.read() as typeof data;
 const image=(replica:typeof a)=>view(replica).body.blocks.find(block=>block.id==='image');
 try{
  const insert={type:'rich-image-insert' as const,field:'body',capture:a.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'P'}),id:'image',asset:assetA};
  const inserted=a.apply([insert]);b.receive(inserted.update);
  same('insertion is a real receipt and has its default size',[!!inserted.receiptId,image(b)?.attrs],[true,{asset:assetA,displaySize:'medium'}]);
  const replace=a.richImageCapture('body','image','source'),resize=b.richImageCapture('body','image','size');
  const changed=a.apply([{type:'rich-image-replace',field:'body',capture:replace,asset:assetB}]);
  const sized=b.apply([{type:'rich-image-resize',field:'body',capture:resize,displaySize:'small'}]);
  b.receive(changed.update);a.receive(sized.update);
  same('concurrent replace and resize commute',[image(a)?.attrs,image(b)?.attrs],[{asset:assetB,displaySize:'small'},{asset:assetB,displaySize:'small'}]);
  const checkpoint=a.checkpoint();
  reject('same-channel stale capture cannot replace',()=>a.apply([{type:'rich-image-replace',field:'body',capture:replace,asset:assetA}]));
  same('stale capture leaves exact checkpoint',a.checkpoint(),checkpoint);
  const reverted=a.undo(changed.receiptId!);b.receive(reverted.update);
  same('undo replace preserves other author size',[image(a)?.attrs,image(b)?.attrs],[{asset:assetA,displaySize:'small'},{asset:assetA,displaySize:'small'}]);
  const redone=a.redo(reverted.receiptId!);b.receive(redone.update);
  same('redo replace preserves other author size',image(b)?.attrs,{asset:assetB,displaySize:'small'});
  const removed=b.apply([{type:'rich-block-hide',field:'body',capture:b.richBlockEditCapture('body',['image'])}]);a.receive(removed.update);
  same('normal hide removes only the image',view(a).body.blocks,[paragraph]);
  a.receive(b.undo(removed.receiptId!).update);
  same('normal undo restores exact image and neighbor',view(a),view(b));
  const cold=createLocalToolReplica(a.checkpoint(),{authorId:'cold',contract});
  try{same('cold checkpoint opens the exact image',view(cold),view(a));}finally{cold.destroy();}
  same('portable export verifies without package code',exportLocalToolConvergenceCheckpoint(a.checkpoint()).pending,false);
 }finally{a.destroy();b.destroy();}
 return checks;
}

export function testSharedImageBirthUndo(){
 const checks:string[]=[];
 const same=(label:string,value:unknown,expected:unknown)=>{assert.deepEqual(value,expected,label);checks.push(label);console.log('PASS '+label);};
 for(const channel of ['source','size'] as const)for(const delivered of [false,true]){
  const label=channel+'/'+(delivered?'early':'late');
  const genesis=createLocalToolGenesis(data,contract);
  const a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract});
  const image=(replica:typeof a)=>(replica.read() as typeof data).body.blocks.find(block=>block.id==='image')?.attrs??null;
  try{
   const inserted=a.apply([{type:'rich-image-insert',field:'body',capture:a.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'P'}),id:'image',asset:assetA}]);
   b.receive(inserted.update);
   const capture=b.richImageCapture('body','image',channel);
   const edited=b.apply([channel==='source'?{type:'rich-image-replace',field:'body',capture,asset:assetB}:{type:'rich-image-resize',field:'body',capture,displaySize:'small'}]);
   if(delivered)a.receive(edited.update);
   const undone=a.undo(inserted.receiptId!);
   if(!delivered){same(label+' undo before remote edit removes image locally',image(a),null);a.receive(edited.update);}
   b.receive(undone.update);
   const supported=channel==='source'?{asset:assetB,displaySize:'medium'}:{asset:assetA,displaySize:'small'};
   same(label+' the surviving edit supports the same image',[image(a),image(b)],[supported,supported]);
   same(label+' portable support is complete',exportLocalToolConvergenceCheckpoint(a.checkpoint()).pending,false);
   const bUndo=b.undo(edited.receiptId!);a.receive(bUndo.update);
   same(label+' retiring the last edit removes support',[image(a),image(b)],[null,null]);
   a.receive(b.redo(bUndo.receiptId!).update);
   same(label+' redo restores only supported image',[image(a),image(b)],[supported,supported]);
   const hidden=a.apply([{type:'rich-block-hide',field:'body',capture:a.richBlockEditCapture('body',['image'])}]);b.receive(hidden.update);
   same(label+' explicit hide beats support',[image(a),image(b)],[null,null]);
  }finally{a.destroy();b.destroy();}
 }
 const genesis=createLocalToolGenesis(data,contract);
 const a=createLocalToolReplica(genesis,{authorId:'A',contract}),b=createLocalToolReplica(genesis,{authorId:'B',contract}),c=createLocalToolReplica(genesis,{authorId:'C',contract});
 const image=(replica:typeof a)=>(replica.read() as typeof data).body.blocks.find(block=>block.id==='image')?.attrs??null;
 try{
  const inserted=a.apply([{type:'rich-image-insert',field:'body',capture:a.richBlockEditCapture('body',[],{parentId:null,slot:'body',afterId:'P'}),id:'image',asset:assetA}]);
  b.receive(inserted.update);c.receive(inserted.update);
  const replaced=c.apply([{type:'rich-image-replace',field:'body',capture:c.richImageCapture('body','image','source'),asset:assetB}]);
  a.receive(replaced.update);b.receive(replaced.update);
  same('B observes the independently replaced source before resizing',image(b),{asset:assetB,displaySize:'medium'});
  const sized=b.apply([{type:'rich-image-resize',field:'body',capture:b.richImageCapture('body','image','size'),displaySize:'full'}]);
  a.receive(sized.update);c.receive(sized.update);
  const retired=c.undo(replaced.receiptId!);
  a.receive(retired.update);b.receive(retired.update);
  const undone=a.undo(inserted.receiptId!);
  b.receive(undone.update);c.receive(undone.update);
  same('support never restores a source retired independently',[image(a),image(b),image(c)],Array(3).fill({asset:assetA,displaySize:'full'}));
 }finally{a.destroy();b.destroy();c.destroy();}
 return checks;
}
