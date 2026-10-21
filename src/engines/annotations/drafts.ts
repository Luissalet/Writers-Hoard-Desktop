import {createLocalDraftStore} from '@/hooks/localDraftStore';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {AnnotationMention} from './types';
export interface AnnotationDraft {kind:'body'|'reply'|'edit-reply'|'new';replyId?:string;body:string;mentions:AnnotationMention[];revision:number}
export function annotationDrafts(scope:WorldEraScope){return createLocalDraftStore<AnnotationDraft>(`wh.annotation-drafts.v1.${scope.projectId}${scope.eraId?`.era:${encodeURIComponent(scope.eraId)}`:''}`,(value):value is AnnotationDraft=>!!value&&typeof value==='object'&&typeof (value as AnnotationDraft).body==='string'&&Array.isArray((value as AnnotationDraft).mentions)&&['body','reply','edit-reply','new'].includes((value as AnnotationDraft).kind)&&Number.isSafeInteger((value as AnnotationDraft).revision));}
