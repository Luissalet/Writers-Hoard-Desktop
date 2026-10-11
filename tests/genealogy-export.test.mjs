import test from 'node:test';
import assert from 'node:assert/strict';

let mod;
try {
  mod = await import('../src/engines/genealogy/treeExport.ts');
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
    assert.fail('rojo esperado: treeExport.ts aun no existe');
  }
  throw err;
}
const { exportTreeDot, exportTreeText } = mod;

const CH = (id, name) => ({ id, name });
const L = (id, fromId, toId, kind, label) => ({ id, fromId, toId, kind, label });

function sample() {
  const characters = [CH('a', 'Abuelo'), CH('b', 'Hijo'), CH('c', 'Nieta'), CH('d', 'Suegra')];
  const links = [
    L('g1', 'a', 'b', 'biological_parent'),
    L('g2', 'b', 'c', 'biological_parent'),
    L('g3', 'd', 'b', 'adoptive_parent', 'tutora'),
    L('g4', 'a', 'd', 'partner', 'matrimonio'),
  ];
  return { characters, links };
}

test('exportTreeDot: cabecera digraph con nombre dado', () => {
  const dot = exportTreeDot(sample(), { name: 'familia' });
  assert.match(dot, /^digraph familia \{/);
  assert.ok(dot.trimEnd().endsWith('}'));
});

test('exportTreeDot: un nodo por personaje con su nombre como etiqueta', () => {
  const dot = exportTreeDot(sample());
  assert.match(dot, /"a" \[label="Abuelo"\]/);
  assert.match(dot, /"c" \[label="Nieta"\]/);
});

test('exportTreeDot: arista por enlace con estilo segun kind', () => {
  const dot = exportTreeDot(sample());
  assert.match(dot, /"a" -> "b" \[label="biological_parent"\]/);
  assert.match(dot, /"d" -> "b" \[label="adoptive_parent: tutora", style=dashed\]/);
  assert.match(dot, /"a" -> "d" \[label="partner: matrimonio", style=dotted\]/);
});

test('exportTreeDot: escapa comillas y barras en nombres y etiquetas', () => {
  const dot = exportTreeDot({
    characters: [CH('x', 'A "B" \\C')],
    links: [],
  });
  assert.match(dot, /label="A \\"B\\" \\\\C"/);
});

test('exportTreeDot: sin personajes produce digraph vacio valido', () => {
  const dot = exportTreeDot({ characters: [], links: [] });
  assert.match(dot, /^digraph genealogy \{\n\}$/);
});

test('exportTreeText: raices primero, hijos indentados por profundidad', () => {
  const text = exportTreeText(sample());
  const lines = text.split('\n');
  assert.equal(lines[0], 'Abuelo');
  assert.match(lines[1], /^  Hijo \(biological_parent\)$/);
  assert.match(lines[2], /^    Nieta \(biological_parent\)$/);
  assert.match(lines[3], /^  pareja: Suegra \(partner: matrimonio\)$/);
  assert.match(lines[4], /^Suegra$/);
});

test('exportTreeText: marca el kind de la relacion que anida', () => {
  const text = exportTreeText(sample());
  assert.match(text, /Hijo \(biological_parent\)/);
  assert.match(text, /Hijo \(adoptive_parent: tutora\)/);
});

test('exportTreeText: parejas no anidan, se listan como nota del personaje', () => {
  const text = exportTreeText(sample());
  assert.match(text, /Abuelo/);
  assert.match(text, /pareja: Suegra \(partner: matrimonio\)/);
});

test('exportTreeText: ciclos no producen recursion infinita', () => {
  const text = exportTreeText({
    characters: [CH('a', 'A'), CH('b', 'B')],
    links: [L('g1', 'a', 'b', 'biological_parent'), L('g2', 'b', 'a', 'biological_parent')],
  });
  assert.ok(text.includes('A'));
  assert.ok(text.includes('B'));
  assert.ok(text.length < 500);
});

test('ambas exportaciones son puras: no mutan la entrada', () => {
  const input = sample();
  const before = JSON.stringify(input);
  exportTreeDot(input);
  exportTreeText(input);
  assert.equal(JSON.stringify(input), before);
});
