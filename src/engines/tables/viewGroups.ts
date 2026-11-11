import type { DataColumn, TableGroupingView, TableGroupRule, TableViewSettings } from './types';
import { CONDITION_OPS } from './tableEdits.ts';

export const tableViewParts = ['rules', 'sorts', 'conditions'] as const;

export type StoredTableView = TableViewSettings & { conditionsRevision: number };

export function storedTableView(views: readonly TableGroupingView[] | undefined, tableId: string, eraId?: string): StoredTableView {
  if (!Array.isArray(views)) return { rules: [], sorts: [], conditions: [], conditionsRevision: 0 };
  const own = views.find(view => view?.tableId === tableId && view.eraId === eraId);
  const base = eraId ? views.find(view => view?.tableId === tableId && view.eraId === undefined) : undefined;
  const read = <K extends keyof TableViewSettings>(key: K): TableViewSettings[K] => {
    const part = own?.[key] ?? base?.[key];
    return Array.isArray(part) ? part : [];
  };
  const revision = (Array.isArray(own?.conditions) ? own : base)?.conditionsRevision;
  return { rules: read('rules'), sorts: read('sorts'), conditions: read('conditions'), conditionsRevision: Number.isSafeInteger(revision) ? Math.max(0, revision!) : 0 };
}

export const filterStamp = (revision: number, conditions: readonly TableViewSettings['conditions'][number][]) => JSON.stringify([revision, conditions]);

/** Dexie may deliver an intermediate snapshot after a newer local save was acknowledged. */
export function confirmedTableFilters(
  revision: number, stored: TableViewSettings['conditions'], visible: TableViewSettings['conditions'],
  acknowledged: { revision: number; conditions: TableViewSettings['conditions'] } | undefined,
) {
  return acknowledged && acknowledged.revision > revision
    ? { stamp: filterStamp(acknowledged.revision, acknowledged.conditions), visible: acknowledged.conditions }
    : { stamp: filterStamp(revision, stored), visible };
}

export function effectiveTableView(view: Partial<TableViewSettings>, columns: readonly DataColumn[]): TableViewSettings {
  const ids = new Set(columns.map(column => column.id));
  const sorted = new Set<string>();
  const sorts = (Array.isArray(view.sorts) ? view.sorts : []).flatMap(item => {
    if (!item || !ids.has(item.id) || typeof item.descending !== 'boolean' || sorted.has(item.id)) return [];
    sorted.add(item.id);
    return [{ id: item.id, descending: item.descending }];
  });
  const conditions = (Array.isArray(view.conditions) ? view.conditions : []).flatMap(item => {
    if (!item || !ids.has(item.columnId) || !CONDITION_OPS.includes(item.op) || (item.value !== undefined && typeof item.value !== 'string')) return [];
    return [{ columnId: item.columnId, op: item.op, ...(item.value === undefined ? {} : { value: item.value }) }];
  });
  return { rules: effectiveTableGrouping(view.rules, columns), sorts, conditions };
}

/** Project and workbook copies retain view rules against the new column identities. */
export function remapTableView(view: Partial<TableViewSettings>, column: (id: string) => string | undefined): Partial<TableViewSettings> {
  const remap = <T>(items: T[], key: 'id' | 'columnId') => items.flatMap(item => {
    const source = (item as Record<string, unknown> | null)?.[key];
    const target = typeof source === 'string' ? column(source) : undefined;
    return target ? [{ ...item, [key]: target }] : [];
  });
  return {
    ...(Array.isArray(view.rules) ? { rules: remap(view.rules, 'columnId') } : {}),
    ...(Array.isArray(view.sorts) ? { sorts: remap(view.sorts, 'id') } : {}),
    ...(Array.isArray(view.conditions) ? { conditions: remap(view.conditions, 'columnId') } : {}),
  };
}

/** A saved view can outlive a deleted or hidden schema column. */
export function effectiveTableGrouping(rules: unknown, columns: readonly DataColumn[]): TableGroupRule[] {
  const result: TableGroupRule[] = [];
  if (!Array.isArray(rules)) return result;
  const remainingColumns = new Set(columns.map(column => column.id));
  for (const rule of rules) {
    if (!remainingColumns.size) break;
    if (!rule || typeof rule.columnId !== 'string' || (rule.direction !== 'asc' && rule.direction !== 'desc')) continue;
    if (remainingColumns.delete(rule.columnId)) {
      result.push({ columnId: rule.columnId, direction: rule.direction });
    }
  }
  return result;
}

type GroupValue = { identity: string; label: string; number?: number };
type GroupHeader = { kind: 'group'; key: string; label: string; depth: number; count: number; expanded: boolean; hidden: boolean };
type RowItem<T> = { kind: 'row'; row: T; hidden: boolean };
type GroupPath = { key: string; parent?: GroupPath };

/**
 * Groups the already filtered and sorted rows. Grouping changes their display
 * order but keeps the incoming sort inside each leaf. Collapsing is a separate
 * presentation decision; hidden rows stay addressable for search.
 */
export function projectTableGroups<T extends { id: string }>(
  rows: readonly T[],
  rules: readonly TableGroupRule[],
  read: (row: T, columnId: string) => GroupValue,
  collapsed: ReadonlySet<string>,
  locale: string,
) {
  const orderedRows: T[] = [], expandedRows: T[] = [];
  const items: (GroupHeader | RowItem<T>)[] = [];
  const pathsByRow = new Map<string, readonly string[]>();
  const compare = rules.length ? new Intl.Collator(locale, { numeric: true }) : undefined;
  const stack: { branch: readonly T[]; depth: number; path?: GroupPath; visible: boolean; header?: GroupHeader }[] = [
    { branch: rows, depth: 0, visible: true },
  ];
  while (stack.length) {
    const { branch, depth, path, visible, header } = stack.pop()!;
    if (header) items.push(header);
    const rule = rules[depth];
    if (!rule) {
      const ancestors: string[] = [];
      for (let ancestor = path; ancestor; ancestor = ancestor.parent) ancestors.push(ancestor.key);
      ancestors.reverse();
      for (const row of branch) {
        orderedRows.push(row);
        pathsByRow.set(row.id, ancestors);
        items.push({ kind: 'row', row, hidden: !visible });
        if (visible) expandedRows.push(row);
      }
      continue;
    }
    const groups = new Map<string, { value: GroupValue; rows: T[] }>();
    for (const row of branch) {
      const value = read(row, rule.columnId);
      const group = groups.get(value.identity);
      if (group) group.rows.push(row);
      else groups.set(value.identity, { value, rows: [row] });
    }
    const sign = rule.direction === 'desc' ? -1 : 1;
    const orderedGroups = [...groups.values()].sort((a, b) => {
      const left = a.value, right = b.value;
      const type = (value: GroupValue) => !value.identity ? 0 : value.number !== undefined ? 1 : 2;
      const order = type(left) - type(right) ||
        (left.number !== undefined && right.number !== undefined ? left.number - right.number : compare!.compare(left.label, right.label));
      return sign * (order || (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0));
    });
    // Push siblings in reverse order so their rows follow their headers.
    for (let index = orderedGroups.length - 1; index >= 0; index--) {
      const group = orderedGroups[index];
      // Each encoded pair is self-delimiting, including names containing brackets or quotes.
      const key = (path?.key ?? '') + JSON.stringify([rule.columnId, group.value.identity]);
      const expanded = !collapsed.has(key);
      stack.push({
        branch: group.rows, depth: depth + 1, path: { key, parent: path }, visible: visible && expanded,
        header: { kind: 'group', key, label: group.value.label, depth, count: group.rows.length, expanded, hidden: !visible },
      });
    }
  }
  return { orderedRows, expandedRows, items, pathsByRow };
}
