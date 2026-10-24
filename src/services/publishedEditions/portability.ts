import {findLocalToolBlocksInHtml,remapLocalToolBlockEnvelope,serializeLocalToolBlock,validateLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
const prefixes:Record<string,string>={'dialog-scene':'scene',worldgen:'world',maps:'map',board:'board',timeline:'tl',dictionary:'language',tables:'table',genealogy:'tree','relation-tree':'tree','character-sheets':'sheet',radar:'radar','model-viewer':'model'};
/** Historical pointers remain remapped missing pointers when the live source was deleted. */
export function remapPublishedEditionContent(sourceProjectId:string,targetProjectId:string,html:string,remap:(id:string,prefix:string)=>string,options:{linksOnly?:boolean;richSourceIds?:ReadonlySet<string>}={}):string{
 if(!options.linksOnly&&html.includes('data-wh-source-block')){validateLocalToolBlocksInHtml(html,sourceProjectId);for(const span of findLocalToolBlocksInHtml(html).reverse()){if(span.envelope.scope!=='host'||!Object.values(span.envelope.codec.fields).some(field=>field.kind==='prose'&&field.format==='rich'))continue;html=html.slice(0,span.from)+serializeLocalToolBlock(targetProjectId,remapLocalToolBlockEnvelope(span.envelope,remap,value=>remapPublishedEditionContent(sourceProjectId,targetProjectId,value,remap,{linksOnly:true})))+html.slice(span.to);}}
 if(!/data-wh-(?:codex|media|tool)-block|\/(?:codex|writings)\?/.test(html))return html;
 const template=document.createElement('template');template.innerHTML=html;
 if(!options.linksOnly)for(const block of template.content.querySelectorAll('[data-wh-codex-block="true"],[data-wh-media-block="true"],[data-wh-tool-block="true"]')){
  if(block.getAttribute('data-project-id')!==sourceProjectId)continue;
  const media=block.hasAttribute('data-wh-media-block'),codex=block.hasAttribute('data-wh-codex-block'),attribute=media?'data-asset-id':codex?'data-entry-id':'data-document-id',id=block.getAttribute(attribute),prefix=media?'media':codex?'codex':block.getAttribute('data-tool-kind')==='local-tool'&&id&&options.richSourceIds?.has(id)?'source-tool':prefixes[block.getAttribute('data-tool-kind')??''];
  block.setAttribute('data-project-id',targetProjectId);if(id&&prefix)block.setAttribute(attribute,remap(id,prefix));
 }
 for(const anchor of template.content.querySelectorAll('a[href]'))try{
  const url=new URL(anchor.getAttribute('href')!,'https://writer.invalid');
  if(url.origin==='https://writer.invalid'&&url.pathname===`/project/${encodeURIComponent(sourceProjectId)}/writings`){url.pathname=`/project/${encodeURIComponent(targetProjectId)}/writings`;for(const key of ['writing','compareWriting']){const id=url.searchParams.get(key);if(id)url.searchParams.set(key,remap(id,'wr'));}for(const key of ['draft','draftId','compareDraft']){const id=url.searchParams.get(key);if(id)url.searchParams.set(key,remap(id,'wsnap'));}const manuscript=url.searchParams.get('manuscript');if(manuscript&&!['main','library'].includes(manuscript))url.searchParams.set('manuscript',remap(manuscript,'manuscript'));const era=url.searchParams.get('era');if(era)url.searchParams.set('era',remap(era,'era'));anchor.setAttribute('href',url.pathname+url.search+url.hash);continue;}
  if(url.origin!=='https://writer.invalid'||url.pathname!==`/project/${encodeURIComponent(sourceProjectId)}/codex`)continue;
  const id=url.searchParams.get('entry');if(!id)continue;url.pathname=`/project/${encodeURIComponent(targetProjectId)}/codex`;url.searchParams.set('entry',remap(id,'codex'));const era=url.searchParams.get('era');if(era)url.searchParams.set('era',remap(era,'era'));anchor.setAttribute('href',url.pathname+url.search+url.hash);
 }catch{/* ordinary prose links retain their original text/destination */}
 return template.innerHTML;
}
