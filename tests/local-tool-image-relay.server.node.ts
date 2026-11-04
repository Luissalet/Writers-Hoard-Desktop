import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createPresenceRelay} from '../electron/presence/server';
import {createLocalToolGenesis,createLocalToolReplica} from '@/engines/local/convergence/replica';
import {convergenceIdentityOf} from '@/engines/local/convergence/format';
import type {LocalToolConvergenceContract} from '@/engines/local/convergence/types';
import type {LocalToolJson} from '@/engines/local/stateTypes';

import {rasterFixtures} from './local-tool-image-formats.fixture';
import {testImageBase64} from './local-tool-image-fixture';

export async function testBinaryImageRelay(profile:'legacy'|'aligned'|'raster'|'cells'='legacy'){
 const alignmentProfile=profile!=='legacy',cells=profile==='cells',raster=profile==='raster'||cells;
 const bytesA=Buffer.from(raster?rasterFixtures[0].base64:testImageBase64,'base64'),bytesB=Buffer.from(raster?rasterFixtures[1].base64:'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAZElEQVR4nO3PMQ0AIRQEUTRg41q0IAWlJwgD/IJq2GSSLafY1/qYx/3rO+61vr12SAB9SAB9SAB96BqQcrTqBdC9ALoXQPf5gJSjVS+A7gXQvQC6zwekHK16AXQvgO4F0H08YAPEFUR5VhpNyAAAAABJRU5ErkJggg==','base64'),describe=(bytes:Buffer,mime:'image/png'|'image/jpeg'|'image/webp')=>({sha256:createHash('sha256').update(bytes).digest('hex'),mime,size:bytes.byteLength}),assetA=describe(bytesA,raster?'image/jpeg':'image/png'),assetB=describe(bytesB,raster?'image/webp':'image/png');
 const namespace='tests.binary-images',field='body',nodeId='own-image';
 const imageField=cells?{kind:'rich',profile:'blocks-tree/9',schema:'writers-blocks/8'} as const:raster?{kind:'rich',profile:'blocks-tree/8',schema:'writers-blocks/7'} as const:alignmentProfile?{kind:'rich',profile:'blocks-tree/7',schema:'writers-blocks/6'} as const:{kind:'rich',profile:'blocks-tree/6',schema:'writers-blocks/5'} as const;
 const contract:LocalToolConvergenceContract={namespace,validationId:'image-test',schemaEpoch:'image-test-1',codec:{version:2,fields:{body:imageField}},validateState:(value):value is LocalToolJson=>!!value&&typeof value==='object'&&!Array.isArray(value)};
 const genesis=createLocalToolGenesis({body:{type:'block-doc',schema:imageField.schema,blocks:[{id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[]}],axisOrder:[]}},contract),aReplica=createLocalToolReplica(genesis,{authorId:'own-A',contract});
 const placement={parentId:null,slot:'body' as const,afterId:'P'};
 if(cells){
  aReplica.apply([{type:'rich-table-create',field,capture:aReplica.richBlockEditCapture(field,[],placement),table:{id:'T',rows:[{id:'R',header:false}],columns:[{id:'C'}]}}]);
  aReplica.apply([{type:'rich-table-cell-image-insert',field,capture:aReplica.richTableCellCapture(field,'T','R','C'),fragmentId:'F',id:nodeId,asset:assetA}]);
 }else aReplica.apply([{type:'rich-image-insert',field,capture:aReplica.richBlockEditCapture(field,[],placement),id:nodeId,asset:assetA}]);
 const bReplica=createLocalToolReplica(aReplica.checkpoint(),{authorId:'own-B',contract}),seed=aReplica.export();
 const doc={projectId:'own-project',eraId:null,namespace,documentId:'own-doc',lineage:'own-lineage',convergence:convergenceIdentityOf(seed)};
 let host='';const relay=createPresenceRelay(()=>[host]),server=http.createServer((req,res)=>{void relay.handle(req,res).then(found=>{if(!found)res.writeHead(404).end();});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address==='object');host='127.0.0.1:'+address.port;
 let calls=0;const checks:string[]=[],base='http://'+host+'/__wh_presence/';
 const ok=(label:string)=>{checks.push(label);console.log('PASS '+label);};
 const post=async(route:string,body:unknown,expected=200)=>{calls++;const res=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await res.json();assert.equal(res.status,expected,JSON.stringify(value));return value;};
 type Connection={connectionId:string;token:string};
 type Member=Connection&{roomId:string;instanceId:string;epoch:string};
 const connect=(id:string):Promise<Connection>=>post('connect',{profile:{userId:id,name:id,color:'#334477'}});
 const member=(c:Connection,roomId:string,instanceId:string,epoch='lease-1'):Member=>({...c,roomId,instanceId,epoch});
 const update=(m:Member,kind:string,body:object={},expected=200)=>post('update',{...m,kind,...body},expected);
 const binary=async(m:Member,sha:string,data?:Buffer,mime=sha===assetA.sha256?assetA.mime:assetB.mime)=>{calls++;const query=new URLSearchParams({roomId:m.roomId,instanceId:m.instanceId,epoch:m.epoch});return fetch(base+'image/'+sha+'?'+query,{method:data?'PUT':'GET',headers:{'x-writer-connection':m.connectionId,Authorization:'Bearer '+m.token,...(data?{'Content-Type':mime}:{})},...(data?{body:Uint8Array.from(data)}:{})});};
 const sameBytes=async(m:Member,asset:{sha256:string;mime:string},expected:Buffer)=>{const reply=await binary(m,asset.sha256);assert.equal(reply.status,200);assert.equal(reply.headers.get('content-type'),asset.mime);assert.deepEqual(Buffer.from(await reply.arrayBuffer()),expected);};
 const denied=async(m:Member,sha:string,data?:Buffer,status?:number)=>{const res=await binary(m,sha,data);assert(!res.ok);if(status!==undefined)assert.equal(res.status,status);await res.arrayBuffer();};
 try{
  const a=await connect('Alice'),b=await connect('Beatriz'),outsider=await connect('Otro');
  const room=await post('create',{...a,document:doc,content:seed});
  assert.deepEqual(room.needsImages,[assetA],'A room carrying an image must request its missing binary');ok('initial room requests the exact historical image descriptor');
  const A=member(a,room.roomId,'a'),B=member(b,room.roomId,'b'),people=member(b,room.roomId,'people'),X=member(outsider,room.roomId,'x');
  await update(B,'join-prepare',{document:doc,content:true},400);await denied(X,assetA.sha256,bytesA);await denied({...A,token:'wrong'},assetA.sha256,bytesA,401);
  const bad=Buffer.from(bytesA);bad[bad.length-1]^=1;await denied(A,assetA.sha256,bad);if(raster){const mislabeled=await binary(A,assetA.sha256,bytesA,'image/webp');assert(!mislabeled.ok);await mislabeled.arrayBuffer();}
  const uploaded=await binary(A,assetA.sha256,bytesA);assert(uploaded.ok);await uploaded.arrayBuffer();ok('bootstrap permits only owner and validates its actual image MIME and digest');
  assert.deepEqual((await update(B,'join-prepare',{document:doc,content:true})).content,seed);
  await update(A,'join',{document:doc,content:true});await update(people,'join',{document:doc});await denied(people,assetA.sha256);await denied(X,assetA.sha256);
  await update(B,'join',{document:doc,content:true});await sameBytes(B,assetA,bytesA);ok('second member reads bytes only after joining document content');
  const replace=aReplica.apply([{type:'rich-image-replace',field,capture:aReplica.richImageCapture(field,nodeId,'source'),asset:assetB}]).update;
  const resize=bReplica.apply([{type:'rich-image-resize',field,capture:bReplica.richImageCapture(field,nodeId,'size'),displaySize:'small'}]).update;
  const contribution={messageId:'replace-one',update:replace};
  assert.deepEqual((await update(A,'content',contribution)).needsImages,[assetB]);await denied(B,assetB.sha256,bytesB);await denied(A,assetB.sha256);
  const during=await update(B,'content-full-request',{requestId:'before-upload'});assert.deepEqual(during.content,seed);ok('missing bytes do not admit a new causal cut or grant another member its upload');
  const stored=await binary(A,assetB.sha256,bytesB);assert(stored.ok);await stored.arrayBuffer();await denied(B,assetB.sha256);
  assert.equal((await update(A,'content',contribution)).ok,true);assert.equal((await update(A,'content',contribution)).duplicate,true);
  await update(B,'content',{messageId:'resize-one',update:resize});
  if(alignmentProfile){
   const aligned=aReplica.apply([{type:'rich-image-align',field,capture:aReplica.richImageCapture(field,nodeId,'alignment'),alignment:'right'}]);
   const admitted=await update(A,'content',{messageId:'alignment-only',update:aligned.update});
   assert.equal(admitted.ok,true);
   assert.equal(admitted.needsImages,undefined);
   ok('alignment-only delta retains both images without another upload');
  }
  const final=await update(B,'content-full-request',{requestId:'complete'});const combined=bReplica.receive(final.content);assert.equal(combined.pending,false);
  const visible=(bReplica.read() as unknown as {body:{blocks:{id:string;parentId:string|null;attrs:unknown}[]}}).body.blocks.find(block=>block.id===nodeId);
  assert.deepEqual(visible?.attrs,{asset:assetB,displaySize:'small',...(alignmentProfile?{alignment:'right'}:{})});assert.equal(visible?.parentId,cells?'F':null);await sameBytes(B,assetA,bytesA);await sameBytes(B,assetB,bytesB);
  assert.equal(Buffer.from(final.content.updateBase64,'base64').includes(bytesA),false);assert.equal(Buffer.from(final.content.updateBase64,'base64').includes(bytesB),false);
  ok('replacement and resize converge while old and new bytes use only the binary channel');
  await update(B,'join',{document:doc,content:true});await update(B,'leave');await denied(B,assetB.sha256);await denied(people,assetB.sha256);
  const other=await post('create',{...outsider,document:{...doc,documentId:'other-doc'}});await denied(member(outsider,other.roomId,'other'),assetB.sha256);ok('retired leases and unrelated rooms cannot read either file');
  return{checks,calls};
 }finally{aReplica.destroy();bReplica.destroy();relay.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
