// Bench: the four claims of tanda 1, measured rather than asserted.
//
//   npx tsx harness/map2d-cohesion.ts [seed] [gridWidth]
//
// 1. The 2D asks for the geography it actually needs, in two passes.
//    The regression this exists to prevent: the road layer shipped, was
//    verified against `buildHumanGeography(..., 'full')` in a bench, and drew
//    NOTHING in the app — because `WorldView` asked for `'places'`, where
//    `roads` is the empty array. Measuring the renderer is not measuring the
//    view. So this measures the depths the view actually asks for.
// 2. Realm borders come out of the extraction on real boundaries, and cost
//    what a per-frame layer is allowed to cost.
// 3. The camera contract reaches the bottom of the satellite pyramid.
// 4. A double-click never moves the camera outward, at any span.

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { getGeography, rebuildGeography, geographyIsStale } from '../src/engines/worldgen/cartography/texture';
import { realmBorders, drawRealmBorders } from '../src/engines/worldgen/cartography/realmOverlay';
import { drawRoadNetwork } from '../src/engines/worldgen/cartography/roadOverlay';
import {
  EARTH_KM, MIN_SPAN_KM, MAX_SPAN_KM, doubleClickSpanKm, clampSpanKm,
} from '../src/engines/worldgen/core/camera';
import { MAX_SAT_TILE_Z } from '../src/engines/worldgen/region/satelliteTile';
import { TILE_PX } from '../src/engines/worldgen/cartography/tiles';
import { PROJECTIONS } from '../src/engines/worldgen/core/projections';

type Ctx = CanvasRenderingContext2D;
const seed = process.argv[2] || 'monstruo';
const gridW = Number(process.argv[3] || 1024);
const world = getWorld({ seed, width: gridW });
let fails = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${label} — ${detail}`);
};

// ---------------------------------------------------------------------------
console.log(`\n1. LAS DOS PASADAS DE GEOGRAFÍA  (mundo ${world.width}×${world.height})`);
// Exactly the sequence the effect in WorldView now runs: the cheap half first,
// then the deep one, on the same world object.
const tA = Date.now();
const places = getGeography(world, 'places', DEFAULT_HUMAN_PARAMS);
const msPlaces = Date.now() - tA;
console.log(`   pasada 1 'places' — ${msPlaces} ms · ${places.settlements.length} poblaciones · `
  + `${places.roads.length} caminos · ${places.features.length} accidentes · ${places.ruins.length} ruinas`);

const staleNow = geographyIsStale(world, 'full');
const tB = Date.now();
const full = staleNow ? rebuildGeography(world, 'full', DEFAULT_HUMAN_PARAMS) : getGeography(world, 'full', DEFAULT_HUMAN_PARAMS);
const msFull = Date.now() - tB;
console.log(`   pasada 2 'full'   — ${msFull} ms · ${full.settlements.length} poblaciones · `
  + `${full.roads.length} caminos · ${full.features.length} accidentes · ${full.ruins.length} ruinas`);

check(places.roads.length === 0, 'la pasada barata NO trae caminos',
  `${places.roads.length} — es exactamente por lo que la capa dibujaba el array vacío`);
check(full.roads.length > 0, 'la pasada honda SÍ trae caminos', `${full.roads.length}`);
check(full.features.length > 0, 'y accidentes con nombre', `${full.features.length}`);
check(full.ruins.length > 0, 'y ruinas', `${full.ruins.length}`);
check(staleNow, 'una geografía a medias se declara obsoleta ante una petición honda',
  `geographyIsStale(world, 'full') = ${staleNow}`);
// The cache must never downgrade, or switching to the 3D would throw the
// expensive half away and the map would lose its roads on every view change.
const after = getGeography(world, 'places', DEFAULT_HUMAN_PARAMS);
check(after.roads.length === full.roads.length, 'y la caché no degrada al volver a pedir lo barato',
  `${after.roads.length} caminos siguen ahí`);

// ---------------------------------------------------------------------------
console.log('\n2. FRONTERAS');
const tC = Date.now();
const segs = realmBorders(world, full);
const msSegs = Date.now() - tC;
const tD = Date.now();
realmBorders(world, full);
const msCached = Date.now() - tD;
console.log(`   ${full.realms.length} reinos · ${segs.count} segmentos · extracción ${msSegs} ms · `
  + `desde caché ${msCached} ms`);
check(segs.count > 0, 'hay frontera que dibujar', `${segs.count} segmentos`);
check(msCached <= 1, 'y sólo se extrae una vez por geografía', `${msCached} ms la segunda vez`);

// Every segment must separate two DIFFERENT realm ids — an edge inside one
// country is a line drawn across a country.
let wrongSide = 0;
const W = world.width, H = world.height;
for (let k = 0; k < segs.count; k++) {
  const ax = segs.xy[k * 4], ay = segs.xy[k * 4 + 1];
  const bx = segs.xy[k * 4 + 2], by = segs.xy[k * 4 + 3];
  let a: number, b: number;
  if (ax === bx) {
    // Vertical edge at x=ax between cell (ax-1, ay) and (ax, ay).
    a = full.realmOf[ay * W + (((ax - 1) % W) + W) % W];
    b = full.realmOf[ay * W + (ax % W)];
  } else {
    // Horizontal edge at y=ay between cell (ax, ay-1) and (ax, ay).
    a = full.realmOf[(ay - 1) * W + (ax % W)];
    b = full.realmOf[Math.min(H - 1, ay) * W + (ax % W)];
  }
  if (a === b) wrongSide++;
  void bx; void by;
}
check(wrongSide === 0, 'cada segmento separa dos reinos distintos',
  `${wrongSide} segmentos dentro de un mismo reino`);

// Ink and cost at the four tiers.
//
// AIMED AT INHABITED GROUND, not at a fixed fraction of the sheet. The first
// version of this bench pointed the camera at u=0,42 v=0,45 and reported zero
// borders and zero roads at three of the four tiers — which reads exactly like
// a broken cull and was in fact open ocean. A layer measured over water
// measures nothing.
const CW = 1280, CH = 800, sp = PROJECTIONS.equirect;
const focus = (() => {
  const bucket = new Map<number, number>();
  const S = 16;
  for (const r of full.roads) {
    for (const c of r.cells) {
      const k = Math.floor((c / world.width | 0) / S) * 4096 + Math.floor((c % world.width) / S);
      bucket.set(k, (bucket.get(k) ?? 0) + 1);
    }
  }
  let bestK = -1, bestN = -1;
  for (const [k, n] of bucket) if (n > bestN) { bestN = n; bestK = k; }
  return bestK < 0
    ? { x: world.width * 0.5, y: world.height * 0.5 }
    : { x: (bestK % 4096) * S + S / 2, y: Math.floor(bestK / 4096) * S + S / 2 };
})();
console.log(`   cámara sobre la celda más transitada: ${focus.x.toFixed(0)},${focus.y.toFixed(0)}`);
/**
 * Every tier PLUS the fitted view, and through the same east-west copies the
 * map draws.
 *
 * The first version of this bench sampled spans only. It therefore never
 * exercised the view the map actually OPENS in — `fit()` sizes the map to 98 %
 * of the canvas, so the window is slightly WIDER than the world and every
 * segment is in range in every copy. That is where the layer cost 15 ms a
 * frame, and the bench said 5 ms and passed.
 */
console.log('\n   caso           span      copias  segmentos  ms/frame  tinta%');
const CASES: { name: string; spanKm: number | 'fit' }[] = [
  { name: 'ajustada  ', spanKm: 'fit' },
  { name: 'planetario', spanKm: 20000 },
  { name: 'continental', spanKm: 6000 },
  { name: 'regional  ', spanKm: 1200 },
  { name: 'local     ', spanKm: 200 },
];
for (const c of CASES) {
  const fitScale = Math.min(CW / W, CH / H) * 0.98;
  const scale = c.spanKm === 'fit' ? fitScale : CW / ((c.spanKm / EARTH_KM) * W);
  const spanKm = EARTH_KM * CW / (W * scale);
  const mapW = W * scale, mapH = H * scale;
  const ox = c.spanKm === 'fit' ? (CW - mapW) / 2 : CW * 0.5 - (focus.x / W) * mapW;
  const oy = c.spanKm === 'fit' ? (CH - mapH) / 2 : CH * 0.5 - (focus.y / H) * mapH;

  // Map2D's copies loop, verbatim in spirit: every east-west copy that can
  // touch the canvas.
  const copies: number[] = [];
  const firstOx = ox - Math.ceil((ox + mapW) / mapW) * mapW + mapW;
  for (let k = firstOx; k <= CW; k += mapW) copies.push(k);
  if (!copies.length) copies.push(ox);

  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  const t0 = Date.now();
  let drawn = 0;
  for (const copyOx of copies) {
    drawn += drawRealmBorders(ctx, segs, {
      worldWidth: W, worldHeight: H,
      toScreen: (u, v) => { const [X, Y] = sp.forward(u, v); return [copyOx + X * mapW, oy + Y * mapH]; },
      width: CW, height: CH, pxPerCell: scale,
      view: { x: -copyOx / scale, y: -oy / scale, w: CW / scale, h: CH / scale },
      linear: { ox: copyOx, oy, scale },
      alpha: 0.72,
    });
  }
  const ms = Date.now() - t0;
  const px = ctx.getImageData(0, 0, CW, CH).data;
  let inked = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) inked++;
  console.log(`   ${c.name}${String(Math.round(spanKm)).padStart(7)} km  ${String(copies.length).padStart(6)}  `
    + `${String(drawn).padStart(9)}  ${String(ms).padStart(8)}  ${((100 * inked) / (CW * CH)).toFixed(3)}`);
  // Contra la MEDIDA ANTERIOR, no contra medio fotograma: 15 ms era el coste de
  // la vista ajustada antes de la ventana por copia, el camino afín y la fusión
  // de tiradas. Un umbral pegado a la medida parpadea y no dice nada.
  check(ms < 12, `fronteras, caso ${c.name.trim()}, por debajo del coste anterior (15 ms)`, `${ms} ms`);
  // A small overlap is CORRECT, not waste: when the map is slightly wider than
  // the world, the segments in the sliver at each edge really are on screen
  // twice, in two different copies.
  check(drawn <= segs.count * 1.1, 'y casi ningun segmento se proyecta dos veces',
    `${drawn} de ${segs.count} (+${(100 * (drawn / segs.count - 1)).toFixed(1)} %)`);
}

// The roads, with the geography the view NOW asks for.
{
  const spanKm = 6000;
  const scale = CW / ((spanKm / EARTH_KM) * W);
  const mapW = W * scale, mapH = H * scale;
  const ox = CW * 0.5 - (focus.x / W) * mapW, oy = CH * 0.5 - (focus.y / H) * mapH;
  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  const res = drawRoadNetwork(ctx, full.roads, {
    worldWidth: W, worldHeight: H,
    toScreen: (u, v) => { const [X, Y] = sp.forward(u, v); return [ox + X * mapW, oy + Y * mapH]; },
    width: CW, height: CH, pxPerCell: scale, alpha: 1,
  });
  const px = ctx.getImageData(0, 0, CW, CH).data;
  let inked = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) inked++;
  console.log(`\n   caminos con la geografía que ahora pide la vista: ${res.drawn} dibujados, `
    + `${((100 * inked) / (CW * CH)).toFixed(3)} % de tinta`);
  check(res.drawn > 0 && inked > 0, 'la capa de caminos tiene algo que dibujar en el 2D',
    `${res.drawn} caminos, ${inked} px`);
}

// ---------------------------------------------------------------------------
console.log('\n3. LA CÁMARA LLEGA AL FONDO DE LA PIRÁMIDE');
for (const gw of [1024, 2048, 3072]) {
  for (const screenPx of [900, 1600, 2560]) {
    const maxScale = (TILE_PX * Math.pow(2, MAX_SAT_TILE_Z) / gw) * 1.4;
    const deepest = EARTH_KM * screenPx / (gw * maxScale);
    const ok = deepest >= MIN_SPAN_KM;
    if (!ok) fails++;
    if (gw === 2048 && screenPx === 1600) {
      console.log(`   mundo ${gw}, pantalla ${screenPx} px → span más hondo alcanzable `
        + `${deepest.toFixed(3)} km · suelo del contrato ${MIN_SPAN_KM} km`);
    }
  }
}
check(true, 'todo mundo × pantalla llega por debajo del suelo del contrato',
  `MIN_SPAN_KM = ${MIN_SPAN_KM} km (era 3 — tres niveles de pirámide irrepresentables)`);
check(clampSpanKm(0.4) === 0.4, 'y una vista de 0,4 km sobrevive al recorte', `${clampSpanKm(0.4)}`);
check(clampSpanKm(1e9) === MAX_SPAN_KM, 'sin romper el techo', `${clampSpanKm(1e9)}`);

// ---------------------------------------------------------------------------
console.log('\n4. EL DOBLE CLIC NUNCA ALEJA');
let outward = 0, worst = 0;
for (let i = 0; i <= 4000; i++) {
  // Log sweep from a metre of ground to the whole planet.
  const span = 0.001 * Math.pow(EARTH_KM / 0.001, i / 4000);
  const next = doubleClickSpanKm(span);
  const from = clampSpanKm(span);
  if (next > from + 1e-9) { outward++; worst = Math.max(worst, next - from); }
}
check(outward === 0, 'en 4001 spans de un metro a un planeta',
  outward ? `${outward} alejan, el peor por ${worst.toFixed(2)} km` : 'ninguno aleja');
console.log(`   ejemplos: 20000 → ${doubleClickSpanKm(20000).toFixed(1)} · `
  + `100 → ${doubleClickSpanKm(100).toFixed(2)} · `
  + `40 → ${doubleClickSpanKm(40).toFixed(2)} (antes 24, o sea ALEJAR) · `
  + `1 → ${doubleClickSpanKm(1).toFixed(3)} · `
  + `0,3 → ${doubleClickSpanKm(0.3).toFixed(3)}`);

console.log(`\n${fails === 0 ? 'TODO EN VERDE' : `${fails} COMPROBACIONES EN ROJO`}`);
process.exit(fails === 0 ? 0 : 1);
