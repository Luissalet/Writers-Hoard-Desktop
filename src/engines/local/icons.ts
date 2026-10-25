import {PLACE_CATALOG_ID,PLACE_CATALOG_NAMES,canonicalPlaceCatalogName} from '../worldgen/core/placeIconCatalog';

export interface LocalToolIconDescriptor {id:string;pack:string;name:string;label:string}
export interface LocalToolIconPack {id:string;label:string;count:number}
export interface LocalToolIconSearchOptions {offset?:number;limit?:number}
export interface LocalToolIconPage {items:LocalToolIconDescriptor[];total:number}
export interface LocalToolIcons {
 get(id:string):Promise<LocalToolIconDescriptor|null>;
 search(query:string,options?:LocalToolIconSearchOptions):Promise<LocalToolIconPage>;
 packs():Promise<LocalToolIconPack[]>;
}
const names=[...PLACE_CATALOG_NAMES].sort();
const label=(name:string)=>name.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
const descriptor=(name:string):LocalToolIconDescriptor=>({id:`${PLACE_CATALOG_ID}:${name}`,pack:PLACE_CATALOG_ID,name,label:label(name)});
/** Shared static metadata only: no renderer, geometry, database or network. */
export function createLocalToolIcons():LocalToolIcons {
 return Object.freeze({
  async get(id:string){
   if(typeof id!=='string')return null;
   const name=canonicalPlaceCatalogName(id.startsWith(PLACE_CATALOG_ID+':')?id.slice(PLACE_CATALOG_ID.length+1):id);
   return name?descriptor(name):null;
  },
  async search(query:string,{offset=0,limit=50}:LocalToolIconSearchOptions={}){
   if(typeof query!=='string'||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1)throw Error('local_tool_icon_query_invalid');
   const text=query.toLowerCase(),matches=names.filter(name=>name.toLowerCase().includes(text)||label(name).toLowerCase().includes(text));
   return{items:matches.slice(offset,offset+limit).map(descriptor),total:matches.length};
  },
  async packs(){return[{id:PLACE_CATALOG_ID,label:'Writer map symbols',count:names.length}];},
 });
}
