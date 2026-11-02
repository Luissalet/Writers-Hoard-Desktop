import assert from 'node:assert/strict';
import {MAX_LOCAL_TOOL_STATE_BYTES} from '@/engines/local/stateTypes';
import {validateSourceToolDocument} from '@/engines/local/documents/types';
import {convergenceBase64,convergenceBytes,convergenceCodecHash,LOCAL_TOOL_CONVERGENCE_ENGINE} from '@/engines/local/convergence/format';

/** Shape validation only: opaque causal bytes must not consume the admitted state's budget. */
export function testConvergenceFormatBudget(){
 const codec={version:1 as const,fields:{notes:{kind:'prose' as const}}};
 const checkpoint={format:'writers-hoard-local-convergence/1',namespace:'tests.convergence-format',genesisId:'format-only',engine:LOCAL_TOOL_CONVERGENCE_ENGINE,codecHash:convergenceCodecHash(codec),validationId:'v1',schemaEpoch:'1',checkpointBase64:'AAAA'.repeat(MAX_LOCAL_TOOL_STATE_BYTES/4+64),stateVectorBase64:''};
 const document={id:'format-document',namespace:checkpoint.namespace,title:'Format fixture',revision:1,createdAt:1,updatedAt:1,data:{notes:'Élodie 李明 🐚'},codec,convergence:{checkpoint}};
 const before=structuredClone(document);
 validateSourceToolDocument(document);assert.deepEqual(document,before);
 const overhead=new TextEncoder().encode(JSON.stringify({notes:''})).byteLength;
 const boundary={...document,data:{notes:'a'.repeat(MAX_LOCAL_TOOL_STATE_BYTES-overhead)}};
 validateSourceToolDocument(boundary);
 assert.throws(()=>validateSourceToolDocument({...boundary,data:{notes:boundary.data.notes+'a'}}),/state-too-large/);
 assert.throws(()=>validateSourceToolDocument({...document,convergence:{checkpoint:{...checkpoint,checkpointBase64:'bad!'}}}),/convergence_format_invalid/);
 return 'Pure Source envelope accepts causal bytes above 2 MiB while admitted data keeps its exact 2 MiB budget; no engine decoding claimed';
}

/** Large causal envelopes remain canonical without a recursive regexp matcher. */
export function testConvergenceLargeCanonicalBytes(){
 assert.deepEqual(convergenceBytes('AA=='),new Uint8Array([0]));
 for(const text of ['A','AAAA\n','AAA\n','AAA\u2028','A===','AA=A','====','AB==','AAB=','____','éAAA']){
  assert.throws(()=>convergenceBytes(text),/local_tool_convergence_format_invalid/);
 }
 const bytes=new Uint8Array(MAX_LOCAL_TOOL_STATE_BYTES*8+1);
 for(let i=0;i<bytes.length;i++)bytes[i]=(i*31+7)%256;
 const encoded=convergenceBase64(bytes);
 assert.deepEqual(convergenceBytes(encoded),bytes,'large canonical envelope changed its bytes');
 assert.throws(()=>convergenceBytes(encoded.slice(0,-4)+'AA=A'),/local_tool_convergence_format_invalid/);
 return 'Large canonical causal bytes round-trip exactly; invalid alphabet, padding and unused bits remain rejected';
}

/** Actual host-selected encoders only; availability is recorded, never mocked or forced. */
export function testConvergenceEncodingBytes(){
 const host={node:typeof process==='undefined'?null:process.versions.node??null,electron:typeof process==='undefined'?null:process.versions.electron??null,nativeUint8ArrayToBase64:typeof (Uint8Array.prototype as Uint8Array & {toBase64?:()=>string}).toBase64==='function',globalBufferFrom:typeof (globalThis as typeof globalThis & {Buffer?:{from?:unknown}}).Buffer?.from==='function',atob:typeof globalThis.atob==='function',btoa:typeof globalThis.btoa==='function'};
 let checks=0;const same=(a:unknown,b:unknown,message?:string)=>{assert.deepEqual(a,b,message);checks++;};
 const vectors=[['',''],['f','Zg=='],['fo','Zm8='],['foo','Zm9v'],['foob','Zm9vYg=='],['fooba','Zm9vYmE='],['foobar','Zm9vYmFy']];
 for(const[text,canonical]of vectors){const bytes=new TextEncoder().encode(text);same(convergenceBase64(bytes),canonical,'RFC4648 encoding');same(convergenceBytes(canonical),bytes,'RFC4648 decoding');}
 const alphabet=Uint8Array.from({length:256},(_,index)=>index),allBytes='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==';
 same(convergenceBase64(alphabet),allBytes,'every possible byte');same(convergenceBytes(allBytes),alphabet);same(convergenceBase64(new Uint8Array([255])),'/w==');same(convergenceBytes('AAA='),new Uint8Array([0,0]));
 const observations:{bytes:number;offset:number;base64Chars:number}[]=[];
 for(const size of[1,2,3,8191,8192,8193,MAX_LOCAL_TOOL_STATE_BYTES+3]){
  const backing=new Uint8Array(size+19).fill(0xa7),view=backing.subarray(7,7+size);for(let index=0;index<view.length;index++)view[index]=(index*31+7)%256;const before=backing.slice(),copy=new Uint8Array(view),encoded=convergenceBase64(view),decoded=convergenceBytes(encoded);
  same(encoded,convergenceBase64(copy),'view offset or neighbor bytes leaked');same(encoded.length,4*Math.ceil(size/3),'standard padding length');same(decoded,copy,'complete byte-for-byte roundtrip');same(backing,before,'input or sentinels mutated');observations.push({bytes:size,offset:view.byteOffset,base64Chars:encoded.length});
 }
 const invalid:unknown[]=[undefined,null,0,true,{},[], 'A','AA','AAA','AA=','AAAA=','AAAA\n',' AAAA','AAAA ','AAA\t','AAA\u2028','A===','AA=A','====','AB==','AAB=','/x==','____','_w==','-w==','éAAA'];
 for(const value of invalid){assert.throws(()=>convergenceBytes(value as string),/local_tool_convergence_format_invalid/);checks++;}
 return{ok:true,checks,rfc4648Vectors:vectors.length,allByteValues:256,observations,invalidCases:invalid.length,hostCapabilities:host,forcedBranches:false,encoderBranchProved:false,purpose:'Actual functions in this host only; a Node result does not establish Brave/native/fallback coverage'};
}
