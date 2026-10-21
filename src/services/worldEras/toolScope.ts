import type { Table } from 'dexie';
import { BridgeError, checkLinkedRow, optString, resolveProjectId, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { readEraRow } from './store';
export function worldEraToolScope(args: ToolArgs) { const eraId = optString(args, 'eraId'); return eraId ? { projectId: resolveProjectId(args), eraId } : undefined; }
export async function checkEraLinkedRow<T extends { projectId: string }>(args: ToolArgs, table: Table<T, string>, id: string | undefined, projectId: string, what: string): Promise<T | undefined> {
  const eraId = optString(args, 'eraId'); if (!eraId) return checkLinkedRow(table, id, projectId, what);
  if (!id) return undefined;
  const row = await readEraRow<T>({ projectId, eraId }, table.name, id);
  if (!row || row.projectId !== projectId) throw new BridgeError('bad-args', `The linked ${what} is absent in this era.`);
  return row;
}
