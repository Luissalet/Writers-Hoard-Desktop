// Independent lifecycle/error probes. Empty private caches; no downloaded model is mutated.
const {build}=require('esbuild');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
 const root=path.resolve(__dirname,'..'),out=await fs.mkdtemp(path.join(root,'work/classifier-closure-')),cache=await fs.mkdtemp(path.join(os.tmpdir(),'writer-classifier-closure-cache-'));
 const shared={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
 const native=path.join(out,'runtime.cjs');await build({...shared,stdin:{contents:"export {VisualSearchRuntime} from './electron/visualSearch/runtime';export {EntityDetectionRuntime} from './electron/entityDetection/runtime';export {VISUAL_MODEL} from './electron/visualSearch/models';export {ENTITY_MODEL_KEY} from './electron/entityDetection/models';",resolveDir:root},outfile:native});
 const classes=require(native),results=[];
 for(const [family,className]of [['entityDetection','EntityDetectionRuntime'],['visualSearch','VisualSearchRuntime']]){
  const directory=path.join(cache,family);await fs.mkdir(directory,{recursive:true});
  const actual=path.join(out,`${family}-actual.cjs`),worker=path.join(out,`${family}-blocked.cjs`);
  await build({...shared,entryPoints:[path.join(root,`electron/${family}/worker.ts`)],outfile:actual});
  await fs.writeFile(worker,`globalThis.fetch=()=>{throw Error('INDEPENDENT_NETWORK_BLOCKED')};require(${JSON.stringify(actual)});`);
  const runtime=new classes[className](directory,worker),invoke=()=>family==='entityDetection'?runtime.detect('Ada Lovelace llegó a Madrid.'):runtime.text('a mountain map');
  try{
   if(family==='visualSearch'){await assert.rejects(runtime.image('https://example.invalid/private-image.png'),/image_data_invalid/);await assert.rejects(runtime.text('  '),/query_missing/);}else{assert.deepEqual(await runtime.detect('  '),[]);await assert.rejects(runtime.detect(null),/text_invalid/);}
   assert.equal((await runtime.status()).state,'missing');
   await assert.rejects(invoke(),/assets_missing_or_damaged/);
   assert.equal((await runtime.status()).state,'error');
   await assert.rejects(invoke(),/assets_missing_or_damaged/);
   await assert.rejects(runtime.prepare(),/INDEPENDENT_NETWORK_BLOCKED/);
   assert.equal((await runtime.status()).state,'error');
   await runtime.close();
   const fresh=new classes[className](directory,worker);
   try{assert.equal((await fresh.status()).state,'missing');await assert.rejects(family==='entityDetection'?fresh.detect('Ada Lovelace'):fresh.text('a map'),/assets_missing_or_damaged/);}finally{await fresh.close();}
   const pending=invoke();const closed=runtime.close();await assert.rejects(pending,/worker_closed/);await closed;
   await assert.rejects(invoke(),/assets_missing_or_damaged/);
   results.push(`${family}: empty private cache fails inference locally, retry and prepare errors settle without poisoned queue, fresh worker sees missing, close rejects pending work, later use starts a real fresh worker`);
  }finally{await runtime.close();}
  const unavailable=new classes[className](directory,path.join(out,'missing-worker.cjs'));
  try{await assert.rejects(family==='entityDetection'?unavailable.detect('Ada'):unavailable.text('map'),/Cannot find module|MODULE_NOT_FOUND/);assert.equal((await unavailable.status()).state,'error');}finally{await unavailable.close();}
 }
 const receipt={ok:true,network:'fetch throws in both actual worker entry points; no model downloaded or loaded',output:out,cache,results};
 await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));for(const result of results)console.log('PASS '+result);console.log('RECEIPT '+path.join(out,'receipt.json'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
