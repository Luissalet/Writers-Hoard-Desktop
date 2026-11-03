import assert from 'node:assert/strict';
import {createLocalToolGenesis,createLocalToolReplica} from '../src/engines/local/convergence/replica';
import type {LocalToolConvergenceContract,LocalToolReplica} from '../src/engines/local/convergence/types';
import type {LocalToolJson} from '../src/engines/local/stateTypes';

/** A current public validator reenters its live replica while a FULL4 is prepared. */
export async function testRichAdoptionReceiveReentry(){
 const checks:string[]=[],actors:LocalToolReplica[]=[];let reenter:(()=>void)|undefined;
 const policy=(value:LocalToolJson):value is LocalToolJson=>{if(JSON.stringify(value).includes('https://example.org/outer')&&reenter){const run=reenter;reenter=undefined;run();}return !!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body;};
 const old:LocalToolConvergenceContract={namespace:'tests.adoption-reentry',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'},flag:{kind:'scalar'}}},validationId:'3',schemaEpoch:'3',validateState:policy},target:LocalToolConvergenceContract={...old,validationId:'4',schemaEpoch:'4',codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'},flag:{kind:'scalar'}}},richAdoption:{transition:'rich-links-3-to-4/1',from:{namespace:old.namespace,codec:old.codec,validationId:old.validationId,schemaEpoch:old.schemaEpoch}}};
 const G=createLocalToolGenesis({body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]},flag:0},old),a=createLocalToolReplica(G,{authorId:'A',contract:target}),b=createLocalToolReplica(G,{authorId:'B',contract:target});actors.push(a,b);
 try{
  b.adopt(target);b.apply([{type:'rich-link',field:'body',nodeId:'P',range:b.richRange('body','P',0,2),href:'example.org/outer'}]);const full=b.export(),original=JSON.stringify(full);let inner:ReturnType<LocalToolReplica['checkpoint']>|undefined,receipt:string|null=null;
  reenter=()=>{const result=a.apply([{type:'set',field:'flag',value:1}]);receipt=result.receiptId;inner=a.checkpoint();};
  assert.throws(()=>a.receive(full),/conflict/);checks.push('outer receive rejects stale preparation after public policy reentry');assert(inner);assert.deepEqual(a.checkpoint(),inner);checks.push('accepted inner transaction remains exact');assert.equal(JSON.stringify(full),original);checks.push('original FULL not rewritten');assert.equal(a.checkpoint().engine.version,'3');checks.push('stale receive never switches format');assert.equal(JSON.stringify(a.read()).includes('https://example.org/outer'),false);checks.push('outer contribution absent');assert(receipt);a.undo(receipt);assert.equal((a.read() as {flag:number}).flag,0);checks.push('inner owner receipt remains usable');
  a.receive(full);assert.equal(a.checkpoint().engine.version,'4');assert.equal(JSON.stringify(a.read()).includes('https://example.org/outer'),true);checks.push('same original FULL succeeds after fresh preparation');
 }finally{reenter=undefined;for(const actor of actors)actor.destroy();}
 return checks;
}
