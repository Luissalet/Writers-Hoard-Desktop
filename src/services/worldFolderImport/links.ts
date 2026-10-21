import { markdownToTiptapHtml as htmlFromMarkdown } from '@/services/aiBridge/markdown';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { base64FromBytes } from '@/services/documents/client';
import type { FolderSource } from './paths';
import { relativeFolderPath } from './paths';
import type { WorldFolderFinding, WorldFolderPlan, WorldFolderPlanRow } from './types';

export function folderDocumentHref(projectId:string,eraId:string|undefined,row:Pick<WorldFolderPlanRow,'target'|'id'>):string {
  const query=new URLSearchParams(row.target==='codex'?{entry:row.id}:row.target==='writings'?{writing:row.id}:{entity:row.id});if(eraId)query.set('era',eraId);
  return `/project/${encodeURIComponent(projectId)}/${row.target}?${query}`;
}
/** Syntax conversion is limited to prose, never fenced or inline code. */
function localSyntax(source:string):string{
  let fence:{char:string;length:number}|undefined;
  return source.split('\n').map(line=>{
    const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim())fence=undefined;return line;}
    if(marker){fence={char:marker[1][0],length:marker[1].length};return line;}
    return line.split(/(`[^`\n]*`)/g).map((part,index)=>index%2?part:part
      .replace(/(!?)\[\[([^\]\n]+)\]\]/g,(_all,bang:string,body:string)=>{const separator=body.indexOf('|'),path=separator<0?body:body.slice(0,separator),label=separator<0?path:body.slice(separator+1);return `${bang}[${label.replaceAll('[','\\[').replaceAll(']','\\]')}](${encodeURI(path)})`;})
      .replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,(_all,start:string,path:string,end:string)=>`${start}${/^[a-z][\w+.-]*:|^[/.#]/i.test(path)?path:`./${path}`}${end}`)).join('');
  }).join('\n');
}
export function renderFolderMarkdown(body:string,path:string,projectId:string,eraId:string|undefined,sources:FolderSource[],rows:WorldFolderPlanRow[],assets:WorldFolderPlan['assets'],findings:WorldFolderFinding[]):string{
  const host=new DOMParser().parseFromString(htmlFromMarkdown(localSyntax(body)),'text/html');
  const report=(code:string,target:string)=>findings.push({path,code,message:`${target}`,blocking:false});
  for(const element of host.querySelectorAll('a[href],img[src]')){
    const attr=element.tagName==='IMG'?'src':'href',value=element.getAttribute(attr)??'';
    if(attr==='src'&&/^https?:/i.test(value)){report('remote_image_not_imported',value);element.replaceWith(host.createTextNode(element.getAttribute('alt')||value));continue;}
    if(/^[a-z][\w+.-]*:|^\/project\//i.test(value))continue;
    if(value.startsWith('#')){report('local_heading_link_retained',value);continue;}
    const [target,fragment]=value.split('#'),resolved=relativeFolderPath(path,target);
    if(!resolved){report('local_link_unresolved',value);continue;}
    let candidates=sources.filter(source=>source.path===resolved);
    if(!candidates.length)candidates=sources.filter(source=>source.path.replace(/\.(?:md|markdown)$/i,'')===resolved);
    if(!candidates.length&&!target.replace(/^\.\//,'').includes('/')){const basename=resolved.split('/').at(-1);candidates=sources.filter(source=>source.path.split('/').at(-1)?.replace(/\.(?:md|markdown)$/i,'')===basename?.replace(/\.(?:md|markdown)$/i,''));}
    if(candidates.length!==1){report(candidates.length?'local_link_ambiguous':'local_link_missing',value);continue;}
    const source=candidates[0],asset=assets.find(item=>item.path===source.path);
    if(asset?.kind==='raster'&&attr==='src'){
      element.setAttribute('src',`data:${asset.mime};base64,${base64FromBytes(source.bytes)}`);asset.used=true;continue;
    }
    if(asset?.kind==='media'){
      asset.used=true;
      const figure=host.createElement('figure');figure.setAttribute('data-wh-media-block','true');figure.setAttribute('data-project-id',projectId);figure.setAttribute('data-asset-id',asset.id!);figure.setAttribute('data-label',element.getAttribute('alt')??element.textContent??source.path);
      const caption=host.createElement('figcaption');caption.textContent=element.getAttribute('alt')??element.textContent??source.path;figure.append(caption);
      // A block cannot live inside a paragraph; split the paragraph while preserving its other content.
      const paragraph=element.closest('p');
      if(paragraph){const range=host.createRange();range.setStartAfter(element);range.setEnd(paragraph,paragraph.childNodes.length);const after=range.extractContents();element.remove();const tail=paragraph.cloneNode(false) as Element;tail.append(after);paragraph.after(figure);if(tail.childNodes.length)figure.after(tail);if(!paragraph.textContent&&!paragraph.querySelector('img'))paragraph.remove();}else element.replaceWith(figure);
      continue;
    }
    const destinations=rows.filter(row=>row.path===source.path&&row.status!=='excluded');
    if(destinations.length!==1){report(destinations.length?'local_link_multiple_destinations':'local_link_excluded',value);continue;}
    if(fragment){report('local_heading_link_retained',value);continue;}
    if(attr==='src'){report('local_embed_document_unsupported',value);continue;}
    element.setAttribute('href',folderDocumentHref(projectId,eraId,destinations[0]));
  }
  return sanitizeRichHtml(host.body.innerHTML);
}
