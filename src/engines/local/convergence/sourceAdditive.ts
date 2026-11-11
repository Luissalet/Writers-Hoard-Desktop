import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {sourceDefaultEntries,sourceDefaultHash,validateLocalToolCodec,type LocalToolSourceDefault,type LocalToolStateCodec} from '../stateCodecFormat';
import {convergenceCanonical,convergenceEngine,convergenceHash,validateConvergenceMetadata} from './format';
import type {LocalToolConvergenceMetadata} from './formatTypes';

export type LocalToolSourceAdditive = {from:LocalToolConvergenceMetadata} & (
 | {field:string;defaultValue:LocalToolJson;fields?:never}
 | {fields:Record<string,LocalToolJson>;field?:never;defaultValue?:never}
);

export function projectSourceDefaults(data:LocalToolJson,entries:readonly [string,LocalToolJson][]):LocalToolJson {
 if(!data||typeof data!=='object'||Array.isArray(data))return data;
 let projected=data;
 for(const [field,value] of entries){
  if(Object.hasOwn(data,field))continue;
  if(projected===data)projected={...data};
  projected[field]=cloneLocalToolJson(value);
 }
 return projected;
}

export function projectSourceDefault(data:LocalToolJson,spec:Pick<LocalToolSourceDefault,'field'|'defaultValue'>|undefined):LocalToolJson {
 return spec?projectSourceDefaults(data,[[spec.field,spec.defaultValue]]):data;
}

export function sourceAdditiveCodecDefaults(declaration:LocalToolSourceAdditive):Pick<LocalToolStateCodec,'sourceDefault'|'sourceDefaults'> {
 const fromHash=convergenceHash(declaration.from);
 return declaration.fields!==undefined
  ? {sourceDefaults:{fields:declaration.fields,fromHash}}
  : {sourceDefault:{field:declaration.field,defaultValue:declaration.defaultValue,fromHash}};
}

export function priorSourceCodec(codec:LocalToolStateCodec,addedFields:readonly string[]):LocalToolStateCodec {
 const added=new Set(addedFields);
 return {version:codec.version,fields:Object.fromEntries(Object.entries(codec.fields).filter(([name])=>!added.has(name)))};
}

/** Declare fields introduced together by a package, while retaining the legacy single-field representation. */
export function prepareSourceAdditiveDeclaration(value:LocalToolSourceAdditive,namespace:string,codec:LocalToolStateCodec|undefined):LocalToolSourceAdditive {
 const invalid=():never=>{throw Error('local_tool_source_additive_invalid');};
 const declaration=cloneLocalToolJson(value as unknown as LocalToolJson) as unknown as LocalToolSourceAdditive;
 if(!declaration||typeof declaration!=='object'||!declaration.from||
    !['defaultValue,field,from','fields,from'].includes(Object.keys(declaration).sort().join(','))||
    Object.keys(declaration.from).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||
    !codec||codec.version!==1||declaration.from.namespace!==namespace)return invalid();
 validateConvergenceMetadata(declaration.from);
 const prior=declaration.from.codec;
 const target={...codec,...sourceAdditiveCodecDefaults(declaration)};
 try { validateLocalToolCodec(target); } catch { return invalid(); }
 const fields=sourceDefaultEntries(target).map(([field])=>field);
 if(prior.version!==1||convergenceEngine(prior).version!=='1'||!['1','8'].includes(convergenceEngine(codec).version)||
    fields.some(field=>Object.hasOwn(prior.fields,field))||
    convergenceCanonical(priorSourceCodec(codec,fields))!==convergenceCanonical(prior)||
    sourceDefaultHash(codec)&&convergenceCanonical(codec)!==convergenceCanonical(target))return invalid();
 return declaration;
}
