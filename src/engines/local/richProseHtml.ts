import {sanitizeRichHtml} from '@/utils/sanitizeRichHtml';
import {renderLocalToolPreview,type LocalToolSemanticPreview} from './previewTypes';

export interface RichProsePolicy {includeImages?:boolean;link?:(href:string)=>string|undefined}
const raster=/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i;
const tags=new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','LI','STRONG','B','EM','I','S','STRIKE','U','A','BLOCKQUOTE','PRE','CODE','HR','BR','IMG']);
/** Inspect semantic anchors only; never recurse into encoded Source payloads. */
export function inspectRichProseLinks(html:string,visit:(href:string)=>void):void{const template=document.createElement('template');template.innerHTML=html;for(const anchor of template.content.querySelectorAll('a[href]'))visit(anchor.getAttribute('href')!);}
/** A projection only: never persists or activates imported application atoms. */
export function richProseHtml(html:string,policy:RichProsePolicy={}):string{
 const template=document.createElement('template');template.innerHTML=sanitizeRichHtml(html);
 for(const atom of template.content.querySelectorAll('[data-wh-source-block],[data-wh-tool-block],[data-wh-media-block],[data-wh-codex-block],[data-wh-prep]'))atom.replaceWith(document.createTextNode(atom.textContent??''));
 for(const element of [...template.content.querySelectorAll('*')].reverse()){
  if(!tags.has(element.tagName)){element.replaceWith(...element.childNodes);continue;}
  const href=element.getAttribute('href'),src=element.getAttribute('src'),alt=element.getAttribute('alt'),title=element.getAttribute('title');
  for(const attribute of [...element.attributes])element.removeAttribute(attribute.name);
  if(element.tagName==='IMG'){if(policy.includeImages===false||!src||!raster.test(src)){element.remove();continue;}element.setAttribute('src',src);if(alt)element.setAttribute('alt',alt);}
  if(element.tagName==='A'){const target=href&&(policy.link?policy.link(href):href);if(target)element.setAttribute('href',target);else{element.replaceWith(...element.childNodes);continue;}}
  if(title)element.setAttribute('title',title);
 }
 return template.innerHTML;
}
/** Host-owned presentation follows sanitization; imported styles never become authority. */
export function richProsePreviewHtml(html:string,policy:RichProsePolicy={}):string{
 const template=document.createElement('template');template.innerHTML=richProseHtml(html,policy);
 for(const list of template.content.querySelectorAll<HTMLElement>('ul,ol')){list.style.listStyleType=list.tagName==='UL'?'disc':'decimal';list.style.paddingInlineStart='1.5rem';}
 for(const paragraph of template.content.querySelectorAll<HTMLElement>('p'))paragraph.style.margin='0.5em 0';
 const headingSizes=['1.5em','1.28em','1.1em','1em','0.95em','0.9em'];
 for(const heading of template.content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')){
  heading.style.fontSize=headingSizes[Number(heading.tagName.slice(1))-1];heading.style.fontWeight='600';heading.style.lineHeight='1.3';heading.style.margin='1.2em 0 0.5em';
 }
 for(const quote of template.content.querySelectorAll<HTMLElement>('blockquote')){quote.style.borderInlineStart='3px solid currentColor';quote.style.paddingInlineStart='1rem';quote.style.margin='1em 0';quote.style.fontStyle='italic';}
 for(const code of template.content.querySelectorAll<HTMLElement>('pre,code'))code.style.fontFamily='ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
 for(const pre of template.content.querySelectorAll<HTMLElement>('pre')){pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';pre.style.margin='1em 0';}
 for(const rule of template.content.querySelectorAll<HTMLElement>('hr')){rule.style.border='0';rule.style.borderTop='1px solid currentColor';rule.style.margin='1em 0';}
 for(const link of template.content.querySelectorAll<HTMLElement>('a[href]'))link.style.textDecoration='underline';
 return template.innerHTML;
}
/** Rich markers come from portable codec projection and are sanitized again at every sink. */
export function renderRichProsePreview(preview:LocalToolSemanticPreview,includeHeading=true,policy:RichProsePolicy={}):string{
 const html=renderLocalToolPreview(preview,includeHeading);if(!preview.fields.some(field=>field.richHtml!==undefined))return html;
 const template=document.createElement('template');template.innerHTML=html;
 const fields=template.content.querySelectorAll('section[data-wh-local-tool-preview]>dl>div>dd');
 preview.fields.forEach((field,index)=>{if(field.richHtml===undefined||!fields[index])return;fields[index].setAttribute('data-wh-rich-prose','true');fields[index].innerHTML=richProsePreviewHtml(field.richHtml,policy);});
 return template.innerHTML;
}
