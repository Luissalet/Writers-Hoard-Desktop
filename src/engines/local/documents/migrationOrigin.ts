import {convergenceCanonical,convergenceHash,convergenceIdentity,convergenceIdentityOf} from '../convergence/format';
import type {LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import type {LocalToolStateCodec} from '../stateCodecFormat';
import type {SourceToolDocument} from './types';

interface SourceMigrationOrigin {
 from:LocalToolConvergenceMetadata;
 codec?:LocalToolStateCodec;
}
interface SourceMigrationMetadata {
 codec?:LocalToolStateCodec;
 sourceMigration?:{from:LocalToolConvergenceMetadata};
 sourceScalarRename?:{from:LocalToolConvergenceMetadata};
}
type Lookup=(namespace:string,contentHash:string|null|undefined)=>SourceMigrationOrigin|undefined;
let lookup:Lookup|undefined;

/** The catalogue registers only contract metadata, without exposing executable callbacks. */
export function registerSourceMigrationOriginLookup(resolve:Lookup):void {
 lookup=resolve;
}

export function sourceMigrationOriginFor(namespace:string,contentHash?:string|null):SourceMigrationOrigin|undefined {
 return lookup?.(namespace,contentHash);
}

export function sourceMigrationOrigin(source:SourceMigrationMetadata|undefined):SourceMigrationOrigin|undefined {
 const from=(source?.sourceMigration??source?.sourceScalarRename)?.from;
 return from?{from,codec:source?.codec}:undefined;
}

/** A pre-start root attests to its codec. Started roots attest to the declared origin. */
export function isSourceMigrationPredecessor(document:SourceToolDocument,origin:SourceMigrationOrigin|undefined):boolean {
 if(!origin)return false;
 const {from,codec}=origin;
 if(!codec||!document.codec||document.namespace!==from.namespace)throw Error('local_tool_source_migration_origin_mismatch');
 const storedCodec=convergenceCanonical(document.codec);
 if(storedCodec===convergenceCanonical(codec))return false;
 const checkpoint=document.convergence?.checkpoint;
 if(storedCodec!==convergenceCanonical(from.codec)||checkpoint&&
    convergenceHash(convergenceIdentityOf(checkpoint))!==convergenceHash(convergenceIdentity(from,checkpoint.genesisId)))throw Error('local_tool_source_migration_origin_mismatch');
 return true;
}

/** Generic era saves may fork the predecessor, but cannot rewrite its migration inputs. */
export function sourceMigrationVariantConvergence(previous:SourceToolDocument,next:SourceToolDocument,origin:SourceMigrationOrigin|undefined):SourceToolDocument['convergence'] {
 if(!isSourceMigrationPredecessor(previous,origin))return;
 if(next.namespace!==previous.namespace||convergenceHash(next.codec??null)!==convergenceHash(previous.codec??null)||
    convergenceHash(next.data)!==convergenceHash(previous.data)||next.convergence&&
    convergenceHash(next.convergence)!==convergenceHash(previous.convergence??null))throw Error('local_tool_source_migration_required');
 return previous.convergence;
}
