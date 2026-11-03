import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {localToolFieldKey,type LocalToolSourceDefault,type LocalToolStateCodec} from '../stateCodecFormat';
import {convergenceCanonical,convergenceEngine,convergenceHash,validateConvergenceMetadata} from './format';
import type {LocalToolConvergenceMetadata} from './formatTypes';

export interface LocalToolSourceAdditive {
 from:LocalToolConvergenceMetadata;
 field:string;
 defaultValue:LocalToolJson;
}

export function projectSourceDefault(data:LocalToolJson,spec:Pick<LocalToolSourceDefault,'field'|'defaultValue'>|undefined):LocalToolJson {
 if(!spec||!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,spec.field))return data;
 return {...data,[spec.field]:cloneLocalToolJson(spec.defaultValue)};
}

export function sourceAdditiveDefault(declaration:LocalToolSourceAdditive):LocalToolSourceDefault {
 return {field:declaration.field,defaultValue:declaration.defaultValue,fromHash:convergenceHash(declaration.from)};
}

export function priorSourceCodec(codec:LocalToolStateCodec,field:string):LocalToolStateCodec {
 return {version:codec.version,fields:Object.fromEntries(Object.entries(codec.fields).filter(([name])=>name!==field))};
}

/** A finite declaration of one new scalar, independent of package code and releases. */
export function prepareSourceAdditiveDeclaration(value:LocalToolSourceAdditive,namespace:string,codec:LocalToolStateCodec|undefined):LocalToolSourceAdditive {
 const declaration=cloneLocalToolJson(value as unknown as LocalToolJson) as unknown as LocalToolSourceAdditive;
 if(!declaration||Object.keys(declaration).sort().join(',')!=='defaultValue,field,from'||!declaration.from||
    Object.keys(declaration.from).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||!localToolFieldKey(declaration.field)||
    !codec||codec.version!==1||declaration.from.namespace!==namespace)throw Error('local_tool_source_additive_invalid');
 validateConvergenceMetadata(declaration.from);
 const prior=declaration.from.codec;
 const {field}=declaration;
 if(prior.version!==1||convergenceEngine(prior).version!=='1'||!['1','8'].includes(convergenceEngine(codec).version)||
    Object.hasOwn(prior.fields,field)||codec.fields[field]?.kind!=='scalar'||
    convergenceCanonical(priorSourceCodec(codec,field))!==convergenceCanonical(prior)||
    codec.sourceDefault&&convergenceCanonical(codec.sourceDefault)!==convergenceCanonical(sourceAdditiveDefault(declaration)))throw Error('local_tool_source_additive_invalid');
 return declaration;
}
