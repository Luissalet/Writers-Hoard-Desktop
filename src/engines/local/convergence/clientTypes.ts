import type {RichRange,RichSplitCapture,RichJoinCapture,RichResolvedPoint} from './richTypes';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolSnapshot} from '../sdk';
import type {LocalToolConvergenceIdentity,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolPlainRange} from './types';
/** Small read descriptor; complete causal bytes are available through explicit export. */
export type LocalToolConvergenceSnapshot=LocalToolConvergenceIdentity&{conflict?:LocalToolValidationConflict};
export interface LocalToolConvergenceImportOptions {expectedLineage?:string}
export interface LocalToolAdoptionReceiptSuccessor {previous:string;successor:string}
export interface LocalToolDocumentConvergence<T extends LocalToolJson>{
 richTableAxisCapture(field:string,tableId:string,axis:import('./tableAxesFormat').RichTableAxis,afterId:string|null):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./tableAxesEditing').RichTableAxisCapture}>;
 richTableCellCapture(field:string,tableId:string,rowId:string,columnId:string,afterId?:string|null):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./tableAxesEditing').RichTableCellCapture}>;
 richBlockEmptyItemCapture(field:string,nodeId:string):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockExit').RichBlockEmptyItemCapture}>;
 richBlockSplitCapture(field:string,nodeId:string,at:number):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockText').RichBlockSplitCapture}>;
 richBlockJoinCapture(field:string,leftNodeId:string,rightNodeId:string):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockText').RichBlockJoinCapture}>;
 richBlockEditCapture(field:string,nodeIds:string[],destination?:import('./blockTypes').RichBlockPlacement):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockEditingTypes').RichBlockEditCapture}>;
 richBlockCapture(field:string,options:{nodeIds:string[]}):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockTypes').RichBlockCapture}>;
 richBlockMoveCapture(field:string,nodeId:string,destination:import('./blockTypes').RichBlockPlacement):Promise<{snapshot:LocalToolSnapshot<T>;capture:import('./blockTypes').RichBlockMoveCapture}>;
 richRange(field:string,nodeId:string,from:number,to:number,options?:{affinity:'left'|'right'}):Promise<{snapshot:LocalToolSnapshot<T>;range:RichRange}>;
 resolveRichPoint(point:RichRange):Promise<{snapshot:LocalToolSnapshot<T>;point:RichResolvedPoint}>;
 richSplitCapture(field:string,nodeId:string,at:number,options?:{affinity:'left'|'right'}):Promise<{snapshot:LocalToolSnapshot<T>;capture:RichSplitCapture}>;
 richJoinCapture(field:string,leftNodeId:string,rightNodeId:string):Promise<{snapshot:LocalToolSnapshot<T>;capture:RichJoinCapture}>;
 textRange(field:string,from:number,to:number):Promise<{snapshot:LocalToolSnapshot<T>;range:LocalToolPlainRange}>;
 start(baseline:LocalToolSnapshot<T>):Promise<{snapshot:LocalToolSnapshot<T>;checkpoint:LocalToolConvergenceCheckpoint;changed:boolean}>;
 adopt(baseline:LocalToolSnapshot<T>,full?:LocalToolConvergenceUpdate):Promise<{snapshot:LocalToolSnapshot<T>;checkpoint:LocalToolConvergenceCheckpoint;changed:boolean;pending:boolean;receipts?:LocalToolAdoptionReceiptSuccessor[]}>;
 export(options?:{stateVectorBase64?:string}):Promise<{snapshot:LocalToolSnapshot<T>;checkpoint:LocalToolConvergenceCheckpoint|null;update:LocalToolConvergenceUpdate|null;pending:boolean}>;
 import(update:LocalToolConvergenceUpdate,options?:LocalToolConvergenceImportOptions):Promise<{snapshot:LocalToolSnapshot<T>;changed:boolean;causalChanged:boolean;pending:boolean;receipts?:LocalToolAdoptionReceiptSuccessor[]}>;
}
