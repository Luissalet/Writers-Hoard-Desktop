import { unpackWorld, type WorldData, type WorldTransfer } from '../src/engines/worldgen/core/types';
import { CartoBaseGL } from '../src/engines/worldgen/cartography/glbase';
import { buildSymbolAtlas, SymbolGL, type SymbolInstance } from '../src/engines/worldgen/cartography/glsymbols';
import { computeFields, getTintFieldFor, renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
declare global { interface Window { wgDone?: boolean } }

async function load(): Promise<WorldData> {
  const meta = await (await fetch('/world.json')).json();
  const buf = await (await fetch('/world.bin')).arrayBuffer();
  const t: Record<string, unknown> = { ...meta };
  let off = 0;
  for (const [n, l] of meta.__layout as [string, number][]) { if (n.startsWith('river:')) continue; t[n] = buf.slice(off, off + l); off += l; }
  const rivers: { cells: ArrayBuffer; flow: number }[] = [];
  for (const [n, l] of meta.__layout as [string, number][]) { if (!n.startsWith('river:')) continue; rivers.push({ cells: buf.slice(off, off + l), flow: meta.__riverFlows[rivers.length] }); off += l; }
  t.rivers = rivers;
  return unpackWorld(t as unknown as WorldTransfer);
}

void load().then((world) => {
  const theme = themeById('wonder');
  const geo = getGeography(world);
  const OW = 1400, OH = 700;
  const view = { x: 0, y: 0, w: world.width, h: world.height };
  const glCanvas = document.createElement('canvas');
  const gl = new CartoBaseGL(glCanvas, world);
  const opts = { theme, shading: true, biomeTint: true, coastRings: true };

  const t0 = performance.now();
  gl.sync(world, computeFields(world), getTintFieldFor(world, theme));
  console.log(`sync (subida de texturas, una vez): ${(performance.now() - t0).toFixed(0)} ms`);

  const t1 = performance.now();
  for (let k = 0; k < 20; k++) gl.draw(view, OW, OH, opts, 0);
  console.log(`base en GPU: ${((performance.now() - t1) / 20).toFixed(2)} ms por fotograma`);

  const out = document.createElement('canvas');
  out.width = OW; out.height = OH * 2;
  document.body.appendChild(out);
  const ctx = out.getContext('2d')!;

  // Atlas de símbolos + capa instanciada
  const tA = performance.now();
  const atlas = buildSymbolAtlas(theme, world.params.seed);
  console.log(`atlas de símbolos (${atlas.cols}x${atlas.rows} celdas): ${(performance.now() - tA).toFixed(0)} ms, una vez`);
  const symCanvas = document.createElement('canvas');
  const sym = new SymbolGL(symCanvas, atlas);
  let inst: SymbolInstance[] = [];

  // GPU base + símbolos instanciados + tinta
  const c1 = document.createElement('canvas'); c1.width = OW; c1.height = OH;
  const x1 = c1.getContext('2d')!;
  const t2 = performance.now();
  let tSym = 0;
  renderCartography(world, x1 as unknown as Ctx, { theme, width: OW, height: OH, view, geography: geo,
    layers: { frame: false, compass: false, scaleBar: false },
    drawBase: (w, h, v) => { gl.draw(v, w, h, opts, 0); return glCanvas; },
    emitSymbol: (e) => { inst.push({ ...e, alpha: 1 }); },
    drawSymbols: (w, h) => { const t = performance.now(); sym.draw(inst, w, h); tSym = performance.now() - t; return symCanvas; } });
  console.log(`  ${inst.length} símbolos instanciados en ${tSym.toFixed(1)} ms (una llamada de dibujo)`);
  console.log(`carta COMPLETA con base y símbolos en GPU: ${(performance.now() - t2).toFixed(0)} ms`);
  ctx.drawImage(c1, 0, 0);
  inst = [];

  // CPU de referencia
  const c2 = document.createElement('canvas'); c2.width = OW; c2.height = OH;
  const x2 = c2.getContext('2d')!;
  const t3 = performance.now();
  renderCartography(world, x2 as unknown as Ctx, { theme, width: OW, height: OH, view, geography: geo,
    layers: { frame: false, compass: false, scaleBar: false } });
  console.log(`carta COMPLETA con base en CPU: ${(performance.now() - t3).toFixed(0)} ms`);
  ctx.drawImage(c2, 0, OH);

  window.wgDone = true;
});
