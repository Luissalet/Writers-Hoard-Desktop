import type {Project,Writing} from '@/types';
import type {ReaderPresentation} from './readerPresentationTypes';
import {defaultReaderPresentation} from './readerPresentationTypes';
import {applyEraReaderCover,cloneCoverJacket,validateReaderCover} from './coverDesign/model';

export const MAIN_MANUSCRIPT='main';
export type WritingSelection={kind:'world'}|{kind:'manuscript';id:string};
export interface MainManuscriptMetadata {title?:string;author?:string|null;blurb?:string|null;archivedAt?:number}
export interface Manuscript extends MainManuscriptMetadata {id:string;title:string;coverImage?:string;reader?:Pick<ReaderPresentation,'cover'|'playback'>;eraCovers?:Record<string,ReaderPresentation['cover']>;createdAt:number;updatedAt:number}
export interface ManuscriptCatalog {revision:number;main?:MainManuscriptMetadata;entries:Manuscript[]}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function writingManuscriptId(row:{manuscriptId?:unknown}):string{
 if(row.manuscriptId===undefined)return MAIN_MANUSCRIPT;
 if(typeof row.manuscriptId!=='string'||!row.manuscriptId||row.manuscriptId===MAIN_MANUSCRIPT||row.manuscriptId==='library')throw Error('manuscript_owner_invalid');
 return row.manuscriptId;
}
export function writingSelection(value:unknown):WritingSelection{
 if(value===undefined)return{kind:'manuscript',id:MAIN_MANUSCRIPT};
 if(!record(value)||value.kind!=='world'&&value.kind!=='manuscript'||value.kind==='manuscript'&&(typeof value.id!=='string'||!value.id||value.id==='library'))throw Error('manuscript_selection_invalid');
 return value.kind==='world'?{kind:'world'}:{kind:'manuscript',id:String(value.id)};
}
export function selectManuscriptWritings<T extends {manuscriptId?:unknown}>(rows:readonly T[],scope?:WritingSelection):T[]{
 const selection=writingSelection(scope);return rows.filter(row=>selection.kind==='world'||writingManuscriptId(row)===selection.id);
}
export function manuscriptMetadata(project:Pick<Project,'title'|'author'|'blurb'|'manuscriptCatalog'>,id=MAIN_MANUSCRIPT):MainManuscriptMetadata{
 if(id===MAIN_MANUSCRIPT)return{title:project.title,author:project.author,blurb:project.blurb,...project.manuscriptCatalog?.main};
 const entry=project.manuscriptCatalog?.entries.find(row=>row.id===id);if(!entry)throw Error('manuscript_missing');return entry;
}
export interface ManuscriptSummary {chapterCount:number;wordCount:number;lastChapterUpdatedAt:number|null;lastChapterId:string|null}
/** Invalid legacy timestamps stay data; only their date presentation is unavailable. */
export function manuscriptChapterUpdatedIso(timestamp:number|null):string|null{
 if(timestamp===null)return null;const date=new Date(timestamp);return Number.isFinite(date.getTime())?date.toISOString():null;
}
/** Available effective chapter rows, not world activity or catalogue changes. */
export function manuscriptSummary(project:Pick<Project,'id'|'title'|'author'|'blurb'|'manuscriptCatalog'>,writings:readonly Writing[],id=MAIN_MANUSCRIPT):ManuscriptSummary{
 manuscriptMetadata(project,id);
 let chapterCount=0,wordCount=0,last:Writing|undefined;
 for(const row of writings)if(row.projectId===project.id&&writingManuscriptId(row)===id){
  chapterCount++;wordCount+=row.wordCount;
  if(!last||row.updatedAt>last.updatedAt||row.updatedAt===last.updatedAt&&row.id<last.id)last=row;
 }
 return{chapterCount,wordCount,lastChapterUpdatedAt:last?.updatedAt??null,lastChapterId:last?.id??null};
}
export function validateManuscriptProject(project:{manuscriptCatalog?:unknown}):void{
 const catalog=project.manuscriptCatalog;if(catalog===undefined)return;
 if(!record(catalog)||!integer(catalog.revision)||!Array.isArray(catalog.entries))throw Error('manuscript_catalog_invalid');
 const metadata=(entry:Record<string,unknown>)=>{if(entry.title!==undefined&&(typeof entry.title!=='string'||!entry.title.trim())||['author','blurb'].some(key=>entry[key]!==undefined&&entry[key]!==null&&typeof entry[key]!=='string')||entry.archivedAt!==undefined&&!integer(entry.archivedAt))throw Error('manuscript_metadata_invalid');};
 if(catalog.main!==undefined){if(!record(catalog.main)||Object.keys(catalog.main).some(key=>!['title','author','blurb','archivedAt'].includes(key)))throw Error('manuscript_main_invalid');metadata(catalog.main);}
 const ids=new Set<string>();for(const entry of catalog.entries){
  if(!record(entry)||typeof entry.id!=='string'||!entry.id||['main','library'].includes(entry.id)||ids.has(entry.id)||typeof entry.title!=='string'||!entry.title.trim()||!integer(entry.createdAt)||!integer(entry.updatedAt))throw Error('manuscript_entry_invalid');ids.add(entry.id);metadata(entry);
  if(entry.coverImage!==undefined&&typeof entry.coverImage!=='string')throw Error('manuscript_cover_invalid');
  if(entry.reader!==undefined){if(!record(entry.reader))throw Error('manuscript_reader_invalid');validateReaderCover(entry.reader.cover);const p=entry.reader.playback;if(p!==undefined&&(!record(p)||!['read','play'].includes(String(p.mode))||typeof p.wordsPerMinute!=='number'||!Number.isFinite(p.wordsPerMinute)||p.wordsPerMinute<60||p.wordsPerMinute>1000))throw Error('manuscript_playback_invalid');}
  if(entry.eraCovers!==undefined){if(!record(entry.eraCovers))throw Error('manuscript_era_cover_invalid');for(const cover of Object.values(entry.eraCovers))validateReaderCover(cover);}
 }
}
export function assertManuscriptOwner(project:Pick<Project,'title'|'author'|'blurb'|'manuscriptCatalog'>,row:{manuscriptId?:unknown}){const id=writingManuscriptId(row);manuscriptMetadata(project,id);return id;}
/** Read projection only. Canonical world identity and shared chapter style ids survive. */
export function manuscriptProject(project:Project,selection?:WritingSelection,eraId?:string):Project{
 const scope=writingSelection(selection),era=eraId?project.worldEras?.find(row=>row.id===eraId):undefined;if(eraId&&!era)throw Error('world_era_missing');
 if(scope.kind==='world')return applyEraReaderCover(project,era);
 const metadata=manuscriptMetadata(project,scope.id);
 if(scope.id===MAIN_MANUSCRIPT)return{...applyEraReaderCover(project,era),title:metadata.title??project.title,author:metadata.author??undefined,blurb:metadata.blurb??undefined};
 const entry=project.manuscriptCatalog!.entries.find(row=>row.id===scope.id)!,initial=defaultReaderPresentation();
 return{...project,title:entry.title,author:entry.author??undefined,blurb:entry.blurb??undefined,coverImage:entry.coverImage,readerPresentation:{...initial,...entry.reader,revision:project.readerPresentation?.revision??0,cover:eraId?entry.eraCovers?.[eraId]??entry.reader?.cover??initial.cover:entry.reader?.cover??initial.cover,chapters:project.readerPresentation?.chapters??{}}};
}
export function remapManuscriptCatalog(catalog:ManuscriptCatalog|undefined,remap:(id:string,prefix:string)=>string):ManuscriptCatalog|undefined{
 if(catalog===undefined)return;validateManuscriptProject({manuscriptCatalog:catalog});
 return{...structuredClone(catalog),revision:0,entries:catalog.entries.map(entry=>({...structuredClone(entry),id:remap(entry.id,'manuscript'),...(entry.reader?{reader:{...structuredClone(entry.reader),cover:cloneCoverJacket(entry.reader.cover,remap)}}:{}),...(entry.eraCovers?{eraCovers:Object.fromEntries(Object.entries(entry.eraCovers).map(([id,cover])=>[remap(id,'era'),cloneCoverJacket(cover,remap)]))}:{})}))};
}
/**
 * Resolve identity before interpreting missing legacy fields. Live Base is
 * authoritative; explicit owners in era/archive history must agree with it.
 */
export function structuralManuscriptOwners(writings:readonly unknown[],variants:readonly unknown[]=[],archives:readonly unknown[]=[]):Map<string,string>{
 const candidates:{row:Record<string,unknown>;base:boolean}[]=[];
 for(const row of writings)if(record(row))candidates.push({row,base:true});
 for(const raw of archives)if(record(raw)&&Array.isArray(raw.mutations))for(const mutation of raw.mutations)if(record(mutation)&&mutation.table==='writings')for(const row of [mutation.beforeRow,mutation.afterRow])if(record(row))candidates.push({row,base:false});
 for(const raw of variants)if(record(raw)&&raw.kind==='writings')for(const state of [raw,...Array.isArray(raw.history)?raw.history:[]])if(record(state)&&record(state.document)&&record(state.document.root))candidates.push({row:state.document.root,base:false});
 const owners=new Map<string,string>();
 for(const {row,base} of candidates)if(typeof row.id==='string'&&(base||row.manuscriptId!==undefined)){
  const owner=writingManuscriptId({manuscriptId:row.manuscriptId}),known=owners.get(row.id);if(known!==undefined&&known!==owner)throw Error('manuscript_owner_conflict');owners.set(row.id,owner);
 }
 for(const {row} of candidates)if(typeof row.id==='string'&&!owners.has(row.id))owners.set(row.id,MAIN_MANUSCRIPT);
 return owners;
}
/** Portable preflight before any clear/import. Legacy absent owners inherit origin. */
export function validateManuscriptContents(project:Pick<Project,'id'|'title'|'author'|'blurb'|'manuscriptCatalog'>,writings:readonly unknown[],variants:readonly unknown[]=[],profiles:readonly unknown[]=[],archives:readonly unknown[]=[]):void{
 validateManuscriptProject(project);
 const owners=structuralManuscriptOwners(writings,variants,archives);for(const owner of owners.values())manuscriptMetadata(project,owner);
 for(const row of writings)if(record(row)&&row.projectId!==undefined&&row.projectId!==project.id)throw Error('manuscript_project_mismatch');
 for(const raw of profiles)if(record(raw)){const scope=writingSelection(raw.writingScope);if(scope.kind==='manuscript'){manuscriptMetadata(project,scope.id);for(const id of [...Array.isArray(raw.selectedWritingIds)?raw.selectedWritingIds:[],...Array.isArray(raw.writingOrder)?raw.writingOrder:[]])if(typeof id==='string'&&owners.has(id)&&owners.get(id)!==scope.id)throw Error('manuscript_profile_selection_invalid');}}
}
