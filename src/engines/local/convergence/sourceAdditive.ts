import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
import {sourceDefaultEntries,sourceDefaultHash,validateLocalToolCodec,type LocalToolSourceDefault,type LocalToolStateCodec} from '../stateCodecFormat';
import {convergenceCanonical,convergenceEngine,convergenceHash,validateConvergenceMetadata} from './format';
import type {LocalToolConvergenceMetadata} from './formatTypes';

export type LocalToolSourceAdditive = {
 from:LocalToolConvergenceMetadata;
 ancestors?:readonly LocalToolConvergenceMetadata[];
} & (
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
 const inherited=sourceDefaultEntries(declaration.from.codec);
 if(inherited.length){
  const added=declaration.fields??{[declaration.field!]:declaration.defaultValue!};
  return {sourceDefaults:{fields:{...Object.fromEntries(inherited),...added},fromHash}};
 }
 return declaration.fields!==undefined
  ? {sourceDefaults:{fields:declaration.fields,fromHash}}
  : {sourceDefault:{field:declaration.field,defaultValue:declaration.defaultValue,fromHash}};
}

export function priorSourceCodec(codec:LocalToolStateCodec,addedFields:readonly string[]):LocalToolStateCodec {
 const added=new Set(addedFields);
 return {version:codec.version,fields:Object.fromEntries(Object.entries(codec.fields).filter(([name])=>!added.has(name)))};
}

const invalid=():never=>{throw Error('local_tool_source_additive_invalid');};

/** The transition only grants the fields introduced after its exact predecessor. */
export function sourcePromotionFields(from:LocalToolStateCodec,to:LocalToolStateCodec):string[] {
 if(from.version!==1||to.version!==1||!['1','8'].includes(convergenceEngine(from).version)||
    convergenceEngine(to).version!=='8')return invalid();
 for(const [field,descriptor] of Object.entries(from.fields)){
  if(!Object.hasOwn(to.fields,field)||convergenceCanonical(descriptor)!==convergenceCanonical(to.fields[field]))return invalid();
 }
 const added=Object.keys(to.fields).filter(field=>!Object.hasOwn(from.fields,field));
 if(!added.length)return invalid();
 const oldDefaults=new Map(sourceDefaultEntries(from)),newDefaults=new Map(sourceDefaultEntries(to));
 if(newDefaults.size!==oldDefaults.size+added.length||added.some(field=>!newDefaults.has(field)))return invalid();
 for(const [field,previous] of oldDefaults){
  if(!newDefaults.has(field)||convergenceCanonical(previous)!==convergenceCanonical(newDefaults.get(field)))return invalid();
 }
 return added;
}

function validateSourceAncestors(declaration:LocalToolSourceAdditive,namespace:string):void {
 const ancestors=declaration.ancestors;
 if(ancestors!==undefined&&!Array.isArray(ancestors))return invalid();
 const lineage=[...(ancestors??[]),declaration.from];
 for(const [index,identity] of lineage.entries()){
  if(!identity||Object.keys(identity).sort().join(',')!=='codec,namespace,schemaEpoch,validationId'||
     identity.namespace!==namespace)return invalid();
  validateConvergenceMetadata(identity);
  const previous=lineage[index-1];
  if(previous){
   if(sourceDefaultHash(identity.codec)!==convergenceHash(previous))return invalid();
   sourcePromotionFields(previous.codec,identity.codec);
  }
 }
}

/** Declare fields introduced together by a package, while retaining the legacy single-field representation. */
export function prepareSourceAdditiveDeclaration(value:LocalToolSourceAdditive,namespace:string,codec:LocalToolStateCodec|undefined):LocalToolSourceAdditive {
 const declaration=cloneLocalToolJson(value as unknown as LocalToolJson) as unknown as LocalToolSourceAdditive;
 if(!declaration||typeof declaration!=='object'||!declaration.from||
    !['defaultValue,field,from','fields,from','ancestors,defaultValue,field,from','ancestors,fields,from'].includes(Object.keys(declaration).sort().join(','))||
    declaration.fields!==undefined&&(!declaration.fields||typeof declaration.fields!=='object'||Array.isArray(declaration.fields))||
    !codec||codec.version!==1||!['1','8'].includes(convergenceEngine(codec).version))return invalid();
 validateSourceAncestors(declaration,namespace);
 const target={...codec,...sourceAdditiveCodecDefaults(declaration)};
 try { validateLocalToolCodec(target); } catch { return invalid(); }
 const added=sourcePromotionFields(declaration.from.codec,target);
 const declared=declaration.fields===undefined?[declaration.field!]:Object.keys(declaration.fields);
 if(added.length!==declared.length||declared.some(field=>!added.includes(field))||
    sourceDefaultHash(codec)&&convergenceCanonical(codec)!==convergenceCanonical(target))return invalid();
 return declaration;
}
