import {convergenceCanonical,convergenceHash,convergenceIdentity,convergenceIdentityOf} from '../convergence/format';
import type {LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import {localToolConvergenceContext,type LocalToolConvergenceDefinition} from '../convergence/context';
import type {LocalToolStateCodec} from '../stateCodecFormat';
import type {SourceToolDocument} from './types';

interface SourceMigrationOrigin {
 from:LocalToolConvergenceMetadata;
 codec?:LocalToolStateCodec;
 sameCodecTarget?:LocalToolConvergenceMetadata;
}
interface SourceMigrationMetadata extends LocalToolConvergenceDefinition {
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
 if(!source)return undefined;
 const from=(source.sourceMigration??source.sourceScalarRename)?.from;
 if(!from)return undefined;
 const codec=source.codec;
 const sameCodecTarget=codec&&convergenceCanonical(from.codec)===convergenceCanonical(codec)
  ?{namespace:source.namespace,codec,...localToolConvergenceContext(source,codec)!}:undefined;
 return {from,codec,sameCodecTarget};
}

/** A pre-start root attests to its codec. Distinguishing versions of one codec requires a checkpoint. */
export function isSourceMigrationPredecessor(document:SourceToolDocument,origin:SourceMigrationOrigin|undefined):boolean {
 if(!origin)return false;
 const {from,codec,sameCodecTarget}=origin;
 if(!codec||!document.codec||document.namespace!==from.namespace)throw Error('local_tool_source_migration_origin_mismatch');
 const storedCodec=convergenceCanonical(document.codec);
 if(!sameCodecTarget&&storedCodec===convergenceCanonical(codec))return false;
 if(storedCodec!==convergenceCanonical(from.codec))throw Error('local_tool_source_migration_origin_mismatch');
 const checkpoint=document.convergence?.checkpoint;
 if(!checkpoint)return !sameCodecTarget;
 const identity=convergenceHash(convergenceIdentityOf(checkpoint));
 if(identity===convergenceHash(convergenceIdentity(from,checkpoint.genesisId)))return true;
 if(sameCodecTarget&&identity===convergenceHash(convergenceIdentity(sameCodecTarget,checkpoint.genesisId)))return false;
 throw Error('local_tool_source_migration_origin_mismatch');
}

/** Generic era saves may fork the predecessor, but cannot rewrite its migration inputs. */
export function sourceMigrationVariantConvergence(previous:SourceToolDocument,next:SourceToolDocument,origin:SourceMigrationOrigin|undefined):SourceToolDocument['convergence'] {
 if(!isSourceMigrationPredecessor(previous,origin))return;
 if(next.namespace!==previous.namespace||convergenceHash(next.codec??null)!==convergenceHash(previous.codec??null)||
    convergenceHash(next.data)!==convergenceHash(previous.data)||next.convergence&&
    convergenceHash(next.convergence)!==convergenceHash(previous.convergence??null))throw Error('local_tool_source_migration_required');
 return previous.convergence;
}
