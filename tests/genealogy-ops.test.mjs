import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyGenealogy, queryGenealogy, undoGenealogy, genealogyRevision, GenealogyOpError } from '../src/engines/genealogy/genealogyOps.ts';

const characters = [
  { id: 'A', name: 'Ana' },
  { id: 'B', name: 'Beto' },
  { id: 'C', name: 'Caro' },
];

const proposal = [
  { id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' },
  { id: 'f2', from: 'B', to: 'C', kind: 'adoptive_parent' },
  { id: 'f3', from: 'A', to: 'A', kind: 'partner' }, // self_link: rechazado
];

test('apply aplica solo los aceptados y registra la aplicacion', () => {
  const links = [];
  const result = applyGenealogy(characters, links, proposal, 'app1');
  assert.deepEqual(result.appliedLinkIds, ['f1', 'f2']);
  assert.equal(result.links.length, 2);
  assert.equal(result.links[0].id, 'f1');
  assert.equal(result.application.id, 'app1');
  assert.deepEqual(result.application.appliedLinkIds, ['f1', 'f2']);
  assert.ok(result.application.revisionBefore);
  assert.ok(result.application.revisionAfter);
  assert.notEqual(result.application.revisionBefore, result.application.revisionAfter);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].issues[0].code, 'self_link');
});

test('apply no muta el estado de entrada', () => {
  const links = [];
  const copy = JSON.stringify(links);
  applyGenealogy(characters, links, proposal, 'app1');
  assert.equal(JSON.stringify(links), copy);
});

test('apply rechaza applyId duplicado', () => {
  const applications = { app1: { id: 'app1', appliedLinkIds: ['f1'], revisionBefore: 'x', revisionAfter: 'y' } };
  assert.throws(
    () => applyGenealogy(characters, [], proposal, 'app1', applications),
    (err) => err instanceof GenealogyOpError && err.code === 'duplicate_apply',
  );
});

test('genealogyRevision es determinista e independiente del orden', () => {
  const a = [{ id: 'f1', from: 'A', to: 'B', kind: 'partner' }];
  const b = [{ id: 'f1', from: 'A', to: 'B', kind: 'partner' }];
  const reordered = [b[0]];
  assert.equal(genealogyRevision(a), genealogyRevision(reordered));
  const other = [{ id: 'f1', from: 'A', to: 'C', kind: 'partner' }];
  assert.notEqual(genealogyRevision(a), genealogyRevision(other));
});

test('query devuelve padres, hijos, guardianes y pareja por direccion', () => {
  const links = [
    { id: 'f1', from: 'A', to: 'B', kind: 'biological_parent' },
    { id: 'f2', from: 'C', to: 'B', kind: 'adoptive_parent' },
    { id: 'f3', from: 'G', to: 'B', kind: 'guardian' },
    { id: 'f4', from: 'B', to: 'P', kind: 'partner' },
    { id: 'f5', from: 'P', to: 'B', kind: 'partner' },
  ];
  const q = queryGenealogy(links, 'B');
  assert.deepEqual(q.parents.map((l) => l.id).sort(), ['f1', 'f2']);
  assert.deepEqual(q.children, []);
  assert.deepEqual(q.guardians.map((l) => l.id), ['f3']);
  assert.deepEqual(q.partners.map((l) => l.id).sort(), ['f4', 'f5']);
  const qA = queryGenealogy(links, 'A');
  assert.deepEqual(qA.children.map((l) => l.id), ['f1']);
  assert.deepEqual(qA.parents, []);
});

test('query no infiere de relaciones genericas: solo enlaces genealogicos', () => {
  const links = [{ id: 'f1', from: 'A', to: 'B', kind: 'partner' }];
  const q = queryGenealogy(links, 'A');
  assert.deepEqual(q.parents, []);
  assert.deepEqual(q.children, []);
  assert.deepEqual(q.guardians, []);
  assert.deepEqual(q.partners.map((l) => l.id), ['f1']);
});

test('undo restaura el estado previo cuando la revision coincide', () => {
  const first = applyGenealogy(characters, [], [proposal[0]], 'app1');
  const second = applyGenealogy(characters, first.links, [proposal[1]], 'app2');
  const undone = undoGenealogy(second.links, { app1: first.application, app2: second.application }, 'app2', second.application.revisionAfter);
  assert.deepEqual(undone.links, first.links);
  assert.deepEqual(undone.removedLinkIds, ['f2']);
});

test('undo rechaza si el estado cambio desde la aplicacion (stale_revision)', () => {
  const first = applyGenealogy(characters, [], [proposal[0]], 'app1');
  assert.throws(
    () => undoGenealogy([{ id: 'f9', from: 'B', to: 'C', kind: 'partner' }], { app1: first.application }, 'app1', 'no-importa'),
    (err) => err instanceof GenealogyOpError && err.code === 'stale_revision',
  );
});

test('undo con applyId desconocido', () => {
  assert.throws(
    () => undoGenealogy([], {}, 'nope', genealogyRevision([])),
    (err) => err instanceof GenealogyOpError && err.code === 'unknown_apply',
  );
});

test('undo no muta el estado de entrada', () => {
  const first = applyGenealogy(characters, [], [proposal[0]], 'app1');
  const before = JSON.stringify(first.links);
  undoGenealogy(first.links, { app1: first.application }, 'app1', first.application.revisionAfter);
  assert.equal(JSON.stringify(first.links), before);
});

test('la revision tras undo coincide con la revision previa a la aplicacion', () => {
  const first = applyGenealogy(characters, [], [proposal[0]], 'app1');
  const second = applyGenealogy(characters, first.links, [proposal[1]], 'app2');
  const undone = undoGenealogy(second.links, { app1: first.application, app2: second.application }, 'app2', second.application.revisionAfter);
  assert.equal(genealogyRevision(undone.links), first.application.revisionAfter);
});

test('apply tras undo con el mismo applyId funciona (el registro viejo se sustituye)', () => {
  const first = applyGenealogy(characters, [], [proposal[0]], 'app1');
  const undone = undoGenealogy(first.links, { app1: first.application }, 'app1', first.application.revisionAfter);
  const again = applyGenealogy(characters, undone.links, [proposal[1]], 'app1', {});
  assert.deepEqual(again.appliedLinkIds, ['f2']);
});
