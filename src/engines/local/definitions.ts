import type {LocalToolDefinition} from './sdk';
import type {LocalReleaseMetadata} from './releaseMetadata';
import {registerSourceAdditiveOriginLookup} from './documents/additiveOrigin';
interface Catalog {development?:LocalToolDefinition;releases:Map<string,{manifest:LocalReleaseMetadata;definition:LocalToolDefinition}>}
const definitions=new Map<string,Catalog>();
export const localToolEngineId=(namespace:string)=>`local-tool-${namespace}`;
export const getLocalToolCatalog=(namespace:string)=>definitions.get(namespace);
/** Representative metadata for discovery/engine identity only; never selects executable code for a project. */
export const listLocalToolDefinitions=()=>[...definitions.values()].map(catalog=>catalog.development??[...catalog.releases.values()][0]?.definition).filter((source):source is LocalToolDefinition=>!!source);
export const getLocalToolDefinition=(namespace:string,contentHash?:string|null)=>contentHash?definitions.get(namespace)?.releases.get(contentHash)?.definition:definitions.get(namespace)?.development;
registerSourceAdditiveOriginLookup((namespace,contentHash)=>getLocalToolDefinition(namespace,contentHash)?.sourceAdditive?.from);
export const getLocalToolReleases=(namespace:string)=>[...definitions.get(namespace)?.releases.values()??[]].sort((a,b)=>a.manifest.version.localeCompare(b.manifest.version,'en',{numeric:true})||a.manifest.contentHash.localeCompare(b.manifest.contentHash));
export function rememberLocalToolDefinition(definition:LocalToolDefinition,manifest?:LocalReleaseMetadata){if(manifest)for(const spec of Object.values(definition.assets??{}))if(!manifest.files.some(file=>file.path===spec.path))throw Error('local_asset_file_not_in_release');const catalog:Catalog=definitions.get(definition.namespace)??{releases:new Map()};if(manifest)catalog.releases.set(manifest.contentHash,{manifest:structuredClone(manifest),definition});else catalog.development=definition;definitions.set(definition.namespace,catalog);}

/** Copy catalogue membership before asynchronous publication work. Definitions are immutable compiled handles. */
export function captureLocalToolDefinitions(){return new Map([...definitions].map(([namespace,catalog])=>[namespace,{development:catalog.development,releases:new Map(catalog.releases)}]));}

/** Detached catalogue updates. Validation/cloning precede the no-await commit. */
export function prepareLocalToolDefinitions(entries:{definition:LocalToolDefinition;manifest?:LocalReleaseMetadata}[]){
 const updates=new Map<string,Catalog>();
 for(const {definition,manifest}of entries){
  if(manifest)for(const asset of Object.values(definition.assets??{}))if(!manifest.files.some(file=>file.path===asset.path))throw Error('local_asset_file_not_in_release');
  const old=updates.get(definition.namespace)??definitions.get(definition.namespace),next:Catalog={development:old?.development,releases:new Map(old?.releases)};
  if(manifest)next.releases.set(manifest.contentHash,{manifest:structuredClone(manifest),definition});else next.development=definition;
  updates.set(definition.namespace,next);
 }
 return ()=>{for(const [namespace,catalog]of updates)definitions.set(namespace,catalog);};
}
