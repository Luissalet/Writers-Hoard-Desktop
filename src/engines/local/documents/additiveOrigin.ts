import {assertConvergenceIdentity,convergenceCanonical,convergenceIdentity} from '../convergence/format';
import type {LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import type {SourceToolDocument} from './types';

type Lookup=(namespace:string,contentHash:string|null|undefined)=>LocalToolConvergenceMetadata|undefined;
let lookup:Lookup|undefined;

/** The renderer registers a view of its catalogue without exposing executable definitions. */
export function registerSourceAdditiveOriginLookup(resolve:Lookup):void {
 lookup=resolve;
}

export function sourceAdditiveOriginFor(namespace:string,contentHash?:string|null):LocalToolConvergenceMetadata|undefined {
 return lookup?.(namespace,contentHash);
}

/** A pre-start root may match the exact old codec, without gaining a writer. */
export function isSourceAdditivePredecessor(document:SourceToolDocument,from:LocalToolConvergenceMetadata|undefined):boolean {
 if(!from||!document.codec||document.namespace!==from.namespace||
    convergenceCanonical(document.codec)!==convergenceCanonical(from.codec))return false;
 const checkpoint=document.convergence?.checkpoint;
 if(checkpoint)assertConvergenceIdentity(checkpoint,convergenceIdentity(from,checkpoint.genesisId));
 return true;
}
