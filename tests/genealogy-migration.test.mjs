// Migration v36 -> v37 for the genealogyLinks table (review r3, P1): the
// primary key cannot change between Dexie versions, so the composite
// projectId+linkId now lives IN `id` and the original link id moves to the
// new `linkId` field. These tests exercise the pure migration helper and the
// repository against v36-shaped data (with rows, empty table, malformed row).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { migrateGenealogyLinkV36toV37, genealogyLinkKey, linkToRow, rowToLink } from '../src/engines/genealogy/genealogyStore.ts';
import { loadGenealogyLinks, saveGenealogyLinks } from '../src/engines/genealogy/genealogyRepo.ts';

function fakeTable() {
  const rows = new Map();
  return {
    rows,
    where(index) {
      return {
        equals: (value) => ({
          toArray: async () => [...rows.values()].filter((r) => r[index] === value),
        }),
      };
    },
    async bulkPut(incoming) {
      for (const r of incoming) rows.set(r.id, r);
      return incoming.length;
    },
    async get(id) {
      return rows.get(id);
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

test('migrate rewrites a v36 row into the composite-key v37 shape', () => {
  const v36 = { id: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'biological_parent' };
  const out = migrateGenealogyLinkV36toV37(v36);
  assert.equal(out.id, genealogyLinkKey('p1', 'g1'));
  assert.equal(out.linkId, 'g1');
  assert.equal(out.projectId, 'p1');
  // input not mutated
  assert.equal(v36.id, 'g1');
  assert.equal(v36.linkId, undefined);
});

test('migrate leaves an already-migrated row untouched (idempotent)', () => {
  const v37 = { id: genealogyLinkKey('p1', 'g1'), linkId: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'partner' };
  const out = migrateGenealogyLinkV36toV37(v37);
  assert.equal(out.id, v37.id);
  assert.equal(out.linkId, 'g1');
});

test('migrate passes through a malformed row without throwing', () => {
  const out = migrateGenealogyLinkV36toV37({ id: '', projectId: 'p1' });
  assert.equal(out.id, '');
  assert.equal(out.linkId, undefined);
  const out2 = migrateGenealogyLinkV36toV37({ id: 'g1', projectId: '' });
  assert.equal(out2.id, 'g1');
});

test('roundtrip: linkToRow/rowToLink keep the original link id', () => {
  const link = { id: 'g7', from: 'a', to: 'b', kind: 'guardian' };
  const row = linkToRow('proj', link);
  assert.equal(row.id, genealogyLinkKey('proj', 'g7'));
  assert.equal(row.linkId, 'g7');
  const back = rowToLink(row);
  assert.deepEqual(back, link);
});

test('repo loads a migrated v36 dataset with original ids restored', async () => {
  const table = fakeTable();
  // Simulate the upgrade output: composite id + linkId.
  table.rows.set(genealogyLinkKey('p1', 'g1'), {
    id: genealogyLinkKey('p1', 'g1'), linkId: 'g1', projectId: 'p1', from: 'a', to: 'b', kind: 'biological_parent', updatedAt: 'x',
  });
  table.rows.set(genealogyLinkKey('p1', 'g2'), {
    id: genealogyLinkKey('p1', 'g2'), linkId: 'g2', projectId: 'p1', from: 'b', to: 'c', kind: 'partner', updatedAt: 'x',
  });
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((l) => l.id).sort(),
    ['g1', 'g2'],
  );
  assert.equal(links[0].from, 'a');
});

test('repo load tolerates a v36 row that missed the upgrade (no linkId)', async () => {
  const table = fakeTable();
  table.rows.set('g9', { id: 'g9', projectId: 'p1', from: 'a', to: 'b', kind: 'partner', updatedAt: 'x' });
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 1);
  assert.equal(links[0].id, 'g9');
});

test('repo save uses the composite key and linkId field (v37 shape)', async () => {
  const table = fakeTable();
  const receipt = await saveGenealogyLinks(table, 'p1', [
    { id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' },
  ]);
  assert.equal(receipt.saved, 1);
  const row = table.rows.get(genealogyLinkKey('p1', 'g1'));
  assert.equal(row.linkId, 'g1');
  assert.equal(row.id, genealogyLinkKey('p1', 'g1'));
  assert.equal(row.projectId, 'p1');
});

test('empty v36 table upgrades without error and stays empty', async () => {
  const table = fakeTable();
  const links = await loadGenealogyLinks(table, 'p1');
  assert.deepEqual(links, []);
  const receipt = await saveGenealogyLinks(table, 'p1', []);
  assert.equal(receipt.saved, 0);
});
