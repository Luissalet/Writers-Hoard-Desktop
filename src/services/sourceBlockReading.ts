import {findLocalToolBlocksInHtml,type LocalToolBlockEnvelope} from '@/engines/local/blocks/types';
import {localToolBlockPreview,renderLocalToolPreview} from '@/engines/local/blocks/preview';
import {listWorldDocuments} from '@/services/worldEras/store';
import type {EraDocument} from '@/services/worldEras/types';
import type {ToolExportPolicy} from '@/components/editor/toolBlocks/preview';

const excludes=(values:ReadonlySet<string>|readonly string[]|undefined,id:string)=>!!values&&(Array.isArray(values)?values.includes(id):(values as ReadonlySet<string>).has(id));
/** A world query uses the same captured era as its containing publication. */
export async function sourceBlockPreviewHtml(envelope:LocalToolBlockEnvelope,projectId:string,locale:'en'|'es',policy:ToolExportPolicy={},wiki=false):Promise<string>{
 let documents:EraDocument[]|undefined;
 if(envelope.scope==='world'){
  if(policy.source&&policy.source.project.id!==projectId)throw Error('reader_source_project_mismatch');
  documents=policy.source?policy.source.documents?.(envelope.world.kind):(await listWorldDocuments({projectId,eraId:policy.eraId},envelope.world.kind)).map(read=>read.document);
  if(documents){
   const kind=envelope.world.kind;
   documents=documents.filter(({root})=>(kind!=='codex'||!excludes(policy.excludedEntryIds,root.id))&&(kind!=='maps'||policy.includeMaps!==false&&!excludes(policy.excludedMapIds,root.id))).map(worldDocument=>{
    const root={...worldDocument.root};
    for(const field of policy.excludedFields??[])delete root[field];
    if(kind==='codex'&&root.fields&&typeof root.fields==='object')root.fields=Object.fromEntries(Object.entries(root.fields).filter(([field])=>!policy.excludedFields?.includes(field)));
    if(wiki&&typeof root.content==='string'){const template=document.createElement('template');template.innerHTML=root.content;template.content.querySelectorAll('[data-wh-wiki-hidden="true"]').forEach(node=>node.remove());root.content=template.innerHTML;}
    return{...worldDocument,root};
   });
  }
 }
 return renderLocalToolPreview(localToolBlockPreview(envelope,locale,documents));
}
/** Hydrate only exported HTML; the original atoms, code and host stay untouched. */
export async function prepareSourceBlocksForExport(html:string,projectId:string,locale:'es'|'en',policy:ToolExportPolicy={},wiki=false):Promise<string>{
 const template=document.createElement('template');template.innerHTML=html;
 for(const element of template.content.querySelectorAll<HTMLElement>('figure[data-wh-source-block="true"]')){
  const section=document.createElement('section');section.className='wh-source-block-export';
  try{const spans=findLocalToolBlocksInHtml(element.outerHTML);if(spans.length!==1||spans[0].projectId!==projectId)throw Error('source_block_unavailable');section.innerHTML=await sourceBlockPreviewHtml(spans[0].envelope,projectId,locale,policy,wiki);}
  catch{section.textContent=locale==='es'?'Bloque local no disponible.':'Local block unavailable.';}
  element.replaceWith(section);
 }
 return template.innerHTML;
}
