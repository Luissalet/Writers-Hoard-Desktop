/** Portable atoms. This module may be used by import/clone/history without source code. */
import {cloneLocalToolJson,localToolNamespace,type LocalToolJson} from '../stateTypes';
import {validateLocalToolCodecState,remapLocalToolReferences,type LocalToolStateCodec} from '../stateCodec';
import {validateLocalToolPreviewSpec,type LocalToolPreviewSpec} from '../previewTypes';
import {eraDocumentKinds,type EraDocumentKind} from '@/services/worldEras/types';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';
export interface LocalToolBlockOwner {kind:'codex'|'writings';documentId:string}
/** Data hosts include the real Project default dock; HTML operations keep LocalToolBlockOwner. */
export type LocalToolBlockDataOwner=LocalToolBlockOwner|{kind:'project';documentId:string};
export interface LocalToolWorldBlockQuery {kind:EraDocumentKind;fields:string[]}
interface BlockBase {version:1;id:string;namespace:string;key:string;name:{en:string;es:string};preview?:LocalToolPreviewSpec}
export interface LocalToolOwnedBlockEnvelope extends BlockBase {scope:'host';revision:number;data:LocalToolJson;codec:LocalToolStateCodec}
export interface LocalToolWorldBlockEnvelope extends BlockBase {scope:'world';world:LocalToolWorldBlockQuery}
export type LocalToolBlockEnvelope=LocalToolOwnedBlockEnvelope|LocalToolWorldBlockEnvelope;
export function validateLocalToolBlockEnvelope(value:unknown):asserts value is LocalToolBlockEnvelope {
 const row=cloneLocalToolJson(value as LocalToolJson) as unknown as LocalToolBlockEnvelope;
 if(!row||row.version!==1||typeof row.id!=='string'||!row.id||!localToolNamespace(row.namespace)||typeof row.key!=='string'||!/^[a-z][a-z0-9_-]*$/.test(row.key)||!row.name||(['en','es']as const).some(locale=>typeof row.name[locale]!=='string'||!row.name[locale].trim()))throw Error('local_tool_block_invalid');
 const keys=['version','id','namespace','key','name','preview',...(row.scope==='host'?['scope','revision','data','codec']:['scope','world'])];if(Object.keys(row).some(key=>!keys.includes(key)))throw Error('local_tool_block_invalid');
 if(row.preview)validateLocalToolPreviewSpec(row.preview);
 if(row.scope==='host'){if(!Number.isSafeInteger(row.revision)||row.revision<0||!Object.hasOwn(row,'data'))throw Error('local_tool_block_invalid');validateLocalToolCodecState(row.data,row.codec);}
 else if(row.scope==='world'){if(!row.world||!eraDocumentKinds.includes(row.world.kind)||!Array.isArray(row.world.fields)||row.world.fields.some(key=>typeof key!=='string'||!key||['__proto__','constructor','prototype'].includes(key))||Object.keys(row.world).some(key=>!['kind','fields'].includes(key)))throw Error('local_tool_block_invalid');}
 else throw Error('local_tool_block_invalid');
}
export function remapLocalToolBlockEnvelope(envelope:LocalToolBlockEnvelope,remap:(id:string,prefix:string)=>string):LocalToolBlockEnvelope {validateLocalToolBlockEnvelope(envelope);const copy=structuredClone(envelope);copy.id=remap(envelope.id,'source-block');if(copy.scope==='host'){copy.revision=0;copy.data=remapLocalToolReferences(copy.data,copy.codec,(kind,id)=>remap(id,worldDocumentPrefixes[kind]),(kind,id)=>remap(id,kind==='image'?'img':kind==='file'?'asset-file':'media'));}return copy;}
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const decode=(value:string)=>value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_entity,key:string)=>{if(key[0]==='#'){const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));if(n<0||n>0x10ffff)throw Error('local_tool_block_html_invalid');return String.fromCodePoint(n);}return({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}as Record<string,string>)[key.toLowerCase()];});
export interface LocalToolBlockSpan {from:number;to:number;projectId:string;envelope:LocalToolBlockEnvelope;html:string}
/** Lexical spans keep every byte of surrounding authored prose intact. */
export function findLocalToolBlocksInHtml(html:string):LocalToolBlockSpan[]{const result:LocalToolBlockSpan[]=[];for(const match of html.matchAll(/<figure\b([^>]*?)>[\s\S]*?<\/figure\s*>/gi)){const attrs=new Map<string,string>();for(const attribute of match[1].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g))attrs.set(attribute[1].toLowerCase(),decode(attribute[2]??attribute[3]??attribute[4]));if(attrs.get('data-wh-source-block')!=='true')continue;const projectId=attrs.get('data-project-id'),encoded=attrs.get('data-source-block');if(!projectId||!encoded)throw Error('local_tool_block_html_invalid');const envelope:unknown=JSON.parse(encoded);validateLocalToolBlockEnvelope(envelope);result.push({from:match.index!,to:match.index!+match[0].length,projectId,envelope,html:match[0]});}return result;}
export function validateLocalToolBlocksInHtml(html:string,projectId?:string):void{const ids=new Set<string>();for(const span of findLocalToolBlocksInHtml(html)){if(ids.has(span.envelope.id)||projectId&&span.projectId!==projectId)throw Error('local_tool_block_scope_invalid');ids.add(span.envelope.id);}}
export function serializeLocalToolBlock(projectId:string,envelope:LocalToolBlockEnvelope):string{validateLocalToolBlockEnvelope(envelope);return`<figure data-wh-source-block="true" data-project-id="${escape(projectId)}" data-source-block="${escape(JSON.stringify(envelope))}"><figcaption>${escape(envelope.name.en)}</figcaption></figure>`;}
export function patchLocalToolBlockHtml(html:string,blockId:string,replacement?:LocalToolBlockEnvelope,projectId?:string):string{const matches=findLocalToolBlocksInHtml(html).filter(span=>span.envelope.id===blockId);if(matches.length!==1||projectId&&matches[0].projectId!==projectId)throw Error('local_tool_block_missing_or_ambiguous');const target=matches[0];if(replacement&&replacement.id!==blockId)throw Error('local_tool_block_identity_changed');return html.slice(0,target.from)+(replacement?serializeLocalToolBlock(target.projectId,replacement):'')+html.slice(target.to);}
export function remapLocalToolBlocksInHtml(html:string,remap:(id:string,prefix:string)=>string,targetProjectId?:string):string{let result=html;for(const span of findLocalToolBlocksInHtml(html).reverse())result=result.slice(0,span.from)+serializeLocalToolBlock(targetProjectId??remap(span.projectId,'project'),remapLocalToolBlockEnvelope(span.envelope,remap))+result.slice(span.to);return result;}

/** Validate only known rich-text leaves. Tool payloads are deliberately opaque. */
export function validateLocalToolBlockRichContent(value:unknown,projectId?:string):void{if(Array.isArray(value)){for(const child of value)validateLocalToolBlockRichContent(child,projectId);return;}if(!value||typeof value!=='object'||value instanceof Blob)return;for(const [key,child]of Object.entries(value)){if(['data','localToolStates'].includes(key))continue;if(['content','html','body','richContent'].includes(key)&&typeof child==='string'){if(child.includes('data-wh-source-block'))validateLocalToolBlocksInHtml(child,projectId);}else if(child&&typeof child==='object')validateLocalToolBlockRichContent(child,projectId);}}
