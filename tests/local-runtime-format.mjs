import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectRuntimePacket,canonicalRuntimeJson} from '../src/engines/local/runtimeFormat.mjs';

// Authored external runtime fixture: parsed as bytes only, never imported as code.
const bytes=new Uint8Array(await readFile(new URL('./local-runtime-packages-native/fixtures/b.whpackage.json',import.meta.url)));
const digest=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>new TextEncoder().encode(JSON.stringify(value)+'\n');

test('runtime package preserves exact canonical bytes and identity without evaluating code',async()=>{
 assert.equal(digest(bytes),'5592f0f17361b6c66141154484ab72240cb10997a62f796b953a88537397687e');
 const checked=await inspectRuntimePacket(bytes);
 assert.equal(checked.manifest.contentHash,'88501ae0ce87293cccbf640aee266e4a74cbb30a7116d6d407bd4ef33f73d990');
 assert.equal(checked.fileSha256,digest(bytes));assert.equal(checked.bytes,8407);assert.deepEqual(checked.packet,bytes);
 assert.equal(globalThis.__runtime59ModuleLoads,undefined);assert.equal(globalThis.__runtime59FactoryCalls,undefined);
});
test('UTF8 BOM is not a second accepted representation of the same runtime package',async()=>{
 await inspectRuntimePacket(bytes); // Healthy control before the original causal prefix.
 const prefixed=new Uint8Array(bytes.length+3);prefixed.set([0xef,0xbb,0xbf]);prefixed.set(bytes,3);
 await assert.rejects(()=>inspectRuntimePacket(prefixed),/local_runtime_package_packet_not_canonical/);
});
test('canonical file syntax rejects formatting, duplicate JSON keys and extra line endings',async()=>{
 const packet=JSON.parse(new TextDecoder().decode(bytes));
 for(const text of [JSON.stringify(packet,null,2)+'\n',new TextDecoder().decode(bytes)+'\n',new TextDecoder().decode(bytes).replace('{"files":','{"files":{},"files":')])await assert.rejects(()=>inspectRuntimePacket(new TextEncoder().encode(text)),/packet_not_canonical/);
 assert.equal(canonicalRuntimeJson({z:2,a:['Élodie',0,false,null]}),'{"a":["Élodie",0,false,null],"z":2}');
});
test('actual file bytes and manifest content hashes are both checked',async()=>{
 const changed=JSON.parse(new TextDecoder().decode(bytes)),bundle=Buffer.from(changed.files['bundle.mjs'],'base64');bundle[0]^=1;changed.files['bundle.mjs']=bundle.toString('base64');
 await assert.rejects(()=>inspectRuntimePacket(encode(changed)),/file_hash_mismatch/);
 const metadata=JSON.parse(new TextDecoder().decode(bytes));metadata.manifest.version='1.0.1';metadata.manifest.members[0].version='1.0.1';
 await assert.rejects(()=>inspectRuntimePacket(encode(metadata)),/content_hash_mismatch/);
});
test('invalid UTF8 and Source/1 do not become executable runtime packages',async()=>{
 await assert.rejects(()=>inspectRuntimePacket(new Uint8Array([0xff])),/json_invalid/);
 await assert.rejects(()=>inspectRuntimePacket(encode({manifest:{format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace:'own.source',version:'1',contentHash:'0'.repeat(64),files:[]},files:{}})),/manifest_invalid/);
});
