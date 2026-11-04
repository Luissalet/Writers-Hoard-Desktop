import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateCodec} from '../stateCodecFormat';
export interface LocalToolConvergenceMetadata {
 namespace:string;
 codec:LocalToolStateCodec;
 validationId:string;
 schemaEpoch:string;
}
/** Executable validation is supplied by the current host definition, never by JSON. */
export interface LocalToolConvergenceContract<T extends LocalToolJson=LocalToolJson> extends LocalToolConvergenceMetadata {
 validateState:(value:LocalToolJson)=>value is T;
 richAdoption?:LocalToolRichAdoption;
}
export interface LocalToolRichAdoption {transition:'rich-links-3-to-4/1';from:LocalToolConvergenceMetadata}
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
export type LocalToolConvergenceIdentityV5=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'5';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV6=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'6';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV7=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'7';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV8=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'8';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV9=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'9';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV10=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'10';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV11=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'11';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV12=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'12';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV13=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'13';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentityV14=LocalToolConvergenceIdentityFields&{engine:{id:'writers-hoard-yjs-registers';version:'14';updateFormat:'yjs-v1';libraryVersion:'13.6.33'}};
export type LocalToolConvergenceIdentity=LocalToolConvergenceIdentityV14|LocalToolConvergenceIdentityV13|LocalToolConvergenceIdentityV1|LocalToolConvergenceIdentityV2|LocalToolConvergenceIdentityV3|LocalToolConvergenceIdentityV4|LocalToolConvergenceIdentityV5|LocalToolConvergenceIdentityV6|LocalToolConvergenceIdentityV7|LocalToolConvergenceIdentityV8|LocalToolConvergenceIdentityV9|LocalToolConvergenceIdentityV10|LocalToolConvergenceIdentityV11|LocalToolConvergenceIdentityV12;
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
/** Opaque, versioned JSON owned by the host's receipt/token, never an SDK/MCP argument. */
export interface LocalToolConvergenceReceipt {
 format:'writers-hoard-local-convergence-receipt/1';
 id:string;
 identity:LocalToolConvergenceIdentity;
 mode:'undo'|'redo';
 record:LocalToolJson;
}
export interface LocalToolPlainRange {format:'writers-hoard-local-plain-range/1';identity:LocalToolConvergenceIdentity;field:string;afterPlacementId:string|null;deleteIds:readonly string[]}
export interface CausalTransaction {id:string;parents:string[]}
export interface RegisterVersion {id:string;root:string;key:string;present:boolean;value:LocalToolJson;txId:string}
export interface RegisterActivation {id:string;versionId:string;enabled:boolean;txId:string}
export interface Toggle {id:string;enabled:boolean}
