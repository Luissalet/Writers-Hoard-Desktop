import type {LocalToolJson} from '../stateTypes';
import type {LocalToolSnapshot} from '../sdk';
import type {LocalToolConvergenceIdentity,LocalToolConvergenceCheckpoint,LocalToolConvergenceUpdate,LocalToolValidationConflict,LocalToolPlainRange} from './types';
/** Small read descriptor; complete causal bytes are available through explicit export. */
export type LocalToolConvergenceSnapshot=LocalToolConvergenceIdentity&{conflict?:LocalToolValidationConflict};
export interface LocalToolDocumentConvergence<T extends LocalToolJson>{
 textRange(field:string,from:number,to:number):Promise<{snapshot:LocalToolSnapshot<T>;range:LocalToolPlainRange}>;
 start(baseline:LocalToolSnapshot<T>):Promise<{snapshot:LocalToolSnapshot<T>;checkpoint:LocalToolConvergenceCheckpoint;changed:boolean}>;
 export(options?:{stateVectorBase64?:string}):Promise<{snapshot:LocalToolSnapshot<T>;checkpoint:LocalToolConvergenceCheckpoint|null;update:LocalToolConvergenceUpdate|null}>;
 import(update:LocalToolConvergenceUpdate):Promise<{snapshot:LocalToolSnapshot<T>;changed:boolean;causalChanged:boolean;pending:boolean}>;
}
