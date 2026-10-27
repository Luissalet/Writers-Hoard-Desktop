import type {LocalToolReleaseManifest} from '../src/engines/local/releaseFormat.mjs';
export interface LocalToolSourcePackage {manifest:LocalToolReleaseManifest;files:Record<string,string>}
export function checkLocalToolPackage(value:unknown):LocalToolSourcePackage;
export function packLocalToolSource(sourceDir:string):Promise<LocalToolSourcePackage>;
export function checkInstalledLocalToolRelease(directory:string):Promise<LocalToolReleaseManifest>;
export function installLocalToolPackage(value:LocalToolSourcePackage,rootDir?:string):Promise<{directory:string;manifest:LocalToolReleaseManifest;alreadyInstalled:boolean;rebuildRequired:true}>;
export function verifyInstalledLocalToolReleases(installed:string):Promise<void>;

export function packLocalRuntimeSource(sourceDir:string):Promise<{packet:Uint8Array;manifest:import('../src/engines/local/runtimeFormat.mjs').RuntimePackageManifest}>;
