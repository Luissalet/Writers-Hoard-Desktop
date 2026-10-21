import Dexie, { type DBCoreTransaction } from 'dexie';
const pending = new WeakMap<DBCoreTransaction, Set<string>>();
const listeners = new Map<string, Set<() => void>>();
/** Native middleware bypasses Dexie's cache; publish only after commit, outside its transaction zone. */
export function announceDocumentHistory(transaction: DBCoreTransaction, projectId: string): void {
 let projects = pending.get(transaction);
 if (!projects) { projects = new Set(); pending.set(transaction,projects); const committed=projects; (transaction as unknown as IDBTransaction).addEventListener('complete',()=>Dexie.ignoreTransaction(()=>{for(const id of committed)for(const listener of listeners.get(id)??[])listener();}),{once:true}); }
 projects.add(projectId);
}
export function subscribeDocumentHistory(projectId: string, listener: () => void): () => void { const set=listeners.get(projectId)??new Set(); set.add(listener);listeners.set(projectId,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(projectId);}; }
