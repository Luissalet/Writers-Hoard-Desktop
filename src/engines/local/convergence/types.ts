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
export interface LocalToolConvergenceIdentity {
 namespace:string;
 genesisId:string;
 engine:{id:'writers-hoard-yjs-registers';version:'1';updateFormat:'yjs-v1';libraryVersion:'13.6.33'};
 codecHash:string;
 validationId:string;
 schemaEpoch:string;
}
export interface LocalToolConvergenceCheckpoint extends LocalToolConvergenceIdentity {
 format:'writers-hoard-local-convergence/1';
 checkpointBase64:string;
 stateVectorBase64:string;
}
export interface LocalToolConvergenceUpdate extends LocalToolConvergenceIdentity {
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
