import {cloneLocalToolJson,localToolNamespace,type LocalToolJson} from './stateTypes';
export const HOST_ASSET_NAMESPACE='writers.host-assets';
export type LocalAssetKind='audio'|'image'|'font'|'video'|'data';
export type LocalAssetRef={kind:'media'|'image'|'file';id:string}|{kind:'source';namespace:string;slot:string;releaseHash?:string};
export type LocalAssetOverrides=Record<string,LocalAssetRef>;
export interface LocalAssetSpec {path:string;kind:LocalAssetKind;meta?:Record<string,LocalToolJson>;replaceable?:boolean;accept?:string[];aliases?:string[]}
export type LocalAssetManifest=Record<string,LocalAssetSpec>;
export type LocalAssetFiles=Record<string,()=>Promise<Blob>>;
export interface LocalAssetResolved {blob:Blob;kind:LocalAssetKind;mime:string;version:string;ref:LocalAssetRef;origin:'document'|'installation'|'default';slot:string}
export interface LocalAssetInstallation {version:string;overrides:LocalAssetOverrides;own:LocalAssetOverrides;provenance:'base'|'variant'}
import type {LocalAssetFileInfo,LocalAssetFileKind} from './assetFileFormat';
export type {LocalAssetFileInfo,LocalAssetFileKind} from './assetFileFormat';
export interface LocalToolAssets {import(file:File,kind:LocalAssetFileKind):Promise<LocalAssetFileInfo>;list():Promise<LocalAssetManifest>;validate(slot:string,ref:LocalAssetRef|null):Promise<{slot:string;aliases:string[]}>;resolve(ref:LocalAssetRef):Promise<LocalAssetResolved|null>;slot(slot:string,overrides?:LocalAssetOverrides):Promise<LocalAssetResolved|null>;choices(kind:LocalAssetKind):Promise<{ref:LocalAssetRef;title:string}[]>;installation:{read():Promise<LocalAssetInstallation>;set(slot:string,ref:LocalAssetRef|null,expectedVersion:string):Promise<LocalAssetInstallation>}}
export function validateLocalAssetRef(value:unknown):asserts value is LocalAssetRef {const row=value as LocalAssetRef;if(!row||typeof row!=='object'||Array.isArray(row))throw Error('local_asset_ref_invalid');if(row.kind==='media'||row.kind==='image'||row.kind==='file'){if(typeof row.id!=='string'||!row.id||Object.keys(row).sort().join(',')!=='id,kind')throw Error('local_asset_ref_invalid');}else if(row.kind==='source'){if(!localToolNamespace(row.namespace)||typeof row.slot!=='string'||!row.slot||Object.keys(row).some(key=>!['kind','namespace','slot','releaseHash'].includes(key))||row.releaseHash!==undefined&&!/^[a-f0-9]{64}$/.test(row.releaseHash))throw Error('local_asset_ref_invalid');}else throw Error('local_asset_ref_invalid');}
export function validateLocalAssetManifest(value:LocalAssetManifest,files:LocalAssetFiles){cloneLocalToolJson(value as unknown as LocalToolJson);const names=new Set(Object.keys(value));for(const [key,spec]of Object.entries(value)){if(!key||['__proto__','constructor','prototype'].includes(key)||!spec||!['audio','image','font','video','data'].includes(spec.kind)||!spec.path||spec.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\:]/.test(spec.path)||Array.from(spec.path).some(character=>character.charCodeAt(0)<32)||typeof files[spec.path]!=='function'||spec.replaceable!==undefined&&typeof spec.replaceable!=='boolean'||spec.accept!==undefined&&(!Array.isArray(spec.accept)||spec.accept.some(mime=>typeof mime!=='string'||!mime)))throw Error('local_asset_manifest_invalid');if(spec.aliases!==undefined&&(!Array.isArray(spec.aliases)||spec.aliases.some(alias=>typeof alias!=='string')))throw Error('local_asset_alias_invalid');for(const alias of spec.aliases??[]){if(!alias||names.has(alias))throw Error('local_asset_alias_ambiguous');names.add(alias);}}}
export function assetSlot(manifest:LocalAssetManifest,key:string){return Object.hasOwn(manifest,key)?key:Object.keys(manifest).find(name=>manifest[name].aliases?.includes(key));}
export function assetOverrideKey(namespace:string,slot:string){return JSON.stringify([namespace,slot]);}
export function assetAccepts(spec:LocalAssetSpec,kind:LocalAssetKind,mime:string){return spec.kind===kind&&(!spec.accept?.length||spec.accept.some(accept=>accept===mime||accept.endsWith('/*')&&mime.startsWith(accept.slice(0,-1))));}
/** Decode already admitted local data without a CSP-sensitive network request. */
export function localAssetDataBlob(url:string):Blob{
 if(!url.startsWith('data:'))throw Error('local_asset_file_missing');
  // Vite inlines small defaults; gallery images also use data URLs.
  // connect-src intentionally disallows data: fetch; img/media-src permit it.
  const comma=url.indexOf(',');if(comma<0)throw Error('local_asset_file_missing');
  const metadata=url.slice(5,comma),base64=/;base64$/i.test(metadata),type=metadata.replace(/;base64$/i,'')||'text/plain;charset=US-ASCII',encoded=new TextEncoder().encode(url.slice(comma+1)),decoded:number[]=[];
  for(let i=0;i<encoded.length;i++){
   const hex=String.fromCharCode(encoded[i+1]??0,encoded[i+2]??0);
   if(encoded[i]===37&&/^[0-9a-f]{2}$/i.test(hex)){decoded.push(parseInt(hex,16));i+=2;}else decoded.push(encoded[i]);
  }
  const bytes=base64?Uint8Array.from(atob(decoded.map(byte=>String.fromCharCode(byte)).join('')),character=>character.charCodeAt(0)):new Uint8Array(decoded);
 return new Blob([bytes],{type});
}
/** Only a compiled source supplies this URL; user data never stores it. */
export function localAssetFile(url:string):()=>Promise<Blob>{return async()=>{
 const resolved=new URL(url,location.href);
 if(resolved.protocol==='data:')return localAssetDataBlob(resolved.href);
 if(resolved.origin!==location.origin)throw Error('local_asset_external_source');
 const reply=await fetch(resolved);if(!reply.ok)throw Error('local_asset_file_missing');return reply.blob();
};}
