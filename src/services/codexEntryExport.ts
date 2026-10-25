import JSZip from 'jszip';
import {capturePublicationSnapshot,publicationReaderSource} from '@/services/publishedEditions/snapshot';
import {buildDocumentImage} from '@/services/documentImage/build';
import {capturePreparedDocumentImage} from '@/services/documentImage';
import {projectCodexEntry} from '@/engines/codex/properties';
import {effectiveCodexTemplate} from '@/engines/codex/templateHierarchy';
import {renderCodexEntry,type RenderContext} from '@/services/worldMarkdownExport/render';
import {createLinkContext} from '@/services/worldMarkdownExport/linking';
import {MediaSink} from '@/services/worldMarkdownExport/media';
import {vaultCopy} from '@/services/worldMarkdownExport/copy';
import {sanitizeFilename,downloadBlobFile,exportHtmlPdf} from '@/engines/writings/manuscriptExport';
import {eraDocumentVersion} from '@/services/worldEras/adapters';
import {mediaFilename} from '@/engines/media/types';
import {relativePath} from '@/services/worldMarkdownExport/names';
import type {CodexEntry} from '@/types';
import type {DocumentImageRequest} from '@/services/documentImage/types';

export interface CodexEntryExportRequest {projectId:string;eraId?:string;entryId:string;locale?:'es'|'en'}
export async function prepareCodexEntryExport(request:CodexEntryExportRequest){
 const snapshot=await capturePublicationSnapshot(request),source=publicationReaderSource(snapshot);
 const entry=source.rows('codexEntries').find(row=>row.id===request.entryId&&row.projectId===request.projectId);
 if(!entry)throw Error('document_not_found');
 const imageRequest:DocumentImageRequest={projectId:request.projectId,eraId:request.eraId,kind:'codex',entityId:entry.id,locale:request.locale??'en'};
 const image=await buildDocumentImage(imageRequest,source);
 const template=source.project.codexTemplates?.find(row=>row.id===entry.templateId);
 const effective=template?effectiveCodexTemplate(template,source.project.codexTemplates??[]):undefined;
 const projection=projectCodexEntry(entry,source.project.codexTemplates);
 const dependencies={...image.dependencies};
 // Metadata that actually contributes to the card; no project.updatedAt/world fingerprint.
 if(effective)dependencies['card:template']=await eraDocumentVersion({root:{id:effective.id,template:effective},children:{}});
 const targetIds=new Set([...entry.relations.map(row=>row.targetId),...Object.values(entry.referenceFields??{}).flat()]);
 const targetNames=new Map(source.rows('codexEntries').filter(row=>targetIds.has(row.id)).map(row=>[row.id,row.title]));
 for(const id of targetIds)dependencies[`card:reference:${id}`]=await eraDocumentVersion({root:{id,title:targetNames.get(id)??null},children:{}});
 // The portable prepared body includes the bytes and text actually consumed by embeds/assets.
 // This content token does not invalidate on changes to uncopied rows.
 const body=new DOMParser().parseFromString(image.html,'text/html');
 dependencies['card:prepared']=await eraDocumentVersion({root:{id:entry.id,html:body.body.innerHTML},children:{}});
 const prepared={...image,dependencies};
 return {request:{...request,locale:request.locale??'en'},entry:structuredClone(entry),project:source.project,projection,targetNames,prepared,imageRequest};
}
export type PreparedCodexEntryExport=Awaited<ReturnType<typeof prepareCodexEntryExport>>;

export async function codexEntryMarkdown(artifact:PreparedCodexEntryExport,includeMedia=false){
 const zip=new JSZip(),locale=artifact.request.locale,copy=vaultCopy(locale),sink=new MediaSink(zip,includeMedia);
 const stem=sanitizeFilename(artifact.entry.title||copy.untitled),path=stem+'.md';
 const parsed=new DOMParser().parseFromString(artifact.prepared.html,'text/html');parsed.querySelector('body > header')?.remove();
 for(const asset of artifact.prepared.mediaAttachments??[]){
  const stored=await sink.addBlob(asset.blob,'attachments',mediaFilename(asset)),p=parsed.createElement('p');
  if(stored){const link=parsed.createElement('a');link.setAttribute('href',relativePath(path,stored));link.textContent=asset.title;p.append(link);}
  else p.textContent=`${asset.title} — ${locale==='es'?'adjunto no incluido':'attachment not included'}`;
  parsed.body.append(p);
 }
 const cell=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\s*\n\s*/g,' / ').trim();
 // The incumbent prose converter does not handle DL/TABLE. Serialize these
 // generated rows here, without changing the default world-vault converter.
 for(const dl of parsed.querySelectorAll('dl')){
  const rows=[...dl.querySelectorAll('dt')].map(dt=>`| ${cell(dt.textContent??'')} | ${cell(dt.nextElementSibling?.textContent??'')} |`);
  dl.replaceWith(parsed.createTextNode(rows.length?`\n\n| ${locale==='es'?'Propiedad':'Property'} | ${locale==='es'?'Valor':'Value'} |\n| --- | --- |\n${rows.join('\n')}\n\n`:''));
 }
 for(const table of parsed.querySelectorAll('table')){
  const rows=[...table.rows].map(row=>[...row.cells].map(td=>cell(td.textContent??'')));if(!rows.length){table.remove();continue;}
  table.replaceWith(parsed.createTextNode('\n\n'+[`| ${rows[0].join(' | ')} |`,`| ${rows[0].map(()=>'---').join(' | ')} |`,...rows.slice(1).map(row=>`| ${row.join(' | ')} |`)].join('\n')+'\n\n'));
 }
 // Outside-card references are readable text, never links to absent files.
 const references=Object.fromEntries(Object.entries(artifact.entry.referenceFields??{}).map(([key,ids])=>[key,ids.map(id=>artifact.targetNames.get(id)??`Unavailable (${id})`)]));
 const row:CodexEntry={...artifact.entry,avatar:'',avatarOriginal:undefined,content:parsed.body.innerHTML,fields:{...artifact.projection.fields},referenceFields:references,relations:artifact.entry.relations.map(relation=>({...relation,targetTitle:artifact.targetNames.get(relation.targetId)??`Unavailable (${relation.targetId})`}))};
 const data={project:artifact.project,entries:[row],writings:[],notes:[],timelines:[],events:[],connections:[],maps:[],pins:[],outlines:[],beats:[],diary:[]};
 const context:RenderContext={copy,data,link:createLinkContext(row.projectId,[],new Map(),false),media:sink,writingNames:new Map()};
 const markdown=renderCodexEntry(row,{id:row.id,title:row.title,name:stem,path},context);
 zip.file(path,markdown);
 const blob=includeMedia?await zip.generateAsync({type:'blob'}):new Blob([markdown],{type:'text/markdown;charset=utf-8'});
 return{blob,fileName:stem+(includeMedia?'.zip':'.md'),mime:includeMedia?'application/zip':'text/markdown;charset=utf-8',bytes:blob.size,sourceVersion:artifact.prepared.sourceVersion,dependencies:artifact.prepared.dependencies,warnings:sink.warnings()};
}
export function captureCodexEntryImage(artifact:PreparedCodexEntryExport){return capturePreparedDocumentImage(artifact.imageRequest,artifact.prepared);}
export function saveCodexEntryPdf(artifact:PreparedCodexEntryExport){return exportHtmlPdf(artifact.prepared.html,sanitizeFilename(artifact.entry.title)+'.pdf');}
export function saveCodexEntryHtml(artifact:PreparedCodexEntryExport){downloadBlobFile(new Blob([artifact.prepared.html],{type:'text/html;charset=utf-8'}),sanitizeFilename(artifact.entry.title)+'.html');}

/** Reserve synchronously in the click handler, then never adopt a different document. */
export function reserveCodexPrintView(){
 const tab=window.open('about:blank','_blank');if(!tab)return null;
 tab.opener=null;const initial=tab.document,token={};let active=true;
 const owned=()=>{try{return active&&!tab.closed&&tab.document===initial&&tab.location.href==='about:blank'&&(initial as Document&{__cardPrintOwner?:object}).__cardPrintOwner===token;}catch{return false;}};
 (initial as Document&{__cardPrintOwner?:object}).__cardPrintOwner=token;
 return{show(html:string){if(!owned())return false;initial.open();initial.write(html);initial.close();active=false;return true;},cancel(){if(owned())tab.close();active=false;}};
}
