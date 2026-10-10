// Public end-to-end flow for the genealogy contract (task #136):
// import -> apply -> query -> undo -> readback, against an in-memory table
// shaped like the Dexie genealogyLinks table (composite key projectId+id).
// Run: node --experimental-strip-types scripts/genealogy-flow.mjs
import assert from 'node:assert/strict';
import { createGenealogyBridgeHandlers } from '../src/services/aiBridge/tools/genealogy.ts';

function fakeTable() {
  const rows = new Map();
  return {
    _rows: rows,
    where: () => ({
      equals: () => ({
        toArray: async () => [...rows.values()],
      }),
    }),
    bulkPut: async (list) => {
      for (const r of list) rows.set(r.key, r);
    },
    get: async (key) => rows.get(key),
    delete: async (key) => {
      rows.delete(key);
    },
  };
}

const CHARACTERS = [
  { id: 'c1', title: 'Alice', type: 'character' },
  { id: 'c2', title: 'Bob', type: 'character' },
];
const loadCharacters = async () => CHARACTERS;

const table = fakeTable();
const handlers = createGenealogyBridgeHandlers(table, loadCharacters);

// 1. Import: Obsidian markdown -> proposal with derived ids and preview.
const imp = await handlers.wh_genealogy_import({
  projectId: 'p1',
  format: 'obsidian',
  text: '- [[Alice|c1]] -> [[Bob|c2]] : biological_parent',
});
assert.equal(imp.ok, true, `import failed: ${JSON.stringify(imp)}`);
assert.equal(imp.proposal.length, 1);
assert.equal(imp.proposal[0].id, 'g1');
assert.equal(imp.issues.length, 0);

// 2. Apply: the accepted proposal lands in the table (readback below).
const ap = await handlers.wh_genealogy_apply({ projectId: 'p1', links: imp.proposal });
assert.equal(ap.ok, true, `apply failed: ${JSON.stringify(ap)}`);
assert.deepEqual(ap.applied, ['g1']);
assert.equal(table._rows.size, 1);

// 3. Query: the parent relationship is visible by direction (c1 is parent of c2).
const q = await handlers.wh_genealogy_query({ projectId: 'p1', characterId: 'c2' });
assert.equal(q.ok, true, `query failed: ${JSON.stringify(q)}`);
assert.deepEqual(q.parents.map((p) => p.id), ['g1']);

// 4. Undo: only with the recorded revision; the table is empty again.
const un = await handlers.wh_genealogy_undo({
  projectId: 'p1',
  applyId: ap.applyId,
  revision: ap.revisionAfter,
});
assert.equal(un.ok, true, `undo failed: ${JSON.stringify(un)}`);
assert.equal(table._rows.size, 0);

// 5. Readback: a second undo of the same apply is rejected (unknown/used).
const un2 = await handlers.wh_genealogy_undo({ projectId: 'p1', applyId: ap.applyId });
assert.equal(un2.ok, false);

console.log('genealogy-flow: import/apply/query/undo/readback OK');
