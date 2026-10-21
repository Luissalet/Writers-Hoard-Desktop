import type {Writing} from '@/types';
import type {WorldEraScope} from '@/services/worldEras/types';
import {eraWritingOperations} from '@/services/worldEras/writings';
import {WritingConflictError} from '../operations';
export interface AuthoredBaseline {title:string;content:string;wordCount:number;updatedAt:number;toolDock?:Writing['toolDock']}
/** Only the authored fields this editor actually sends; metadata is never replayed. */
export function dockMetadataAdvance(baseline:AuthoredBaseline,current:Writing){return current.title===baseline.title&&current.content===baseline.content&&current.wordCount===baseline.wordCount&&JSON.stringify(current.toolDock)!==JSON.stringify(baseline.toolDock);}
export async function saveAuthoredWriting(scope:WorldEraScope,id:string,baseline:AuthoredBaseline,next:Pick<Writing,'title'|'content'|'wordCount'>){
 if(Object.keys(next).length!==3||Object.keys(next).some(key=>!['title','content','wordCount'].includes(key)))throw Error('writing_authored_payload_invalid');
 const operations=eraWritingOperations(scope);
 try{return{version:await operations.updateWritingAtVersion(id,next,baseline.updatedAt),toolDock:baseline.toolDock};}
 catch(error){if(!(error instanceof WritingConflictError)||!dockMetadataAdvance(baseline,error.current))throw error;return{version:await operations.updateWritingAtVersion(id,next,error.current.updatedAt),toolDock:error.current.toolDock};}
}
