import {decodeEraValue} from '@/services/worldEras/portability';
import {validateArchive} from '@/services/documentArchive/store';
import type {DocumentArchive} from '@/services/documentArchive/types';
import {remapSourceToolDocument} from './portability';
import type {SourceToolDocument} from './types';

/** The legacy project JSON extension is explicitly Source-only. Other archive
 * kinds continue using complete project Duplicate and ZIP. */
export function decodeSourceToolArchives(value:unknown,projectId:string):DocumentArchive[]{
 const rows=decodeEraValue(value??[]);if(!Array.isArray(rows))throw Error('source_tool_archives_invalid');
 const ids=new Set<string>();
 for(const row of rows){validateArchive(row,projectId);if(row.kind!=='local-tool'||!row.metadata||row.metadata.field!=='sourceToolDocuments'||ids.has(row.id))throw Error('source_tool_archive_invalid');ids.add(row.id);}
 return rows;
}
/** Use the import's existing shared identity map and semantic Source codec.
 * Archive records remain in Archive; no hidden document is inserted into Base. */
export function cloneSourceToolArchives(rows:DocumentArchive[],projectId:string,remap:(id:string,prefix:string)=>string,richProse:(html:string)=>string):DocumentArchive[]{
 return rows.map(row=>{const item=remapSourceToolDocument(row.metadata!.item as unknown as SourceToolDocument,remap,richProse);return {...structuredClone(row),id:remap(row.id,'archive'),projectId,sourceId:item.id,metadata:{...row.metadata!,item:item as unknown as Record<string,unknown>}};});
}
