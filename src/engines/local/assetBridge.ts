import {db} from '@/db';
import {assertEngineEnabled,resolveProjectId,requireString,optString,type ToolArgs} from '@/services/aiBridge/tools/shared';
import {resolveProjectLocalTool} from './releases';
import {createLocalToolClient} from './storage';
import type {LocalAssetRef,LocalAssetOverrides} from './assets';
const client=async(args:ToolArgs,readOnly:boolean)=>{const projectId=resolveProjectId(args),project=await db.projects.get(projectId);if(!project)throw Error('project_missing');const namespace=requireString(args,'namespace'),source=resolveProjectLocalTool(namespace,project);if(!readOnly)await assertEngineEnabled(projectId,'local-tool-'+namespace);return createLocalToolClient(projectId,source,{eraId:optString(args,'eraId'),documentId:optString(args,'documentId'),readOnly,releaseHash:project.localToolInstallations?.[namespace]?.contentHash??null,requireSelectedRelease:true});};
import {prepareBrowserAssetFile,storeAssetFile} from './assetFiles';
import {assetBytes,assetBase64,assetFileInfo,assetFileHash} from './assetFileFormat';
import {assetAccepts,assetSlot} from './assets';
export const LOCAL_ASSET_HANDLERS={
 async wh_local_asset_slots(args:ToolArgs){const scoped=await client(args,true);return{slots:await scoped.assets.list(),installation:await scoped.assets.installation.read(),...(args.choiceKind?{choices:await scoped.assets.choices(args.choiceKind as 'font'|'data')}: {})};},
 async wh_local_asset_resolve(args:ToolArgs){const scoped=await client(args,true),overrides=(args.overrides??(args.documentId?(await scoped.read()).data as {assetOverrides?:LocalAssetOverrides}:{}).assetOverrides??{}) as LocalAssetOverrides,asset=await scoped.assets.slot(requireString(args,'slot'),overrides);if(!asset)return{available:false};return{available:true,kind:asset.kind,mime:asset.mime,size:asset.blob.size,version:asset.version,origin:asset.origin,slot:asset.slot,ref:asset.ref,...(args.includeContent&&(asset.kind==='font'||asset.kind==='data')?{content:{base64:assetBase64(new Uint8Array(await asset.blob.arrayBuffer())),sha256:await assetFileHash(new Uint8Array(await asset.blob.arrayBuffer()))}}:{})};},
 async wh_local_asset_override(args:ToolArgs){
  const scoped=await client(args,false),slot=requireString(args,'slot'),version=requireString(args,'expectedVersion');
  if(args.file!==undefined&&args.ref!==undefined||args.importOnly&&!args.file)throw Error('local_asset_import_args_invalid');
  const file=args.file as {name:string;kind:'font'|'data';mime:string;base64:string}|undefined;
  let prepared:Awaited<ReturnType<typeof prepareBrowserAssetFile>>|undefined;
  if(file){if(typeof file.name!=='string'||typeof file.mime!=='string'||!['font','data'].includes(file.kind))throw Error('local_asset_import_args_invalid');prepared=await prepareBrowserAssetFile(new File([assetBytes(file.base64)],file.name,{type:file.mime}),file.kind,scoped.projectId);}
  // Preparation above may await decoding. Resolve a fresh lease and CAS inside the outer transaction.
  return db.transaction('rw',db.tables,async()=>{
   const fresh=await client(args,false),manifest=await fresh.assets.list(),key=assetSlot(manifest,slot);
   if(!key)throw Error('local_asset_slot_missing');
   const current=args.level==='document'?await fresh.read():undefined;
   if(args.level==='document'){if(!fresh.documentId||!fresh.state)throw Error('source_tool_document_required');if(current?.document?.version!==version)throw Error('local_asset_conflict');}
   else if((await fresh.assets.installation.read()).version!==version)throw Error('local_asset_conflict');
   if(prepared&&(manifest[key].replaceable===false||!assetAccepts(manifest[key],prepared.kind,prepared.mime)))throw Error('local_asset_replacement_invalid');
   const imported=prepared?assetFileInfo(await storeAssetFile(prepared)):undefined,ref=(imported?.ref??args.ref??null) as LocalAssetRef|null;
   const target=await fresh.assets.validate(slot,ref);
   if(args.importOnly)return{imported,applied:false};
   const result=args.level==='document'?await fresh.state!.apply(current!,[...target.aliases.map(key=>({type:'map-delete' as const,field:'assetOverrides',key})),ref?{type:'map-set' as const,field:'assetOverrides',key:target.slot,value:ref}:{type:'map-delete' as const,field:'assetOverrides',key:target.slot}]):await fresh.assets.installation.set(slot,ref,version);
   return imported?{...result,imported,applied:true}:result;
  });
 }
};
