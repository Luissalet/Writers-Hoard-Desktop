import type {BridgeToolSchema} from '@/services/aiBridge/schema';
import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
const keywords=new Set(['type','title','description','$schema','default','examples','readOnly','writeOnly','deprecated','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','enum','const','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','pattern','anyOf','oneOf','allOf']);
/** Refuse unsupported assertions instead of advertising rules we do not enforce. */
export function validateLocalOperationSchema(schema:BridgeToolSchema):void{
 const visit=(spec:unknown):void=>{
  if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('invalid_local_tool_operation_schema');
  const row=spec as Record<string,unknown>;for(const key of Object.keys(row))if(!keywords.has(key))throw new Error(`unsupported_local_tool_schema_keyword: ${key}`);
  if(row.type!==undefined&&!(Array.isArray(row.type)?row.type:[row.type]).every(value=>['object','array','string','number','integer','boolean','null'].includes(String(value))))throw new Error('invalid_local_tool_operation_schema_type');
  if(row.properties!==undefined){if(!row.properties||typeof row.properties!=='object'||Array.isArray(row.properties))throw new Error('invalid_local_tool_operation_schema_properties');Object.values(row.properties).forEach(visit);}
  for(const key of ['items','additionalProperties'])if(row[key]!==undefined&&typeof row[key]!=='boolean')visit(row[key]);
  for(const key of ['anyOf','oneOf','allOf'])if(row[key]!==undefined){if(!Array.isArray(row[key])||!row[key].length)throw new Error('invalid_local_tool_operation_schema_composition');row[key].forEach(visit);}
  if(row.required!==undefined&&(!Array.isArray(row.required)||row.required.some(value=>typeof value!=='string')))throw new Error('invalid_local_tool_operation_schema_required');
  if(row.enum!==undefined&&(!Array.isArray(row.enum)||!row.enum.length))throw new Error('invalid_local_tool_operation_schema_enum');
  if(row.pattern!==undefined){if(typeof row.pattern!=='string')throw new Error('invalid_local_tool_operation_schema_pattern');new RegExp(row.pattern);}
  for(const key of ['minItems','maxItems','minLength','maxLength'])if(row[key]!==undefined&&(!Number.isSafeInteger(row[key])||Number(row[key])<0))throw new Error('invalid_local_tool_operation_schema_bound');
  for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum'])if(row[key]!==undefined&&(typeof row[key]!=='number'||!Number.isFinite(row[key])))throw new Error('invalid_local_tool_operation_schema_bound');
 };
 visit(schema);
}
const canonical=(value:LocalToolJson):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
/** JSON schema vocabulary used by native tools, recursively for extension inputs. */
export function localOperationInput(schema:BridgeToolSchema,input:unknown):Record<string,LocalToolJson>{
 const value=cloneLocalToolJson(input as LocalToolJson,Number.MAX_SAFE_INTEGER);
 const check=(spec:Record<string,unknown>,item:LocalToolJson,path:string):void=>{
  const error=(message:string):never=>{throw new Error(`invalid_operation_input: ${path} ${message}`);};
  const matches=(option:unknown)=>{try{check(option as Record<string,unknown>,item,path);return true;}catch{return false;}};
  if(Array.isArray(spec.anyOf)&&!spec.anyOf.some(matches))error('does not match anyOf');
  if(Array.isArray(spec.oneOf)&&spec.oneOf.filter(matches).length!==1)error('does not match oneOf');
  if(Array.isArray(spec.allOf))spec.allOf.forEach(option=>check(option as Record<string,unknown>,item,path));
  if(spec.const!==undefined&&canonical(spec.const as LocalToolJson)!==canonical(item))error('has another const value');
  if(Array.isArray(spec.enum)&&!spec.enum.some(value=>canonical(value)===canonical(item)))error('is outside enum');
  const actual=item===null?'null':Array.isArray(item)?'array':typeof item,types=Array.isArray(spec.type)?spec.type:[spec.type];
  if(spec.type&&!types.some(type=>type===actual||type==='integer'&&actual==='number'&&Number.isInteger(item)))error(`must be ${types.join('|')}`);
  if(typeof item==='number'){if(typeof spec.minimum==='number'&&item<spec.minimum||typeof spec.maximum==='number'&&item>spec.maximum||typeof spec.exclusiveMinimum==='number'&&item<=spec.exclusiveMinimum||typeof spec.exclusiveMaximum==='number'&&item>=spec.exclusiveMaximum)error('is outside numeric bounds');}
  if(typeof item==='string'){const length=Array.from(item).length;if(typeof spec.minLength==='number'&&length<spec.minLength||typeof spec.maxLength==='number'&&length>spec.maxLength)error('is outside text bounds');if(typeof spec.pattern==='string'&&!new RegExp(spec.pattern).test(item))error('does not match pattern');}
  if(Array.isArray(item)){if(typeof spec.minItems==='number'&&item.length<spec.minItems||typeof spec.maxItems==='number'&&item.length>spec.maxItems)error('is outside array bounds');if(spec.uniqueItems&&new Set(item.map(canonical)).size!==item.length)error('contains duplicates');if(spec.items===false&&item.length)error('does not accept items');if(spec.items&&typeof spec.items==='object')item.forEach((value,index)=>check(spec.items as Record<string,unknown>,value,`${path}[${index}]`));}
  else if(item&&typeof item==='object'){const properties=(spec.properties??{})as Record<string,Record<string,unknown>>;for(const key of (spec.required??[])as string[])if(!Object.hasOwn(item,key))error(`requires ${key}`);for(const[key,value]of Object.entries(item)){const nested=properties[key];if(nested)check(nested,value,`${path}.${key}`);else if(spec.additionalProperties===false)error(`does not accept ${key}`);else if(spec.additionalProperties&&typeof spec.additionalProperties==='object')check(spec.additionalProperties as Record<string,unknown>,value,`${path}.${key}`);}}
 };
 check(schema as unknown as Record<string,unknown>,value,'input');
 return value as Record<string,LocalToolJson>;
}
