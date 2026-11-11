export type TableGroupRule = { columnId: string; direction: 'asc' | 'desc' };

type GroupValue = { identity: string; label: string; number?: number };
type GroupHeader = { kind: 'group'; key: string; label: string; depth: number; count: number; expanded: boolean; hidden: boolean };
type RowItem<T> = { kind: 'row'; row: T; hidden: boolean };

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
  const visit = (branch: readonly T[], depth: number, prefix: readonly [string, string][], ancestors: readonly string[], visible: boolean) => {
    const rule = rules[depth];
    if (!rule) {
      for (const row of branch) {
        orderedRows.push(row);
        pathsByRow.set(row.id, ancestors);
        items.push({ kind: 'row', row, hidden: !visible });
        if (visible) expandedRows.push(row);
      }
      return;
    }
    const groups = new Map<string, { value: GroupValue; rows: T[] }>();
    for (const row of branch) {
      const value = read(row, rule.columnId);
      const group = groups.get(value.identity);
      if (group) group.rows.push(row);
      else groups.set(value.identity, { value, rows: [row] });
    }
    const sign = rule.direction === 'desc' ? -1 : 1;
    for (const group of [...groups.values()].sort((a, b) => {
      const left = a.value, right = b.value;
      const type = (value: GroupValue) => !value.identity ? 0 : value.number !== undefined ? 1 : 2;
      const order = type(left) - type(right) ||
        (left.number !== undefined && right.number !== undefined ? left.number - right.number : compare!.compare(left.label, right.label));
      return sign * (order || (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0));
    })) {
      const path: readonly [string, string][] = [...prefix, [rule.columnId, group.value.identity]];
      const key = JSON.stringify(path), expanded = !collapsed.has(key);
      items.push({ kind: 'group', key, label: group.value.label, depth, count: group.rows.length, expanded, hidden: !visible });
      visit(group.rows, depth + 1, path, [...ancestors, key], visible && expanded);
    }
  };
  visit(rows, 0, [], [], true);
  return { orderedRows, expandedRows, items, pathsByRow };
}
