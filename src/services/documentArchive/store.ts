import Dexie, { type Transaction } from 'dexie';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { validateDocumentRestoreRows } from '@/engines/_shared/backupScope';
import type { ArchiveMutation, ArchivedDocumentKind, DocumentArchive } from './types';
import { metadataFields, restoreArchivedMetadata, validateArchivedMetadata } from './metadata';
import {renewToolDockGeneration,type ToolDockLayout} from '@/engines/writings/toolDock/types';

type Row = Record<string, unknown>;
export const archiveRootTable: Record<ArchivedDocumentKind, string> = { 'local-tool':'projects',codex:'codexEntries',maps:'worldMaps',board:'boards',timeline:'timelines',writings:'writings',dictionary:'projects',tables:'projects','relation-tree':'projects','model-viewer':'projects','character-sheets':'projects',radar:'projects' };
const allowedTables = new Set(['codexEntries','relationships','characterArcs','sceneCasts','dialogBlocks','mapPins','worldMaps','inspirationImages','localMediaAssets','timelineEvents','annotations','annotationReferences','writings','writingSnapshots','outlineBeats','boards','boardNodes','boardEdges','boardLayers','boardViews','timelines','timelineConnections']);
const normalize = (value: unknown): unknown => value instanceof Blob ? { blobType:value.type,blobSize:value.size } : Array.isArray(value) ? value.map(normalize) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).filter(([,v])=>v!==undefined).map(([k,v])=>[k,normalize(v)])) : value;
export const archiveValuesEqual = (left: unknown, right: unknown) => JSON.stringify(normalize(left))===JSON.stringify(normalize(right));
interface Capture { rows: Map<string,{table:string;key:string;before?:Row}> }
const captures = new WeakMap<Transaction,Capture>();
let installed=false;
function captureFor(transaction: Transaction): Capture | undefined { for(let current:Transaction|undefined=transaction;current;current=current.parent) { const capture=captures.get(current); if(capture)return capture; } return undefined; }
function installCaptureHooks() {
  if(installed)return; installed=true;
  for(const table of db.tables) {
    if(!allowedTables.has(table.name))continue;
    const remember=(key:unknown,before:Row|undefined,transaction:Transaction)=>{
      const capture=captureFor(transaction); if(!capture)return;
      if(typeof key!=='string'||!key)throw new Error('Unsupported archive key');
      const token=`${table.name}:${key}`;
      if(!capture.rows.has(token))capture.rows.set(token,{table:table.name,key,before:before&&structuredClone(before)});
      if(capture.rows.size>20000)throw new Error('Archive exceeds document row capacity');
    };
    table.hook('deleting',(key,row,transaction)=>remember(key,row,transaction));
    table.hook('updating',(_changes,key,row,transaction)=>remember(key,row,transaction));
    table.hook('creating',(key,row,transaction)=>remember(key??row.id,undefined,transaction));
  }
}
function mutation(table:string,key:string,before:Row|undefined,after:Row|undefined):ArchiveMutation|null {
  if(archiveValuesEqual(before,after))return null;
  if(!before||!after)return {table,key,beforeRow:before,afterRow:after};
  const fields=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>key!=='updatedAt'&&!archiveValuesEqual(before[key],after[key]));
  return fields.length?{table,key,fields,beforeValues:Object.fromEntries(fields.map(field=>[field,before[field]])),afterValues:Object.fromEntries(fields.map(field=>[field,after[field]]))}:null;
}

/** Existing delete policies run unchanged; every touched row is captured in their transaction. */
export async function archiveWithMutation<T>(kind:ArchivedDocumentKind,id:string,remove:()=>Promise<T>):Promise<T> {
  if(Dexie.currentTransaction && captureFor(Dexie.currentTransaction))return remove();
  installCaptureHooks();
  let projectId='';
  const result=await db.transaction('rw',db.tables,async transaction=>{
    const root=await db.table(archiveRootTable[kind]).get(id) as Row|undefined;
    if(!root)return remove();
    if(typeof root.projectId!=='string')throw new Error('Document has no project');
    projectId=root.projectId;
    // Existing maintenance/tests can clean orphan rows after their project is gone.
    // Such rows have no accessible project archive and retain the cleanup path.
    if(!await db.projects.get(projectId))return remove();
    const capture:Capture={rows:new Map()};captures.set(transaction,capture);
    try {
      const value=await remove();
      const beforeRows=[...capture.rows.values()].flatMap(row=>row.before?[{table:row.table,record:row.before}]:[]);
      await validateDocumentRestoreRows(projectId,beforeRows,false);
      const mutations:ArchiveMutation[]=[];
      for(const row of capture.rows.values()) { const next=mutation(row.table,row.key,row.before,await db.table(row.table).get(row.key));if(next)mutations.push(next); }
      if(!mutations.length)return value;
      const archive:DocumentArchive={id:generateId('archive'),projectId,kind,sourceId:id,title:String(root.title??root.name??id),archivedAt:Date.now(),schema:1,mutations};
      // Limits keep a pathological document from freezing recovery or ZIP parsing.
      validateArchive(archive,projectId);
      await db.documentArchives.add(archive);
      return value;
    } finally {captures.delete(transaction);}
  });
  if(projectId)notifyDataChanged({source:'other',projectId});
  return result;
}

export class ArchiveRestoreConflict extends Error { constructor(message='The document or one of its links changed after archiving. No changes were restored.') {super(message);this.name='ArchiveRestoreConflict';} }
export async function restoreArchivedDocument(projectId:string,id:string):Promise<void> {
  let sourceDocument=false;
  await db.transaction('rw',db.tables,async()=>{
    const archive=await db.documentArchives.get(id);
    if(!archive||archive.projectId!==projectId||!await db.projects.get(projectId))throw new ArchiveRestoreConflict('Archive not in this project.');
    validateArchive(archive,projectId);
    if(archive.metadata) {
      sourceDocument=archive.kind==='local-tool';
      try {await restoreArchivedMetadata(archive);}catch(error){throw new ArchiveRestoreConflict(error instanceof Error?error.message:String(error));}
      await db.documentArchives.delete(id);return;
    }
    const planned:Array<{table:string;record:Row}>=[];
    for(const patch of archive.mutations) {
      const current=await db.table(patch.table).get(patch.key) as Row|undefined;
      if(patch.fields) {
        if(!current||!patch.fields.every(field=>archiveValuesEqual(current[field],patch.afterValues?.[field])))throw new ArchiveRestoreConflict();
        const restored={...current};
        for(const field of patch.fields) {const value=patch.beforeValues?.[field];if(value===undefined)delete restored[field];else restored[field]=value;}
        if(typeof restored.updatedAt==='number')restored.updatedAt=Math.max(Date.now(),restored.updatedAt+1);
        planned.push({table:patch.table,record:restored});
      } else {
        if(!archiveValuesEqual(current,patch.afterRow))throw new ArchiveRestoreConflict('A document ID is already occupied. No changes were restored.');
        if(patch.beforeRow)planned.push({table:patch.table,record:patch.beforeRow});
      }
    }
    for(const item of planned)if(item.table==='writings'&&item.record.toolDock)item.record={...item.record,toolDock:renewToolDockGeneration(item.record.toolDock as ToolDockLayout,crypto.randomUUID())};
    try {await validateDocumentRestoreRows(projectId,planned);}catch(error){throw new ArchiveRestoreConflict(error instanceof Error?error.message:String(error));}
    const plannedByKey=new Map(planned.map(item=>[`${item.table}:${item.record.id}`,item.record]));
    for(const patch of archive.mutations) {
      const row=plannedByKey.get(`${patch.table}:${patch.key}`);
      if(row)await db.table(patch.table).put(row);else await db.table(patch.table).delete(patch.key);
    }
    await db.documentArchives.delete(id);
  });
  if(sourceDocument&&Dexie.currentTransaction){let outer=Dexie.currentTransaction;while(outer.parent)outer=outer.parent;outer.on('complete',()=>Dexie.ignoreTransaction(()=>notifyDataChanged({source:'undo',projectId})));}else notifyDataChanged({source:'undo',projectId});
}
export async function forgetArchivedDocument(projectId:string,id:string) { await db.transaction('rw',db.documentArchives,async()=>{const row=await db.documentArchives.get(id);if(!row||row.projectId!==projectId)throw new Error('Archive not in this project');await db.documentArchives.delete(id);}); }

/** Untrusted ZIP payload must never become a generic database write capability. */
export function validateArchive(value:unknown,projectId:string):asserts value is DocumentArchive {
  if(!value||typeof value!=='object')throw new Error('Invalid archive');
  const row=value as DocumentArchive;
  if(row.schema!==1||row.projectId!==projectId||typeof row.id!=='string'||!row.id||typeof row.sourceId!=='string'||typeof row.title!=='string'||!Number.isSafeInteger(row.archivedAt)||row.archivedAt<0||!Object.hasOwn(archiveRootTable,row.kind)||!Array.isArray(row.mutations)||row.mutations.length>20000||JSON.stringify(row).length>100*1024*1024)throw new Error('Invalid archive document');
  if(row.metadata) {
    if(row.mutations.length||metadataFields[row.kind]!==row.metadata.field||row.metadata.item?.id!==row.sourceId||!Number.isSafeInteger(row.metadata.index)||row.metadata.index<0)throw new Error('Invalid metadata archive scope');
    validateArchivedMetadata(row.kind,row.metadata.item);return;
  }
  if(!row.mutations.length)throw new Error('Empty archive');
  const tokens=new Set<string>();
  for(const patch of row.mutations) {
    if(!patch||!allowedTables.has(patch.table)||typeof patch.key!=='string'||!patch.key||tokens.has(`${patch.table}:${patch.key}`))throw new Error('Invalid archive mutation');
    tokens.add(`${patch.table}:${patch.key}`);
    if(patch.fields) {
      if(!Array.isArray(patch.fields)||!patch.fields.length||patch.fields.length>1000||patch.fields.some(field=>typeof field!=='string'||['id','projectId','__proto__','constructor','prototype'].includes(field)||field.includes('.'))||!patch.beforeValues||Array.isArray(patch.beforeValues)||!patch.afterValues||Array.isArray(patch.afterValues)||patch.beforeRow||patch.afterRow)throw new Error('Invalid archive fields');
      if(patch.table==='localMediaAssets'&&patch.fields.some(field=>field!=='linkedEntryIds'))throw new Error('Invalid media archive patch');
    } else {
      if(patch.table==='localMediaAssets')throw new Error('Media bytes cannot be embedded in a document archive');
      for(const record of [patch.beforeRow,patch.afterRow])if(record&&(!record||typeof record!=='object'||Array.isArray(record)||record.id!==patch.key||('projectId'in record&&record.projectId!==projectId)))throw new Error('Invalid archive row scope');
    }
  }
  if(!row.mutations.some(patch=>patch.table===archiveRootTable[row.kind]&&patch.key===row.sourceId&&patch.beforeRow&&!patch.afterRow))throw new Error('Archive root missing');
}
