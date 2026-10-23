// The table rules are stored with the project and saved whole with a revision,
// so two windows (or the panel and the bridge) cannot overwrite each other.
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { EMPTY_TABLE_RULES, validateTableRules, type TableRules } from './tableRules';

export class TableRulesConflict extends Error { constructor() { super('table_rules_conflict'); this.name = 'TableRulesConflict'; } }

export async function readTableRules(projectId: string): Promise<TableRules> {
  return (await db.projects.get(projectId))?.tableRules ?? { ...EMPTY_TABLE_RULES, values: {}, info: [] };
}

export async function saveTableRules(projectId: string, next: Pick<TableRules, 'system' | 'values' | 'info'>, expectedRevision: number): Promise<TableRules> {
  validateTableRules(next);
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.tableRules ?? EMPTY_TABLE_RULES;
    if (current.revision !== expectedRevision) throw new TableRulesConflict();
    const written: TableRules = { revision: current.revision + 1, system: next.system, values: structuredClone(next.values), info: structuredClone(next.info) };
    await db.projects.update(projectId, { tableRules: written, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return written;
  });
  notifyProjectsChanged();
  return saved;
}

/** Put the rules back as they were (undo), whatever their revision now. */
export async function restoreTableRules(projectId: string, previous: TableRules): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    await db.projects.update(projectId, { tableRules: { revision: (project.tableRules?.revision ?? 0) + 1, system: previous.system, values: previous.values, info: previous.info }, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  });
  notifyProjectsChanged();
}
