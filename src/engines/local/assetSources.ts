import {assetSlot,validateLocalAssetRef,type LocalAssetManifest,type LocalAssetRef,type LocalAssetResolved} from './assets';
import type {LocalToolDefinition} from './sdk';
export type LocalAssetSource=Pick<LocalToolDefinition,'namespace'|'assets'|'assetFiles'>;
import type {LocalReleaseMetadata} from './releaseMetadata';
import type {LocalAssetFile} from './assetFileFormat';
import {validateRichImageAsset,type RichImageAsset} from './convergence/imageFormat';
import {localToolRichImageCells,localToolRichImageRaster,localToolRichTableCellHeaders,type LocalToolStateCodec} from './stateCodecFormat';
export async function resolveAssetSource(source:LocalAssetSource,manifest:LocalReleaseMetadata|undefined,ref:LocalAssetRef):Promise<LocalAssetResolved|null>{validateLocalAssetRef(ref);if(ref.kind==='source'&&ref.releaseHash&&ref.releaseHash!==manifest?.contentHash)return null;if(ref.kind!=='source'||ref.namespace!==source.namespace)return null;const slots:LocalAssetManifest=source.assets??{},key=assetSlot(slots,ref.slot);if(!key)return null;const spec=slots[key],load=source.assetFiles?.[spec.path];if(!load)return null;const descriptor=manifest?.files.find(file=>file.path===spec.path);if(manifest&&!descriptor)throw Error('local_asset_file_not_in_release');const blob=await load(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(descriptor&&(descriptor.sha256!==hash||descriptor.bytes!==blob.size))throw Error('local_asset_hash_mismatch');return{blob,kind:spec.kind,mime:blob.type,version:JSON.stringify([manifest?.contentHash??null,key,hash]),ref:{...ref,slot:key},origin:'default',slot:key};}

import {assetAccepts,type LocalAssetInstallation,type LocalAssetOverrides,type LocalToolAssets} from './assets';
export interface LocalAssetPort {current():Promise<LocalAssetSource>;source(ref:Extract<LocalAssetRef,{kind:'source'}>):Promise<LocalAssetResolved|null>;user(ref:Extract<LocalAssetRef,{kind:'media'|'image'|'file'}>):Promise<LocalAssetResolved|null>;image?(asset:RichImageAsset):Promise<LocalAssetFile|undefined>;import?:LocalToolAssets['import'];importImages?:LocalToolAssets['importImages'];choices(kind:import('./assets').LocalAssetKind):ReturnType<LocalToolAssets['choices']>;read():Promise<LocalAssetInstallation>;save(slot:string,ref:LocalAssetRef|null,version:string):Promise<LocalAssetInstallation>}
/** Authoring uses local bytes; receiving a causal cut is a separate operation. */
export function requireLocalImageActions(assets:LocalToolAssets|undefined,actions:readonly import('./stateActions').LocalToolStateAction[],codec:LocalToolStateCodec|undefined){
 const images=actions.flatMap<{type:string;field:string;asset:unknown}>(action=>{
  if(action.type==='rich-table-paste'){
   if(!Array.isArray(action.matrix))throw Error('local_tool_table_paste_invalid');
   return action.matrix.flatMap(row=>{
    if(!Array.isArray(row))throw Error('local_tool_table_paste_invalid');
    return row.flatMap(cell=>{
     if(!cell||cell.images!==undefined&&!Array.isArray(cell.images))throw Error('local_tool_table_paste_invalid');
     return (cell.images??[]).map(image=>({type:action.type,field:action.field,asset:image?.asset}));
    });
   });
  }
  return action.type==='rich-image-insert'||action.type==='rich-image-replace'||action.type==='rich-table-cell-image-insert'?[{type:action.type,field:action.field,asset:action.asset}]:[];
 });
 if(!images.length)return undefined;
 return (async()=>{for(const {type,field,asset} of images){
  const descriptor=codec?.fields[field];
  if(type==='rich-table-cell-image-insert'&&!localToolRichImageCells(descriptor))throw Error('local_tool_table_axes_action_invalid');
  if(type==='rich-table-paste'&&!localToolRichTableCellHeaders(descriptor))throw Error('local_tool_table_paste_invalid');
  validateRichImageAsset(asset,localToolRichImageRaster(descriptor));
  if(!assets||!await assets.resolveImage(asset))throw Error('local_asset_image_unavailable');
 }})();
}

export function createLocalAssetService(port:LocalAssetPort):LocalToolAssets{
 const resolve=async(ref:LocalAssetRef)=>{validateLocalAssetRef(ref);await port.current();const value=ref.kind==='source'?await port.source(ref):await port.user(ref);await port.current();return value;};
 const resolveImage=async(asset:RichImageAsset):Promise<LocalAssetResolved|null>=>{
  validateRichImageAsset(asset,true);const expected={...asset};await port.current();const row=await port.image?.(expected);await port.current();
  if(!row||row.kind!=='image'||row.sha256!==expected.sha256||row.mime!==expected.mime||row.size!==expected.size||row.blob.size!==expected.size)return null;
  return{blob:row.blob,kind:'image',mime:row.mime,version:row.sha256,ref:{kind:'file',id:row.id},origin:'document',slot:''};
 };
 const list=async()=>structuredClone((await port.current()).assets??{});
 const validate=async(key:string,ref:LocalAssetRef|null)=>{const manifest=await list(),canonical=assetSlot(manifest,key);if(!canonical)throw Error('local_asset_slot_missing');const spec=manifest[canonical];if(spec.replaceable===false)throw Error('local_asset_not_replaceable');if(ref){const value=await resolve(ref);if(!value||!assetAccepts(spec,value.kind,value.mime))throw Error('local_asset_replacement_invalid');}return{slot:canonical,aliases:[...spec.aliases??[]]};};
 return Object.freeze({list,resolve,resolveImage,validate,...(port.importImages?{importImages:async(files:readonly File[])=>{await port.current();const rows=await port.importImages!(files);await port.current();return rows;}}:{}),import:async(file:File,kind:import('./assetFileFormat').LocalAssetFileKind)=>{await port.current();if(!port.import)throw Error('local_tool_query_is_read_only');const row=await port.import(file,kind);await port.current();return row;},choices:async(kind:import('./assets').LocalAssetKind)=>{await port.current();const rows=await port.choices(kind);await port.current();return rows;},async slot(key:string,overrides:LocalAssetOverrides={}){const manifest=await list(),canonical=assetSlot(manifest,key);if(!canonical)return null;const spec=manifest[canonical],pick=(values:LocalAssetOverrides)=>[canonical,...spec.aliases??[]].map(key=>Object.hasOwn(values,key)?values[key]:undefined).find(value=>value!==undefined),doc=pick(overrides),installed=pick((await port.read()).overrides),ref=doc??installed??{kind:'source' as const,namespace:(await port.current()).namespace,slot:canonical};const value=await resolve(ref);return value&&assetAccepts(spec,value.kind,value.mime)?{...value,slot:canonical,origin:doc?'document' as const:installed?'installation' as const:'default' as const}:null;},installation:Object.freeze({read:port.read,async set(key:string,ref:LocalAssetRef|null,version:string){const target=await validate(key,ref);return port.save(target.slot,ref,version);}})});
}

export async function assetBlobHash(blob:Blob){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
