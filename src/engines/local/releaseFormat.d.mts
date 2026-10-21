export interface LocalToolReleaseFile {path:string;sha256:string;bytes:number}
export interface LocalToolReleaseManifest {format:'writers-hoard-local-tool-source/1';apiVersion:1;namespace:string;version:string;contentHash:string;files:LocalToolReleaseFile[]}
export const LOCAL_TOOL_SOURCE_FORMAT:'writers-hoard-local-tool-source/1';
export function localToolContentHash(value:unknown):value is string;
export function localToolSourcePath(value:unknown):value is string;
export function validateLocalToolRelease(value:unknown):asserts value is LocalToolReleaseManifest;
export function localToolReleaseIdentity(value:Pick<LocalToolReleaseManifest,'namespace'|'version'|'files'>):string;
