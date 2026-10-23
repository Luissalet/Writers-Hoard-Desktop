import {structuralManuscriptOwners} from '@/engines/writings/manuscripts';
import {findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import { applyEraReaderCover } from '@/engines/writings/coverDesign/model';
import type {Transaction} from 'dexie';
import {db} from '@/db';
import type {Project,Writing} from '@/types';
import type {WritingSnapshot} from '@/engines/writings/snapshotTypes';
import {eraAdapters,eraDocumentVersion} from '@/services/worldEras/adapters';
import {eraDocumentAssetId,resolveEraDocumentAssetPayload} from '@/services/worldEras/assets';
import {eraDocumentKinds,type EraDocument,type EraRow,type WorldEraAsset,type WorldEraScope,type WorldEraVariant} from '@/services/worldEras/types';
import {MAX_PARENT_HOPS,resolveCapturedWorldCalendar} from '@/engines/timeline/worldCalendarStore';
import type {ReaderSource,ReaderSourceRows} from '@/engines/writings/readerSource';

export interface PublicationSnapshot{project:Project;parents:Project[];tables:Record<string,EraRow[]>;variants:WorldEraVariant[];assets:WorldEraAsset[];eraId?:string;writingOwners?:Record<string,string>}
/** Only IndexedDB requests here. Every table is bound to the explicit transaction. */
export async function capturePublicationSources(tx:Transaction,scope:WorldEraScope):Promise<PublicationSnapshot>{
 const project=await tx.table('projects').get(scope.projectId)as Project|undefined;if(!project)throw Error('project_missing');if(scope.eraId&&!project.worldEras?.some(era=>era.id===scope.eraId))throw Error('world_era_missing');
 const tables:Record<string,EraRow[]>={},roots=Object.values(eraAdapters).filter(adapter=>adapter.table);
 await Promise.all(roots.map(async adapter=>{tables[adapter.table!]=await tx.table(adapter.table!).where('projectId').equals(scope.projectId).toArray();}));
 const imageIds=new Set<string>();const images=(value:unknown):void=>{if(!value||typeof value!=='object'||value instanceof Blob)return;if(Array.isArray(value)){value.forEach(images);return;}const row=value as Record<string,unknown>;if(row.kind==='image'&&typeof row.id==='string')imageIds.add(row.id);for(const child of Object.values(row)){if(typeof child==='string'&&child.includes('data-wh-source-block')){for(const figure of child.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi)){try{for(const span of findLocalToolBlocksInHtml(figure[0]))if(span.projectId===scope.projectId&&span.envelope.scope==='host')images(span.envelope.data);}catch{/* Imported invalid atoms stay unavailable without hiding valid neighbours. */}}}else images(child);}};images(project);
 tables.writingSnapshots=await tx.table('writingSnapshots').where('projectId').equals(scope.projectId).filter(row=>row.kind==='parallel-draft').toArray();
 await Promise.all(roots.flatMap(adapter=>Object.entries(adapter.children??{}).filter(([table])=>table!=='writingSnapshots').map(async([table,parent])=>{const ids=tables[adapter.table!].map(row=>row.id);tables[table]=ids.length?await tx.table(table).where(parent).anyOf(ids).toArray():[];})));
 const variants:WorldEraVariant[]=scope.eraId?await tx.table('worldEraVariants').where('[projectId+eraId]').equals([scope.projectId,scope.eraId]).toArray():[];
 // Structural membership spans every era and archived origin, independently
 // of the active era's visible content. Retain only the derived identity map.
 const [writingVariants,writingArchives]=await Promise.all([
  tx.table('worldEraVariants').where('projectId').equals(scope.projectId).filter(row=>row.kind==='writings').toArray(),
  tx.table('documentArchives').where('projectId').equals(scope.projectId).filter(row=>row.kind==='writings').toArray(),
 ]);
 const writingOwners=Object.fromEntries(structuralManuscriptOwners(tables.writings??[],writingVariants,writingArchives));
 Object.values(tables).forEach(images);images(variants);tables.inspirationImages=imageIds.size?await tx.table('inspirationImages').where('id').anyOf([...imageIds]).filter(row=>row.projectId===scope.projectId).toArray():[];
 const assetIds=[...new Set(variants.flatMap(variant=>{const id=variant.document&&eraDocumentAssetId(variant.document);return id?[id]:[];}))],assets=(assetIds.length?await tx.table('worldEraAssets').bulkGet(assetIds):[]).filter((asset):asset is WorldEraAsset=>!!asset);
 const parents:Project[]=[],seen=new Set([project.id]);let id=project.parentId;
 while(id&&parents.length<MAX_PARENT_HOPS&&!seen.has(id)){seen.add(id);const parent=await tx.table('projects').get(id)as Project|undefined;if(!parent)break;parents.push(parent);if(parent.worldCalendar)break;id=parent.parentId;}
 return{project,parents,tables,variants,assets,eraId:scope.eraId,writingOwners};
}
export function capturePublicationSnapshot(scope:WorldEraScope){return db.transaction('r',db.tables,tx=>capturePublicationSources(tx,scope));}
/** Normal era adapter/asset vocabulary, resolved from captured payloads rather than a live query. */
export function publicationReaderSource(snapshot:PublicationSnapshot):ReaderSource&{writings:Writing[];parallelDrafts:WritingSnapshot[];hasDocument:(kind:typeof eraDocumentKinds[number],id:string)=>boolean}{
 const raw=snapshot.project,era=raw.worldEras?.find(era=>era.id===snapshot.eraId),project=applyEraReaderCover({...structuredClone(raw),...Object.fromEntries(Object.entries(era?.defaults??{}).filter(([,value])=>value!==undefined))},era),tables:Record<string,EraRow[]>={},assets=new Map(snapshot.assets.map(asset=>[asset.id,asset])),available=new Map<string,Set<string>>(),capturedDocuments=new Map<string,EraDocument[]>();
 for(const kind of eraDocumentKinds){
  const adapter=eraAdapters[kind],roots=adapter.table?snapshot.tables[adapter.table]??[]:(raw[adapter.metadata!]??[])as unknown as EraRow[],documents=new Map<string,EraDocument>(roots.map(root=>[root.id,{root,children:Object.fromEntries(Object.entries(adapter.children??{}).map(([table,parent])=>[table,(snapshot.tables[table]??[]).filter(row=>row[parent]===root.id)]))}]));
  for(const variant of snapshot.variants.filter(row=>row.kind===kind)){if(variant.archived)continue;if(variant.hidden)documents.delete(variant.entityId);else if(variant.document){const id=eraDocumentAssetId(variant.document);documents.set(variant.entityId,resolveEraDocumentAssetPayload(raw.id,structuredClone(variant.document),id?assets.get(id):undefined));}}
  if(kind==='writings'){
   const owners=snapshot.writingOwners??Object.fromEntries(structuralManuscriptOwners(snapshot.tables.writings??[],snapshot.variants));
   for(const [id,document] of documents){const owner=owners[id];if(owner&&owner!=='main')documents.set(id,{...document,root:{...document.root,manuscriptId:owner}});}
  }
  if(adapter.metadata)Object.assign(project,{[adapter.metadata]:[...documents.values()].map(document=>document.root)});
  available.set(kind,new Set(documents.keys()));
  capturedDocuments.set(kind,structuredClone([...documents.values()]));
  if(adapter.table){tables[adapter.table]=[...documents.values()].map(document=>document.root);for(const table of Object.keys(adapter.children??{}))tables[table]=[...documents.values()].flatMap(document=>document.children[table]??[]);}
 }
 const projects=new Map([[project.id,project],...snapshot.parents.map(parent=>[parent.id,parent]as const)]);
 return{project,capturedImages:()=>structuredClone(snapshot.tables.inspirationImages??[]) as unknown as import('@/types').InspirationImage[],writings:tables.writings as unknown as Writing[],parallelDrafts:(tables.writingSnapshots??[])as unknown as WritingSnapshot[],hasDocument:(kind,id)=>available.get(kind)?.has(id)??false,documents:kind=>structuredClone(capturedDocuments.get(kind)??[]),rows<K extends keyof ReaderSourceRows>(table:K):ReaderSourceRows[K][]{if(!Object.hasOwn(tables,table))throw Error('reader_snapshot_table_missing');return structuredClone(tables[table])as unknown as ReaderSourceRows[K][];},calendar:timelineId=>resolveCapturedWorldCalendar(project.id,timelineId,projects,tables.timelines as unknown as ReaderSourceRows['timelines'][])};
}
export async function publicationSourceFingerprint(snapshot:PublicationSnapshot):Promise<string>{
 const project={...snapshot.project};delete project.publishedEditions;delete project.publishedEditionRevision;
 const parents=snapshot.parents.map(parent=>{const row={...parent};delete row.publishedEditions;delete row.publishedEditionRevision;return row;});
 return(await eraDocumentVersion({root:project as unknown as EraRow,children:{...snapshot.tables,_parents:parents as unknown as EraRow[],_writingOwners:Object.entries(snapshot.writingOwners??{}).map(([id,manuscriptId])=>({id,manuscriptId})),_variants:snapshot.variants.map(variant=>({...variant,history:undefined}))as unknown as EraRow[],_assets:snapshot.assets as unknown as EraRow[]}})).slice('sha256:'.length);
}
