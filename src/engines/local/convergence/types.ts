import type {RichRange,RichSplitCapture,RichJoinCapture,RichResolvedPoint} from './richTypes';
import type {RichBlockCapture,RichBlockMoveCapture,RichBlockPlacement} from './blocks';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateCodec} from '../stateCodec';
import type {LocalToolStateAction} from '../stateActions';

export interface LocalToolConvergenceMetadata {
 namespace:string;
 codec:LocalToolStateCodec;
 validationId:string;
 schemaEpoch:string;
}
/** Executable validation is supplied by the current host definition, never by JSON. */
export interface LocalToolConvergenceContract<T extends LocalToolJson=LocalToolJson> extends LocalToolConvergenceMetadata {
 validateState:(value:LocalToolJson)=>value is T;
}
interface LocalToolConvergenceIdentityFields {
 namespace:string;
 genesisId:string;
 codecHash:string;
 validationId:string;
 schemaEpoch:string;
}
export type LocalToolConvergenceIdentityV1=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'1';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV2=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'2';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV3=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'3';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV4=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'4';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentity=LocalToolConvergenceIdentityV1|LocalToolConvergenceIdentityV2|LocalToolConvergenceIdentityV3|LocalToolConvergenceIdentityV4;
export type LocalToolConvergenceCheckpoint=LocalToolConvergenceIdentity&{
 format:'writers-hoard-local-convergence/1';
 checkpointBase64:string;
 stateVectorBase64:string;
}
export type LocalToolConvergenceUpdate=LocalToolConvergenceIdentity&{
 format:'writers-hoard-local-convergence-update/1';
 updateBase64:string;
}
export interface LocalToolValidationConflict {
 kind:'validation';
 policy:'authored-valid-snapshot/1';
 validationId:string;
 rawFingerprint:string;
 raw:LocalToolJson;
}
export interface LocalToolConvergenceView<T extends LocalToolJson=LocalToolJson> {
 data:T;
 conflict:LocalToolValidationConflict|null;
}
export interface LocalToolConvergenceChange<T extends LocalToolJson=LocalToolJson> extends LocalToolConvergenceView<T> {
 changed:boolean;
 causalChanged:boolean;
 pending:boolean;
}
export interface LocalToolReplicaEdit<T extends LocalToolJson=LocalToolJson> extends LocalToolConvergenceChange<T> {
 update:LocalToolConvergenceUpdate;
 receiptId:string|null;
}
/** SDK-visible capability; no host receipt recipe, database or callback in this object. */
export interface LocalToolReplica<T extends LocalToolJson=LocalToolJson> {
 richBlockEmptyItemCapture(field:string,nodeId:string):import('./blockExit').RichBlockEmptyItemCapture;
 richBlockSplitCapture(field:string,nodeId:string,at:number):import('./blockText').RichBlockSplitCapture;
 richBlockJoinCapture(field:string,leftNodeId:string,rightNodeId:string):import('./blockText').RichBlockJoinCapture;
 richBlockEditCapture(field:string,nodeIds:string[],destination?:RichBlockPlacement):import('./blockEditingTypes').RichBlockEditCapture;
 richBlockCapture(field:string,options:{nodeIds:string[]}):RichBlockCapture;
 richBlockMoveCapture(field:string,nodeId:string,destination:RichBlockPlacement):RichBlockMoveCapture;
 richRange(field:string,nodeId:string,from:number,to:number,options?:{affinity:'left'|'right'}):RichRange;
 resolveRichPoint(point:RichRange):RichResolvedPoint;
 richSplitCapture(field:string,nodeId:string,at:number,options?:{affinity:'left'|'right'}):RichSplitCapture;
 richJoinCapture(field:string,leftNodeId:string,rightNodeId:string):RichJoinCapture;
 textRange(field:string,from:number,to:number):LocalToolPlainRange;
 read():T;
 inspect():LocalToolConvergenceView<T>;
 apply(actions:readonly LocalToolStateAction[]):LocalToolReplicaEdit<T>;
 receive(update:LocalToolConvergenceUpdate):LocalToolConvergenceChange<T>;
 export(stateVectorBase64?:string):LocalToolConvergenceUpdate;
 checkpoint():LocalToolConvergenceCheckpoint;
 undo(receiptId:string):LocalToolReplicaEdit<T>;
 redo(receiptId:string):LocalToolReplicaEdit<T>;
 destroy():void;
}
/** Opaque, versioned JSON owned by the host's receipt/token, never an SDK/MCP argument. */
export interface LocalToolConvergenceReceipt {
 format:'writers-hoard-local-convergence-receipt/1';
 id:string;
 identity:LocalToolConvergenceIdentity;
 mode:'undo'|'redo';
 record:LocalToolJson;
}
/** Preparing this object does not consume a token. Host consumption happens onCommit only. */
export interface LocalToolConvergencePreparation<T extends LocalToolJson=LocalToolJson> extends LocalToolConvergenceChange<T> {
 beforeFingerprint:string;
 checkpoint:LocalToolConvergenceCheckpoint;
 update:LocalToolConvergenceUpdate;
 consumeReceiptId:string|null;
 receipt:LocalToolConvergenceReceipt|null;
}
export interface LocalToolReplicaOptions<T extends LocalToolJson=LocalToolJson> {
 authorId:string;
 contract:LocalToolConvergenceContract<T>;
}

export interface LocalToolPlainRange {format:'writers-hoard-local-plain-range/1';identity:LocalToolConvergenceIdentity;field:string;afterPlacementId:string|null;deleteIds:readonly string[]}
