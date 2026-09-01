// ============================================
// How much does this project have in each engine?
// ============================================
//
// The Engine Manager needs this to keep a promise: never switch an engine off
// without saying, by name, what that engine is currently holding. Every engine
// declares its Dexie tables in `EngineDefinition.tables` as
// `{ tableName: 'indexSpec' }`, so the count is derived from the registry
// rather than from a hand-maintained list that would drift the first time an
// engine gained a table.
//
// Only tables indexed by `projectId` are counted: those are the rows this
// project owns. Child tables keyed by a parent id (`sceneCasts: 'id, sceneId'`)
// are reached through their parent and would need a join to attribute, so they
// are left out — the number is a floor on what an engine holds, never an
// inflation of it.

import { db } from '@/db';
import { getAllEngines, type EngineDefinition } from '@/engines';

const PROJECT_INDEX = 'projectId';

function projectScopedTables(engine: EngineDefinition): string[] {
  return Object.entries(engine.tables)
    .filter(([, indexSpec]) =>
      indexSpec.split(',').map(part => part.trim()).includes(PROJECT_INDEX))
    .map(([tableName]) => tableName);
}

/** Rows this project owns in one engine's tables. */
export async function countEngineRows(
  engine: EngineDefinition,
  projectId: string,
): Promise<number> {
  const perTable = await Promise.all(
    projectScopedTables(engine).map(tableName =>
      db.table(tableName).where(PROJECT_INDEX).equals(projectId).count()),
  );
  return perTable.reduce((total, count) => total + count, 0);
}

/**
 * Row counts for every registered engine, keyed by engine id.
 *
 * Every engine is counted, not just the enabled ones: an engine switched off
 * months ago still holds its rows, and that is exactly what a writer needs to
 * see before a preset switches it off again — or back on.
 */
export async function countProjectRowsByEngine(
  projectId: string,
): Promise<Record<string, number>> {
  const engines = getAllEngines();
  const totals = await Promise.all(
    engines.map(engine => countEngineRows(engine, projectId)),
  );
  return Object.fromEntries(
    engines.map((engine, index) => [engine.id, totals[index]] as const),
  );
}
