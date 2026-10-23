import type {Writing} from '@/types';
import type {ReaderPresentation} from '@/engines/writings/readerPresentationTypes';

export interface PublishedEditionChapter {
  sourceDraftId?:string;
  sourceDraftName?:string;
  sourceUpdatedAt:number;
  writing:Writing;
}
/** Append-only local publication. reader.html is an independent frozen artifact. */
export interface PublishedEdition {
  writingScope?:import('@/engines/writings/manuscripts').WritingSelection;
  manuscriptTitle?:string;
  id:string;
  projectId:string;
  title:string;
  publishedAt:number;
  locale:'es'|'en';
  eraId?:string;
  eraName?:string;
  supersedesEditionId?:string;
  sourceProjectTitle:string;
  sourceFingerprint:string;
  chapters:PublishedEditionChapter[];
  presentation:ReaderPresentation;
  reader:{html:string;filename:string;sha256:string};
}
export interface PublishedEditionsProject {
  id?:string;
  publishedEditions?:PublishedEdition[];
  publishedEditionRevision?:number;
}
export interface PublishEditionInput {
  writingScope?:import('@/engines/writings/manuscripts').WritingSelection;
  projectId:string;
  eraId?:string;
  chapterIds:string[];
  chapterDraftIds?:Record<string,string>;
  title:string;
  locale:'es'|'en';
  expectedRevision:number;
  supersedesEditionId?:string;
}
export interface RestoreEditionInput {
  targetManuscriptId?:string;
  projectId:string;
  editionId:string;
  chapterIds?:string[];
  targetEraId?:string;
  expectedRevision:number;
}
export interface MissingEditionReference {kind:string;id:string;chapterId:string}
