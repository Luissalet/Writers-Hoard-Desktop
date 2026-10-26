import Dexie, { type Transaction } from 'dexie';
import { db } from '@/db';
import { announceEraChange, readWorldDocument, resetEraDocument, saveEraDocument } from '@/services/worldEras/store';
import { WorldEraConflict, type EraDocumentRead, type WorldEraScope } from '@/services/worldEras/types';
import { changeTable } from './operations';
import { insertRow, moveRow } from './tableEdits';
import type { DataRow, WorldTable } from './types';

export type TableRowAction = { action: 'move-row'; rowId: string; beforeRowId?: string } | { action: 'insert-row'; at?: number; beforeRowId?: string };
export interface TableRowResult { tableId: string; version: string; row?: DataRow; receiptId?: string }
interface Receipt { scope: WorldEraScope; tableId: string; before: WorldTable; provenance: EraDocumentRead['provenance']; afterVersion: string; claimed?: Transaction }
const receipts = new Map<string, Receipt>();
const outer = (transaction: Transaction): Transaction => transaction.parent ? outer(transaction.parent) : transaction;
const tableFrom = (read: EraDocumentRead) => read.document.root as unknown as WorldTable;

export async function editTableRows(scope: WorldEraScope, tableId: string, action: TableRowAction, expectedVersion: string, committed?: (result: TableRowResult) => void): Promise<TableRowResult> {
  return db.transaction('rw', db.tables, async transaction => {
    const read = await readWorldDocument(scope, 'tables', tableId);
    if (!read) throw Error('table_missing');
    if (read.version !== expectedVersion) throw new WorldEraConflict();
    const before = tableFrom(read), next = structuredClone(before);
    if (next.codexType || next.codexTemplateId || next.codexAllTypes) throw Error('table_live_order_requires_view');
    let row: DataRow | undefined;
    if (action.action === 'move-row') {
      if (!moveRow(next, action.rowId, action.beforeRowId)) return { tableId, version: read.version };
    } else {
      if (action.beforeRowId !== undefined && action.at !== undefined) throw Error('table_row_position_invalid');
      const at = action.beforeRowId === undefined ? action.at ?? next.rows.length : next.rows.findIndex(item => item.id === action.beforeRowId);
      if (!Number.isFinite(at) || action.beforeRowId !== undefined && at < 0) throw Error('table_row_position_invalid');
      row = insertRow(next, at);
    }
    await changeTable(scope.projectId, tableId, current => { Object.assign(current, next); }, scope.eraId);
    const after = (await readWorldDocument(scope, 'tables', tableId))!, receiptId = crypto.randomUUID(), owner = outer(transaction);
    receipts.set(receiptId, { scope: { ...scope }, tableId, before: structuredClone(before), provenance: read.provenance, afterVersion: after.version });
    owner.on('abort', () => { receipts.delete(receiptId); });
    const result: TableRowResult = { tableId, version: after.version, ...(row ? { row } : {}), receiptId };
    if (committed) owner.on('complete', () => Dexie.ignoreTransaction(() => committed(result)));
    return result;
  });
}

export async function undoTableRows(scope: WorldEraScope, receiptId: string): Promise<string> {
  const receipt = receipts.get(receiptId);
  if (!receipt || receipt.scope.projectId !== scope.projectId || receipt.scope.eraId !== scope.eraId) throw Error('table_row_receipt_missing');
  await db.transaction('rw', db.tables, async transaction => {
    // A root's rejection can reach its caller before the abort listener releases
    // the reservation. An inactive root cannot write again; the version check
    // below still refuses replay if that root committed instead of aborting.
    if (receipt.claimed && !receipt.claimed.active) receipt.claimed = undefined;
    if (receipts.get(receiptId) !== receipt || receipt.claimed) throw Error('table_row_receipt_missing');
    const owner = outer(transaction); receipt.claimed = owner;
    owner.on('complete', () => { receipts.delete(receiptId); });
    owner.on('abort', () => { if (receipts.get(receiptId) === receipt) receipt.claimed = undefined; });
    const current = await readWorldDocument(scope, 'tables', receipt.tableId);
    if (!current || current.version !== receipt.afterVersion) throw new WorldEraConflict();
    if (scope.eraId && receipt.provenance === 'base') await resetEraDocument(scope, 'tables', receipt.tableId, current.variantRevision!);
    else if (scope.eraId) await saveEraDocument(scope, 'tables', { root: structuredClone(receipt.before) as unknown as Record<string, unknown> & { id: string }, children: {} }, current.version);
    else {
      await changeTable(scope.projectId, receipt.tableId, table => { for (const key of Object.keys(table)) delete (table as unknown as Record<string, unknown>)[key]; Object.assign(table, structuredClone(receipt.before)); });
      announceEraChange(scope.projectId, true);
    }
  });
  return receipt.tableId;
}
