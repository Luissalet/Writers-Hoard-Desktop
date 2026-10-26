// Installed runtime import-query values only. The factory is never evaluated,
// and no model assets, pipeline or inference are prepared by this test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {build}=require('esbuild'),{fileURLToPath}=require('node:url'),{viteCssTextPlugin}=require('../scripts/esbuild-vite-css.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
 const output=await build({stdin:{contents:`import raw from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?raw';import url from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';export {raw,url};`,resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:'actual',plugins:[viteCssTextPlugin()]});
 const {raw,url}=require('node:vm').runInNewContext(output.outputFiles[0].text+';actual');
 const rawSha256=crypto.createHash('sha256').update(raw).digest('hex');
 assert.equal(Buffer.byteLength(raw),53057);
 assert.equal(rawSha256,'0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611');
 assert.equal(new URL(url).protocol,'file:');
 const file=fileURLToPath(url);assert.equal(fs.statSync(file).size,26861777);
 const wasmSha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 assert.equal(wasmSha256,'49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082');
 console.log(JSON.stringify({ok:true,attribution:'Actual installed factory text and WASM file URL in isolated esbuild test; factory never evaluated, no model/inference.',rawBytes:Buffer.byteLength(raw),rawSha256,wasmBytes:fs.statSync(file).size,wasmSha256,url}));
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
