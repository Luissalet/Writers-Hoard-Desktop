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
