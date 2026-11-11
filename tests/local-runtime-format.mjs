import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packLocalRuntimeSource,validatePackedRuntimeCatalogue} from '../scripts/local-runtime-pack.mjs';
import {inspectRuntimePacket,canonicalRuntimeJson,runtimeBytesHash,runtimeBase64,runtimeManifestIdentity,RUNTIME_CATALOGUE_PATH,RUNTIME_CATALOGUE_MIME} from '../src/engines/local/runtimeFormat.mjs';

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

test('runtime CLI derives a canonical preview from author data without loading the tool',async()=>{
 const temp=await realpath(os.tmpdir()),dir=await mkdtemp(path.join(temp,'wh-catalogue-test-'));
 assert.equal(path.dirname(await realpath(dir)),temp);
 const member={kind:'tool',namespace:'qa.derived-catalogue',version:'0.1.0'};
 const config={namespace:member.namespace,version:member.version,entry:'tool.tsx',assets:[],members:[member],
  catalogue:[{namespace:member.namespace,file:'fields.json'}]};
 const labels={en:'Synthetic field',es:'Campo de ensayo'};
 const agent=(schema,index)=>({description:labels,schema,...(index?{index:true}:{})});
 const stateFields={version:1,fields:{
  title:{codec:{kind:'scalar'},agent:agent({type:'string'},true)},
  score:{codec:{kind:'scalar'},agent:agent({type:'integer'},true)},
  ready:{codec:{kind:'scalar'},agent:agent({type:'boolean'},true)},
  notes:{codec:{kind:'prose'}},
  rewards:{codec:{kind:'map'},agent:agent({type:'integer'})},
  objectives:{codec:{kind:'list',idKey:'id'},agent:agent({type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false})},
 }};
 const writeConfig=async value=>writeFile(path.join(dir,'local-tool.runtime.json'),JSON.stringify(value));
 const writeFields=async value=>writeFile(path.join(dir,'fields.json'),JSON.stringify(value));
 try{
  await writeConfig(config);
  await writeFields({documentBacked:true,stateFields});
  await writeFile(path.join(dir,'tool.tsx'),
   'import fields from "./fields.json";if(fields.stateFields)throw Error("the author module ran during pack/check");export default {namespace:"qa.derived-catalogue"};');
  const first=await packLocalRuntimeSource(dir),second=await packLocalRuntimeSource(dir);
  assert.deepEqual(first.packet,second.packet);
  const checked=await inspectRuntimePacket(first.packet);
  const [{namespace,documentBacked,operations,index}]=checked.catalogue.tools;
  assert.equal(namespace,member.namespace);
  assert.equal(documentBacked,true);
  assert.deepEqual(operations.map(operation=>operation.id),[
   'add_objectives_item','remove_objectives_item','remove_rewards_key','set_ready','set_rewards_key','set_score','set_title','update_objectives_item',
  ]);
  assert.deepEqual(index.fields,{ready:{path:'$.ready',type:'boolean'},score:{path:'$.score',type:'number'},title:{path:'$.title',type:'string'}});
  const title=operations.find(operation=>operation.id==='set_title');
  assert.deepEqual(title.inputSchema.required,['expectedRevision','expectedDocumentVersion','value']);
  assert.equal(title.inputSchema.additionalProperties,false);
  assert(checked.manifest.files.some(file=>file.path===RUNTIME_CATALOGUE_PATH&&file.mime===RUNTIME_CATALOGUE_MIME));

  const withCatalogue=async text=>{
   const parsed=JSON.parse(new TextDecoder().decode(first.packet)),file=parsed.manifest.files.find(row=>row.path===RUNTIME_CATALOGUE_PATH);
   const data=new TextEncoder().encode(text);
   file.bytes=data.length;file.sha256=await runtimeBytesHash(data);
   parsed.files[file.path]=runtimeBase64(data);
   parsed.manifest.contentHash=await runtimeBytesHash(new TextEncoder().encode(runtimeManifestIdentity(parsed.manifest)));
   return new TextEncoder().encode(canonicalRuntimeJson(parsed)+'\n');
  };
  await assert.rejects(()=>inspectRuntimePacket(first.packet.map((byte,i)=>i===0?0:byte)),/json_invalid/);
  const another=structuredClone(checked.catalogue);another.tools[0].namespace='qa.other-tool';
  await assert.rejects(async()=>inspectRuntimePacket(await withCatalogue(canonicalRuntimeJson(another)+'\n')),/catalogue_tool_invalid/);
  await assert.rejects(async()=>inspectRuntimePacket(await withCatalogue(JSON.stringify(checked.catalogue,null,2)+'\n')),/catalogue_not_canonical/);

  await assert.rejects(async()=>inspectRuntimePacket(await withCatalogue('\uFEFF'+canonicalRuntimeJson(checked.catalogue)+'\n')),/catalogue_not_canonical/);
  const wrongSchema=structuredClone(checked.catalogue);
  wrongSchema.tools[0].operations.find(operation=>operation.id==='set_title').inputSchema.properties.value.$ref='#bad';
  const wrongSchemaPacket=await inspectRuntimePacket(await withCatalogue(canonicalRuntimeJson(wrongSchema)+'\n'));
  await assert.rejects(()=>validatePackedRuntimeCatalogue(wrongSchemaPacket),/unsupported_local_tool_schema_keyword/);
  const wrongIndex=structuredClone(checked.catalogue);
  wrongIndex.tools[0].index.fields.title.path='not-a-selector';
  const wrongIndexPacket=await inspectRuntimePacket(await withCatalogue(canonicalRuntimeJson(wrongIndex)+'\n'));
  await assert.rejects(()=>validatePackedRuntimeCatalogue(wrongIndexPacket),/local_tool_index_path_invalid/);
  await validatePackedRuntimeCatalogue(checked);

  const manualIndex={version:1,fields:{title_override:{path:'$.title',type:'string'}}};
  await writeFields({documentBacked:true,stateFields,index:manualIndex});
  const manual=await inspectRuntimePacket((await packLocalRuntimeSource(dir)).packet);
  assert.deepEqual(manual.catalogue.tools[0].index,manualIndex);
  await writeFields({documentBacked:true,stateFields:{...stateFields,fields:{title:{...stateFields.fields.title,agent:agent({type:'string',$ref:'#bad'},true)}}}});
  await assert.rejects(()=>packLocalRuntimeSource(dir),/unsupported_local_tool_schema_keyword/);
  await writeConfig({...config,catalogue:[{namespace:'qa.foreign-tool',file:'fields.json'}]});
  await assert.rejects(()=>packLocalRuntimeSource(dir),/catalogue_config_invalid/);
 }finally{
  const real=await realpath(dir);
  assert.equal(path.dirname(real),temp);
  assert(path.basename(real).startsWith('wh-catalogue-test-'));
  await rm(real,{recursive:true});
 }
});
