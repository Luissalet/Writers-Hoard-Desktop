import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=path.join(root,'src/engines/writings/pdf/generated/artifacts.json');
export const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function canonicalInput(bytes,normalization){
 if(normalization!=='lf')return bytes;
 const text=bytes.toString('utf8');
 if(bytes.includes(0)||!Buffer.from(text).equals(bytes))throw Error('Publishing text fingerprint requires valid UTF8 without NUL bytes');
 return Buffer.from(text.replace(/\r\n/g,'\n'));
}
export function checkPublishingWasm(){
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 for(const file of [...manifest.inputs,...manifest.outputs]){
  const target=path.resolve(root,file.path);
  if(!target.startsWith(root+path.sep))throw Error('Invalid publishing artifact path');
  const bytes=canonicalInput(fs.readFileSync(target),file.normalization);
  if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error(`Publishing WASM is stale: ${file.path}. Rebuild with npm run publishing:wasm:build.`);
 }
 console.log(`Publishing WASM: ${manifest.inputs.length} inputs and ${manifest.outputs.length} artifacts exact (${manifest.toolchain}).`);
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))checkPublishingWasm();
