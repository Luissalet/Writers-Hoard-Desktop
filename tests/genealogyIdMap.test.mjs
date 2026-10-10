// ============================================================================
// Genealogy id-map tests — Node standard test runner (node --test).
//
// Run: node --experimental-strip-types --test tests/genealogyIdMap.test.mjs
//
// The mapper under test is a pure TypeScript module with no external imports,
// so Node's type stripping can load it directly.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapGenealogyIds } from '../src/engines/genealogy/idMap.ts';

// --- Shared fixtures ---------------------------------------------------------

const ID_TABLE = {
  A: 'hoard://writer/codex/c1',
  B: 'hoard://writer/codex/c2',
};

const LINKS = [
  { id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' },
  { id: 'f2', from: 'B', to: 'A', kind: 'partner', label: 'pareja' },
];

// --- toWorld: local ids become hoard refs ------------------------------------

test('toWorld rewrites local ids to world refs via the id table', () => {
  const { toWorld, issues } = mapGenealogyIds(LINKS, ID_TABLE, 'toWorld');
  assert.deepEqual(issues, []);
  assert.equal(toWorld.length, 2);
  assert.equal(toWorld[0].from, 'hoard://writer/codex/c1');
  assert.equal(toWorld[0].to, 'hoard://writer/codex/c2');
  assert.equal(toWorld[0].kind, 'biological_parent');
  assert.equal(toWorld[1].label, 'pareja');
});

// --- toLocal: hoard refs become local ids (inverted table) -------------------

test('toLocal inverts the id table and rewrites refs back to local ids', () => {
  const worldForm = [
    { id: 'f1', from: 'hoard://writer/codex/c1', to: 'hoard://writer/codex/c2', kind: 'biological_parent' },
  ];
  const { toLocal, issues } = mapGenealogyIds(worldForm, ID_TABLE, 'toLocal');
  assert.deepEqual(issues, []);
  assert.equal(toLocal.length, 1);
  assert.equal(toLocal[0].from, 'A');
  assert.equal(toLocal[0].to, 'B');
});

// --- missing_ref: unknown endpoint is rejected with the link id --------------

test('endpoint outside the id table is rejected as missing_ref, never guessed', () => {
  const links = [{ id: 'f9', from: 'A', to: 'ZZZ', kind: 'partner' }];
  const { toWorld, issues } = mapGenealogyIds(links, ID_TABLE, 'toWorld');
  assert.deepEqual(toWorld, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'missing_ref');
  assert.equal(issues[0].linkId, 'f9');
  assert.match(issues[0].detail, /ZZZ/);
});

// --- duplicate_id: matches the validator's rule ------------------------------

test('duplicate link ids are rejected as duplicate_id', () => {
  const links = [
    { id: 'f1', from: 'A', to: 'B', kind: 'partner' },
    { id: 'f1', from: 'B', to: 'A', kind: 'partner' },
  ];
  const { issues } = mapGenealogyIds(links, ID_TABLE, 'toWorld');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'duplicate_id');
  assert.equal(issues[0].linkId, 'f1');
});

// --- invalid_shape: malformed payloads are rejected, not coerced -------------

test('non-object links and malformed entries are rejected as invalid_shape', () => {
  const { issues } = mapGenealogyIds([null, { id: '', from: 'A', to: 'B', kind: 'partner' }], ID_TABLE, 'toWorld');
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.code === 'invalid_shape'));
});

test('idTable with an empty entry is rejected as invalid_shape', () => {
  const { issues } = mapGenealogyIds(LINKS, { A: '' }, 'toWorld');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'invalid_shape');
});

test('idTable with two local ids for the same ref is rejected (toLocal)', () => {
  const table = { A: 'hoard://writer/codex/c1', B: 'hoard://writer/codex/c1' };
  const { issues } = mapGenealogyIds(LINKS, table, 'toLocal');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'invalid_shape');
  assert.match(issues[0].detail, /same world ref/);
});

// --- purity: inputs are never mutated ----------------------------------------

test('mapGenealogyIds does not mutate its inputs', () => {
  const links = JSON.parse(JSON.stringify(LINKS));
  const table = JSON.parse(JSON.stringify(ID_TABLE));
  mapGenealogyIds(links, table, 'toWorld');
  assert.deepEqual(links, LINKS);
  assert.deepEqual(table, ID_TABLE);
});

// --- roundtrip: toWorld then toLocal recovers the original ids ---------------

test('roundtrip toWorld -> toLocal recovers the original local ids', () => {
  const { toWorld } = mapGenealogyIds(LINKS, ID_TABLE, 'toWorld');
  const { toLocal, issues } = mapGenealogyIds(toWorld, ID_TABLE, 'toLocal');
  assert.deepEqual(issues, []);
  assert.deepEqual(toLocal, LINKS);
});
