// Tests for the pure tree layout (W3): positions for the tree view.
// Run: node --experimental-strip-types --test tests/genealogy-layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutGenealogyTree } from '../src/engines/genealogy/layout.ts';
import { buildGenealogyTree } from '../src/engines/genealogy/tree.ts';

const chars = (pairs) => pairs.map(([id, name]) => ({ id, name }));

test('layout: single root gets row 0 and column 0', () => {
  const tree = buildGenealogyTree(chars([['a', 'Alice']]), []);
  const out = layoutGenealogyTree(tree);
  assert.equal(out.positions.get('a').row, 0);
  assert.equal(out.positions.get('a').col, 0);
  assert.equal(out.rowCount, 1);
});

test('layout: child sits one row below its parent', () => {
  const tree = buildGenealogyTree(
    chars([['a', 'Alice'], ['b', 'Bob']]),
    [{ id: 'l1', from: 'a', to: 'b', kind: 'biological_parent' }],
  );
  const out = layoutGenealogyTree(tree);
  assert.equal(out.positions.get('a').row, 0);
  assert.equal(out.positions.get('b').row, 1);
});

test('layout: siblings occupy consecutive columns', () => {
  const tree = buildGenealogyTree(
    chars([['p', 'Parent'], ['x', 'X'], ['y', 'Y']]),
    [
      { id: 'l1', from: 'p', to: 'x', kind: 'biological_parent' },
      { id: 'l2', from: 'p', to: 'y', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  assert.equal(out.positions.get('x').col, 0);
  assert.equal(out.positions.get('y').col, 1);
  // The parent is centered over its children.
  assert.equal(out.positions.get('p').col, 0.5);
});

test('layout: parent centered over a subtree of grandchildren', () => {
  const tree = buildGenealogyTree(
    chars([['g', 'Gran'], ['p', 'Parent'], ['x', 'X'], ['y', 'Y']]),
    [
      { id: 'l1', from: 'g', to: 'p', kind: 'biological_parent' },
      { id: 'l2', from: 'p', to: 'x', kind: 'biological_parent' },
      { id: 'l3', from: 'p', to: 'y', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  // Children of p are at cols 0 and 1, so p centers at 0.5 and g over p.
  assert.equal(out.positions.get('p').col, 0.5);
  assert.equal(out.positions.get('g').col, 0.5);
});

test('layout: two roots side by side, no overlap', () => {
  const tree = buildGenealogyTree(chars([['a', 'A'], ['b', 'B']]), []);
  const out = layoutGenealogyTree(tree);
  assert.equal(out.positions.get('a').col, 0);
  assert.equal(out.positions.get('b').col, 1);
});

test('layout: rowCount equals the deepest row plus one', () => {
  const tree = buildGenealogyTree(
    chars([['a', 'A'], ['b', 'B'], ['c', 'C']]),
    [
      { id: 'l1', from: 'a', to: 'b', kind: 'biological_parent' },
      { id: 'l2', from: 'b', to: 'c', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  assert.equal(out.rowCount, 3);
});

test('layout: multi-parent child appears once, at its deepest row', () => {
  const tree = buildGenealogyTree(
    chars([['m', 'Mom'], ['d', 'Dad'], ['k', 'Kid']]),
    [
      { id: 'l1', from: 'm', to: 'k', kind: 'biological_parent' },
      { id: 'l2', from: 'd', to: 'k', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  // Kid is nested under both parents but must get exactly one position.
  assert.equal(out.positions.size, 3);
  assert.equal(out.positions.get('k').row, 1);
});

test('layout: cycle members are laid out as roots without infinite recursion', () => {
  const tree = buildGenealogyTree(
    chars([['a', 'A'], ['b', 'B']]),
    [
      { id: 'l1', from: 'a', to: 'b', kind: 'biological_parent' },
      { id: 'l2', from: 'b', to: 'a', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  assert.equal(out.positions.size, 2);
  assert.ok(Number.isFinite(out.positions.get('a').col));
  assert.ok(Number.isFinite(out.positions.get('b').col));
});

test('layout: does not mutate the input tree', () => {
  const tree = buildGenealogyTree(chars([['a', 'A']]), []);
  const snapshot = JSON.stringify(tree);
  layoutGenealogyTree(tree);
  assert.equal(JSON.stringify(tree), snapshot);
});

test('layout: columns are dense (no gaps) per row', () => {
  const tree = buildGenealogyTree(
    chars([['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']]),
    [
      { id: 'l1', from: 'a', to: 'c', kind: 'biological_parent' },
      { id: 'l2', from: 'b', to: 'd', kind: 'biological_parent' },
    ],
  );
  const out = layoutGenealogyTree(tree);
  const row0 = [...out.positions.values()].filter((p) => p.row === 0)
    .map((p) => p.col).sort((x, y) => x - y);
  assert.deepEqual(row0, [0, 1]);
});
