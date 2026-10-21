import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { safeToolSvg } from '@/components/editor/toolBlocks/preview';
import type { DocumentImageRect } from './types';

export const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const raster=(value:unknown):value is string=>typeof value==='string'&&/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(value);
export const image=(value:unknown,alt='')=>raster(value)?`<img src="${esc(value)}" alt="${esc(alt)}">`:'';
export const table=(headers:unknown[],rows:unknown[][])=>`<table><thead><tr>${headers.map(value=>`<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
export const fields=(values:Record<string,unknown>)=>`<dl>${Object.entries(values).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(typeof value==='object'?JSON.stringify(value):value)}</dd></div>`).join('')}</dl>`;
export function safeProse(source:string):Document {
  const doc=new DOMParser().parseFromString(sanitizeRichHtml(source),'text/html');
  for(const element of doc.querySelectorAll('*'))for(const attribute of ['href','src','poster','background','srcset','xlink:href'])if(element.hasAttribute(attribute)&&!(element.tagName==='IMG'&&attribute==='src'&&raster(element.getAttribute('src'))))element.removeAttribute(attribute);
  return doc;
}
/** Full exporter output, without the tool-preview's 360px thumbnail cap. */
export function svg(source:string,view?:DocumentImageRect):string {
  const safe=safeToolSvg(source);if(!safe)throw new Error('document_svg_invalid');
  const doc=new DOMParser().parseFromString(safe,'image/svg+xml'),root=doc.documentElement;
  root.removeAttribute('style');root.removeAttribute('width');root.removeAttribute('height');
  if(view)root.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
  root.setAttribute('style','display:block;width:100%;height:auto');
  return new XMLSerializer().serializeToString(root);
}
export const IMAGE_STYLE=`*{box-sizing:border-box}html{background:#f6f2e8;scrollbar-width:none}::-webkit-scrollbar{display:none}body{margin:0;padding:32px;color:#272b2b;font:16px/1.65 Georgia,serif;overflow:visible}header{border-bottom:1px solid #c9c3b5;margin-bottom:24px;padding-bottom:16px}h1{font-size:32px;line-height:1.2;margin:0 0 12px;overflow-wrap:anywhere}h2{font-size:24px;margin:28px 0 12px}h3{font-size:19px;margin:20px 0 8px}p,li,dd{overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace}img{max-width:100%;height:auto}table{border-collapse:collapse;min-width:100%;margin:16px 0;font:14px/1.5 system-ui,sans-serif}th,td{border:1px solid #bdb7a8;padding:8px 12px;text-align:left;vertical-align:top;min-width:100px;max-width:420px;overflow-wrap:anywhere}th{background:#e8e1d2}dl{margin:16px 0}dl>div{display:grid;grid-template-columns:minmax(130px,1fr) 3fr;gap:12px;border-bottom:1px solid #d7d0c1;padding:8px 0}dt{font:600 13px/1.5 system-ui,sans-serif}dd{margin:0;white-space:pre-wrap}.meta{font:13px/1.5 system-ui,sans-serif;color:#625f55}.prose{max-width:none}.prose img{display:block}.scene-box{position:relative;overflow:hidden}.board-node{position:absolute;overflow:hidden;padding:12px;border:1px solid #8b8068;border-radius:6px;background:#fff9e9}.board-node h3{font:600 15px/1.3 system-ui;margin:0 0 8px}.board-node p{font:13px/1.5 system-ui;margin:0}.dual{display:grid;grid-template-columns:1fr 1fr;gap:32px}.dialog{max-width:70%;margin:16px auto}.dialog b{display:block}.transition{text-align:right}.stage-direction{font-style:italic}blockquote{margin-left:0;padding-left:20px;border-left:2px solid #a48b55}[data-model-controls],[data-model-status]{display:none!important}video{display:block;width:100%;max-height:none}.waveform{display:block;width:100%;height:200px}`;
