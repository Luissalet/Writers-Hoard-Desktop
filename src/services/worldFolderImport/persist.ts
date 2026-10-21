import Dexie, { type Transaction } from 'dexie';
import { db } from '@/db';
import type { CodexEntry, Writing, Timeline, TimelineEvent } from '@/types';
import type { EraDocumentKind, WorldEraScope, EraRow } from '@/services/worldEras/types';
import { assertWorldEra, readWorldDocument, saveEraDocument, hideEraDocument, listWorldDocuments, announceEraChange } from '@/services/worldEras/store';
import { eraAdapters } from '@/services/worldEras/registry';
import { validateEraDocument } from '@/services/worldEras/adapters';
import { addTable } from '@/engines/tables/operations';
import { importLocalMedia } from '@/engines/media/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { countWords } from '@/utils/text';
import { sha256Hex } from '@/services/judge/text';
import { prepareWorldFolderImport, folderContextVersion } from './plan';
import type { WorldFolderInput, WorldFolderImportReceipt, WorldFolderImportReference } from './types';
import { validateWorldFolderImportsProject } from './portability';
import { remapLocalToolReferences } from '@/engines/local/stateCodec';
import type { SourceToolDocument } from '@/engines/local/documents/types';
import { findLocalToolBlocksInHtml } from '@/engines/local/blocks/types';
import { BridgeError } from '@/services/aiBridge/tools/bridgeError';

interface UndoReceipt { scope:WorldEraScope; batchId:string; versions:{ref:WorldFolderImportReference;version:string}[]; claimed?:Transaction }
const undoReceipts=new Map<string,UndoReceipt>();
function outermost(tx:Transaction):Transaction{while(tx.parent)tx=tx.parent;return tx;}
function committedNotification(scope:WorldEraScope):void{const notify=()=>Dexie.ignoreTransaction(()=>{announceEraChange(scope.projectId);notifyDataChanged({source:'import',projectId:scope.projectId});});const tx=Dexie.currentTransaction;if(tx)outermost(tx).on('complete',notify);else notify();}

export async function applyWorldFolderImport(scope:WorldEraScope,input:WorldFolderInput,expectedDigest:string){
  const {plan,sources}=await prepareWorldFolderImport(scope,input);
  if(plan.digest!==expectedDigest)throw Error('world_folder_plan_conflict');
  if(plan.findings.some(finding=>finding.blocking))throw Error('world_folder_plan_has_findings');
  const selected=plan.rows.filter(row=>row.status==='new'),media=plan.assets.filter(asset=>asset.kind==='media'&&asset.used&&asset.status==='new');
  if(!selected.length&&!media.length)return{created:[],receiptId:null,duplicates:plan.rows.filter(row=>row.status==='duplicate').length};
  const batchId=`world-folder-import:${crypto.randomUUID()}`,now=Date.now();
  const result=await db.transaction('rw',db.tables,async()=>{
    const project=await assertWorldEra(scope);
    if(await folderContextVersion(scope)!==plan.contextVersion)throw Error('world_folder_context_conflict');
    for(const kind of new Set([...selected.map(row=>row.target),...(media.length?['media']:[])]))if(!project.enabledEngines.includes(kind))throw new BridgeError('engine-disabled',`The ${kind} engine is disabled in this project.`);
    for(const row of selected)if(await readWorldDocument(scope,row.target,row.id))throw Error('world_folder_destination_conflict');
    for(const asset of plan.assets)if(asset.used&&asset.kind==='media'&&asset.status==='duplicate'&&(!asset.id||!await readWorldDocument(scope,'media',asset.id)))throw Error('world_folder_attachment_missing');
    const refs:WorldFolderImportReference[]=[],mediaIds=new Map<string,string>();
    for(const asset of media){
      const source=sources.find(source=>source.path===asset.path)!;
      const saved=await importLocalMedia(scope.projectId,new File([source.bytes],asset.path.split('/').at(-1)!,{type:asset.mime}),scope.eraId,{id:asset.id,notify:false});
      mediaIds.set(asset.id!,saved.id);refs.push({kind:'media',id:saved.id,path:asset.path});
    }
    let chapter=Math.max(0,...(await listWorldDocuments(scope,'writings')).map(read=>Number(read.document.root.chapter)||0));
    for(const row of selected){
      let content=row.content??'';
      if(mediaIds.size){const host=new DOMParser().parseFromString(content,'text/html');for(const block of host.querySelectorAll('[data-wh-media-block][data-asset-id]')){const id=mediaIds.get(block.getAttribute('data-asset-id')!);if(id)block.setAttribute('data-asset-id',id);}content=host.body.innerHTML;}
      if(row.target==='codex'){
        const entry:CodexEntry={id:row.id,projectId:scope.projectId,title:row.title,type:row.type??'custom',content,fields:row.fields??{},tags:row.tags??[],relations:[],createdAt:now,updatedAt:now,...(row.templateId?{templateId:row.templateId}:{}) ,...(row.propertyDefinitions?{propertyDefinitions:structuredClone(row.propertyDefinitions)}:{})};
        if(scope.eraId)await saveEraDocument(scope,'codex',{root:entry as unknown as EraRow,children:{}},null);else await db.codexEntries.add(entry);
      }else if(row.target==='writings'){
        const source=sources.find(source=>source.path===row.sourcePath)!;
        let stored=await db.manuscriptSources.where('[projectId+sha256]').equals([scope.projectId,source.sha256]).first();
        if(!stored){stored={id:crypto.randomUUID(),projectId:scope.projectId,sha256:source.sha256,name:source.path,format:source.path.split('.').at(-1)??'md',original:new Blob([source.bytes]),revision:0,receipts:[],createdAt:now};await db.manuscriptSources.add(stored);}
        const contentHash=await Dexie.waitFor(sha256Hex(content));
        const writing:Writing={id:row.id,projectId:scope.projectId,title:row.title,content,wordCount:countWords(content),chapter:++chapter,status:'draft',tags:row.tags??[],createdAt:now,updatedAt:now,manuscriptSource:{sourceId:stored.id,commitId:batchId,chapterKey:row.path,contentHash}};
        // Same normal atomic create path as manuscriptReview; no floating touchProject.
        if(scope.eraId)await saveEraDocument(scope,'writings',{root:writing as unknown as EraRow,children:{writingSnapshots:[]}},null);else await db.writings.add(writing);
        const old=stored.receipts.find(receipt=>receipt.id===batchId),receipts=stored.receipts.filter(receipt=>receipt.id!==batchId);
        receipts.push({id:batchId,eraId:scope.eraId,writingIds:[...old?.writingIds??[],writing.id],planDigest:plan.digest,createdAt:now});
        await db.manuscriptSources.put({...stored,revision:stored.revision+1,receipts});
      }else if(row.target==='tables'){
        if(!row.table)throw Error('world_folder_table_missing');await addTable(scope.projectId,row.table,scope.eraId);
      }else{
        const timeline:Timeline={id:row.id,projectId:scope.projectId,title:row.title,color:'#c4973b',createdAt:now,updatedAt:now};
        const events:TimelineEvent[]=(row.events??[]).map((event,index)=>({...event,projectId:scope.projectId,timelineId:row.id,eventType:event.realDateEnd?'range':'point',order:index,color:'#c4973b',createdAt:now,updatedAt:now}));
        const document={root:timeline as unknown as EraRow,children:{timelineEvents:events as unknown as EraRow[],timelineConnections:[]}};validateEraDocument(scope.projectId,'timeline',row.id,document);
        if(scope.eraId)await saveEraDocument(scope,'timeline',document,null);else{await db.timelines.add(timeline);if(events.length)await db.timelineEvents.bulkAdd(events);}
      }
      refs.push({kind:row.target,id:row.id,path:row.path});
    }
    const paths=new Set(selected.map(row=>row.sourcePath));for(const asset of plan.assets)if(asset.used)paths.add(asset.path);
    const receipt:WorldFolderImportReceipt={version:1,id:batchId,eraId:scope.eraId,format:input.format,files:plan.files.filter(file=>paths.has(file.path)),refs};
    const current=await db.projects.get(scope.projectId);if(!current)throw Error('world_folder_project_missing');
    const worldFolderImports=[...current.worldFolderImports??[],receipt];validateWorldFolderImportsProject({...current,worldFolderImports});
    await db.projects.update(scope.projectId,{worldFolderImports,updatedAt:Math.max(Date.now(),current.updatedAt+1)});
    const versions=[];for(const ref of refs){const read=await readWorldDocument(scope,ref.kind,ref.id);if(!read)throw Error('world_folder_created_missing');versions.push({ref,version:read.version});}
    return{refs,versions};
  });
  const receiptId=crypto.randomUUID();undoReceipts.set(receiptId,{scope:{...scope},batchId,versions:result.versions});
  const outer=Dexie.currentTransaction;if(outer)outermost(outer).on('abort',()=>undoReceipts.delete(receiptId));
  committedNotification(scope);
  return{created:result.refs,receiptId,batchId,undoPersistence:'session' as const};
}

function referencesCreated(value:unknown,ids:Set<string>,projectId:string,key='',targetEra?:string,referenceEra?:string,visible=ids):boolean{
  if(Array.isArray(value))return value.some(item=>referencesCreated(item,ids,projectId,key,targetEra,referenceEra,visible));
  if(value&&typeof value==='object')return Object.entries(value).some(([field,child])=>referencesCreated(child,ids,projectId,field,targetEra,referenceEra,visible));
  if(typeof value!=='string')return false;
  if(/^(?:entryId|entityId|assetId|linkedEntryId|linkedEntryIds|sourceEntityId|targetEntityId|referenceId|targetId)$/.test(key)&&visible.has(value))return true;
  if(!/^(?:content|description|notes|body|richContent|html)$/.test(key)||!/[<>]/.test(value))return false;
  for(const span of findLocalToolBlocksInHtml(value))if(span.projectId===projectId&&span.envelope.scope==='host'){let linked=false;remapLocalToolReferences(span.envelope.data,span.envelope.codec,(_kind,id)=>{if(visible.has(id))linked=true;return id;});if(linked)return true;}
  const host=new DOMParser().parseFromString(value,'text/html');
  for(const block of host.querySelectorAll('[data-entry-id],[data-asset-id],[data-entity-id],[data-document-id]'))if(block.getAttribute('data-project-id')===projectId&&['data-entry-id','data-asset-id','data-entity-id','data-document-id'].some(attr=>visible.has(block.getAttribute(attr)??'')))return true;
  for(const anchor of host.querySelectorAll('a[href]'))try{const url=new URL(anchor.getAttribute('href')!,'https://writer.invalid'),era=url.searchParams.has('era')?url.searchParams.get('era')||undefined:referenceEra;if(targetEra&&targetEra!==era)continue;if(url.origin==='https://writer.invalid'&&url.pathname.startsWith(`/project/${encodeURIComponent(projectId)}/`)&&['entry','entity','writing'].some(key=>ids.has(url.searchParams.get(key)??'')))return true;}catch{/* unrelated href */}
  return false;
}
export async function undoWorldFolderImport(scope:WorldEraScope,receiptId:string){
  const receipt=undoReceipts.get(receiptId);if(!receipt||receipt.scope.projectId!==scope.projectId||receipt.scope.eraId!==scope.eraId)throw Error('world_folder_receipt_missing');
  await db.transaction('rw',db.tables,async tx=>{
    const project=await assertWorldEra(scope);if(receipt.claimed||undoReceipts.get(receiptId)!==receipt)throw Error('world_folder_receipt_missing');
    const outer=outermost(tx);receipt.claimed=outer;outer.on('complete',()=>undoReceipts.delete(receiptId));outer.on('abort',()=>{if(undoReceipts.get(receiptId)===receipt)receipt.claimed=undefined;});
    for(const saved of receipt.versions){const current=await readWorldDocument(scope,saved.ref.kind,saved.ref.id);if(!current||current.version!==saved.version)throw Error('world_folder_undo_conflict');}
    const ids=new Set(receipt.versions.map(saved=>saved.ref.id));
    const variants=await db.worldEraVariants.where('projectId').equals(scope.projectId).toArray();
    if(!scope.eraId&&variants.some(variant=>variant.eraId!==scope.eraId&&ids.has(variant.entityId)&&!variant.hidden))throw Error('world_folder_undo_derived');
    const scopes:WorldEraScope[]=[{projectId:scope.projectId},...(project.worldEras??[]).map(era=>({projectId:scope.projectId,eraId:era.id}))];
    for(const referenceScope of scopes){
      const visible=new Set<string>();for(const saved of receipt.versions)if(await readWorldDocument(referenceScope,saved.ref.kind,saved.ref.id))visible.add(saved.ref.id);
      for(const kind of Object.keys(eraAdapters) as EraDocumentKind[]){
      for(const read of await listWorldDocuments(referenceScope,kind))if(!ids.has(read.document.root.id)){
        if(kind==='local-tool'){const source=read.document.root as unknown as SourceToolDocument;let linked=false;if(source.codec)remapLocalToolReferences(source.data,source.codec,(_kind,id)=>{if(visible.has(id))linked=true;return id;});if(linked)throw Error('world_folder_undo_referenced');continue;}
        if(referencesCreated(read.document,ids,scope.projectId,'',scope.eraId,referenceScope.eraId,visible))throw Error('world_folder_undo_referenced');
        if(kind==='tables'){const table=read.document.root as unknown as import('@/engines/tables/types').WorldTable;if(table.columns.some(column=>column.kind==='reference'&&table.rows.some(row=>visible.has(row.cells[column.id]))))throw Error('world_folder_undo_referenced');}
      }
    }}
    const annotations=await db.annotations.where('projectId').equals(scope.projectId).toArray();
    if(annotations.some(row=>(!scope.eraId||row.eraId===scope.eraId)&&ids.has(row.sourceEntityId)))throw Error('world_folder_undo_referenced');
    const annotationIds=annotations.filter(row=>!scope.eraId||row.eraId===scope.eraId).map(row=>row.id);
    if(annotationIds.length&&(await db.annotationReferences.where('annotationId').anyOf(annotationIds).toArray()).some(row=>referencesCreated(row,ids,scope.projectId)))throw Error('world_folder_undo_referenced');
    for(const saved of receipt.versions){
      const ref=saved.ref;if(scope.eraId){await hideEraDocument(scope,ref.kind,ref.id,saved.version);continue;}
      const adapter=eraAdapters[ref.kind];if(ref.kind==='tables'){const current=await db.projects.get(scope.projectId);await db.projects.update(scope.projectId,{dataTables:(current?.dataTables??[]).filter(row=>row.id!==ref.id)});}
      else{for(const [table,parent] of Object.entries(adapter.children??{}))await db.table(table).where(parent).equals(ref.id).delete();await db.table(adapter.table!).delete(ref.id);}
    }
    // Immutable manuscript originals/receipts also back retained document history.
    // Their normal lifecycle ends at project deletion, not session batch Undo.
    await db.projects.update(scope.projectId,{worldFolderImports:(project.worldFolderImports??[]).filter(item=>item.id!==receipt.batchId),updatedAt:Math.max(Date.now(),project.updatedAt+1)});
  });
  committedNotification(scope);return{removed:receipt.versions.map(saved=>saved.ref)};
}
