// Wire data has no SDK, database, editor or executable codec dependencies.
export type PresenceJson=null|boolean|number|string|PresenceJson[]|{[key:string]:PresenceJson};
type LocalToolJson=PresenceJson;
export interface PresenceConvergenceIdentity {namespace:string;genesisId:string;codecHash:string;validationId:string;schemaEpoch:string;engine:{id:string;version:string;updateFormat:string;libraryVersion:string}}
export interface LocalToolPresenceProfile {userId:string;name:string;color:string;avatarMediaId?:string}
export interface LocalToolPresenceDocument {projectId:string;eraId:string|null;namespace:string;documentId:string;lineage:string;convergence?:PresenceConvergenceIdentity}
export interface LocalToolPresenceConnection {connectionId:string;instanceId:string;sessionId:string;state:LocalToolJson|null;surface:LocalToolJson|null;active:boolean}
export interface LocalToolPresencePeer extends LocalToolPresenceProfile {isSelf:boolean;state:LocalToolJson|null;connections:LocalToolPresenceConnection[]}
export interface LocalToolPresenceSnapshot {status:'unavailable'|'connecting'|'ready'|'disconnected';peers:LocalToolPresencePeer[];error?:string}
export interface LocalToolDocumentPresence {readonly instanceId:string;getSnapshot():LocalToolPresenceSnapshot;subscribe(changed:()=>void):()=>void;setLocal(state:LocalToolJson|null):void;publish(state:LocalToolJson):()=>void;clear():void}
export interface PresenceMember {profile:LocalToolPresenceProfile;connectionId:string;instanceId:string;sessionId:string;state:LocalToolJson|null;surface:LocalToolJson|null;activeOrder:number}
export interface PresenceRoomSnapshot {roomId:string;document:LocalToolPresenceDocument;members:PresenceMember[]}
export interface PresenceWireSnapshot {rooms:PresenceRoomSnapshot[]}

export type LocalToolCollabPresencePeer<T extends PresenceJson>=Omit<LocalToolPresencePeer,'state'|'connections'>&{state:T|null;connections:(Omit<LocalToolPresenceConnection,'state'>&{state:T|null})[]};
