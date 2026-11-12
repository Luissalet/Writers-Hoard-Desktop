import {convergenceCanonical,convergenceEngine,validateConvergenceMetadata} from '../convergence/format';
import type {LocalToolConvergenceMetadata} from '../convergence/formatTypes';
import {localToolFieldKey,type LocalToolStateCodec} from '../stateCodec';
import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
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

export function projectSourceScalarRename(document:SourceToolDocument,rename:LocalToolSourceScalarRename):LocalToolJson {
 const data=cloneLocalToolJson(document.data);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,rename.newField))throw Error('local_tool_source_migration_invalid');
 if(Object.hasOwn(data,rename.oldField)){
  data[rename.newField]=data[rename.oldField];
  delete data[rename.oldField];
 }
 return data;
}
