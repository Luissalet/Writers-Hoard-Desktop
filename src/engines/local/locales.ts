import {cloneLocalToolJson,type LocalToolJson} from './stateTypes';
export interface LocalToolMessages {readonly [key:string]:string|LocalToolMessages}
export type LocalToolCatalogs=Readonly<Record<string,LocalToolMessages>>;
export interface LocalToolLocaleDefinition {readonly defaultLocale:string;readonly catalogs:LocalToolCatalogs}
export interface LocalToolLocaleSnapshot extends LocalToolLocaleDefinition {readonly locale:string;readonly supported:readonly string[]}
export interface LocalToolLocaleSource {readonly declaration:LocalToolLocaleDefinition;getSnapshot():string;subscribe(changed:()=>void):()=>void}
export type LocalToolMessageParams=Readonly<Record<string,string|number|boolean|null|undefined>>;
export interface LocalToolTranslator { (key:string,params?:LocalToolMessageParams):string;plural(key:string,count:number,params?:LocalToolMessageParams):string;number(value:number,options?:Intl.NumberFormatOptions):string;date(value:Date|number|string,options?:Intl.DateTimeFormatOptions):string;readonly locale:string}
const own=(object:object,key:string):unknown=>{const field=Object.getOwnPropertyDescriptor(object,key);if(field&&!('value'in field))throw Error('local_tool_locales_invalid');return field?.value;};
const tag=(value:unknown,fallback='en'):string=>{try{if(typeof value==='string'&&value.trim())return Intl.getCanonicalLocales(value)[0]??fallback;}catch{/* Invalid host language uses a stable fallback. */}return fallback;};
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
/** Capture only our own finite JSON tree; never freeze or invoke accessors on an author's input. */
export function prepareLocalToolLocales(input?:Partial<LocalToolLocaleDefinition>):LocalToolLocaleSnapshot{
 const raw=input?own(input,'catalogs'):undefined;
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw Error('local_tool_locales_invalid');
 const catalogs=cloneLocalToolJson((raw??{}) as LocalToolJson) as unknown as LocalToolCatalogs;
 const validate=(node:unknown):void=>{if(!node||typeof node!=='object'||Array.isArray(node))throw Error('local_tool_locales_invalid');for(const value of Object.values(node))if(typeof value!=='string')validate(value);};
 const normalized:Record<string,LocalToolMessages>={};for(const [code,messages]of Object.entries(catalogs)){validate(messages);const canonical=tag(code,'');if(!canonical||Object.hasOwn(normalized,canonical))throw Error('local_tool_locales_invalid');normalized[canonical]=messages;}
 return freeze({defaultLocale:tag(input?own(input,'defaultLocale'):undefined),catalogs:normalized,supported:Object.keys(normalized).sort(),locale:'en'});
}
/** Internal derivation over a prepared capture: no cloning/validation when only language changes. */
export function deriveLocalToolLocale(prepared:LocalToolLocaleSnapshot,locale?:string):LocalToolLocaleSnapshot{return Object.freeze({...prepared,locale:tag(locale)});}
export function resolveLocalToolLocale(input:{locale?:string;catalogs?:LocalToolCatalogs;defaultLocale?:string}={}):LocalToolLocaleSnapshot{return deriveLocalToolLocale(prepareLocalToolLocales(input),own(input,'locale') as string|undefined);}
const text=(value:unknown):string=>{try{return String(value);}catch{return '?';}};
const valid=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
function message(catalog:LocalToolMessages|undefined,key:string):string|LocalToolMessages|undefined{
 if(!catalog)return;const literal=own(catalog,key);if(literal!==undefined)return literal as string|LocalToolMessages;
 let value:unknown=catalog;for(const part of key.split('.')){if(!value||typeof value!=='object')return;value=own(value,part);}return value as string|LocalToolMessages|undefined;
}
/** Internal translator over immutable data owned by this module's preparation path. */
export function localToolTranslator(snapshot:LocalToolLocaleSnapshot):LocalToolTranslator{
 const codes=[...new Set([snapshot.locale,snapshot.locale.split('-')[0],snapshot.defaultLocale])];
 const interpolate=(value:string,params?:LocalToolMessageParams)=>value.replace(/\{([^{}]+)\}/g,(whole,key:string)=>{const item=params&&Object.hasOwn(params,key)?params[key]:undefined;return item===null||item===undefined?whole:text(item);});
 const keyText=(key:string)=>valid(key)?key:'?';
 const translate=(key:string,params?:LocalToolMessageParams):string=>{for(const code of codes){const value=message(snapshot.catalogs[code],key);if(valid(value))return interpolate(value,params);}return interpolate(keyText(key),params);};
 return Object.assign(translate,{
  locale:snapshot.locale,
  plural(key:string,count:number,params?:LocalToolMessageParams){if(!Number.isFinite(count))return interpolate(keyText(key),params);for(const code of codes){const value=message(snapshot.catalogs[code],key);if(valid(value))return interpolate(value,{...params,count});if(value&&typeof value==='object'){let category='other';try{category=new Intl.PluralRules(code).select(count);}catch{/* Own valid catalogs normally support Intl. */}for(const form of [String(count),category,'other']){const selected=own(value,form);if(valid(selected))return interpolate(selected,{...params,count});}}}return interpolate(keyText(key),{...params,count});},
  number(value:number,options?:Intl.NumberFormatOptions){if(typeof value!=='number'||!Number.isFinite(value))return text(value);try{return new Intl.NumberFormat(snapshot.locale,options).format(value);}catch{return text(value);}},
  date(value:Date|number|string,options?:Intl.DateTimeFormatOptions){if(!(value instanceof Date)&&typeof value!=='string'&&(typeof value!=='number'||!Number.isFinite(value)))return text(value);try{return new Intl.DateTimeFormat(snapshot.locale,options).format(value instanceof Date?value:new Date(value));}catch{return text(value);}},
 });
}
/** Public constructors also capture direct JS callers; readonly alone is not ownership. */
export function createLocalToolTranslator(snapshot:LocalToolLocaleSnapshot):LocalToolTranslator{return localToolTranslator(resolveLocalToolLocale(snapshot));}
export function createLocalToolLocaleSource(declaration:LocalToolLocaleDefinition|undefined,getSnapshot:()=>string=()=> 'en',subscribe:(changed:()=>void)=>()=>void=()=>()=>{}):LocalToolLocaleSource{
 const prepared=prepareLocalToolLocales(declaration);return Object.freeze({declaration:prepared,getSnapshot,subscribe});
}
