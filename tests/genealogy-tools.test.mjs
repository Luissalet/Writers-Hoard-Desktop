import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGenealogyTool, GENEALOGY_TOOLS } from '../src/engines/genealogy/genealogyTools.ts';

const CHARS = [
  { id: 'c1', name: 'Abuelo' },
  { id: 'c2', name: 'Padre' },
  { id: 'c3', name: 'Hija' },
];

function baseState() {
  return {
    characters: CHARS,
    links: [
      { id: 'g1', from: 'c1', to: 'c2', kind: 'biological_parent' },
      { id: 'g2', from: 'c2', to: 'c3', kind: 'biological_parent' },
    ],
    applications: {},
  };
}

test('catalogo: expone las 5 herramientas del §5 con sus limites', () => {
  const names = GENEALOGY_TOOLS.map((t) => t.name);
  assert.deepEqual(names, [
    'genealogy_preview',
    'genealogy_validate',
    'genealogy_apply',
    'genealogy_query',
    'genealogy_undo',
  ]);
  for (const tool of GENEALOGY_TOOLS) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
  }
  const preview = GENEALOGY_TOOLS.find((t) => t.name === 'genealogy_preview');
  assert.match(preview.description, /solo lectura/i);
});

test('despacho de herramienta desconocida: error con codigo explicito', () => {
  const state = baseState();
  assert.throws(
    () => dispatchGenealogyTool(state, 'genealogy_nope', {}),
    (err) => err.code === 'unknown_tool' && err instanceof Error,
  );
});

test('genealogy_preview: solo lectura, no muta el estado', () => {
  const state = baseState();
  const proposal = [{ id: 'g9', from: 'c1', to: 'c3', kind: 'biological_parent' }];
  const result = dispatchGenealogyTool(state, 'genealogy_preview', { links: proposal });
  assert.equal(result.tool, 'genealogy_preview');
  assert.equal(result.validation.accepted.length, 1);
  assert.equal(state.links.length, 2, 'el estado no cambia');
  assert.deepEqual(state.applications, {}, 'sin registro de aplicaciones');
});

test('genealogy_validate: igual que preview, sin efectos', () => {
  const state = baseState();
  const proposal = [{ id: 'g9', from: 'c1', to: 'c3', kind: 'partner' }];
  const result = dispatchGenealogyTool(state, 'genealogy_validate', { links: proposal });
  assert.equal(result.tool, 'genealogy_validate');
  assert.equal(result.validation.accepted.length, 1);
  assert.equal(state.links.length, 2);
});

test('genealogy_apply: aplica solo los aceptados y registra la aplicacion', () => {
  const state = baseState();
  const proposal = [
    { id: 'g9', from: 'c1', to: 'c3', kind: 'biological_parent' },
    { from: 'cX', to: 'c3', kind: 'biological_parent' },
  ];
  const result = dispatchGenealogyTool(state, 'genealogy_apply', { links: proposal, applyId: 'a1' });
  assert.equal(result.tool, 'genealogy_apply');
  assert.deepEqual(result.appliedLinkIds, ['g9']);
  assert.equal(result.links.length, 3);
  assert.equal(result.application.id, 'a1');
  assert.ok(result.application.revisionAfter !== result.application.revisionBefore);
  assert.equal(result.rejected.length, 1);
});

test('genealogy_apply sin applyId: rechazo explicito', () => {
  const state = baseState();
  assert.throws(
    () => dispatchGenealogyTool(state, 'genealogy_apply', { links: [] }),
    (err) => err.code === 'invalid_apply_id',
  );
});

test('genealogy_query: devuelve padres/hijos/guardianes/pareja por direccion', () => {
  const state = baseState();
  const result = dispatchGenealogyTool(state, 'genealogy_query', { characterId: 'c2' });
  assert.equal(result.tool, 'genealogy_query');
  assert.equal(result.query.parents.length, 1);
  assert.equal(result.query.parents[0].from, 'c1');
  assert.equal(result.query.children.length, 1);
  assert.equal(result.query.children[0].to, 'c3');
  assert.equal(result.query.guardians.length, 0);
  assert.equal(result.query.partners.length, 0);
});

test('genealogy_query sin characterId: rechazo explicito', () => {
  const state = baseState();
  assert.throws(
    () => dispatchGenealogyTool(state, 'genealogy_query', {}),
    (err) => err.code === 'invalid_character_id',
  );
});

test('genealogy_undo: deshace con revision actual y guarda de revision', () => {
  const state = baseState();
  const apply = dispatchGenealogyTool(state, 'genealogy_apply', {
    links: [{ id: 'g9', from: 'c1', to: 'c3', kind: 'biological_parent' }],
    applyId: 'a1',
  });
  const undo = dispatchGenealogyTool(
    { characters: state.characters, links: apply.links, applications: { a1: apply.application } },
    'genealogy_undo',
    { applyId: 'a1', currentRevision: apply.application.revisionAfter },
  );
  assert.equal(undo.tool, 'genealogy_undo');
  assert.deepEqual(undo.removedLinkIds, ['g9']);
  assert.equal(undo.links.length, 2);
});

test('genealogy_undo con revision distinta: stale_revision', () => {
  const state = baseState();
  const apply = dispatchGenealogyTool(state, 'genealogy_apply', {
    links: [{ id: 'g9', from: 'c1', to: 'c3', kind: 'biological_parent' }],
    applyId: 'a1',
  });
  assert.throws(
    () =>
      dispatchGenealogyTool(
        { characters: state.characters, links: apply.links, applications: { a1: apply.application } },
        'genealogy_undo',
        { applyId: 'a1', currentRevision: 'deadbeef' },
      ),
    (err) => err.code === 'stale_revision',
  );
});

test('genealogy_undo sin registro: unknown_apply', () => {
  const state = baseState();
  assert.throws(
    () => dispatchGenealogyTool(state, 'genealogy_undo', { applyId: 'nope', currentRevision: 'x' }),
    (err) => err.code === 'unknown_apply',
  );
});

test('el despachador no muta el estado de entrada (pureza)', () => {
  const state = baseState();
  const before = JSON.stringify(state);
  dispatchGenealogyTool(state, 'genealogy_preview', { links: [{ id: 'g9', from: 'c1', to: 'c3', kind: 'partner' }] });
  dispatchGenealogyTool(state, 'genealogy_query', { characterId: 'c1' });
  assert.equal(JSON.stringify(state), before);
});
