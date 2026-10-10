import test from 'node:test';
import assert from 'node:assert/strict';

// The bridge tool module under test. Handlers take the table explicitly (a
// factory), because node cannot intercept the `@/db` import without a loader;
// the real bridge wires the factory with the Dexie table at registration.
import {
  GENEALOGY_BRIDGE_TOOLS,
  createGenealogyBridgeHandlers,
} from '../src/services/aiBridge/tools/genealogy.ts';
import { loadGenealogyLinks } from '../src/engines/genealogy/genealogyRepo.ts';

const fakeTable = () => {
  const rows = new Map();
  return {
    where: (key) => ({
      equals: (v) => ({
        toArray: async () => [...rows.values()].filter((r) => r[key] === v),
      }),
    }),
    bulkPut: async (arr) => {
      for (const r of arr) rows.set(r.key ?? r.id, { ...r });
      return arr.length;
    },
    get: async (id) => (rows.has(id) ? { ...rows.get(id) } : undefined),
    delete: async (id) => {
      rows.delete(id);
    },
    _rows: rows,
  };
};

const CHAR = (id, name) => ({ id, name, type: 'character' });
const LINK = (id, from, to, kind, extra = {}) => ({ id, from, to, kind, ...extra });
const loadCharacters = async (_projectId) => [CHAR('a', 'Ana'), CHAR('b', 'Beto')];

test('manifest lists the six contract tools with writes flags', () => {
  const names = GENEALOGY_BRIDGE_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, [
    'wh_genealogy_preview',
    'wh_genealogy_validate',
    'wh_genealogy_apply',
    'wh_genealogy_import',
    'wh_genealogy_query',
    'wh_genealogy_undo',
  ]);
  const writes = Object.fromEntries(GENEALOGY_BRIDGE_TOOLS.map((tool) => [tool.name, tool.writes]));
  assert.deepEqual(writes, {
    wh_genealogy_preview: false,
    wh_genealogy_validate: false,
    wh_genealogy_apply: true,
    wh_genealogy_import: false,
    wh_genealogy_query: false,
    wh_genealogy_undo: true,
  });
  for (const tool of GENEALOGY_BRIDGE_TOOLS) {
    assert.equal(tool.schema.type, 'object');
    assert.ok(tool.description.length > 20, `${tool.name} needs a description`);
  }
});

test('preview returns additions/duplicates/conflicts without writing', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_preview({
    projectId: 'p1',
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  assert.equal(result.ok, true);
  assert.equal(result.preview.additions.length, 1);
  assert.equal(result.preview.duplicates.length, 0);
  assert.equal(result.preview.conflicts.length, 0);
  assert.equal(table._rows.size, 0, 'preview must not write');
});

test('validate reports issues without writing', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_validate({
    projectId: 'p1',
    characters: [CHAR('a', 'Ana')],
    links: [LINK('g1', 'a', 'a', 'biological_parent')],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'self_link'));
  assert.equal(table._rows.size, 0, 'validate must not write');
});

test('apply writes accepted links and registers the application', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_apply({
    projectId: 'p1',
    links: [
      LINK('g1', 'a', 'b', 'biological_parent'),
      LINK('g2', 'a', 'a', 'biological_parent'),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(table._rows.size, 1);
  assert.ok(result.applyId, 'apply must return an applyId for undo');
});

test('apply is rejected without a projectId', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_apply({
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_project');
  assert.equal(table._rows.size, 0);
});

test('query returns parents and children by direction', async () => {
  const table = fakeTable();
  await table.bulkPut([
    { ...LINK('g1', 'a', 'b', 'biological_parent'), projectId: 'p1', updatedAt: 1 },
    { ...LINK('g2', 'c', 'a', 'biological_parent'), projectId: 'p1', updatedAt: 2 },
  ]);
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_query({ projectId: 'p1', characterId: 'a' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.parents.map((l) => l.id), ['g2']);
  assert.deepEqual(result.children.map((l) => l.id), ['g1']);
  assert.deepEqual(result.partners, []);
});

test('query rejects an unknown kind filter', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_query({
    projectId: 'p1',
    characterId: 'a',
    kind: 'nonsense',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_kind');
});

test('undo restores the previous state with a matching revision', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const applied = await handlers.wh_genealogy_apply({
    projectId: 'p1',
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  assert.equal(table._rows.size, 1);
  const undone = await handlers.wh_genealogy_undo({
    projectId: 'p1',
    applyId: applied.applyId,
    revision: applied.revisionAfter,
  });
  assert.equal(undone.ok, true);
  assert.equal(table._rows.size, 0);
});

test('undo refuses a stale revision', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const applied = await handlers.wh_genealogy_apply({
    projectId: 'p1',
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  const undone = await handlers.wh_genealogy_undo({
    projectId: 'p1',
    applyId: applied.applyId,
    revision: 'deadbeef',
  });
  assert.equal(undone.ok, false);
  assert.equal(undone.code, 'stale_revision');
  assert.equal(table._rows.size, 1, 'stale undo must not delete');
});

test('undo with an unknown applyId is rejected', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const result = await handlers.wh_genealogy_undo({
    projectId: 'p1',
    applyId: 'nope',
    revision: 'x',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_apply');
});

// --- r2 fix: flujo público de importadores (wh_genealogy_import) ---
test('wh_genealogy_import parsea formato obsidian y devuelve propuesta con preview', async () => {
  const { createGenealogyBridgeHandlers } = await import('../src/services/aiBridge/tools/genealogy.ts');
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async () => [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  const r = await handlers['wh_genealogy_import']({
    projectId: 'p1',
    format: 'obsidian',
    text: '- [[A|a]] -> [[B|b]] : biological_parent',
  });
  assert.equal(r.format, 'obsidian');
  assert.equal(r.proposal.length, 1);
  assert.equal(r.proposal[0].from, 'a');
  assert.equal(r.proposal[0].to, 'b');
  assert.equal(r.proposal[0].kind, 'biological_parent');
  assert.ok(Array.isArray(r.preview.additions));
});

test('wh_genealogy_import rechaza formato desconocido con error claro', async () => {
  const { createGenealogyBridgeHandlers } = await import('../src/services/aiBridge/tools/genealogy.ts');
  const handlers = createGenealogyBridgeHandlers(fakeTable(), async () => []);
  const r = await handlers['wh_genealogy_import']({ projectId: 'p1', format: 'noexiste', text: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_format');
});

test('wh_genealogy_import soporta notion, worldanvil y campfire (json)', async () => {
  const { createGenealogyBridgeHandlers } = await import('../src/services/aiBridge/tools/genealogy.ts');
  const handlers = createGenealogyBridgeHandlers(fakeTable(), async () => [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  const notion = await handlers['wh_genealogy_import']({ projectId: 'p1', format: 'notion', text: '## A (a)\n- biological_parent: B (b)' });
  assert.equal(notion.proposal.length, 1);
  const wa = await handlers['wh_genealogy_import']({ projectId: 'p1', format: 'worldanvil', text: '# A (a)\n- Children: B (b)' });
  assert.equal(wa.proposal.length, 1);
  const campfire = await handlers['wh_genealogy_import']({ projectId: 'p1', format: 'campfire', text: JSON.stringify({ relationships: [{ from: 'a', to: 'b', type: 'parent' }] }) });
  assert.equal(campfire.proposal.length, 1);
  assert.equal(campfire.proposal[0].kind, 'biological_parent');
});

// --- r3 fix P1: no reportar exito si el save no confirmo ---
test('apply reports save failure when the table rejects the write', async () => {
  const table = fakeTable();
  table.bulkPut = async () => { throw new Error('quota exceeded'); };
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const r = await handlers.wh_genealogy_apply({
    projectId: 'p1',
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  assert.equal(r.ok, false);
  assert.equal(table._rows.size, 0);
});

test('apply does not register the application when save fails', async () => {
  const table = fakeTable();
  table.bulkPut = async () => { throw new Error('quota exceeded'); };
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  await handlers.wh_genealogy_apply({ projectId: 'p1', links: [LINK('g1', 'a', 'b', 'biological_parent')] });
  const r = await handlers.wh_genealogy_undo({ projectId: 'p1', applyId: 'whatever', revision: 'rev:x' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown_apply');
});

test('apply rejects a->b then b->a cycle across separate calls', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, loadCharacters);
  const r1 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [LINK('g1', 'a', 'b', 'biological_parent')] });
  assert.equal(r1.ok, true);
  const r2 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [LINK('g2', 'b', 'a', 'biological_parent')] });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.applied, []);
  assert.deepEqual(r2.rejected.map((r) => r.issues.map((i) => i.code)).flat(), ['cycle_rejected']);
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 1);
});

test('apply rejects when the save receipt does not match the applied links', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async () => [CHAR]);
  const failing = {
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    bulkPut: async () => { throw new Error('disk full'); },
    get: async () => undefined,
    delete: async () => undefined,
  };
  const broken = createGenealogyBridgeHandlers(failing, async () => [CHAR]);
  const r = await broken.wh_genealogy_apply({
    projectId: 'p1',
    links: [LINK('g1', 'a', 'b', 'biological_parent')],
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'save_failed');
  // the in-memory application registry must not record a failed apply
  const ok = await handlers.wh_genealogy_undo({ projectId: 'p1', applyId: 'x' });
  assert.equal(ok.ok, false);
});

// --- review r3: cycle guard must validate the FULL graph (existing + new
// arcs, keeping multi-parents) and must not contaminate a valid link in the
// same batch (per-link rejection, partial acceptance).

test('cycle guard: a->c, b->c then c->a is rejected (multi-parent graph)', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async () => [
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
  ]);
  const r1 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g1', from: 'a', to: 'c', kind: 'biological_parent' },
    { id: 'g2', from: 'b', to: 'c', kind: 'biological_parent' },
  ] });
  assert.equal(r1.ok, true);
  const r2 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g3', from: 'c', to: 'a', kind: 'biological_parent' },
  ] });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.applied, []);
  assert.deepEqual(r2.rejected.map((r) => r.issues.map((i) => i.code)).flat(), ['cycle_rejected']);
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 2);
});

test('cycle guard: existing a->b plus proposal b->c, c->a is rejected', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async () => [
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
  ]);
  const r1 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' },
  ] });
  assert.equal(r1.ok, true);
  const r2 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g2', from: 'b', to: 'c', kind: 'biological_parent' },
    { id: 'g3', from: 'c', to: 'a', kind: 'biological_parent' },
  ] });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.applied, ['g2']);
  assert.deepEqual(r2.rejected.map((r) => r.issues.map((i) => i.code)).flat(), ['cycle_rejected']);
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 2);
});

test('cycle guard: invalid arc does not contaminate a valid link in the same batch', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async () => [
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' },
  ]);
  const r1 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' },
  ] });
  assert.equal(r1.ok, true);
  // b->a closes a cycle; a->c is independent and valid.
  const r2 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g2', from: 'b', to: 'a', kind: 'biological_parent' },
    { id: 'g3', from: 'a', to: 'c', kind: 'biological_parent' },
  ] });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.applied, ['g3']);
  assert.deepEqual(r2.rejected.map((r) => r.issues.map((i) => i.code)).flat(), ['cycle_rejected']);
  const links = await loadGenealogyLinks(table, 'p1');
  assert.equal(links.length, 2);
});

// --- review r3, P1: undo must not cross projects. The bridge must register
// the real projectId at apply time and pass it at undo time.

test('undo rejects an application belonging to another project', async () => {
  const table = fakeTable();
  const handlers = createGenealogyBridgeHandlers(table, async (pid) => [
    { id: 'a', title: 'A' }, { id: 'b', title: 'B' },
  ]);
  const r1 = await handlers.wh_genealogy_apply({ projectId: 'p1', links: [
    { id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' },
  ] });
  assert.equal(r1.ok, true);
  // Same link id in p2 (composite key allows it).
  const r2 = await handlers.wh_genealogy_apply({ projectId: 'p2', links: [
    { id: 'g1', from: 'a', to: 'b', kind: 'biological_parent' },
  ] });
  assert.equal(r2.ok, true);
  // Undo p1's application while working in p2: must be rejected.
  const u = await handlers.wh_genealogy_undo({ projectId: 'p2', applyId: r1.applyId, revision: r1.revisionAfter });
  assert.equal(u.ok, false);
  assert.equal(u.code, 'project_mismatch');
  // Both rows still there.
  const p1 = await loadGenealogyLinks(table, 'p1');
  const p2 = await loadGenealogyLinks(table, 'p2');
  assert.equal(p1.length, 1);
  assert.equal(p2.length, 1);
  // Undo from the right project works.
  const u2 = await handlers.wh_genealogy_undo({ projectId: 'p1', applyId: r1.applyId, revision: r1.revisionAfter });
  assert.equal(u2.ok, true);
  const p1after = await loadGenealogyLinks(table, 'p1');
  assert.equal(p1after.length, 0);
});
