import {convergenceCanonical,convergenceEngine,convergenceHash,convergenceIdentityOf,validateConvergenceMetadata} from '../convergence/format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import type {LocalToolDefinition} from '../sdk';
import type {LocalToolStateCodec} from '../stateCodec';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateSourceDocumentCheckpoint} from './portability';
import {projectSourceScalarRename} from './scalarRename';
import {findSourceMigrationPredecessor,sourceMigrationOrigin} from './migrationOrigin';
import type {SourceToolDocument} from './types';

export interface LocalToolSourceMigration<T extends LocalToolJson=LocalToolJson> {
 readonly from:LocalToolConvergenceMetadata;
 readonly additionalPredecessors?:readonly LocalToolConvergenceMetadata[];
 /** Transform detached JSON. The host also passes the identified origin when additionalPredecessors is declared. */
 readonly migrate:(previous:LocalToolJson,from?:Readonly<LocalToolConvergenceMetadata>)=>T;
}

export function prepareSourceMigration<T extends LocalToolJson>(declaration:LocalToolSourceMigration<T>,namespace:string,codec:LocalToolStateCodec|undefined,targetValidationId:string):LocalToolSourceMigration<T> {
 if(!declaration||typeof declaration!=='object'||
    !['from,migrate','additionalPredecessors,from,migrate'].includes(Object.keys(declaration).sort().join(','))||
    typeof declaration.migrate!=='function'||!codec||codec.version!==1||convergenceEngine(codec).version!=='1')throw Error('local_tool_source_migration_invalid');
 const additional=declaration.additionalPredecessors;
 if(additional!==undefined&&(!Array.isArray(additional)||!additional.length))throw Error('local_tool_source_migration_invalid');
 const declared=cloneLocalToolJson([declaration.from,...(additional??[])] as unknown as LocalToolJson) as unknown as LocalToolConvergenceMetadata[];
 const seen=new Set<string>(),targetCodec=convergenceCanonical(codec);
 for(const predecessor of declared){
  if(!predecessor||Object.keys(predecessor).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||predecessor.namespace!==namespace)throw Error('local_tool_source_migration_invalid');
  validateConvergenceMetadata(predecessor);
  const key=convergenceCanonical(predecessor.codec);
  if(predecessor.codec.version!==1||convergenceEngine(predecessor.codec).version!=='1'||seen.has(key)||
     predecessor.validationId===targetValidationId&&key===targetCodec)throw Error('local_tool_source_migration_invalid');
  seen.add(key);
  for(const field of Object.values(predecessor.codec.fields))Object.freeze(field);
  Object.freeze(predecessor.codec.fields);
  Object.freeze(predecessor.codec);
  Object.freeze(predecessor);
 }
 const [from,...additionalPredecessors]=declared;
 return Object.freeze({from,migrate:declaration.migrate,...(additionalPredecessors.length?{additionalPredecessors:Object.freeze(additionalPredecessors)}:{})});
}

export function sourceMigrationPredecessor<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):LocalToolConvergenceMetadata|undefined {
 return findSourceMigrationPredecessor(document,sourceMigrationOrigin(definition));
}

export function isSourceMigrationPending<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>):boolean {
 return sourceMigrationPredecessor(document,definition)!==undefined;
}

export function projectSourceMigration<T extends LocalToolJson>(document:SourceToolDocument,definition:LocalToolDefinition<T>,from:LocalToolConvergenceMetadata):LocalToolJson {
 validateSourceDocumentCheckpoint(document);
 if(definition.sourceScalarRename)return projectSourceScalarRename(document,definition.sourceScalarRename);
 const migrate=definition.sourceMigration?.migrate;
 if(!migrate)throw Error('local_tool_source_migration_unavailable');
 const previous=cloneLocalToolJson(document.data);
 const transformed=definition.sourceMigration?.additionalPredecessors?migrate(previous,from):migrate(previous);
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
