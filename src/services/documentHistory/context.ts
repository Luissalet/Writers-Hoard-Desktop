import Dexie, { type DBCoreTransaction } from 'dexie';
const suppressed = new WeakSet<DBCoreTransaction>();
const documents = new WeakMap<DBCoreTransaction, Set<string>>();
const token = (projectId: string, kind: string, entityId: string) => JSON.stringify([projectId, kind, entityId]);
/** Import/clone/project cleanup explicitly opt their existing transaction out of capture. */
export function suppressDocumentHistoryForTransaction(): void {
  const transaction = Dexie.currentTransaction; if (!transaction) throw Error('history_transaction_required');
  suppressed.add(transaction.idbtrans);
}
export function suppressDocumentHistoryForDocument(projectId: string, kind: string, entityId: string): void {
  const transaction = Dexie.currentTransaction; if (!transaction) throw Error('history_transaction_required');
  const seen = documents.get(transaction.idbtrans) ?? new Set<string>(); seen.add(token(projectId, kind, entityId)); documents.set(transaction.idbtrans, seen);
}
export function historyCaptureSuppressed(transaction: DBCoreTransaction, projectId?: string, kind?: string, entityId?: string): boolean { return suppressed.has(transaction) || !!(projectId && kind && entityId && documents.get(transaction)?.has(token(projectId, kind, entityId))); }
