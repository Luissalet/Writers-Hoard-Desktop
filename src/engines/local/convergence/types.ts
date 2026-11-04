import type {LocalToolConvergenceContract,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolConvergenceReceipt,LocalToolPlainRange} from './formatTypes';
export type {LocalToolConvergenceMetadata,LocalToolConvergenceContract,LocalToolRichAdoption,LocalToolConvergenceIdentityV1,LocalToolConvergenceIdentityV2,LocalToolConvergenceIdentityV3,LocalToolConvergenceIdentityV4,LocalToolConvergenceIdentity,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolConvergenceReceipt,LocalToolPlainRange} from './formatTypes';
import type {RichRange,RichSplitCapture,RichJoinCapture,RichResolvedPoint} from './richTypes';
import type {RichBlockCapture,RichBlockMoveCapture,RichBlockPlacement} from './blocks';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateAction} from '../stateActions';

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
 richImageCapture(field:string,nodeId:string,channel:import('./imageEditing').RichImageChannel):import('./imageEditing').RichImageCapture;
 richTableColumnWidthCapture(field:string,tableId:string,columnId:string):import('./tableAxesEditing').RichTableColumnWidthCapture;
 richTableAxisCapture(field:string,tableId:string,axis:import('./tableAxesFormat').RichTableAxis,afterId:string|null):import('./tableAxesEditing').RichTableAxisCapture;
 richTableCellCapture(field:string,tableId:string,rowId:string,columnId:string,afterId?:string|null):import('./tableAxesEditing').RichTableCellCapture;
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
 adopt(targetContract:LocalToolConvergenceContract<T>):LocalToolReplicaEdit<T>;
 receive(update:LocalToolConvergenceUpdate):LocalToolConvergenceChange<T>;
 export(stateVectorBase64?:string):LocalToolConvergenceUpdate;
 checkpoint():LocalToolConvergenceCheckpoint;
 undo(receiptId:string):LocalToolReplicaEdit<T>;
 redo(receiptId:string):LocalToolReplicaEdit<T>;
 destroy():void;
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

