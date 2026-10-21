import {validateSourceToolDocument} from '@/engines/local/documents/types';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { parseDictionaryImport } from '@/engines/dictionary/types';
import { validateRelationTree, type RelationTreeDocument } from '@/engines/genealogy/relationTrees';
import { validateSheet, type CharacterSheet } from '@/engines/character-sheets/types';
import { assetBytes, modelStoredBytes, MAX_PROJECT_MODEL_BYTES, type ModelAsset } from '@/engines/model-viewer/model';
import { validateCell, type WorldTable } from '@/engines/tables/types';
import type { ArchivedDocumentKind, DocumentArchive } from './types';
import { validateRadarChart } from '@/engines/radar/model';

export const metadataFields:Partial<Record<ArchivedDocumentKind,string>>={'local-tool':'sourceToolDocuments',dictionary:'dictionaries',tables:'dataTables','relation-tree':'relationTrees','model-viewer':'modelAssets','character-sheets':'characterSheets',radar:'radarCharts'};
type Row=Record<string,unknown>;
export function validateArchivedMetadata(kind:ArchivedDocumentKind,item:Row):string[] {
  if(typeof item.id!=='string'||!item.id)throw new Error('Invalid metadata ID');
  const refs:string[]=[];
  if(kind==='local-tool'){validateSourceToolDocument(item);}
  else if(kind==='dictionary') {
    parseDictionaryImport(JSON.stringify({format:'writers-dictionary-v1',dictionary:item}));
    const words=item.words as Array<{id:string;linkedEntryId?:string}>;
    if(words.some(word=>typeof word.id!=='string')||new Set(words.map(word=>word.id)).size!==words.length)throw new Error('Invalid word IDs');
    refs.push(...words.flatMap(word=>word.linkedEntryId?[word.linkedEntryId]:[]));
  } else if(kind==='relation-tree') {validateRelationTree(item as unknown as RelationTreeDocument);refs.push(...(item as unknown as RelationTreeDocument).nodes.flatMap(node=>node.codexEntryId?[node.codexEntryId]:[]));}
  else if(kind==='character-sheets') {validateSheet(item as unknown as CharacterSheet);if(item.linkedEntryId)refs.push(String(item.linkedEntryId));}
  else if(kind==='radar') {validateRadarChart(item);refs.push(...(item.series as Array<{linkedEntryId?:string}>).flatMap(series=>series.linkedEntryId?[series.linkedEntryId]:[]));}
  else if(kind==='model-viewer') {const bytes=assetBytes(item as unknown as ModelAsset);if(item.size!==bytes.byteLength||typeof item.name!=='string')throw new Error('Invalid model metadata');}
  else if(kind==='tables') {
    const table=item as unknown as WorldTable;
    if(!table.title?.trim()||!['table','sheet'].includes(table.mode)||!Array.isArray(table.columns)||!Array.isArray(table.rows)||table.columns.length>100||table.rows.length>20000||new Set(table.columns.map(column=>column.id)).size!==table.columns.length||new Set(table.rows.map(row=>row.id)).size!==table.rows.length)throw new Error('Invalid table');
    if(table.columns.some(column=>typeof column.id!=='string'||!column.id||typeof column.name!=='string'||!['text','number','reference','checkbox'].includes(column.kind)||(column.field!==undefined&&(typeof column.field!=='string'||['__proto__','constructor','prototype'].includes(column.field.toLowerCase()))))||table.rows.some(row=>typeof row.id!=='string'||!row.id||!row.cells||typeof row.cells!=='object'||Array.isArray(row.cells)))throw new Error('Invalid table structure');
    for(const row of table.rows)for(const column of table.columns) {const value=row.cells?.[column.id]??'';if(typeof value!=='string'||value.length>50000||(table.mode!=='sheet'&&!validateCell(column,value)))throw new Error('Invalid table cell');if(table.mode!=='sheet'&&column.kind==='reference'&&value)refs.push(value);}
  } else throw new Error('Unsupported metadata document');
  return refs;
}
export async function archiveMetadataWithMutation<T>(kind:ArchivedDocumentKind,projectId:string,id:string,remove:()=>Promise<T>):Promise<T> {
  const field=metadataFields[kind];if(!field)throw new Error('Unsupported metadata document');
  const result=await db.transaction('rw',db.tables,async()=>{
    const project=await db.projects.get(projectId);if(!project)throw new Error('Project not found');
    const rows=(project as unknown as Row)[field] as Row[]|undefined;
    const index=rows?.findIndex(row=>row.id===id)??-1;if(index<0)return remove();
    const item=structuredClone(rows![index]);const value=await remove();
    const after=await db.projects.get(projectId);
    if(((after as unknown as Row)[field] as Row[]).some(row=>row.id===id))throw new Error('Document was not removed');
    const archive:DocumentArchive={schema:1,id:generateId('archive'),projectId,sourceId:id,kind,title:String(item.title??item.name??id),archivedAt:Date.now(),mutations:[],metadata:{field,item,index}};
    if(JSON.stringify(archive).length>100*1024*1024)throw new Error('Archive exceeds document capacity');
    await db.documentArchives.add(archive);return value;
  });
  if(kind!=='local-tool')notifyDataChanged({source:'other',projectId});return result;
}
export async function restoreArchivedMetadata(archive:DocumentArchive):Promise<void> {
  const {projectId,kind,metadata}=archive;
  if(!metadata||metadataFields[kind]!==metadata.field)throw new Error('Invalid metadata archive');
  const project=await db.projects.get(projectId);if(!project)throw new Error('Project not found');
  const refs=validateArchivedMetadata(kind,metadata.item);
  for(const id of refs)if((await db.codexEntries.get(id))?.projectId!==projectId)throw new Error('Restore dependency unavailable');
  const rows=structuredClone(((project as unknown as Row)[metadata.field] as Row[]|undefined)??[]);
  if(rows.some(row=>row.id===metadata.item.id))throw new Error('Document ID already occupied');
  if(kind==='model-viewer'&&rows.reduce((sum,row)=>sum+modelStoredBytes(row as unknown as ModelAsset),modelStoredBytes(metadata.item as unknown as ModelAsset))>MAX_PROJECT_MODEL_BYTES)throw new Error('Model capacity exceeded');
  const restored=kind==='local-tool'?{...metadata.item,generation:crypto.randomUUID(),revision:Number(metadata.item.revision)+1,updatedAt:Math.max(Date.now(),Number(metadata.item.updatedAt)+1)}:metadata.item;rows.splice(Math.min(metadata.index,rows.length),0,restored);
  await db.projects.update(projectId,current=>{Object.assign(current,{[metadata.field]:rows,updatedAt:Math.max(Date.now(),current.updatedAt+1)});});
}
