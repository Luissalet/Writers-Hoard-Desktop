import type {LocalToolDefinition} from './sdk';
import type {LocalToolReleaseManifest} from './releaseFormat.mjs';
interface Catalog {development?:LocalToolDefinition;releases:Map<string,{manifest:LocalToolReleaseManifest;definition:LocalToolDefinition}>}
const definitions=new Map<string,Catalog>();
export const localToolEngineId=(namespace:string)=>`local-tool-${namespace}`;
export const getLocalToolCatalog=(namespace:string)=>definitions.get(namespace);
/** Representative metadata for discovery/engine identity only; never selects executable code for a project. */
export const listLocalToolDefinitions=()=>[...definitions.values()].map(catalog=>catalog.development??[...catalog.releases.values()][0]?.definition).filter((source):source is LocalToolDefinition=>!!source);
export const getLocalToolDefinition=(namespace:string,contentHash?:string|null)=>contentHash?definitions.get(namespace)?.releases.get(contentHash)?.definition:definitions.get(namespace)?.development;
export const getLocalToolReleases=(namespace:string)=>[...definitions.get(namespace)?.releases.values()??[]].sort((a,b)=>a.manifest.version.localeCompare(b.manifest.version,'en',{numeric:true})||a.manifest.contentHash.localeCompare(b.manifest.contentHash));
export function rememberLocalToolDefinition(definition:LocalToolDefinition,manifest?:LocalToolReleaseManifest){const catalog:Catalog=definitions.get(definition.namespace)??{releases:new Map()};if(manifest)catalog.releases.set(manifest.contentHash,{manifest:structuredClone(manifest),definition});else catalog.development=definition;definitions.set(definition.namespace,catalog);}
