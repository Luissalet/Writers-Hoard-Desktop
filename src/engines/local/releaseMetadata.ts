import type {LocalToolReleaseManifest} from './releaseFormat.mjs';
import type {RuntimePackageFile} from './runtimeFormat.mjs';
export interface RuntimeMemberRelease {
 format:'writers-hoard-local-runtime-member/1';apiVersion:1;runtimeVersion:1;
 namespace:string;version:string;contentHash:string;packageNamespace:string;kind:'app'|'tool';files:RuntimePackageFile[];
}
export type LocalReleaseMetadata=LocalToolReleaseManifest|RuntimeMemberRelease;
