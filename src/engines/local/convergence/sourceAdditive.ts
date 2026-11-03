import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {localToolFieldKey,type LocalToolStateCodec} from '../stateCodecFormat';
import {convergenceCanonical,convergenceEngine,validateConvergenceMetadata} from './format';
import type {LocalToolConvergenceMetadata} from './formatTypes';

export interface LocalToolSourceAdditive {
 from:LocalToolConvergenceMetadata;
 field:string;
 defaultValue:LocalToolJson;
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
 if(prior.version!==1||convergenceEngine(prior).version!=='1'||convergenceEngine(codec).version!=='1'||
    Object.hasOwn(prior.fields,field)||codec.fields[field]?.kind!=='scalar'||
    Object.keys(codec.fields).length!==Object.keys(prior.fields).length+1||
    Object.entries(prior.fields).some(([name,descriptor])=>!Object.hasOwn(codec.fields,name)||convergenceCanonical(codec.fields[name])!==convergenceCanonical(descriptor)))throw Error('local_tool_source_additive_invalid');
 return declaration;
}
