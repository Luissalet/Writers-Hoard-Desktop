import type {LocalToolConvergenceUpdate,LocalToolConvergenceIdentity} from '../convergence/types';
import type {LocalToolJson} from '../stateTypes';
import type {LocalToolStateAction} from '../stateActions';
import type {RichRange} from '../convergence/richTypes';

export type LocalToolSaveMode='manual'|'automatic';
export interface LocalToolDocumentContentSnapshot {saveMode:LocalToolSaveMode;modeReady:boolean;preferenceError?:string;autosaveState:'manual'|'idle'|'waiting'|'saving'|'blocked';autosaveError?:string;source:'live';instanceId:string;networkEpoch:number;draftRevision:number;scope:{projectId:string;eraId:string|null};documentId:string|null;namespace:string;lineage:string|null;identity:LocalToolConvergenceIdentity|null;sharing:boolean;saveReady:boolean;fields:string[];pending:boolean;error?:string}
export interface LocalToolDocumentContent {
 readonly instanceId:string;
 getSnapshot():LocalToolDocumentContentSnapshot;
 subscribe(changed:()=>void):()=>void;
 query():Promise<LocalToolJson>;
 capture(field:string,request:{kind:'range';nodeId:string;from:number;to:number}):Promise<RichRange>;
 capture(field:string,request:LocalToolJson):Promise<LocalToolJson>;
 apply(field:string,actions:readonly LocalToolStateAction[]):Promise<boolean>;
 setSaveMode(mode:LocalToolSaveMode):Promise<void>;
 control(action:'undo'|'redo'|'save'|'leave'|'retry'|'adopt',field?:string):Promise<boolean>;
}
export interface ContentNetwork {roomId?:string;identity?:LocalToolConvergenceIdentity;send(update:LocalToolConvergenceUpdate,messageId:string):Promise<void>;requestFull?(requestId:string):Promise<LocalToolConvergenceUpdate|undefined>;retire?():void;leave():Promise<void>}
