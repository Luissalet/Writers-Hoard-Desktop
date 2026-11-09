import {cloneLocalToolJson,type LocalToolJson} from '../stateTypes';
export type RichAnnotationScalar=string|number|boolean|null;
export type RichAnnotationAttrs=Record<string,RichAnnotationScalar>;
export interface RichAnnotationAttribute {type:'string'|'number'|'boolean'|'null';enum?:RichAnnotationScalar[]}
export interface RichAnnotationSpec {id:string;version:1;attributes:Record<string,RichAnnotationAttribute>}
export interface AnnotationPresentation {label:string;attributes?:Record<string,string>;values?:Record<string,Record<string,string>>}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const key=(v:string)=>!!v&&!['__proto__','constructor','prototype'].includes(v);
const fail=():never=>{throw Error('local_tool_rich_annotation_invalid');};
const scalar=(v:unknown,type:string)=>type==='null'?v===null:typeof v===type&&(typeof v!=='number'||Number.isFinite(v));
export function annotationCanonical(value:unknown):string {
 const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,item])=>[k,sort(item)])):v;
 return JSON.stringify(sort(value));
}
export function validateAnnotationSpec(value:unknown):asserts value is RichAnnotationSpec {
 cloneLocalToolJson(value as LocalToolJson);
 if(!object(value)||Object.keys(value).sort().join(',')!=='attributes,id,version'||typeof value.id!=='string'||!value.id||value.version!==1||!object(value.attributes))return fail();
 for(const[name,attribute]of Object.entries(value.attributes)){
  if(!key(name)||!object(attribute)||Object.keys(attribute).some(k=>k!=='type'&&k!=='enum')||!['string','number','boolean','null'].includes(attribute.type as string))return fail();
  if(attribute.enum!==undefined&&(!Array.isArray(attribute.enum)||!attribute.enum.length||attribute.enum.some(v=>!scalar(v,attribute.type as string))||new Set(attribute.enum.map(annotationCanonical)).size!==attribute.enum.length))return fail();
 }
}
export function validateAnnotationAttrs(value:unknown,spec:RichAnnotationSpec):asserts value is RichAnnotationAttrs {
 cloneLocalToolJson(value as LocalToolJson);
 if(!object(value)||Object.keys(value).length!==Object.keys(spec.attributes).length)return fail();
 for(const[name,attribute]of Object.entries(spec.attributes))if(!Object.hasOwn(value,name)||!scalar(value[name],attribute.type)||attribute.enum&&!attribute.enum.some(v=>v===value[name]))return fail();
}
/** Detached policy, bound to the codec's identity rather than a mutable registry. */
export function annotationSpec(field:unknown):RichAnnotationSpec|undefined {
 if(!object(field)||field.kind!=='rich'||field.profile!=='paragraphs-inline/3')return undefined;
 validateAnnotationSpec(field.annotation);const spec=JSON.parse(annotationCanonical(field.annotation)) as RichAnnotationSpec;
 for(const attribute of Object.values(spec.attributes)){if(attribute.enum)Object.freeze(attribute.enum);Object.freeze(attribute);}Object.freeze(spec.attributes);return Object.freeze(spec);
}
