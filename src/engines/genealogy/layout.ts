// ============================================================================
// Genealogy tree layout (W3) — pure positions for the tree view, no DOM, no
// I/O, no mutation.
//
// layoutGenealogyTree(tree) assigns every character a (row, col):
//
//   - row = depth in the ancestry nesting (roots at row 0, children one row
//     below their parent);
//   - leaves are laid out left to right in first-seen order, so columns are
//     dense (no gaps) per row;
//   - a parent is centered over its subtree: col = mean of its subtree's
//     leaf columns (fractional columns are fine; the view maps col * gap to
//     pixels);
//   - a character nested under several parents (multi-parent is allowed) is
//     placed once, at its deepest occurrence;
//   - cycle members are roots (the builder already broke the cycle), so the
//     walk terminates.
// ============================================================================

import type { GenealogyTree, GenealogyTreeNode } from './tree.ts';

/** Grid position of one character in the tree view. */
export interface TreePosition {
  /** Depth: 0 for roots, +1 per level of ancestry nesting. */
  row: number;
  /** Horizontal slot: integer for leaves, fractional for centered parents. */
  col: number;
}

export interface GenealogyTreeLayout {
  /** One position per character id. */
  positions: Map<string, TreePosition>;
  /** Number of rows (deepest row + 1). */
  rowCount: number;
  /** Number of leaf columns the widest row spans. */
  colCount: number;
}

/** Deepest row at which each character is nested (leaves of the walk). */
function assignRows(
  node: GenealogyTreeNode,
  row: number,
  depth: Map<string, number>,
): void {
  const known = depth.get(node.character.id);
  if (known === undefined || row > known) depth.set(node.character.id, row);
  for (const child of node.children) assignRows(child, row + 1, depth);
}

/** Left-to-right leaf order; each leaf takes the next free column. */
function assignLeafColumns(
  node: GenealogyTreeNode,
  depth: Map<string, number>,
  row: number,
  nextCol: { value: number },
  leafCol: Map<string, number>,
): void {
  if (node.children.length === 0) {
    const known = leafCol.get(node.character.id);
    // A leaf already placed higher up (multi-parent) keeps its first slot.
    if (known === undefined) {
      leafCol.set(node.character.id, nextCol.value);
      nextCol.value += 1;
    }
    return;
  }
  for (const child of node.children) {
    assignLeafColumns(child, depth, row + 1, nextCol, leafCol);
  }
}

/** Mean of the subtree's leaf columns, computed bottom-up. */
function centerSubtree(
  node: GenealogyTreeNode,
  depth: Map<string, number>,
  leafCol: Map<string, number>,
  col: Map<string, number>,
): { min: number; max: number } {
  if (node.children.length === 0) {
    const c = leafCol.get(node.character.id) ?? 0;
    col.set(node.character.id, c);
    return { min: c, max: c };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const child of node.children) {
    const span = centerSubtree(child, depth, leafCol, col);
    if (span.min < min) min = span.min;
    if (span.max > max) max = span.max;
  }
  col.set(node.character.id, (min + max) / 2);
  return { min, max };
}

export function layoutGenealogyTree(tree: GenealogyTree): GenealogyTreeLayout {
  const depth = new Map<string, number>();
  for (const root of tree.roots) assignRows(root, 0, depth);

  const leafCol = new Map<string, number>();
  const nextCol = { value: 0 };
  for (const root of tree.roots) {
    assignLeafColumns(root, depth, 0, nextCol, leafCol);
  }

  const col = new Map<string, number>();
  for (const root of tree.roots) centerSubtree(root, depth, leafCol, col);

  const positions = new Map<string, TreePosition>();
  let rowCount = 0;
  let colCount = 0;
  for (const [id, c] of col) {
    positions.set(id, { row: depth.get(id) ?? 0, col: c });
    const row = depth.get(id) ?? 0;
    if (row + 1 > rowCount) rowCount = row + 1;
    if (c + 1 > colCount) colCount = c + 1;
  }
  return { positions, rowCount, colCount };
}
