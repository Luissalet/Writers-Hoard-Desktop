import Dexie from 'dexie';
import {db} from '@/db';
import {notifyProjectsChanged} from '@/db/operations';
import {eraDocumentKinds,type WorldEraScope} from '@/services/worldEras/types';
import {eraWritingOperations} from '@/services/worldEras/writings';
import {safeReaderPresentation} from '@/engines/writings/readerPresentation';
import {buildReaderHtml} from '@/engines/writings/readerExport';
import {sha256Hex} from '@/services/judge/text';
import {countWords} from '@/utils/text';
import {codexTextLinkTarget} from '@/components/editor/codexBlocks/inlineLinks';
import type {Writing} from '@/types';
import type {WritingSnapshot} from '@/engines/writings/snapshotTypes';
import type {MissingEditionReference,PublishedEdition,PublishEditionInput,RestoreEditionInput} from './types';
import {validatePublishedEditionsProject} from './validation';
import {capturePublicationSources,capturePublicationSnapshot,publicationReaderSource,publicationSourceFingerprint} from './snapshot';
import {findLocalToolBlocksInHtml} from '@/engines/local/blocks/types';
import {remapLocalToolReferences} from '@/engines/local/stateCodec';

export class PublishedEditionConflict extends Error{constructor(){super('published_edition_conflict');this.name='PublishedEditionConflict';}}
const revision=(value:number|undefined)=>value??0;
async function projectFor(projectId:string){const project=await db.projects.get(projectId);if(!project)throw Error('project_missing');validatePublishedEditionsProject(project);return project;}
function sameRevision(actual:number|undefined,expected:number){if(!Number.isSafeInteger(expected)||expected<0||revision(actual)!==expected)throw new PublishedEditionConflict();}
function orderedSelection(rows:Writing[],ids:string[]){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id))throw Error('published_edition_selection_invalid');
 return ids.map(id=>{const row=rows.find(row=>row.id===id);if(!row)throw Error('published_edition_chapter_missing');return row;});
}
function selectedDrafts(writings:Writing[], drafts:WritingSnapshot[], choices:Record<string,string>|undefined){
 if(choices!==undefined&&(!choices||typeof choices!=='object'||Array.isArray(choices)||Object.keys(choices).some(id=>!writings.some(row=>row.id===id))||Object.values(choices).some(id=>typeof id!=='string'||!id)))throw Error('published_edition_draft_selection_invalid');
 return writings.map(writing=>{const id=choices?.[writing.id];if(!id)return{writing,sourceUpdatedAt:writing.updatedAt};const draft=drafts.find(row=>row.id===id&&row.projectId===writing.projectId&&row.writingId===writing.id&&row.kind==='parallel-draft');if(!draft)throw Error('published_edition_draft_missing');return{sourceDraftId:draft.id,sourceDraftName:draft.draftName,sourceUpdatedAt:draft.updatedAt??draft.createdAt,writing:{...writing,content:draft.content,wordCount:countWords(draft.content),updatedAt:draft.updatedAt??draft.createdAt}};});
}
export async function listPublishedEditions(projectId:string,eraId?:string){const project=await projectFor(projectId);return{revision:revision(project.publishedEditionRevision),editions:(project.publishedEditions??[]).filter(edition=>eraId===undefined||edition.eraId===eraId).map(({reader,chapters,...edition})=>({...edition,chapters:chapters.map(chapter=>({id:chapter.writing.id,title:chapter.writing.title,sourceUpdatedAt:chapter.sourceUpdatedAt,wordCount:chapter.writing.wordCount})),reader:{filename:reader.filename,sha256:reader.sha256,characters:reader.html.length}}))};}
export async function getPublishedEdition(projectId:string,editionId:string):Promise<PublishedEdition>{
 const project=await projectFor(projectId),edition=project.publishedEditions?.find(edition=>edition.id===editionId);if(!edition)throw Error('published_edition_missing');
 if(await sha256Hex(edition.reader.html)!==edition.reader.sha256)throw Error('published_edition_artifact_changed');return structuredClone(edition);
}
/** Normal preview/capture seam; commit rechecks sources and edition CAS after rendering. */
export async function preparePublishedEdition(input:PublishEditionInput):Promise<PublishedEdition>{
 if(typeof input.title!=='string'||!input.title.trim()||!['es','en'].includes(input.locale))throw Error('published_edition_invalid');
 const scope={projectId:input.projectId,eraId:input.eraId},snapshot=await capturePublicationSnapshot(scope),source=publicationReaderSource(snapshot),project=source.project;sameRevision(project.publishedEditionRevision,input.expectedRevision);
 if(input.supersedesEditionId&&!project.publishedEditions?.some(edition=>edition.id===input.supersedesEditionId))throw Error('published_edition_parent_missing');
 const chapters=selectedDrafts(orderedSelection(source.writings,input.chapterIds),source.parallelDrafts,input.chapterDraftIds),writings=chapters.map(chapter=>chapter.writing),settings=safeReaderPresentation(project.readerPresentation),presentation={...settings,chapters:Object.fromEntries(Object.entries(settings.chapters).filter(([id])=>input.chapterIds.includes(id)))},stamp=await publicationSourceFingerprint(snapshot),reader=await buildReaderHtml(project,writings,presentation,input.locale,scope,source),now=Date.now();
 const edition:PublishedEdition={id:crypto.randomUUID(),projectId:input.projectId,title:input.title.trim(),publishedAt:now,locale:input.locale,eraId:input.eraId,eraName:project.worldEras?.find(era=>era.id===input.eraId)?.name,supersedesEditionId:input.supersedesEditionId,sourceProjectTitle:project.title,sourceFingerprint:stamp,chapters:structuredClone(chapters),presentation,reader:{...reader,sha256:await sha256Hex(reader.html)}};
 validatePublishedEditionsProject({id:input.projectId,publishedEditions:[{...edition,supersedesEditionId:undefined}]});return edition;
}
export async function commitPublishedEdition(edition:PublishedEdition,expectedRevision:number){
 validatePublishedEditionsProject({id:edition.projectId,publishedEditions:[{...edition,supersedesEditionId:undefined}]});
 const result=await db.transaction('rw',db.tables,tx=>Dexie.Promise.resolve(capturePublicationSources(tx,{projectId:edition.projectId,eraId:edition.eraId})).then(snapshot=>{
  const project=snapshot.project;validatePublishedEditionsProject(project);sameRevision(project.publishedEditionRevision,expectedRevision);
  if(project.publishedEditions?.some(row=>row.id===edition.id))throw new PublishedEditionConflict();
  // A Dexie continuation retains the transaction context for normal DBCore middleware too.
  return Dexie.waitFor(Promise.all([publicationSourceFingerprint(snapshot),sha256Hex(edition.reader.html)])).then(([stamp,digest])=>{
   if(stamp!==edition.sourceFingerprint||digest!==edition.reader.sha256)throw new PublishedEditionConflict();
   const editions=[...project.publishedEditions??[],structuredClone(edition)],next=revision(project.publishedEditionRevision)+1;validatePublishedEditionsProject({id:project.id,publishedEditions:editions,publishedEditionRevision:next});
   return tx.table('projects').update(project.id,{publishedEditions:editions,publishedEditionRevision:next,updatedAt:Math.max(Date.now(),project.updatedAt+1)}).then(()=>({edition:structuredClone(edition),revision:next}));
  });
 }));notifyProjectsChanged();return result;
}
export async function publishEdition(input:PublishEditionInput){return commitPublishedEdition(await preparePublishedEdition(input),input.expectedRevision);}

const toolKinds:Record<string,typeof eraDocumentKinds[number]>={'dialog-scene':'dialog-scene',worldgen:'worldgen',maps:'maps',board:'board',timeline:'timeline',dictionary:'dictionary',tables:'tables',genealogy:'genealogy','relation-tree':'genealogy','character-sheets':'character-sheets',radar:'radar','model-viewer':'model-viewer','local-tool':'local-tool'};
function missingReferences(scope:WorldEraScope,writings:Writing[],source:ReturnType<typeof publicationReaderSource>):MissingEditionReference[]{
 const refs:MissingEditionReference[]=[];
 for(const writing of writings){const template=document.createElement('template');template.innerHTML=writing.content;const requested=new Map<string,{kind:typeof eraDocumentKinds[number];id:string;namespace?:string}>();
  for(const node of template.content.querySelectorAll('[data-wh-codex-block="true"],[data-wh-media-block="true"],[data-wh-tool-block="true"]')){
   if(node.getAttribute('data-project-id')!==scope.projectId)continue;const kind=node.hasAttribute('data-wh-codex-block')?'codex':node.hasAttribute('data-wh-media-block')?'media':toolKinds[node.getAttribute('data-tool-kind')??''],id=node.getAttribute(kind==='codex'?'data-entry-id':kind==='media'?'data-asset-id':'data-document-id');if(kind&&id){const namespace=kind==='local-tool'?node.getAttribute('data-namespace')??'':undefined;requested.set(kind==='local-tool'?JSON.stringify([kind,id,namespace]):`${kind}:${id}`,{kind,id,...(namespace!==undefined?{namespace}:{})});}
  }
  for(const anchor of template.content.querySelectorAll('a[href]')){const id=codexTextLinkTarget(anchor.getAttribute('href')!,scope.projectId);if(id)requested.set('codex:'+id,{kind:'codex',id});}
  for(const span of findLocalToolBlocksInHtml(writing.content)){if(span.projectId!==scope.projectId||span.envelope.scope!=='host')continue;remapLocalToolReferences(span.envelope.data,span.envelope.codec,(kind,id)=>{requested.set(`${kind}:${id}`,{kind,id});return id;});}
  for(const ref of requested.values()){const present=source.hasDocument(ref.kind,ref.id)&&(ref.namespace===undefined||source.project.sourceToolDocuments?.some(row=>row.id===ref.id&&row.namespace===ref.namespace));if(!present&&!refs.some(missing=>missing.kind===ref.kind&&missing.id===ref.id&&missing.chapterId===writing.id))refs.push({kind:ref.kind,id:ref.id,chapterId:writing.id});}
 }return refs;
}
export async function restorePublishedEdition(input:RestoreEditionInput){
 const edition=await getPublishedEdition(input.projectId,input.editionId),scope={projectId:input.projectId,eraId:input.targetEraId};
 const selection=orderedSelection(edition.chapters.map(chapter=>chapter.writing),input.chapterIds??edition.chapters.map(chapter=>chapter.writing.id));
 const result=await db.transaction('rw',db.tables,async tx=>{
  const snapshot=await capturePublicationSources(tx,scope),sourceData=publicationReaderSource(snapshot),project=snapshot.project;validatePublishedEditionsProject(project);sameRevision(project.publishedEditionRevision,input.expectedRevision);
  if(!project.publishedEditions?.some(row=>row.id===edition.id&&row.reader.sha256===edition.reader.sha256))throw new PublishedEditionConflict();
  const missing=missingReferences(scope,selection,sourceData),ops=eraWritingOperations(scope),now=Date.now(),created:Writing[]=[];
  const presentation=safeReaderPresentation(project.readerPresentation),draft=structuredClone(presentation);
  for(const source of selection){const row:Writing={...structuredClone(source),id:crypto.randomUUID(),projectId:input.projectId,title:source.title,status:'draft',content:source.content,wordCount:countWords(source.content),createdAt:now,updatedAt:now};delete row.chapter;delete row.googleDocId;delete row.googleDocUrl;delete row.googleDocName;delete row.lastSyncedAt;delete row.syncDirection;delete row.isGoogleDoc;await ops.createWriting(row);created.push(row);
   const style=edition.presentation.chapters[source.id];if(style){const restored=structuredClone(style),ids=new Set([style.audio?.assetId,...style.paragraphAudio?.map(cue=>cue.track.assetId)??[]].filter((id):id is string=>!!id)),absent=new Set<string>();for(const id of ids)if(!sourceData.rows('localMediaAssets').some(asset=>asset.id===id)){absent.add(id);if(!missing.some(ref=>ref.kind==='media'&&ref.id===id&&ref.chapterId===source.id))missing.push({kind:'media',id,chapterId:source.id});}if(restored.audio&&absent.has(restored.audio.assetId))delete restored.audio;if(restored.paragraphAudio)restored.paragraphAudio=restored.paragraphAudio.filter(cue=>!absent.has(cue.track.assetId));Object.defineProperty(draft.chapters,row.id,{value:restored,enumerable:true,configurable:true,writable:true});}
  }
  if(JSON.stringify(draft)!==JSON.stringify(presentation))await tx.table('projects').update(input.projectId,{readerPresentation:{...draft,revision:presentation.revision+1},updatedAt:Math.max(Date.now(),project.updatedAt+1)});
  return{writings:created,missingReferences:missing,editionId:edition.id};
 });notifyProjectsChanged();return result;
}
