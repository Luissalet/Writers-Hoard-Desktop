import {createElement,type ReactNode} from 'react';
import type {LocalToolClient,LocalToolDefinition,LocalToolJson,LocalToolSnapshot} from '../sdk';
import {validateRichDocument,type RichDocument,type RichMark} from '../convergence/richTypes';

export interface RichBaseline {client:LocalToolClient<LocalToolJson>;definition:LocalToolDefinition;field:string;snapshot:LocalToolSnapshot<LocalToolJson>;stale?:boolean}
type BaselineView={kind:'loading'}|{kind:'invalid'}|{kind:'ready';snapshot:LocalToolSnapshot<LocalToolJson>;document:RichDocument;fresh:boolean};
/** A response belongs only to the capability, definition and field that requested it. */
// eslint-disable-next-line react-refresh/only-export-components
export function richBaselineView(baseline:RichBaseline|undefined,client:LocalToolClient<LocalToolJson>,definition:LocalToolDefinition,field:string):BaselineView{
 if(!baseline||baseline.client!==client||baseline.definition!==definition||baseline.field!==field)return{kind:'loading'};
 const snapshot=baseline.snapshot;
 try{
  const identity=snapshot.document;if(!client.documentId||!identity||identity.id!==client.documentId||identity.namespace!==client.namespace||client.namespace!==definition.namespace)throw Error('rich_baseline_identity');
  const data=snapshot.data;if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,field))throw Error('rich_baseline_field');
  const document=data[field];validateRichDocument(document);return{kind:'ready',snapshot,document,fresh:!baseline.stale};
 }catch{return{kind:'invalid'};}
}
const tags:Record<RichMark,string>={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'};
/** Passive text only. No editor, replica, IDs, history or Source calls are created here. */
export function RichBaselineText({document,field,label,placeholder,es}:{document:RichDocument;field:string;label:string;placeholder?:string;es:boolean}){
 const empty=document.content.every(paragraph=>paragraph.content.length===0);
 return <div role="document" aria-label={label} data-sdk-rich-baseline={field} className="space-y-2 rounded-lg border border-border bg-elevated p-3 text-text-primary">
  {document.content.map(paragraph=><p key={paragraph.id} data-writer-paragraph={paragraph.id} className="min-h-6 whitespace-pre-wrap break-words">{paragraph.content.length?paragraph.content.map((part,index)=><span key={index}>{(part.marks??[]).reduceRight<ReactNode>((node,mark)=>createElement(tags[mark.type],null,node),part.text)}</span>):<br/>}</p>)}
  {empty&&<p role="status" className="text-sm text-text-muted">{placeholder??(es?'No hay texto.':'No text yet.')}</p>}
 </div>;
}
