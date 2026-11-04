import type {Project} from '@/types';
import type {DocumentArchive} from '@/services/documentArchive/types';
import type {DocumentHistoryEntry} from '@/services/documentHistory/types';
import type {WorldEraVariant} from '@/services/worldEras/types';
import type {LocalAssetFile} from '../assetFileFormat';
import {isRichImageEngine,validateRichImageAsset,type RichImageAsset} from '../convergence/imageFormat';
import {collectLocalToolCheckpointImages} from '../convergence/replica';
import type {RichBlockDocument} from '../convergence/blockTypes';
import {localToolRichImageRaster,localToolRichImages} from '../stateCodecFormat';
import {SOURCE_TOOL_DOCUMENTS_KEY,SOURCE_TOOL_DOCUMENT_KIND,type SourceToolDocument} from './types';

/** All representations that can be opened or restored from a project ZIP. */
export function validateSourceImageArchive(project:Pick<Project,'id'|'sourceToolDocuments'>,files:readonly LocalAssetFile[],variants:readonly WorldEraVariant[],history:readonly DocumentHistoryEntry[],archives:readonly DocumentArchive[]){
 const key=({sha256,mime,size}:{sha256:string;mime:string;size:number})=>`${sha256}:${mime}:${size}`;
 const available=new Set(files.filter(file=>file.projectId===project.id&&file.kind==='image'&&file.blob.type===file.mime&&file.blob.size===file.size).map(key));
 const checked=new Set<string>();
 const requireFile=(asset:RichImageAsset)=>{if(!available.has(key(asset)))throw Error('local_asset_image_archive_missing');};
 const check=(candidate:unknown)=>{
  if(!candidate)return;const row=candidate as SourceToolDocument;
  if(!row.codec||!row.data||typeof row.data!=='object'||Array.isArray(row.data))return;
  for(const [field,descriptor] of Object.entries(row.codec.fields))if(localToolRichImages(descriptor)){
   const value=row.data[field] as unknown as RichBlockDocument|undefined;
   for(const block of value?.blocks??[])if(block.type==='image'){const asset=block.attrs.asset;validateRichImageAsset(asset,localToolRichImageRaster(descriptor));requireFile(asset);}
  }
  const checkpoint=row.convergence?.checkpoint;
  if(checkpoint&&isRichImageEngine(checkpoint.engine.version)&&!checked.has(checkpoint.checkpointBase64)){
   for(const asset of collectLocalToolCheckpointImages(checkpoint,row.codec))requireFile(asset);
   checked.add(checkpoint.checkpointBase64);
  }
 };
 for(const document of project.sourceToolDocuments??[])check(document);
 for(const variant of variants)if(variant.projectId===project.id&&variant.kind===SOURCE_TOOL_DOCUMENT_KIND){check(variant.document?.root);for(const previous of variant.history??[])check(previous.document?.root);}
 for(const version of history)if(version.projectId===project.id&&version.kind===SOURCE_TOOL_DOCUMENT_KIND)check(version.document.root);
 for(const archive of archives)if(archive.projectId===project.id&&archive.kind===SOURCE_TOOL_DOCUMENT_KIND&&archive.metadata?.field===SOURCE_TOOL_DOCUMENTS_KEY)check(archive.metadata.item);
}
