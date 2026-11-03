import type * as Y from 'yjs';
import type {LocalToolJson} from '../stateTypes';
import {sha256Hex} from '../../../services/aiRuntime/recipe';
const fail=():never=>{throw Error('local_tool_convergence_format_invalid');};
/** Causal envelopes may contain wrapped state/history larger or deeper than one state.
 * State limits remain enforced on data by the existing codec/writer, not on its envelope. */
export function convergenceClone<T>(value:T):T {
 const active=new Set<object>();
 const visit=(value:unknown):unknown=>{
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||active.has(value))return fail();active.add(value);
  try{
   if(Array.isArray(value)){
    if(Reflect.ownKeys(value).length!==value.length+1)return fail();
    return Array.from({length:value.length},(_,index)=>{const property=Object.getOwnPropertyDescriptor(value,String(index));if(!property||!('value'in property)||!property.enumerable)return fail();return visit(property.value);});
   }
   if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return fail();
   return Object.fromEntries(Reflect.ownKeys(value).map(key=>{if(typeof key!=='string')return fail();const property=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in property)||!property.enumerable)return fail();return[key,visit(property.value)];}));
  }finally{active.delete(value);}
 };
 return visit(value) as T;
}
/** Canonical object keys only; array order and opaque strings remain literal. */
export function convergenceCanonical(value:unknown):string {
 const safe=convergenceClone(value) as LocalToolJson;
 const canonical=(value:LocalToolJson):LocalToolJson=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 return JSON.stringify(canonical(safe));
}
export const convergenceHash=(value:unknown):string=>sha256Hex(convergenceCanonical(value));
export function convergenceBase64(bytes:Uint8Array):string {
 // Native encoders keep standard alphabet/padding and avoid the binary-string copy.
 const native=(Uint8Array.prototype as Uint8Array & {toBase64?:()=>string}).toBase64;
 if(typeof native==='function')return native.call(bytes);
 const buffer=(globalThis as typeof globalThis & {Buffer?:{from:(buffer:ArrayBufferLike,offset:number,length:number)=>{toString:(encoding:'base64')=>string}}}).Buffer;
 if(buffer)return buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
 let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
 return btoa(binary);
}
export function convergenceBytes(base64:string):Uint8Array {
 // Repeating one character avoids overflowing the regexp stack on large envelopes.
 if(typeof base64!=='string'||base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(base64))return fail();
 const binary=atob(base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));if(convergenceBase64(bytes)!==base64)return fail();return bytes;
}
/** JSON text protects opaque UTF-16 strings from the engine's UTF-8 Any encoding. */
export class JsonMap<T>{
 constructor(inner:Y.Map<string>){this.inner=inner;}
 readonly inner:Y.Map<string>;
 get(key:string):T|undefined{const text=this.inner.get(key);if(text===undefined)return undefined;if(typeof text!=='string')throw Error('local_tool_convergence_json_invalid');return JSON.parse(text) as T;}
 has(key:string){return this.inner.has(key);}
 set(key:string,value:T){this.inner.set(key,JSON.stringify(value));}
 keys(){return this.inner.keys();}
 *values():IterableIterator<T>{for(const key of this.keys())yield this.get(key)!;}
 *[Symbol.iterator]():IterableIterator<[string,T]>{for(const key of this.keys())yield[key,this.get(key)!];}
 observe(callback:()=>void){this.inner.observe(callback);}
}
export class JsonArray<T>{
 constructor(inner:Y.Array<string>){this.inner=inner;}
 readonly inner:Y.Array<string>;
 toArray():T[]{return this.inner.toArray().map(text=>{if(typeof text!=='string')throw Error('local_tool_convergence_json_invalid');return JSON.parse(text) as T;});}
 insert(index:number,values:T[]){this.inner.insert(index,values.map(value=>JSON.stringify(value)));}
 push(values:T[]){this.inner.push(values.map(value=>JSON.stringify(value)));}
}
