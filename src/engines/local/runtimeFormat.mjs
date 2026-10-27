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
 return {manifest:value.manifest,files:decoded,packet:bytes,fileSha256:await runtimeBytesHash(bytes),bytes:bytes.length};
}
