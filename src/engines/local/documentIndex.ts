/** Portable source-document projections. No registry, React, database or network. */
import {cloneLocalToolJson,localToolNamespace,type LocalToolJson} from './stateTypes';
import {eraDocumentKinds,type EraDocumentKind} from '@/services/worldEras/types';
import {worldDocumentPrefixes} from '@/services/worldEras/documentPrefixes';

export type LocalToolIndexPrimitive=string|number|boolean|null;
export interface LocalToolIndexField {path:string;type:'string'|'number'|'boolean'|'string[]'|'number[]'|'boolean[]';mode?:'first'|'all'}
export interface LocalToolIndexSpec {version:1;fields:Record<string,LocalToolIndexField>;refs?:{kind:EraDocumentKind;path:string}[]}
export interface LocalToolIndexPredicate {eq?:LocalToolIndexPrimitive;ne?:LocalToolIndexPrimitive;gt?:number|string;gte?:number|string;lt?:number|string;lte?:number|string;in?:LocalToolIndexPrimitive[];contains?:string;exists?:boolean}
export interface LocalToolDocumentQuery {namespace?:string;where?:Record<string,LocalToolIndexPredicate>;reference?:{kind:EraDocumentKind;documentId:string};offset?:number;limit?:number}
export interface LocalToolIndexRow {id:string;namespace:string;title:string;updatedAt:number;provenance:'base'|'variant';fields:Record<string,LocalToolIndexPrimitive|LocalToolIndexPrimitive[]>;refs:{kind:EraDocumentKind;documentId:string}[]}
type Step={kind:'field';name:string}|{kind:'wildcard'}|{kind:'descendants'}|{kind:'filter';name?:string;operator:'=='|'!=';value:LocalToolIndexPrimitive};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const safeKey=(key:string)=>!!key&&!['__proto__','prototype','constructor'].includes(key);
const primitive=(value:unknown):value is LocalToolIndexPrimitive=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);

function parsePath(path:string):Step[]{
 if(typeof path!=='string'||path.length>512||!path.startsWith('$'))throw Error('local_tool_index_path_invalid');
 const steps:Step[]=[];let rest=path.slice(1);
 while(rest){
  if(rest.startsWith('.**')){steps.push({kind:'descendants'});rest=rest.slice(3);continue;}
  if(rest.startsWith('[*]')){steps.push({kind:'wildcard'});rest=rest.slice(3);continue;}
  const field=/^\.([A-Za-z_][A-Za-z0-9_-]*)/.exec(rest);
  if(field){if(!safeKey(field[1]))throw Error('local_tool_index_path_invalid');steps.push({kind:'field',name:field[1]});rest=rest.slice(field[0].length);continue;}
  const filter=/^\s*\?\s*\(\s*@(?:\.([A-Za-z_][A-Za-z0-9_-]*))?\s*(==|!=)\s*("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*\)/.exec(rest);
  if(filter){if(!primitive(JSON.parse(filter[3])))throw Error('local_tool_index_path_invalid');if(filter[1]&&!safeKey(filter[1]))throw Error('local_tool_index_path_invalid');steps.push({kind:'filter',name:filter[1],operator:filter[2] as '=='|'!=',value:JSON.parse(filter[3])});rest=rest.slice(filter[0].length);continue;}
  throw Error('local_tool_index_path_invalid');
 }
 return steps;
}
interface Location {value:LocalToolJson;parent?:LocalToolJson[]|Record<string,LocalToolJson>;key?:string|number}
function members(location:Location):Location[]{return Array.isArray(location.value)?location.value.flatMap((value,key)=>members({value,parent:location.value as LocalToolJson[],key})):[location];}
function descendants(location:Location):Location[]{const child=location.value;if(!child||typeof child!=='object')return[location];return[location,...Object.entries(child).flatMap(([key,value])=>descendants({value,parent:child,key}))];}
function locations(path:string,data:LocalToolJson):Location[]{
 return parsePath(path).reduce<Location[]>((rows,step)=>rows.flatMap(location=>{
  if(step.kind==='descendants')return descendants(location);
  if(step.kind==='wildcard')return Array.isArray(location.value)?location.value.map((value,key)=>({value,parent:location.value as LocalToolJson[],key})):[location];
  if(step.kind==='field')return members(location).flatMap(item=>object(item.value)&&Object.hasOwn(item.value,step.name)?[{value:item.value[step.name] as LocalToolJson,parent:item.value as Record<string,LocalToolJson>,key:step.name}]:[]);
  return members(location).filter(item=>{const values=step.name?object(item.value)&&Object.hasOwn(item.value,step.name)?members({value:item.value[step.name] as LocalToolJson}):[]:[item];return values.some(({value})=>primitive(value)&&(step.operator==='=='?value===step.value:value!==step.value));});
 }),[{value:data}]);
}
export function validateLocalToolIndexSpec(value:unknown):asserts value is LocalToolIndexSpec {
 const spec=cloneLocalToolJson(value as LocalToolJson) as unknown as LocalToolIndexSpec;
 if(!object(spec)||spec.version!==1||!object(spec.fields)||Object.keys(spec).some(key=>!['version','fields','refs'].includes(key))||Object.keys(spec.fields).length>32||spec.refs!==undefined&&(!Array.isArray(spec.refs)||spec.refs.length>16))throw Error('local_tool_index_spec_invalid');
 let recursive=0;
 for(const [key,field]of Object.entries(spec.fields)){
  if(!safeKey(key)||!object(field)||Object.keys(field).some(key=>!['path','type','mode'].includes(key))||!['string','number','boolean','string[]','number[]','boolean[]'].includes(field.type)||field.mode!==undefined&&!['first','all'].includes(field.mode))throw Error('local_tool_index_spec_invalid');
  recursive+=parsePath(field.path).filter(step=>step.kind==='descendants').length;
 }
 for(const ref of spec.refs??[]){if(!object(ref)||Object.keys(ref).sort().join(',')!=='kind,path'||!eraDocumentKinds.includes(ref.kind))throw Error('local_tool_index_spec_invalid');recursive+=parsePath(ref.path).filter(step=>step.kind==='descendants').length;}
 if(recursive>2)throw Error('local_tool_index_spec_invalid');
}
export function evaluateLocalToolIndex(spec:LocalToolIndexSpec,data:LocalToolJson):Pick<LocalToolIndexRow,'fields'|'refs'>{
 validateLocalToolIndexSpec(spec);const fields:LocalToolIndexRow['fields']={},refs:LocalToolIndexRow['refs']=[];
 for(const [key,field]of Object.entries(spec.fields)){
  const type=field.type.replace('[]',''),values=locations(field.path,data).flatMap(members).map(item=>item.value).filter((value):value is string|number|boolean=>typeof value===type&&(type!=='number'||Number.isFinite(value)));
  if(field.mode==='all')fields[key]=values;
  else if(field.type.endsWith('[]'))fields[key]=values.slice(0,1);
  else if(values.length)fields[key]=values[0];
 }
 for(const ref of spec.refs??[])for(const {value}of locations(ref.path,data).flatMap(members))if(typeof value==='string'&&value&&!refs.some(item=>item.kind===ref.kind&&item.documentId===value))refs.push({kind:ref.kind,documentId:value});
 return{fields,refs};
}
export function validateLocalToolDocumentQuery(value:unknown):asserts value is LocalToolDocumentQuery {
 const query=cloneLocalToolJson(value as LocalToolJson) as unknown as LocalToolDocumentQuery;
 if(!object(query)||Object.keys(query).some(key=>!['namespace','where','reference','offset','limit'].includes(key))||query.namespace!==undefined&&!localToolNamespace(query.namespace)||query.offset!==undefined&&(typeof query.offset!=='number'||!Number.isSafeInteger(query.offset)||query.offset<0)||query.limit!==undefined&&(typeof query.limit!=='number'||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>500))throw Error('local_tool_index_query_invalid');
 if(query.reference!==undefined&&(!object(query.reference)||Object.keys(query.reference).sort().join(',')!=='documentId,kind'||!eraDocumentKinds.includes(query.reference.kind as EraDocumentKind)||typeof query.reference.documentId!=='string'||!query.reference.documentId))throw Error('local_tool_index_query_invalid');
 if(query.where!==undefined){if(!object(query.where))throw Error('local_tool_index_query_invalid');for(const [key,predicate]of Object.entries(query.where)){
  if(!safeKey(key)||!object(predicate)||!Object.keys(predicate).length)throw Error('local_tool_index_query_invalid');
  for(const [op,operand]of Object.entries(predicate))if(!['eq','ne','gt','gte','lt','lte','in','contains','exists'].includes(op)||(op==='eq'||op==='ne')&&!primitive(operand)||['gt','gte','lt','lte'].includes(op)&&!(typeof operand==='string'||typeof operand==='number'&&Number.isFinite(operand))||op==='in'&&(!Array.isArray(operand)||!operand.every(primitive))||op==='contains'&&typeof operand!=='string'||op==='exists'&&typeof operand!=='boolean')throw Error('local_tool_index_query_invalid');
 }}
}
export function queryLocalToolIndexRows(rows:LocalToolIndexRow[],query:LocalToolDocumentQuery={}):LocalToolIndexRow[]{
 validateLocalToolDocumentQuery(query);
 const matches=(value:LocalToolIndexPrimitive,predicate:LocalToolIndexPredicate)=>Object.entries(predicate).every(([op,operand])=>{
  if(op==='exists')return true;if(op==='eq')return value===operand;if(op==='ne')return value!==operand;
  if(op==='in')return(predicate.in??[]).includes(value);if(op==='contains')return typeof value==='string'&&value.includes(String(operand));
  if(typeof value!==typeof operand||!(typeof value==='string'||typeof value==='number'))return false;
  const order=typeof value==='number'&&typeof operand==='number'?(value===operand?0:value<operand?-1:1):typeof value==='string'&&typeof operand==='string'?(value===operand?0:value<operand?-1:1):NaN;return op==='gt'?order>0:op==='gte'?order>=0:op==='lt'?order<0:order<=0;
 });
 return rows.filter(row=>(!query.namespace||row.namespace===query.namespace)&&(!query.reference||row.refs.some(ref=>ref.kind===query.reference!.kind&&ref.documentId===query.reference!.documentId))&&Object.entries(query.where??{}).every(([key,predicate])=>{
  const present=Object.hasOwn(row.fields,key),value=row.fields[key];if(predicate.exists!==undefined&&predicate.exists!==present)return false;
  const keys=Object.keys(predicate).filter(key=>key!=='exists');if(!keys.length)return true;
  return present&&(Array.isArray(value)?value:[value]).some(item=>matches(item,predicate));
 })).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id)).slice(query.offset??0,(query.offset??0)+(query.limit??100)).map(row=>structuredClone(row));
}
/** Reuse declared reference paths during the product's normal clone/remap. */
export function remapLocalToolIndexReferences(data:LocalToolJson,spec:LocalToolIndexSpec,remap:(id:string,prefix:string)=>string):LocalToolJson{
 validateLocalToolIndexSpec(spec);let result=cloneLocalToolJson(data);const seen=new Set<string>();
 for(const ref of spec.refs??[])for(const location of locations(ref.path,result).flatMap(members))if(typeof location.value==='string'&&location.value){const identity=JSON.stringify([ref.kind,location.value]);if(seen.has(identity))continue;const target=remap(location.value,worldDocumentPrefixes[ref.kind]);if(location.parent&&location.key!==undefined)(location.parent as Record<string,LocalToolJson>)[location.key]=target;else result=target;seen.add(JSON.stringify([ref.kind,target]));}
 return result;
}
export function localToolIndexSearchText(data:LocalToolJson,spec?:LocalToolIndexSpec):string{return spec?Object.values(evaluateLocalToolIndex(spec,data).fields).flat().map(String).join('\n'):'';}
