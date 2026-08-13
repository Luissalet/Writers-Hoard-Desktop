// ============================================================================
// BANCO: la vía afín de la capa de caminos
// ============================================================================
// Mide EXACTAMENTE el cambio de esta pasada: `drawRoadNetwork` con el cierre
// `toScreen` (tupla por vértice) contra la vía `linear` en línea, sobre el
// mismo lienzo, la misma red y la misma vista. La red es sintética pero con la
// carga real (91 caminos, ~100 celdas cada uno — los números del mundo
// monstruo del banco de tinta): a la aritmética de proyección no le importa
// la forma del camino, sólo cuántos vértices pasan por ella.
//
// Y — lección #22 sobre los bancos — se comprueba que las DOS vías pintan el
// MISMO dibujo: mismos caminos dibujados, mismos vértices, y tinta idéntica
// píxel a píxel. Una vía rápida que dibuja otra cosa no es una optimización.
import { createCanvas } from '@napi-rs/canvas';
import { drawRoadNetwork } from '../src/engines/worldgen/cartography/roadOverlay';
import type { Road } from '../src/engines/worldgen/core/settlements';

const W = 1024, H = 512;          // mundo en celdas
const CW = 1280, CH = 800;        // lienzo CSS px
const scalePx = CW / W;           // vista de encuadre: el mundo entero en pantalla

// Una red reproducible: 91 caminos de ~100 celdas en paseo sesgado.
let s = 1234567;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const roads: Road[] = [];
for (let i = 0; i < 91; i++) {
  const cells: number[] = [];
  let x = Math.floor(rnd() * W), y = 40 + Math.floor(rnd() * (H - 80));
  const dx = rnd() < 0.5 ? 1 : -1;
  const n = 60 + Math.floor(rnd() * 80);
  for (let k = 0; k < n; k++) {
    x = (x + (rnd() < 0.7 ? dx : 0) + W) % W;
    y = Math.max(0, Math.min(H - 1, y + (rnd() < 0.4 ? (rnd() < 0.5 ? 1 : -1) : 0)));
    const c = y * W + x;
    if (cells[cells.length - 1] !== c) cells.push(c);
  }
  roads.push({ from: 0, to: 1, cells, major: i % 3 === 0 } as unknown as Road);
}
const vertices = roads.reduce((a, r) => a + r.cells.length, 0);

const base = {
  worldWidth: W, worldHeight: H, width: CW, height: CH,
  pxPerCell: scalePx, alpha: 1,
};
const toScreen = (u: number, v: number): [number, number] => [u * W * scalePx, v * H * scalePx];
const linear = { ox: 0, oy: 0, scale: scalePx };

function run(withLinear: boolean, rounds: number): { ms: number; drawn: number; verts: number } {
  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  let drawn = 0, verts = 0;
  const t0 = performance.now();
  for (let r = 0; r < rounds; r++) {
    ctx.clearRect(0, 0, CW, CH);
    const res = drawRoadNetwork(ctx, roads, {
      ...base, toScreen, linear: withLinear ? linear : undefined,
    });
    drawn = res.drawn; verts = res.vertices;
  }
  return { ms: (performance.now() - t0) / rounds, drawn, verts };
}

// Igualdad de tinta: un fotograma de cada vía, píxel a píxel.
function inkOf(withLinear: boolean): Buffer {
  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawRoadNetwork(ctx, roads, { ...base, toScreen, linear: withLinear ? linear : undefined });
  return Buffer.from(ctx.getImageData(0, 0, CW, CH).data);
}

run(false, 3); run(true, 3); // calentar JIT
const slow = run(false, 40);
const fast = run(true, 40);
const a = inkOf(false), b = inkOf(true);
let diff = 0;
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;

console.log(`red: ${roads.length} caminos, ${vertices} celdas`);
console.log(`cierre  : ${slow.ms.toFixed(2)} ms/fotograma (${slow.drawn} dibujados, ${slow.verts} vértices)`);
console.log(`afín    : ${fast.ms.toFixed(2)} ms/fotograma (${fast.drawn} dibujados, ${fast.verts} vértices)`);
console.log(`x${(slow.ms / fast.ms).toFixed(1)} · bytes distintos entre vías: ${diff} de ${a.length}`);
if (fast.drawn !== slow.drawn || fast.verts !== slow.verts) {
  console.error('¡Las dos vías no dibujan lo mismo!');
  process.exit(1);
}
if (diff !== 0) {
  console.error('¡La tinta difiere entre vías!');
  process.exit(1);
}

// Geometría sola (proyectar + simplificar + suavizar), sin trazar: aísla lo
// que la vía afín y la caché de desenrollado pueden mover de verdad.
{
  const { simplify, chaikin } = await import('../src/engines/worldgen/cartography/contours');
  const { roadScreenPath, unwrapRoad } = await import('../src/engines/worldgen/cartography/roadOverlay');
  const geom = (withLinear: boolean, cached: Pt2[][] | null) => {
    const t0 = performance.now();
    for (let r = 0; r < 200; r++) {
      for (let i = 0; i < roads.length; i++) {
        const path = cached ? cached[i] : unwrapRoad(roads[i].cells, W);
        const s = roadScreenPath(path, { ...base, toScreen, linear: withLinear ? linear : undefined });
        if (!s) continue;
        let pts = simplify(s, 0.9);
        if (pts.length > 2 && pts.length < 400) pts = chaikin(pts, false, 1);
      }
    }
    return (performance.now() - t0) / 200;
  };
  type Pt2 = { x: number; y: number };
  const unwrapped = roads.map((r) => unwrapRoad(r.cells, W));
  console.log(`geometría cierre+desenrollo/f: ${geom(false, null).toFixed(2)} ms`);
  console.log(`geometría afín+caché/f      : ${geom(true, unwrapped).toFixed(2)} ms`);
}
