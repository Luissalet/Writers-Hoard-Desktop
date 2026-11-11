import {convergenceCanonical,convergenceEngine,convergenceHash,convergenceIdentity,convergenceIdentityOf,validateConvergenceMetadata} from '../convergence/format';
import type {LocalToolConvergenceCheckpoint,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import {localToolFieldKey,type LocalToolStateCodec} from '../stateCodec';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {validateSourceDocumentCheckpoint} from './portability';
import type {SourceToolDocument} from './types';

export interface LocalToolSourceScalarRename {
 readonly from:LocalToolConvergenceMetadata;
 readonly oldField:string;
 readonly newField:string;
}

export function prepareSourceScalarRename(value:LocalToolSourceScalarRename,namespace:string,codec:LocalToolStateCodec|undefined):LocalToolSourceScalarRename {
 const rename=cloneLocalToolJson(value as unknown as LocalToolJson) as unknown as LocalToolSourceScalarRename;
 if(!rename||typeof rename!=='object'||Object.keys(rename).sort().join(',')!=='from,newField,oldField'||
    !localToolFieldKey(rename.oldField)||!localToolFieldKey(rename.newField)||rename.oldField===rename.newField||
    !rename.from||Object.keys(rename.from).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||
    rename.from.namespace!==namespace||!codec||codec.version!==1||convergenceEngine(codec).version!=='1')throw Error('local_tool_source_migration_invalid');
 const {from,oldField,newField}=rename;
 validateConvergenceMetadata(from);
 if(from.codec.version!==1||convergenceEngine(from.codec).version!=='1'||
    !Object.hasOwn(from.codec.fields,oldField)||from.codec.fields[oldField].kind!=='scalar'||Object.hasOwn(from.codec.fields,newField))throw Error('local_tool_source_migration_invalid');
 const fields=Object.fromEntries(Object.entries(from.codec.fields).map(([key,field])=>[key===oldField?newField:key,field]));
 if(convergenceCanonical({...from.codec,fields})!==convergenceCanonical(codec))throw Error('local_tool_source_migration_invalid');
 return Object.freeze(rename);
}

/** A pre-start root attests to its codec only. Started roots also attest to the declared origin. */
export function isSourceScalarRenamePending(document:SourceToolDocument,rename:LocalToolSourceScalarRename|undefined,codec:LocalToolStateCodec|undefined):rename is LocalToolSourceScalarRename {
 if(!rename)return false;
 if(!codec||!document.codec||document.namespace!==rename.from.namespace)throw Error('local_tool_source_migration_origin_mismatch');
 const storedCodec=convergenceCanonical(document.codec);
 if(storedCodec===convergenceCanonical(codec))return false;
 const checkpoint=document.convergence?.checkpoint;
 if(storedCodec!==convergenceCanonical(rename.from.codec)||checkpoint&&
    convergenceHash(convergenceIdentityOf(checkpoint))!==convergenceHash(convergenceIdentity(rename.from,checkpoint.genesisId)))throw Error('local_tool_source_migration_origin_mismatch');
 return true;
}

export function projectSourceScalarRename(document:SourceToolDocument,rename:LocalToolSourceScalarRename):LocalToolJson {
 validateSourceDocumentCheckpoint(document);
 const data=cloneLocalToolJson(document.data);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,rename.newField))throw Error('local_tool_source_migration_invalid');
 if(Object.hasOwn(data,rename.oldField)){
  data[rename.newField]=data[rename.oldField];
  delete data[rename.oldField];
 }
 return data;
}

export function migratedSourceScalarRoot(document:SourceToolDocument,data:LocalToolJson,codec:LocalToolStateCodec,checkpoint:LocalToolConvergenceCheckpoint,metadata:Pick<SourceToolDocument,'index'|'preview'>):SourceToolDocument {
 const next={...document,data,codec:structuredClone(codec),generation:crypto.randomUUID(),convergence:{checkpoint}};
 if(metadata.index)next.index=structuredClone(metadata.index);else delete next.index;
 if(metadata.preview)next.preview=structuredClone(metadata.preview);else delete next.preview;
 return next;
}

export function assertSourceScalarRenameBaseline(document:SourceToolDocument,data:LocalToolJson,baseline:{data:LocalToolJson;convergence?:LocalToolConvergenceIdentity}):void {
 const checkpoint=document.convergence?.checkpoint;
 const stored=checkpoint?convergenceIdentityOf(checkpoint):null,observed=baseline.convergence?convergenceIdentityOf(baseline.convergence):null;
 if(convergenceHash(data)!==convergenceHash(baseline.data)||convergenceHash(stored)!==convergenceHash(observed))throw Error('conflict');
}
