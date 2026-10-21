import { PROJECT_ID,s,type BridgeTool } from '@/services/aiBridge/schema';
import { eraDocumentKinds } from '@/services/worldEras/types';
const scope={projectId:PROJECT_ID,kind:s('Base logical document kind.',{enum:[...eraDocumentKinds]}),entityId:s('Logical document ID.')};
const nullable={anyOf:[{type:'null'},{type:'string'}]},historyId=s('Retained history version ID.'),expectedVersion=s('Current full document hash read from history_list.');
const tool=(name:string,description:string,writes:boolean,properties:Record<string,unknown>={},required:string[]=[]):BridgeTool=>({name,description,writes,group:'core',schema:{type:'object',properties:{...scope,...properties},required:name==='wh_document_history_list'?[]:['kind','entityId',...required],additionalProperties:false}});
export const DOCUMENT_HISTORY_TOOLS:BridgeTool[]=[
 tool('wh_document_history_list','With no kind/entityId, list project documents with retained history, including removed documents. Supply both to browse Base edit history metadata for every supported kind and read the current CAS token. Opening/listing creates no version. Named eras retain their separate world_era_versions.',false),
 tool('wh_document_history_get','Read one complete retained Base document and owned children. Binary fields use the portable Blob envelope. This preview does not write.',false,{historyId},['historyId']),
 tool('wh_document_history_save','Deliberately retain the current Base document as a named manual restore point; ordinary edits already retain their prior state automatically. Requires the current CAS token.',true,{expectedVersion},['expectedVersion']),
 tool('wh_document_history_restore','Restore an immutable Base version and its children atomically. expectedVersion:null restores a missing document. Preserves the displaced present and returns an undo receipt. Stale tokens preserve newer edits.',true,{historyId,expectedVersion:nullable},['historyId','expectedVersion']),
 tool('wh_document_history_undo','Undo a restore using its exact receipt fields. Refuses to overwrite any edits made since restore. historyId:null removes a document that was absent before that restore, preserving its recoverable history.',true,{historyId:nullable,expectedVersion},['historyId','expectedVersion']),
];
