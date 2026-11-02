import {richBlockLeaves,validateRichBlockDocument,type RichBlockDocument} from '../convergence/blockTypes';
import {richBlockChildren} from '../convergence/blockEditing';
import {createElement,type ReactNode} from 'react';
import type {LocalToolClient,LocalToolDefinition,LocalToolJson,LocalToolSnapshot} from '../sdk';
import {validateRichDocument,type RichDocument,type RichMark} from '../convergence/richTypes';

export interface RichBaseline {client:LocalToolClient<LocalToolJson>;definition:LocalToolDefinition;field:string;snapshot:LocalToolSnapshot<LocalToolJson>;stale?:boolean}
type BaselineView={kind:'loading'}|{kind:'invalid'}|{kind:'ready';snapshot:LocalToolSnapshot<LocalToolJson>;document:RichDocument;blockDocument?:RichBlockDocument;fresh:boolean};
/** A response belongs only to the capability, definition and field that requested it. */
// eslint-disable-next-line react-refresh/only-export-components
export function richBaselineView(baseline:RichBaseline|undefined,client:LocalToolClient<LocalToolJson>,definition:LocalToolDefinition,field:string):BaselineView{
 if(!baseline||baseline.client!==client||baseline.definition!==definition||baseline.field!==field)return{kind:'loading'};
 const snapshot=baseline.snapshot;
 try{
  const identity=snapshot.document;if(!client.documentId||!identity||identity.id!==client.documentId||identity.namespace!==client.namespace||client.namespace!==definition.namespace)throw Error('rich_baseline_identity');
  const data=snapshot.data;if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,field))throw Error('rich_baseline_field');
  const document=data[field],descriptor=definition.codec?.fields[field];if(descriptor?.kind==='rich'&&descriptor.profile==='blocks-tree/1'){validateRichBlockDocument(document);return{kind:'ready',snapshot,document:richBlockLeaves(document),blockDocument:document,fresh:!baseline.stale};}validateRichDocument(document);return{kind:'ready',snapshot,document,fresh:!baseline.stale};
 }catch{return{kind:'invalid'};}
}
const tags:Record<RichMark,string>={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'};
/** Passive text only. No editor, replica, IDs, history or Source calls are created here. */
export function RichBaselineText({document,blockDocument,field,label,placeholder,es}:{document:RichDocument;blockDocument?:RichBlockDocument;field:string;label:string;placeholder?:string;es:boolean}){
 if(blockDocument)return <BlockBaselineText document={blockDocument} field={field} label={label} placeholder={placeholder} es={es}/>;
 const empty=document.content.every(paragraph=>paragraph.content.length===0);
 return <div role="document" aria-label={label} data-sdk-rich-baseline={field} className="space-y-2 rounded-lg border border-border bg-elevated p-3 text-text-primary">
  {document.content.map(paragraph=><p key={paragraph.id} data-writer-paragraph={paragraph.id} className="min-h-6 whitespace-pre-wrap break-words">{paragraph.content.length?paragraph.content.map((part,index)=><span key={index}>{(part.marks??[]).reduceRight<ReactNode>((node,mark)=>createElement(tags[mark.type],null,node),part.text)}</span>):<br/>}</p>)}
  {empty&&<p role="status" className="text-sm text-text-muted">{placeholder??(es?'No hay texto.':'No text yet.')}</p>}
 </div>;
}

function BlockBaselineText({document,field,label,placeholder,es}:{document:RichBlockDocument;field:string;label:string;placeholder?:string;es:boolean}){
 const parts=(block:RichBlockDocument['blocks'][number])=>block.content?.map((part,index)=><span key={index}>{(part.marks??[]).reduceRight<ReactNode>((node,mark)=>createElement(tags[mark.type],null,node),part.text)}</span>);
 const node=(block:RichBlockDocument['blocks'][number]):ReactNode=>{const props={key:block.id,'data-writer-block':block.id},children=richBlockChildren(document,block.id).map(node);if(block.content)return createElement(block.type==='heading'?'h'+block.attrs.level:'p',props,parts(block));if(block.type==='toggle')return <details key={block.id} open data-writer-block={block.id}><summary>{richBlockChildren(document,block.id,'summary').map(parts)}</summary>{children}</details>;return createElement(({'bullet-list':'ul','ordered-list':'ol','list-item':'li',blockquote:'blockquote'} as Record<string,string>)[block.type],{...props,...(block.type==='ordered-list'?{start:block.attrs.start??1}:{})},children);};
 return <div role="document" aria-label={label} data-sdk-rich-baseline={field} className="tiptap-editor space-y-2 rounded-lg border border-border bg-elevated p-3 text-text-primary"><div className="ProseMirror">{richBlockChildren(document,null).map(node)}{!document.blocks.length&&<p role="status">{placeholder??(es?'No hay texto.':'No text yet.')}</p>}</div></div>;
}
