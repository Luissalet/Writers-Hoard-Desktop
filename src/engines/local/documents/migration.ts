import {convergenceCanonical,convergenceEngine,convergenceHash,convergenceIdentityOf,validateConvergenceMetadata} from '../convergence/format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import type {LocalToolDefinition} from '../sdk';
import type {LocalToolStateCodec} from '../stateCodec';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateSourceDocumentCheckpoint} from './portability';
import {projectSourceScalarRename} from './scalarRename';
import {isSourceMigrationPredecessor,sourceMigrationOrigin} from './migrationOrigin';
import type {SourceToolDocument} from './types';

export interface LocalToolSourceMigration<T extends LocalToolJson=LocalToolJson> {
 readonly from:LocalToolConvergenceMetadata;
 /** Synchronously transform a detached copy of the predecessor's JSON. */
 readonly migrate:(previous:LocalToolJson)=>T;
}

export function prepareSourceMigration<T extends LocalToolJson>(declaration:LocalToolSourceMigration<T>,namespace:string,codec:LocalToolStateCodec|undefined,targetValidationId:string):LocalToolSourceMigration<T> {
 if(!declaration||typeof declaration!=='object'||Object.keys(declaration).sort().join(',')!=='from,migrate'||
    typeof declaration.migrate!=='function'||!codec||codec.version!==1||convergenceEngine(codec).version!=='1')throw Error('local_tool_source_migration_invalid');
 const from=cloneLocalToolJson(declaration.from as unknown as LocalToolJson) as unknown as LocalToolConvergenceMetadata;
 if(!from||Object.keys(from).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||from.namespace!==namespace)throw Error('local_tool_source_migration_invalid');
 validateConvergenceMetadata(from);
 if(from.codec.version!==1||convergenceEngine(from.codec).version!=='1'||
    from.validationId===targetValidationId&&convergenceCanonical(from.codec)===convergenceCanonical(codec))throw Error('local_tool_source_migration_invalid');
 for(const field of Object.values(from.codec.fields))Object.freeze(field);
 Object.freeze(from.codec.fields);
 Object.freeze(from.codec);
 return Object.freeze({from:Object.freeze(from),migrate:declaration.migrate});
}

export function isSourceMigrationPending<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):boolean {
 return isSourceMigrationPredecessor(document,sourceMigrationOrigin(definition));
}

export function projectSourceMigration<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):LocalToolJson {
 validateSourceDocumentCheckpoint(document);
 if(definition.sourceScalarRename)return projectSourceScalarRename(document,definition.sourceScalarRename);
 const migrate=definition.sourceMigration?.migrate;
 if(!migrate)throw Error('local_tool_source_migration_unavailable');
 const transformed=migrate(cloneLocalToolJson(document.data));
 if(transformed instanceof Promise){
  void transformed.catch(()=>{});
  throw Error('local_tool_source_migration_invalid');
 }
 return transformed;
}

export function migratedSourceRoot(document:SourceToolDocument,data:LocalToolJson,codec:LocalToolStateCodec,checkpoint:LocalToolConvergenceCheckpoint,metadata:Pick<SourceToolDocument,'index'|'preview'>):SourceToolDocument {
 const next={...document,data,codec:structuredClone(codec),generation:crypto.randomUUID(),convergence:{checkpoint}};
 if(metadata.index)next.index=structuredClone(metadata.index);else delete next.index;
 if(metadata.preview)next.preview=structuredClone(metadata.preview);else delete next.preview;
 return next;
}

export function assertSourceMigrationBaseline(document:SourceToolDocument,data:LocalToolJson,baseline:{data:LocalToolJson;convergence?:LocalToolConvergenceIdentity}):void {
 const checkpoint=document.convergence?.checkpoint;
 const stored=checkpoint?convergenceIdentityOf(checkpoint):null,observed=baseline.convergence?convergenceIdentityOf(baseline.convergence):null;
 if(convergenceHash(data)!==convergenceHash(baseline.data)||convergenceHash(stored)!==convergenceHash(observed))throw Error('conflict');
}
