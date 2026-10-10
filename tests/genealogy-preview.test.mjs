import test from 'node:test';
import assert from 'node:assert/strict';

let mod;
try {
  mod = await import('../src/engines/genealogy/importPreview.ts');
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    assert.fail(`modulo ausente (rojo TDD esperado): ${err.message}`);
  }
  throw err;
}
const { previewGenealogyImport } = mod;

const link = (id, from, to, kind, label) => {
  const l = { id, from, to, kind };
  if (label !== undefined) l.label = label;
  return l;
};

test('importacion vacia: todo vacio, sin issues', () => {
  const r = previewGenealogyImport({ incoming: [], existing: [] });
  assert.deepEqual(r, { additions: [], duplicates: [], conflicts: [], issues: [] });
});

test('enlace nuevo entra en additions', () => {
  const r = previewGenealogyImport({
    incoming: [link('g1', 'a', 'b', 'biological_parent')],
    existing: [],
  });
  assert.deepEqual(r.additions, [link('g1', 'a', 'b', 'biological_parent')]);
  assert.deepEqual(r.duplicates, []);
  assert.deepEqual(r.conflicts, []);
});

test('duplicado exacto: mismo from/to/kind ya existente va a duplicates aunque cambie el id', () => {
  const r = previewGenealogyImport({
    incoming: [link('g9', 'a', 'b', 'biological_parent')],
    existing: [link('g1', 'a', 'b', 'biological_parent')],
  });
  assert.deepEqual(r.additions, []);
  assert.deepEqual(r.duplicates, [{ incoming: 'g9', existing: 'g1' }]);
});

test('duplicado por id: mismo id ya existente va a duplicates', () => {
  const r = previewGenealogyImport({
    incoming: [link('g1', 'c', 'd', 'partner')],
    existing: [link('g1', 'a', 'b', 'biological_parent')],
  });
  assert.deepEqual(r.additions, []);
  assert.deepEqual(r.duplicates, [{ incoming: 'g1', existing: 'g1' }]);
});

test('conflicto: mismo from/to con kind distinto va a conflicts', () => {
  const r = previewGenealogyImport({
    incoming: [link('g2', 'a', 'b', 'adoptive_parent')],
    existing: [link('g1', 'a', 'b', 'biological_parent')],
  });
  assert.deepEqual(r.additions, []);
  assert.deepEqual(r.duplicates, []);
  assert.deepEqual(r.conflicts, [
    { incoming: 'g2', existing: 'g1', incomingKind: 'adoptive_parent', existingKind: 'biological_parent' },
  ]);
});

test('mismo from/to/kind con etiqueta distinta es duplicado, no conflicto (la etiqueta no cambia la semantica)', () => {
  const r = previewGenealogyImport({
    incoming: [link('g9', 'a', 'b', 'biological_parent', 'padre')],
    existing: [link('g1', 'a', 'b', 'biological_parent', 'progenitor')],
  });
  assert.deepEqual(r.additions, []);
  assert.deepEqual(r.duplicates, [{ incoming: 'g9', existing: 'g1' }]);
  assert.deepEqual(r.conflicts, []);
});

test('mezcla: nuevos, duplicados y conflictos en una sola importacion', () => {
  const r = previewGenealogyImport({
    incoming: [
      link('g1', 'c', 'd', 'biological_parent'),
      link('g2', 'a', 'b', 'biological_parent'),
      link('g3', 'a', 'b', 'adoptive_parent'),
      link('g4', 'x', 'y', 'partner'),
    ],
    existing: [link('g2', 'a', 'b', 'biological_parent')],
  });
  assert.deepEqual(r.additions, [link('g1', 'c', 'd', 'biological_parent'), link('g4', 'x', 'y', 'partner')]);
  assert.deepEqual(r.duplicates, [{ incoming: 'g2', existing: 'g2' }]);
  assert.deepEqual(r.conflicts, [
    { incoming: 'g3', existing: 'g2', incomingKind: 'adoptive_parent', existingKind: 'biological_parent' },
  ]);
});

test('ids derivados: dos entradas sin id reciben ids distintos y no colisionan', () => {
  const r = previewGenealogyImport({
    incoming: [link('', 'a', 'b', 'guardian'), link('', 'c', 'd', 'guardian')],
    existing: [],
  });
  assert.equal(r.additions.length, 2);
  assert.notEqual(r.additions[0].id, r.additions[1].id);
});

test('id derivado salta los ids ya ocupados por lo existente', () => {
  const r = previewGenealogyImport({
    incoming: [link('', 'a', 'b', 'guardian')],
    existing: [link('g1', 'z', 'w', 'partner')],
  });
  assert.deepEqual(r.additions, [link('g2', 'a', 'b', 'guardian')]);
  assert.deepEqual(r.duplicates, []);
  assert.deepEqual(r.conflicts, []);
});

test('id derivado salta tambien los ocupados dentro de la importacion', () => {
  const r = previewGenealogyImport({
    incoming: [link('g2', 'a', 'b', 'guardian'), link('', 'c', 'd', 'guardian')],
    existing: [link('g1', 'z', 'w', 'partner')],
  });
  assert.deepEqual(r.additions.map((l) => l.id), ['g2', 'g3']);
});

test('duplicado dentro de la propia importacion: segunda ocurrencia va a duplicates', () => {
  const r = previewGenealogyImport({
    incoming: [link('g1', 'a', 'b', 'biological_parent'), link('g2', 'a', 'b', 'biological_parent')],
    existing: [],
  });
  assert.deepEqual(r.additions, [link('g1', 'a', 'b', 'biological_parent')]);
  assert.deepEqual(r.duplicates, [{ incoming: 'g2', existing: 'g1' }]);
});

test('conflicto dentro de la propia importacion: mismo from/to con kind distinto', () => {
  const r = previewGenealogyImport({
    incoming: [link('g1', 'a', 'b', 'biological_parent'), link('g2', 'a', 'b', 'adoptive_parent')],
    existing: [],
  });
  assert.deepEqual(r.additions, [link('g1', 'a', 'b', 'biological_parent')]);
  assert.deepEqual(r.conflicts, [
    { incoming: 'g2', existing: 'g1', incomingKind: 'adoptive_parent', existingKind: 'biological_parent' },
  ]);
});

test('no muta las entradas', () => {
  const incoming = [link('g1', 'a', 'b', 'biological_parent')];
  const existing = [link('g1', 'a', 'b', 'biological_parent')];
  const incomingCopy = JSON.parse(JSON.stringify(incoming));
  const existingCopy = JSON.parse(JSON.stringify(existing));
  previewGenealogyImport({ incoming, existing });
  assert.deepEqual(incoming, incomingCopy);
  assert.deepEqual(existing, existingCopy);
});

// r3 fix (review P2): implicit links without id must derive an id, not be dropped
test('preview derives ids for id-less incoming links instead of dropping them', () => {
  const incoming = [
    { id: 'g2', from: 'a', to: 'b', kind: 'biological_parent' },
    { from: 'b', to: 'c', kind: 'biological_parent' },
    { from: 'c', to: 'a', kind: 'biological_parent' },
  ];
  const r = previewGenealogyImport({ incoming, existing: [] });
  assert.deepEqual(r.additions.map((l) => l.id).sort(), ['g1', 'g2', 'g3']);
  assert.deepEqual(r.issues, []);
});
