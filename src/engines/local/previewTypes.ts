import {localAssetFontCss,type LocalAssetFont} from './localAssetFonts';
import type {LocalAssetOverrides} from './assets';
/** Declarative, portable previews: no source functions, React, DB or network. */
import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
export interface LocalToolPreviewField {key:string;label?:{en:string;es:string}}
export interface LocalToolPreviewSpec {version:1;fields:LocalToolPreviewField[];assets?:{namespace:string;slot:string;overridesField?:string}[]}
export interface LocalToolSemanticPreview {title:string;fields:{label:string;value:string}[];assetRequests?:{namespace:string;slot:string;overrides:LocalAssetOverrides}[];images?:{src:string;alt:string}[];fonts?:LocalAssetFont[]}
export function validateLocalToolPreviewSpec(value:unknown):asserts value is LocalToolPreviewSpec {
 const safe=cloneLocalToolJson(value as LocalToolJson) as unknown as LocalToolPreviewSpec;
 if(!safe||safe.version!==1||!Array.isArray(safe.fields)||Object.keys(safe).some(key=>!['version','fields','assets'].includes(key)))throw Error('local_tool_preview_invalid');
 if(safe.assets&&(!Array.isArray(safe.assets)||safe.assets.some(row=>!row||typeof row.namespace!=='string'||typeof row.slot!=='string'||row.overridesField!==undefined&&typeof row.overridesField!=='string'||Object.keys(row).some(key=>!['namespace','slot','overridesField'].includes(key)))))throw Error('local_tool_preview_invalid');
 const seen=new Set<string>();for(const field of safe.fields){if(!field||typeof field.key!=='string'||!field.key||seen.has(field.key)||['__proto__','constructor','prototype'].includes(field.key)||Object.keys(field).some(key=>!['key','label'].includes(key)))throw Error('local_tool_preview_invalid');seen.add(field.key);if(field.label&&(['en','es']as const).some(locale=>typeof field.label?.[locale]!=='string'||!field.label[locale].trim()))throw Error('local_tool_preview_invalid');}
}
export function localToolSemanticPreview(title:string,data:LocalToolJson,spec?:LocalToolPreviewSpec,locale:'es'|'en'='en'):LocalToolSemanticPreview {
 if(spec)validateLocalToolPreviewSpec(spec);const safe=cloneLocalToolJson(data),record=safe&&typeof safe==='object'&&!Array.isArray(safe)?safe:undefined;
 const value=(item:LocalToolJson|undefined)=>typeof item==='string'?item:item===undefined?'':JSON.stringify(item,null,2);
 const fields:LocalToolPreviewField[]=spec?.fields??Object.keys(record??{}).map(key=>({key}));
 return{title,...(spec?.assets?{assetRequests:spec.assets.map(row=>({namespace:row.namespace,slot:row.slot,overrides:(row.overridesField&&record?.[row.overridesField]||{}) as LocalAssetOverrides}))}:{}),fields:record?fields.map(field=>({label:field.label?.[locale]??field.key,value:value(record[field.key])})):[{label:locale==='es'?'Contenido':'Content',value:value(safe)}]};
}
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function renderLocalToolPreview(preview:LocalToolSemanticPreview,includeHeading=true):string{return`${localAssetFontCss(preview.fonts??[])?`<style>${localAssetFontCss(preview.fonts??[])}</style>`:''}<section data-wh-local-tool-preview${preview.fonts?.[0]?` data-wh-asset-font="${preview.fonts[0].token}"`:''}>${includeHeading?`<h3>${escape(preview.title)}</h3>`:''}${(preview.images??[]).filter(image=>/^data:image\/(?:png|jpeg|webp|gif|avif|bmp|svg\+xml);base64,[a-z\d+/=\s]+$/i.test(image.src)).map(image=>`<img src="${escape(image.src)}" alt="${escape(image.alt)}" width="96" height="96">`).join('')}<dl>${preview.fields.map(field=>`<div><dt>${escape(field.label)}</dt><dd style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(field.value)}</dd></div>`).join('')}</dl></section>`;}

/** Scoped against reader/wiki field grids; content uses the caller's own ink. */
export const LOCAL_TOOL_PREVIEW_CSS=`[data-wh-local-tool-preview]{min-width:0;max-width:100%;overflow-wrap:anywhere}[data-wh-local-tool-preview]>dl{display:block;min-width:0;margin:0}[data-wh-local-tool-preview]>dl>div{display:grid;grid-template-columns:minmax(0,1fr);gap:.25rem;min-width:0;margin-block:0 1rem}[data-wh-local-tool-preview]>dl>div>dt{min-width:0;font-weight:600}[data-wh-local-tool-preview]>dl>div>dd{display:block;min-width:0;width:auto;max-width:100%;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}`;
