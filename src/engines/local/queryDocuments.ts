import {getEraProject} from '@/services/worldEras/store';
import type {WorldEraScope} from '@/services/worldEras/types';
import {resolveProjectLocalTool} from './releases';
import {readSourceToolDocument} from './documents/store';
import {evaluateLocalToolIndex,queryLocalToolIndexRows,validateLocalToolDocumentQuery,type LocalToolDocumentQuery,type LocalToolIndexRow} from './documentIndex';
/** Compute from effective authored roots, never a second cache that imports can leave stale. */
export async function queryLocalToolDocuments(scope:WorldEraScope,query:LocalToolDocumentQuery={}):Promise<LocalToolIndexRow[]>{
 validateLocalToolDocumentQuery(query);const project=await getEraProject(scope),rows:LocalToolIndexRow[]=[];
 for(const document of project.sourceToolDocuments??[]){
  if(query.namespace&&document.namespace!==query.namespace)continue;
  let index=document.index;
  try{index=resolveProjectLocalTool(document.namespace,project).index;}catch{/* Portable authored descriptor remains useful without compiled source. */}
  if(!index)continue;
  rows.push({id:document.id,namespace:document.namespace,title:document.title,updatedAt:document.updatedAt,provenance:scope.eraId?(await readSourceToolDocument(scope,document.id))?.provenance??'base':'base',...evaluateLocalToolIndex(index,document.data)});
 }
 return queryLocalToolIndexRows(rows,query);
}
