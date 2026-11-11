import type {LocalToolJson} from './stateTypes';
/** Portable packet metadata only; runtime definitions validate the complete app ABI. */
export interface RuntimePackageAppDescriptor {
 format:'writers-hoard-local-app/1';id:string;version:string;
 name:{en:string;es:string};description:{en:string;es:string};
 subRoutes:boolean;tools:readonly string[];
 state:{initialState:LocalToolJson;codec:object;preview:object};
 publishPreset?:'instance-documents'|'world-wiki';
}
export interface RuntimePackageFile {path:string;bytes:number;sha256:string;mime:string}
export type RuntimePackageMember={kind:'tool';namespace:string;version:string}|{kind:'app';namespace:string;version:string;descriptor:RuntimePackageAppDescriptor};
export interface RuntimePackageManifest {format:'writers-hoard-local-runtime-package/1';apiVersion:1;runtimeVersion:1;namespace:string;version:string;entry:'bundle.mjs';members:RuntimePackageMember[];files:RuntimePackageFile[];contentHash:string}
export interface RuntimePackageCatalogueOperation {id:string;description:{en:string;es:string};writes:true;inputSchema:object}
export interface RuntimePackageCatalogueTool {namespace:string;documentBacked:boolean;operations:RuntimePackageCatalogueOperation[];index?:{version:1;fields:Record<string,unknown>;refs?:unknown[]}}
export interface RuntimePackageCatalogue {version:1;tools:RuntimePackageCatalogueTool[]}
export interface CheckedRuntimePacket {manifest:RuntimePackageManifest;files:Map<string,Uint8Array>;packet:Uint8Array;fileSha256:string;bytes:number;catalogue?:RuntimePackageCatalogue}
export const RUNTIME_CATALOGUE_PATH:'metadata/derived-agent-catalogue.json';
export const RUNTIME_CATALOGUE_MIME:'application/vnd.writers-hoard.derived-agent-catalogue+json';
export function runtimeCatalogueFile(file:RuntimePackageFile):boolean;
export const LOCAL_RUNTIME_PACKAGE_FORMAT:'writers-hoard-local-runtime-package/1';
export function canonicalRuntimeJson(value:unknown):string;
export function runtimeBytesHash(bytes:Uint8Array):Promise<string>;
export function runtimeBase64(bytes:Uint8Array):string;
export function runtimeDecodeBase64(value:string):Uint8Array;
export function validateRuntimeManifest(value:unknown):asserts value is RuntimePackageManifest;
export function runtimeManifestIdentity(manifest:Omit<RuntimePackageManifest,'contentHash'>|RuntimePackageManifest):string;
export function inspectRuntimePacket(packet:Uint8Array):Promise<CheckedRuntimePacket>;
