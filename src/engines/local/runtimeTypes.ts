import type {RuntimePackageManifest} from './runtimeFormat.mjs';
export interface LocalRuntimePackageRow {
 contentHash:string;namespace:string;manifest:RuntimePackageManifest;packet:Uint8Array;
 fileName:string;mime:'application/json';fileSha256:string;installedAt:number;memberNamespaces:string[];
}
export interface RuntimePackageInput {name:string;mime:string;base64:string}
export interface RuntimePackageFailure {phase:string;message:string}
