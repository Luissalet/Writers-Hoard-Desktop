import type {LocalToolPresenceSnapshot,LocalToolPresencePeer} from './types';
export interface PresenceHostObservation {client:{projectId:string;eraId?:string;namespace:string;documentId?:string};instanceId:string;roomId:string|undefined;snapshot():LocalToolPresenceSnapshot;valid():Promise<boolean>}
export const presenceHosts=new Set<PresenceHostObservation>();
const observers=new Set<()=>void>();
export function subscribePresenceHosts(changed:()=>void){observers.add(changed);return()=>{observers.delete(changed);};}
export function notifyPresenceHosts(){for(const changed of observers)changed();}
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
/** Observe only existing host memberships: no opening, reader or network connection. */
export function observeLocalDocumentPresence(scope:{projectId:string;eraId?:string},namespace:string,documentId:string):LocalToolPresenceSnapshot {
 const snapshots=[...presenceHosts].filter(h=>h.client.projectId===scope.projectId&&h.client.eraId===scope.eraId&&h.client.namespace===namespace&&h.client.documentId===documentId).map(h=>h.snapshot());
 const peers=new Map<string,LocalToolPresencePeer>();for(const snapshot of snapshots)for(const peer of snapshot.peers){const known=peers.get(peer.userId);if(!known){peers.set(peer.userId,clone(peer));continue;}for(const connection of peer.connections)if(!known.connections.some(c=>c.connectionId===connection.connectionId&&c.instanceId===connection.instanceId&&c.sessionId===connection.sessionId))known.connections.push(clone(connection));}
 for(const peer of peers.values()){const active=peer.connections.filter(c=>c.active);peer.state=active.length===1?active[0].state:null;}
 return{status:snapshots.some(s=>s.status==='ready')?'ready':snapshots.some(s=>s.status==='connecting')?'connecting':snapshots.some(s=>s.status==='disconnected')?'disconnected':'unavailable',peers:[...peers.values()].sort((a,b)=>a.userId.localeCompare(b.userId))};
}
