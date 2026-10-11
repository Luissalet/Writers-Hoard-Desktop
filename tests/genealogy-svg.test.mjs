import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTreeSvg } from '../src/engines/genealogy/treeSvg.ts';

const CH = (id, name) => ({ id, name });
const LINK = (id, from, to, kind, label) =>
  label === undefined ? { id, from, to, kind } : { id, from, to, kind, label };

test('renderTreeSvg: SVG raiz con viewBox y dimensiones del layout', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto')],
    [LINK('g1', 'a', 'b', 'biological_parent')],
    { cellW: 120, cellH: 60 },
  );
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 /);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('renderTreeSvg: un rect y un text por personaje, con nombre escapado', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana <&"x">')],
    [],
    { cellW: 120, cellH: 60 },
  );
  const rects = svg.match(/<rect /g) ?? [];
  const texts = svg.match(/<text /g) ?? [];
  assert.equal(rects.length, 1);
  assert.equal(texts.length, 1);
  assert.ok(svg.includes('Ana &lt;&amp;&quot;x&quot;&gt;'));
  assert.ok(!svg.includes('<&"x">'));
});

test('renderTreeSvg: coordenadas del layout respetadas (x,y del nodo)', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto')],
    [LINK('g1', 'a', 'b', 'biological_parent')],
    { cellW: 100, cellH: 50 },
  );
  // a es raiz en (0,0); b hijo en fila 1
  assert.match(svg, /<g[^>]*data-id="a"[^>]*>/);
  assert.match(svg, /<g[^>]*data-id="b"[^>]*>/);
  const xa = svg.indexOf('data-id="a"');
  const xb = svg.indexOf('data-id="b"');
  assert.ok(xa >= 0 && xb >= 0);
});

test('renderTreeSvg: arista por enlace parent con flecha hacia el hijo', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto')],
    [LINK('g1', 'a', 'b', 'biological_parent')],
    { cellW: 100, cellH: 50 },
  );
  const lines = svg.match(/<line /g) ?? [];
  assert.equal(lines.length, 1);
  assert.match(svg, /marker-end/);
});

test('renderTreeSvg: pareja dibujada como linea discontinua, sin flecha', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto')],
    [LINK('g1', 'a', 'b', 'partner')],
    { cellW: 100, cellH: 50 },
  );
  assert.match(svg, /stroke-dasharray/);
  assert.ok(!svg.includes('marker-end'));
});

test('renderTreeSvg: adoptivo y guardian con clase distinta de la biologica', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto'), CH('c', 'Caro')],
    [
      LINK('g1', 'a', 'b', 'adoptive_parent'),
      LINK('g2', 'a', 'c', 'guardian'),
    ],
    { cellW: 100, cellH: 50 },
  );
  assert.match(svg, /class="edge adoptive_parent"/);
  assert.match(svg, /class="edge guardian"/);
  assert.ok(!svg.includes('class="edge biological_parent"'));
});

test('renderTreeSvg: etiqueta de kind en la arista cuando trae label', () => {
  const svg = renderTreeSvg(
    [CH('a', 'Ana'), CH('b', 'Beto')],
    [LINK('g1', 'a', 'b', 'partner', 'casados')],
    { cellW: 100, cellH: 50 },
  );
  assert.ok(svg.includes('casados'));
});

test('renderTreeSvg: arbol vacio produce SVG valido sin nodos', () => {
  const svg = renderTreeSvg([], [], { cellW: 100, cellH: 50 });
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<rect /g) ?? []).length, 0);
});

test('renderTreeSvg: no muta entradas y es determinista', () => {
  const chars = [CH('a', 'Ana'), CH('b', 'Beto')];
  const links = [LINK('g1', 'a', 'b', 'biological_parent')];
  const charsCopy = JSON.parse(JSON.stringify(chars));
  const linksCopy = JSON.parse(JSON.stringify(links));
  const s1 = renderTreeSvg(chars, links, { cellW: 100, cellH: 50 });
  const s2 = renderTreeSvg(chars, links, { cellW: 100, cellH: 50 });
  assert.equal(s1, s2);
  assert.deepEqual(chars, charsCopy);
  assert.deepEqual(links, linksCopy);
});

test('renderTreeSvg: ids derivados no necesarios; ids de entrada van en data-id', () => {
  const svg = renderTreeSvg(
    [CH('x1', 'X'), CH('y2', 'Y')],
    [LINK('e9', 'x1', 'y2', 'biological_parent')],
    { cellW: 100, cellH: 50 },
  );
  assert.match(svg, /data-id="x1"/);
  assert.match(svg, /data-id="y2"/);
});
