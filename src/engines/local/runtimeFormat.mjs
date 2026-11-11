import {localToolSourcePath,localToolContentHash} from './releaseFormat.mjs';
export const LOCAL_RUNTIME_PACKAGE_FORMAT='writers-hoard-local-runtime-package/1';
const namespace=value=>typeof value==='string'&&value.length<=80&&/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>object(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(',');
const text=value=>typeof value==='string'&&!!value.trim();
const invalid=reason=>{throw Error('local_runtime_package_'+reason);};
export function canonicalRuntimeJson(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalRuntimeJson).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalRuntimeJson(value[key])).join(',')+'}';
 return invalid('json_invalid');
}
export const runtimeBytesHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export function runtimeBase64(bytes){let result='';for(let index=0;index<bytes.length;index+=32768)result+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(result);}
export function runtimeDecodeBase64(value){if(typeof value!=='string')return invalid('base64_invalid');let bytes;try{bytes=Uint8Array.from(atob(value),character=>character.charCodeAt(0));}catch{return invalid('base64_invalid');}if(runtimeBase64(bytes)!==value)return invalid('base64_invalid');return bytes;}
export function validateRuntimeManifest(manifest){
 if(!keys(manifest,['format','apiVersion','runtimeVersion','namespace','version','entry','members','files','contentHash'])||manifest.format!==LOCAL_RUNTIME_PACKAGE_FORMAT||manifest.apiVersion!==1||manifest.runtimeVersion!==1||!namespace(manifest.namespace)||!text(manifest.version)||manifest.entry!=='bundle.mjs'||!localToolContentHash(manifest.contentHash)||!Array.isArray(manifest.members)||!manifest.members.length||!Array.isArray(manifest.files)||!manifest.files.length)return invalid('manifest_invalid');
 let previous='';
 for(const member of manifest.members){
  if(!object(member))return invalid('member_invalid');
  if(!keys(member,member.kind==='app'?['kind','namespace','version','descriptor']:['kind','namespace','version'])||!['tool','app'].includes(member.kind)||!namespace(member.namespace)||member.version!==manifest.version||member.namespace<=previous)return invalid('member_invalid');
  previous=member.namespace;
  if(member.kind==='app'){
   const d=member.descriptor;
   if(!object(d)||d.format!=='writers-hoard-local-app/1'||d.id!==member.namespace||d.version!==member.version||typeof d.subRoutes!=='boolean'||!Array.isArray(d.tools)||d.tools.some(id=>!namespace(id))||new Set(d.tools).size!==d.tools.length||!keys(d.state,['initialState','codec','preview'])||!object(d.state.codec)||!object(d.state.preview)||!keys(d.name,['en','es'])||!keys(d.description,['en','es'])||[d.name.en,d.name.es,d.description.en,d.description.es].some(value=>!text(value))||Object.keys(d).some(key=>!['format','id','version','name','description','subRoutes','tools','state','publishPreset'].includes(key))||d.publishPreset!==undefined&&!['instance-documents','world-wiki'].includes(d.publishPreset))return invalid('descriptor_invalid');
  }
 }
 previous='';const paths=new Set();
 for(const file of manifest.files){if(!keys(file,['path','bytes','sha256','mime'])||!localToolSourcePath(file.path)||file.path<=previous||paths.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||!localToolContentHash(file.sha256)||!text(file.mime))return invalid('file_invalid');previous=file.path;paths.add(file.path.toLowerCase());}
 if(!manifest.files.some(file=>file.path===manifest.entry&&file.mime==='text/javascript'))return invalid('entry_invalid');
}
export function runtimeManifestIdentity(manifest){const {contentHash:ignored,...identity}=manifest;void ignored;return canonicalRuntimeJson(identity);}
export const RUNTIME_CATALOGUE_PATH='metadata/derived-agent-catalogue.json';
export const RUNTIME_CATALOGUE_MIME='application/vnd.writers-hoard.derived-agent-catalogue+json';
export const runtimeCatalogueFile=file=>file.path===RUNTIME_CATALOGUE_PATH&&file.mime===RUNTIME_CATALOGUE_MIME;
const optionalIndexKeys=(value,required)=>keys(value,Object.hasOwn(value,'index')?[...required,'index']:required);
function readRuntimeCatalogue(manifest,files){
 const file=manifest.files.find(runtimeCatalogueFile);
 if(!file)return undefined;
 if(file.bytes>128*1024)return invalid('catalogue_too_large');
 const bytes=files.get(file.path);
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return invalid('catalogue_not_canonical');
 let source,value;
 try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(source);}catch{return invalid('catalogue_invalid');}
 if(!keys(value,['version','tools'])||value.version!==1||!Array.isArray(value.tools)||!value.tools.length||value.tools.length>manifest.members.length)return invalid('catalogue_invalid');
 const memberTools=new Set(manifest.members.filter(member=>member.kind==='tool').map(member=>member.namespace));
 let previous='';
 for(const tool of value.tools){
  if(!object(tool)||!optionalIndexKeys(tool,['namespace','documentBacked','operations'])||!memberTools.has(tool.namespace)||tool.namespace<=previous||typeof tool.documentBacked!=='boolean'||!Array.isArray(tool.operations)||!tool.operations.length||tool.operations.length>256)return invalid('catalogue_tool_invalid');
  previous=tool.namespace;let operationId='';
  for(const op of tool.operations){
   if(!keys(op,['id','description','inputSchema','writes'])||typeof op.id!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(op.id)||op.id<=operationId||op.writes!==true||
      !keys(op.description,['en','es'])||!text(op.description.en)||!text(op.description.es)||op.description.en.length>550||op.description.es.length>550||
      !object(op.inputSchema)||op.inputSchema.type!=='object'||!object(op.inputSchema.properties)||op.inputSchema.additionalProperties!==false||!Array.isArray(op.inputSchema.required))return invalid('catalogue_operation_invalid');
   operationId=op.id;
  }
  if(Object.hasOwn(tool,'index')){
   const index=tool.index;
   if(!object(index)||!keys(index,Object.hasOwn(index,'refs')?['version','fields','refs']:['version','fields'])||index.version!==1||!object(index.fields)||Object.hasOwn(index,'refs')&&!Array.isArray(index.refs))return invalid('catalogue_index_invalid');
  }
 }
 if(source!==canonicalRuntimeJson(value)+'\n')return invalid('catalogue_not_canonical');
 return value;
}
export async function inspectRuntimePacket(packet){
 const bytes=new Uint8Array(packet);let source,value;
 if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return invalid('packet_not_canonical');
 try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(source);}catch{return invalid('json_invalid');}
 if(!keys(value,['manifest','files'])||!object(value.files))return invalid('packet_invalid');
 validateRuntimeManifest(value.manifest);
 if(source!==canonicalRuntimeJson(value)+'\n')return invalid('packet_not_canonical');
 if(await runtimeBytesHash(new TextEncoder().encode(runtimeManifestIdentity(value.manifest)))!==value.manifest.contentHash)return invalid('content_hash_mismatch');
 if(Object.keys(value.files).length!==value.manifest.files.length)return invalid('files_mismatch');
 const decoded=new Map();
 for(const file of value.manifest.files){if(!Object.hasOwn(value.files,file.path))return invalid('files_mismatch');const content=runtimeDecodeBase64(value.files[file.path]);if(content.length!==file.bytes||await runtimeBytesHash(content)!==file.sha256)return invalid('file_hash_mismatch');decoded.set(file.path,content);}
 try{new TextDecoder('utf-8',{fatal:true}).decode(decoded.get(value.manifest.entry));}catch{return invalid('entry_utf8_invalid');}
 const catalogue=readRuntimeCatalogue(value.manifest,decoded);
 return {manifest:value.manifest,files:decoded,packet:bytes,fileSha256:await runtimeBytesHash(bytes),bytes:bytes.length,...(catalogue?{catalogue}:{})};
}
