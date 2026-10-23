import { cloneManuscriptWritingSource } from '@/engines/writings/manuscriptReview/sourceMetadata';
import { validateProjectCoverMetadata, cloneCoverJacket } from '@/engines/writings/coverDesign/model';
import type {PublishedEdition,PublishedEditionsProject} from './types';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const hash=(value:unknown)=>typeof value==='string'&&/^[\da-f]{64}$/.test(value);
function presentationValid(value:unknown){
 if(!record(value)||!integer(value.revision)||!record(value.cover)||!record(value.chapters))return false;
 const cover=value.cover;if(!['hardcover','paperback','paper'].includes(String(cover.style))||typeof cover.color!=='string'||!/^#[\da-f]{6}$/i.test(cover.color)||!['none','linen','lines'].includes(String(cover.texture))||typeof cover.artwork!=='boolean'||typeof cover.showAtStart!=='boolean')return false;
 const track=(candidate:unknown)=>record(candidate)&&text(candidate.assetId)&&typeof candidate.volume==='number'&&Number.isFinite(candidate.volume)&&candidate.volume>=0&&candidate.volume<=1&&typeof candidate.loop==='boolean';
 if(value.playback!==undefined&&(!record(value.playback)||!['read','play'].includes(String(value.playback.mode))||typeof value.playback.wordsPerMinute!=='number'||!Number.isFinite(value.playback.wordsPerMinute)||value.playback.wordsPerMinute<60||value.playback.wordsPerMinute>1000))return false;
 for(const chapter of Object.values(value.chapters)){
  if(!record(chapter)||!['inherit','serif','sans','mono'].includes(String(chapter.font))||typeof chapter.background!=='string'||chapter.background!==''&&!/^#[\da-f]{6}$/i.test(chapter.background)||!['above','beside','banner','none'].includes(String(chapter.imageLayout))||!['flow','pages'].includes(String(chapter.mode))||chapter.image!==undefined&&typeof chapter.image!=='string'||chapter.audio!==undefined&&!track(chapter.audio))return false;
  if(chapter.paragraphAudio!==undefined&&(!Array.isArray(chapter.paragraphAudio)||chapter.paragraphAudio.some(cue=>!record(cue)||!integer(cue.paragraphIndex)||typeof cue.fingerprint!=='string'||!/^\d+:\d+$/.test(cue.fingerprint)||typeof cue.excerpt!=='string'||!track(cue.track)||cue.through!==undefined&&(!integer(cue.through)||cue.through<=cue.paragraphIndex))))return false;
 }
 return true;
}
/** Metadata preflight; actual HTML digest is verified again before opening/export. */
export function validatePublishedEditionsProject(project:{id?:unknown;publishedEditions?:unknown;publishedEditionRevision?:unknown}):void{
 if(project.publishedEditionRevision!==undefined&&!integer(project.publishedEditionRevision))throw Error('published_edition_revision_invalid');
 if(project.publishedEditions===undefined)return;
 if(!Array.isArray(project.publishedEditions))throw Error('published_editions_invalid');
 const ids=new Set<string>();
 for(const edition of project.publishedEditions){
  if(!record(edition)||!text(edition.id)||ids.has(edition.id)||!text(edition.projectId)||project.id!==undefined&&edition.projectId!==project.id||!text(edition.title)||!integer(edition.publishedAt)||!['es','en'].includes(String(edition.locale))||edition.eraId!==undefined&&!text(edition.eraId)||edition.eraName!==undefined&&typeof edition.eraName!=='string'||edition.supersedesEditionId!==undefined&&!text(edition.supersedesEditionId)||typeof edition.sourceProjectTitle!=='string'||!hash(edition.sourceFingerprint)||!Array.isArray(edition.chapters)||!edition.chapters.length||!record(edition.presentation)||!record(edition.presentation.cover)||!record(edition.presentation.chapters)||!record(edition.reader)||typeof edition.reader.html!=='string'||!/^<!doctype html>/i.test(edition.reader.html)||!text(edition.reader.filename)||!hash(edition.reader.sha256))throw Error('published_edition_invalid');
  validateProjectCoverMetadata({publishedEditions:[{presentation:edition.presentation}]});
  if(!presentationValid(edition.presentation))throw Error('published_edition_presentation_invalid');
  if(edition.supersedesEditionId!==undefined&&!ids.has(edition.supersedesEditionId))throw Error('published_edition_parent_missing');
  ids.add(edition.id);const chapterIds=new Set<string>();
  for(const chapter of edition.chapters){
   if(!record(chapter)||!integer(chapter.sourceUpdatedAt)||chapter.sourceDraftId!==undefined&&!text(chapter.sourceDraftId)||chapter.sourceDraftName!==undefined&&typeof chapter.sourceDraftName!=='string'||!record(chapter.writing))throw Error('published_edition_chapter_invalid');const writing=chapter.writing;
   if(!text(writing.id)||chapterIds.has(writing.id)||writing.projectId!==edition.projectId||typeof writing.title!=='string'||typeof writing.content!=='string'||!integer(writing.wordCount)||!integer(writing.createdAt)||!integer(writing.updatedAt)||!['idea','draft','finished'].includes(String(writing.status))||!Array.isArray(writing.tags)||writing.tags.some(tag=>typeof tag!=='string'))throw Error('published_edition_chapter_invalid');chapterIds.add(writing.id);
  }
 }
}
/** Artifact fragment ids stay local to the byte-identical HTML; editable snapshots remap. */
export function remapPublishedEditions(project:PublishedEditionsProject,remap:(id:string,prefix:string)=>string,remapContent:(html:string)=>string,remapMedia:(id:string)=>string=id=>remap(id,'media')):Pick<PublishedEditionsProject,'publishedEditions'|'publishedEditionRevision'>{
 validatePublishedEditionsProject(project);
 return{publishedEditionRevision:0,publishedEditions:project.publishedEditions?.map((edition):PublishedEdition=>({...structuredClone(edition),id:remap(edition.id,'edition'),projectId:remap(edition.projectId,'proj'),eraId:edition.eraId?remap(edition.eraId,'era'):undefined,supersedesEditionId:edition.supersedesEditionId?remap(edition.supersedesEditionId,'edition'):undefined,chapters:edition.chapters.map(chapter=>({...chapter,sourceDraftId:chapter.sourceDraftId?remap(chapter.sourceDraftId,'wsnap'):undefined,writing:{...structuredClone(chapter.writing),manuscriptSource:cloneManuscriptWritingSource(chapter.writing.manuscriptSource,remap),id:remap(chapter.writing.id,'wr'),projectId:remap(chapter.writing.projectId,'proj'),content:remapContent(chapter.writing.content)}})),presentation:{...structuredClone(edition.presentation),cover:cloneCoverJacket(edition.presentation.cover,remap),chapters:Object.fromEntries(Object.entries(edition.presentation.chapters).map(([id,value])=>[remap(id,'wr'),{...structuredClone(value),audio:value.audio?{...value.audio,assetId:remapMedia(value.audio.assetId)}:undefined,paragraphAudio:value.paragraphAudio?.map(cue=>({...cue,track:{...cue.track,assetId:remapMedia(cue.track.assetId)}}))}]))}}))};
}
