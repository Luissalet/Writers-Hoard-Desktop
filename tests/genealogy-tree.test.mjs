// Tests for the pure tree builder (W3): builds the renderable tree structure
// from validated genealogy links. Pure functions, no I/O, no mutation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGenealogyTree, treeStats } from '../src/engines/genealogy/tree.ts';

const C = (id, name) => ({ id, name });

// --- basic structure -------------------------------------------------------

test('buildGenealogyTree: empty input yields empty tree', () => {
  const t = buildGenealogyTree([], []);
  assert.deepEqual(t.roots, []);
  assert.deepEqual(t.orphans, []);
  assert.deepEqual(t.partnerships, []);
});

test('single character with no links becomes a root', () => {
  const t = buildGenealogyTree([C('a', 'Ana')], []);
  assert.equal(t.roots.length, 1);
  assert.equal(t.roots[0].character.id, 'a');
  assert.deepEqual(t.roots[0].children, []);
  assert.deepEqual(t.orphans, []);
});

test('child with parents nests under each parent (multi-parent)', () => {
  const chars = [C('p1', 'Padre'), C('p2', 'Madre'), C('h', 'Hijo')];
  const links = [
    { id: 'l1', from: 'p1', to: 'h', kind: 'biological_parent' },
    { id: 'l2', from: 'p2', to: 'h', kind: 'biological_parent' },
  ];
  const t = buildGenealogyTree(chars, links);
  // Both parents are roots; the child appears under each of them.
  assert.equal(t.roots.length, 2);
  const padre = t.roots.find((r) => r.character.id === 'p1');
  const madre = t.roots.find((r) => r.character.id === 'p2');
  assert.deepEqual(padre.children.map((c) => c.character.id), ['h']);
  assert.deepEqual(madre.children.map((c) => c.character.id), ['h']);
  assert.deepEqual(t.orphans, []);
});

test('adoptive parent also nests the child (ancestry kinds)', () => {
  const chars = [C('a', 'Padrino'), C('h', 'Hijo')];
  const links = [{ id: 'l1', from: 'a', to: 'h', kind: 'adoptive_parent' }];
  const t = buildGenealogyTree(chars, links);
  assert.equal(t.roots.length, 1);
  assert.deepEqual(t.roots[0].children.map((c) => c.character.id), ['h']);
});

test('guardian and partner never create ancestry nesting', () => {
  const chars = [C('g', 'Tutor'), C('x', 'Otro')];
  const links = [
    { id: 'l1', from: 'g', to: 'x', kind: 'guardian' },
    { id: 'l2', from: 'g', to: 'x', kind: 'partner' },
  ];
  const t = buildGenealogyTree(chars, links);
  // No ancestry: both are roots, no children anywhere.
  assert.equal(t.roots.length, 2);
  for (const r of t.roots) assert.deepEqual(r.children, []);
  // But the partnership is reported.
  assert.equal(t.partnerships.length, 1);
  assert.deepEqual(t.partnerships[0].members, ['g', 'x']);
});

// --- orphans / missing refs ------------------------------------------------

test('link to unknown character does not nest and is reported as orphan edge', () => {
  const chars = [C('h', 'Hijo')];
  const links = [{ id: 'l1', from: 'ghost', to: 'h', kind: 'biological_parent' }];
  const t = buildGenealogyTree(chars, links);
  // The child has no known parent: it is a root, and the edge is reported.
  assert.equal(t.roots.length, 1);
  assert.deepEqual(t.roots[0].children, []);
  assert.equal(t.orphans.length, 1);
  assert.equal(t.orphans[0].linkId, 'l1');
  assert.equal(t.orphans[0].missing, 'ghost');
});

// --- cycles ----------------------------------------------------------------

test('cycle in ancestry does not hang and is reported', () => {
  // A parent of B, B parent of A: the ancestry graph has a cycle. The builder
  // must terminate and report the cycle instead of recursing forever.
  const chars = [C('a', 'A'), C('b', 'B')];
  const links = [
    { id: 'l1', from: 'a', to: 'b', kind: 'biological_parent' },
    { id: 'l2', from: 'b', to: 'a', kind: 'biological_parent' },
  ];
  const t = buildGenealogyTree(chars, links);
  assert.equal(t.cycles.length, 1);
  // No infinite nesting: every node appears as a root (cycle broken at roots).
  assert.equal(t.roots.length, 2);
  for (const r of t.roots) assert.deepEqual(r.children, []);
});

// --- partnerships ----------------------------------------------------------

test('partnership is reported once per unordered pair, with labels merged', () => {
  const chars = [C('a', 'A'), C('b', 'B')];
  const links = [
    { id: 'l1', from: 'a', to: 'b', kind: 'partner', label: 'casados' },
    { id: 'l2', from: 'b', to: 'a', kind: 'partner', label: 'casados' },
  ];
  const t = buildGenealogyTree(chars, links);
  assert.equal(t.partnerships.length, 1);
  assert.deepEqual(t.partnerships[0].members, ['a', 'b']);
  assert.deepEqual(t.partnerships[0].labels, ['casados']);
});

// --- stats -----------------------------------------------------------------

test('treeStats: counts nodes, depth, orphans and partnerships', () => {
  const chars = [C('p', 'P'), C('h', 'H'), C('s', 'S')];
  const links = [
    { id: 'l1', from: 'p', to: 'h', kind: 'biological_parent' },
    { id: 'l2', from: 'p', to: 's', kind: 'biological_parent' },
  ];
  const t = buildGenealogyTree(chars, links);
  const s = treeStats(t);
  assert.equal(s.characters, 3);
  assert.equal(s.roots, 1);
  assert.equal(s.depth, 2);
  assert.equal(s.orphans, 0);
  assert.equal(s.partnerships, 0);
});

// --- purity ----------------------------------------------------------------

test('buildGenealogyTree does not mutate its inputs', () => {
  const chars = [C('p', 'P'), C('h', 'H')];
  const links = [{ id: 'l1', from: 'p', to: 'h', kind: 'biological_parent' }];
  const charsCopy = JSON.parse(JSON.stringify(chars));
  const linksCopy = JSON.parse(JSON.stringify(links));
  buildGenealogyTree(chars, links);
  assert.deepEqual(chars, charsCopy);
  assert.deepEqual(links, linksCopy);
});
