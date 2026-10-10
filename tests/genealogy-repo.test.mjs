import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGenealogyLinks,
  saveGenealogyLinks,
  deleteGenealogyLink,
} from '../src/engines/genealogy/genealogyRepo.ts';

// Minimal in-memory fake of the Dexie Table surface the repo uses:
// where(index).equals(value).toArray(), bulkPut, get, delete, clear.
function fakeTable() {
  const rows = new Map();
  const table = {
    async bulkPut(incoming) {
      for (const row of incoming) rows.set(row.key ?? row.id, { ...row });
      return incoming.length;
    },
    async get(id) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    async delete(id) {
      rows.delete(id);
    },
    async clear() {
      rows.clear();
    },
    where(index) {
      if (index !== 'projectId') throw new Error(`unexpected index ${index}`);
      return {
        equals(value) {
          return {
            async toArray() {
              return [...rows.values()]
                .filter((row) => row.projectId === value)
                .map((row) => ({ ...row }));
            },
          };
        },
      };
    },
  };
  table._rows = rows;
  return table;
}

const link = (over = {}) => ({
  id: 'g1',
  from: 'a',
  to: 'b',
  kind: 'biological_parent',
  ...over,
});

test('save validates and persists rows keyed by project', async () => {
  const table = fakeTable();
  const receipt = await saveGenealogyLinks(table, 'p1', [link()]);
  assert.equal(receipt.saved, 1);
  assert.deepEqual(receipt.issues, []);
  const loaded = await loadGenealogyLinks(table, 'p1');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].from, 'a');
  assert.equal(loaded[0].projectId, 'p1');
});

test('save rejects an invalid link without writing anything', async () => {
  const table = fakeTable();
  const receipt = await saveGenealogyLinks(table, 'p1', [
    link(),
    { id: 'g2', from: 'b', to: 'c', kind: 'not_a_kind' },
  ]);
  assert.equal(receipt.saved, 0);
  assert.equal(receipt.issues.length, 1);
  assert.equal(receipt.issues[0].code, 'unknown_kind');
  assert.equal(table._rows.size, 0);
});

test('save rejects duplicate ids inside one batch', async () => {
  const table = fakeTable();
  const receipt = await saveGenealogyLinks(table, 'p1', [link(), link()]);
  assert.equal(receipt.saved, 0);
  assert.equal(receipt.issues[0].code, 'duplicate_id');
});

test('load returns only the requested project rows', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [link()]);
  await saveGenealogyLinks(table, 'p2', [link({ id: 'g9' })]);
  const p1 = await loadGenealogyLinks(table, 'p1');
  assert.equal(p1.length, 1);
  assert.equal(p1[0].id, 'g1');
});

test('load strips storage fields back to the link shape', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [link({ label: 'casados' })]);
  const [row] = await loadGenealogyLinks(table, 'p1');
  assert.equal(row.label, 'casados');
  assert.ok(!('updatedAt' in row));
});

test('delete removes one row and leaves the rest', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [link(), link({ id: 'g2', from: 'b', to: 'c' })]);
  const done = await deleteGenealogyLink(table, 'p1', 'g1');
  assert.equal(done, true);
  const rest = await loadGenealogyLinks(table, 'p1');
  assert.deepEqual(rest.map((r) => r.id), ['g2']);
});

test('delete refuses to touch a row of another project', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [link()]);
  const done = await deleteGenealogyLink(table, 'p2', 'g1');
  assert.equal(done, false);
  assert.equal(table._rows.size, 1);
});

test('delete on a missing id reports false', async () => {
  const table = fakeTable();
  assert.equal(await deleteGenealogyLink(table, 'p1', 'nope'), false);
});

test('save over an existing id replaces that row only', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [link()]);
  await saveGenealogyLinks(table, 'p1', [link({ kind: 'adoptive_parent' })]);
  const rows = await loadGenealogyLinks(table, 'p1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'adoptive_parent');
});

test('empty batch saves nothing and reports zero', async () => {
  const table = fakeTable();
  const receipt = await saveGenealogyLinks(table, 'p1', []);
  assert.equal(receipt.saved, 0);
  assert.deepEqual(receipt.issues, []);
});

// --- r3 fix P1: aislamiento entre proyectos (clave compuesta) ---
test('save en p2 no traslada ni pisa la fila homonima de p1', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [{ id: 'g1', from: 'a', to: 'b', kind: 'partner' }]);
  await saveGenealogyLinks(table, 'p2', [{ id: 'g1', from: 'c', to: 'd', kind: 'partner' }]);
  const p1 = await loadGenealogyLinks(table, 'p1');
  const p2 = await loadGenealogyLinks(table, 'p2');
  assert.equal(p1.length, 1);
  assert.equal(p1[0].to, 'b');
  assert.equal(p2.length, 1);
  assert.equal(p2[0].to, 'd');
});

test('delete en p2 no borra la fila homonima de p1', async () => {
  const table = fakeTable();
  await saveGenealogyLinks(table, 'p1', [{ id: 'g1', from: 'a', to: 'b', kind: 'partner' }]);
  await saveGenealogyLinks(table, 'p2', [{ id: 'g1', from: 'c', to: 'd', kind: 'partner' }]);
  await deleteGenealogyLink(table, 'p2', 'g1');
  const p1 = await loadGenealogyLinks(table, 'p1');
  assert.equal(p1.length, 1);
});
