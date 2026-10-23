import type { ReaderSource } from '@/engines/writings/readerSource';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import type { EraDocumentKind } from '@/services/worldEras/types';
import { WIKI_ADDITIONAL_KINDS, type WikiDocumentRef, type WorldWikiOptions } from '@/types/worldWiki';
import { resolveToolPreview, type ToolPreview, type ToolExportPolicy } from '@/components/editor/toolBlocks/preview';
import type { ToolDocumentTarget } from '@/components/editor/toolBlocks/model';
import { wikiDocumentHidden, wikiRefKey } from './policy';

export interface WikiDocumentCandidate { ref: WikiDocumentRef; title: string }
export interface WikiStandalonePage extends WikiDocumentCandidate { preview: ToolPreview }
export const wikiDocumentLabels = (locale: 'es'|'en'): Record<string,string> => locale === 'es'
  ? { notes:'Notas',tables:'Tablas',board:'Tableros',timeline:'Cronologías','character-sheets':'Fichas de personaje',dictionary:'Diccionarios','relation-tree':'Árboles',radar:'Gráficos radar','model-viewer':'Modelos 3D','local-tool':'Herramientas locales' }
  : { notes:'Notes',tables:'Tables',board:'Boards',timeline:'Timelines','character-sheets':'Character sheets',dictionary:'Dictionaries','relation-tree':'Trees',radar:'Radar charts','model-viewer':'3D models','local-tool':'Local tools' };
const hex = (value:string) => Array.from(new TextEncoder().encode(value)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
export const wikiDocumentArticleId = (ref:WikiDocumentRef) => ref.kind==='entry'||ref.kind==='map'||ref.kind==='timeline'
  ? `${ref.kind}-${hex(ref.id)}` : `document-${hex(JSON.stringify([ref.kind,ref.id,ref.namespace??'']))}`;

/** A catalogue from the same effective capture as publication; never falls back to live rows. */
export function wikiDocumentCatalog(source:ReaderSource):WikiDocumentCandidate[] {
  const result:WikiDocumentCandidate[]=[];
  for(const kind of WIKI_ADDITIONAL_KINDS){
    const documents=source.documents?.((kind==='relation-tree'?'genealogy':kind) as EraDocumentKind)??[];
    for(const {root} of documents){
      if(root.projectId!==undefined&&root.projectId!==source.project.id)continue;
      const namespace=kind==='local-tool'&&typeof root.namespace==='string'?root.namespace:undefined;
      if(kind==='local-tool'&&!namespace)continue;
      const title=String(root.title??root.name??(kind==='notes'?String(root.text??'').split(/\r?\n/).find(line=>line.trim())?.slice(0,80):undefined)??root.id);
      result.push({ref:{kind,id:root.id,...(namespace?{namespace}:{})},title});
    }
  }
  return result.sort((a,b)=>a.title.localeCompare(b.title)||wikiRefKey(a.ref).localeCompare(wikiRefKey(b.ref)));
}
export function admittedStandaloneDocuments(catalog:WikiDocumentCandidate[],options:WorldWikiOptions):WikiDocumentCandidate[]{
  const selected=new Set((options.additionalDocuments??[]).map(wikiRefKey));
  return catalog.filter(doc=>selected.has(wikiRefKey(doc.ref))&&(!options.onlyRevealed||doc.ref.kind==='timeline')&&!wikiDocumentHidden(doc.ref,doc.ref.kind,options));
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const raster=(value:unknown):value is string=>typeof value==='string'&&/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value);
export async function prepareStandaloneWikiPages(source:ReaderSource,options:WorldWikiOptions,policy:ToolExportPolicy):Promise<WikiStandalonePage[]>{
  const pages:WikiStandalonePage[]=[];
  for(const doc of admittedStandaloneDocuments(wikiDocumentCatalog(source),options)){
    if(doc.ref.kind==='timeline')continue; // The complete timeline renderer retains its original policy and identity.
    if(doc.ref.kind==='notes'){
      const note=source.documents?.('notes').find(item=>item.root.id===doc.ref.id)?.root;
      if(!note)continue;
      let body=String(note.text??'').split(/\r?\n/).map(line=>`<p>${esc(line)||'<br>'}</p>`).join('');
      if(typeof note.richHtml==='string'){
        const content=document.createElement('template');content.innerHTML=sanitizeRichHtml(note.richHtml);
        content.content.querySelectorAll('[data-wh-wiki-hidden="true"],[data-wh-tool-block],[data-wh-source-block],[data-wh-codex-block]').forEach(node=>node.remove());
        content.content.querySelectorAll('[data-wh-wiki-spoiler="true"]').forEach(node=>node.replaceChildren(document.createTextNode('▮▮▮')));
        content.content.querySelectorAll('img').forEach(image=>{if(options.includeImages===false||!raster(image.getAttribute('src')))image.remove();});
        body=content.innerHTML;
      }
      const cover=options.includeImages!==false&&raster(note.cover)?`<img src="${esc(note.cover)}" alt="">`:'';
      pages.push({...doc,preview:{title:doc.title,html:cover+body+(note.source?`<p>${esc(note.source)}</p>`:''),truncated:false}});
      continue;
    }
    const target:ToolDocumentTarget={projectId:source.project.id,kind:doc.ref.kind as ToolDocumentTarget['kind'],documentId:doc.ref.id,label:'',namespace:doc.ref.namespace};
    const preview=await resolveToolPreview(target,source.project.id,options.locale??'es',{...policy,source,page:true,excludedDocuments:policy.excludedDocuments??options.excludedDocuments});
    if(preview)pages.push({...doc,preview});
  }
  return pages;
}
