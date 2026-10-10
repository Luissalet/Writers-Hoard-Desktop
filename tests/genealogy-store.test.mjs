// Tests for the persistence row layer (W3): the exact shape a genealogy link
// takes in the Dexie table, and the pure conversions/validation around it.
// Pure functions, no I/O, no mutation — the Dexie table itself is wired in the
// shared copy during integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  linkToRow,
  rowToLink,
  validateRows,
  GENEALOGY_LINK_ROW_KINDS,
} from '../src/engines/genealogy/genealogyStore.ts';

const LINK = (id, from, to, kind, label) =>
  label === undefined ? { id, from, to, kind } : { id, from, to, kind, label };

// --- linkToRow -------------------------------------------------------------

test('linkToRow: adds projectId and keeps every link field', () => {
  const row = linkToRow('p1', LINK('g1', 'a', 'b', 'biological_parent', 'madre'));
  assert.deepEqual(row, {
    id: 'g1',
    projectId: 'p1',
    from: 'a',
    to: 'b',
    kind: 'biological_parent',
    label: 'madre',
  });
});

test('linkToRow: omits label when the link has none', () => {
  const row = linkToRow('p1', LINK('g1', 'a', 'b', 'partner'));
  assert.equal('label' in row, false);
});

test('linkToRow: does not mutate the input link', () => {
  const link = LINK('g1', 'a', 'b', 'guardian');
  linkToRow('p1', link);
  assert.deepEqual(link, { id: 'g1', from: 'a', to: 'b', kind: 'guardian' });
});

// --- rowToLink -------------------------------------------------------------

test('rowToLink: strips projectId and restores the link shape', () => {
  const link = rowToLink({
    id: 'g1',
    projectId: 'p1',
    from: 'a',
    to: 'b',
    kind: 'adoptive_parent',
    label: 'tutor',
  });
  assert.deepEqual(link, { id: 'g1', from: 'a', to: 'b', kind: 'adoptive_parent', label: 'tutor' });
});

test('rowToLink: roundtrips with linkToRow', () => {
  const original = LINK('g7', 'x', 'y', 'partner', 'pareja');
  const back = rowToLink(linkToRow('p9', original));
  assert.deepEqual(back, original);
});

// --- validateRows ----------------------------------------------------------

test('validateRows: accepts well-formed rows', () => {
  const rows = [
    linkToRow('p1', LINK('g1', 'a', 'b', 'biological_parent')),
    linkToRow('p1', LINK('g2', 'b', 'c', 'partner', 'esposos')),
  ];
  assert.deepEqual(validateRows(rows), { ok: rows, issues: [] });
});

test('validateRows: reports a row whose kind is not a genealogy kind', () => {
  const rows = [{ id: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'friend' }];
  const result = validateRows(rows);
  assert.equal(result.ok.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'unknown_kind');
  assert.equal(result.issues[0].id, 'g1');
});

test('validateRows: reports rows missing id, from or to', () => {
  const rows = [
    { projectId: 'p1', from: 'a', to: 'b', kind: 'partner' },
    { id: 'g2', projectId: 'p1', to: 'b', kind: 'partner' },
    { id: 'g3', projectId: 'p1', from: 'a', kind: 'partner' },
  ];
  const result = validateRows(rows);
  assert.equal(result.issues.length, 3);
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['invalid_shape', 'invalid_shape', 'invalid_shape'],
  );
});

test('validateRows: reports duplicate ids across the batch', () => {
  const rows = [
    linkToRow('p1', LINK('g1', 'a', 'b', 'guardian')),
    linkToRow('p1', LINK('g1', 'c', 'd', 'guardian')),
  ];
  const result = validateRows(rows);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'duplicate_id');
  assert.equal(result.issues[0].id, 'g1');
});

test('validateRows: reports rows whose projectId is missing or empty', () => {
  const rows = [
    { id: 'g1', from: 'a', to: 'b', kind: 'partner' },
    linkToRow('', LINK('g2', 'a', 'b', 'partner')),
  ];
  const result = validateRows(rows);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ['invalid_shape', 'invalid_shape'],
  );
});

test('validateRows: keeps the valid rows and reports only the bad ones', () => {
  const good = linkToRow('p1', LINK('g1', 'a', 'b', 'biological_parent'));
  const bad = { id: 'g2', projectId: 'p1', from: 'c', to: 'd', kind: 'rival' };
  const result = validateRows([good, bad]);
  assert.deepEqual(result.ok, [good]);
  assert.equal(result.issues.length, 1);
});

// --- kinds exported for the table layer ------------------------------------

test('GENEALOGY_LINK_ROW_KINDS matches the contract kinds', () => {
  assert.deepEqual([...GENEALOGY_LINK_ROW_KINDS].sort(), [
    'adoptive_parent',
    'biological_parent',
    'guardian',
    'partner',
  ]);
});
