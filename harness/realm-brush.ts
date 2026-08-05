// Bench: the frontier tools — do they actually move a border?
//
//   npx tsx harness/realm-brush.ts [seed] [gridWidth]
//
// The user asked for two things: countries carrying a faint wash in their own
// colour, and borders that can be REDRAWN — freehand, geography-aware, and with
// GIMP-style lasso tools. This measures whether the redrawing part does anything
// at all, because "the code compiles" is not the same claim.
//
// The specific failure this exists to catch is the one lesson #21 already cost
// us once: a layer that is present in the source, correct in isolation, and
// hands the running application an empty result. So every check here goes the
// whole way round — edit → applyEdits → rebuild geography → realmOf → borders —
// and the last section points the camera AT A BORDER rather than at wherever
// the previous bench happened to aim, because a frontier you cannot see when
// you zoom to it is the same nothing as a frontier that was never drawn.

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import {
  applyEdits, realmFloodCells, polygonCells,
  type WorldEdit, type Pt,
} from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { realmBorders, drawRealmBorders } from '../src/engines/worldgen/cartography/realmOverlay';
import { PROJECTIONS } from '../src/engines/worldgen/core/projections';

type Ctx = CanvasRenderingContext2D;
const EARTH_KM = 40075;
const seed = process.argv[2] || 'monstruo';
const gridW = Number(process.argv[3] || 1024);

const world = getWorld({ seed, width: gridW });
const W = world.width, H = world.height;
const base = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
console.log(`\nmundo ${W}×${H} · ${base.realms.length} reinos · ${base.settlements.length} poblaciones`);

let fails = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${label} — ${detail}`);
};

/** A land cell well inside realm `r`, for aiming the bucket. */
function insideRealm(r: number): { x: number; y: number } | null {
  for (let i = 0; i < W * H; i++) {
    if (base.realmOf[i] !== r || world.elevation[i] <= 0) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < 2 || x > W - 3 || y < 2 || y > H - 3) continue;
    return { x, y };
  }
  return null;
}

/**
 * The MIDDLE OF A BORDER SEGMENT, in fractional cells.
 *
 * Not the middle of a border cell: at 40 km the ground is 1 250 screen pixels
 * across, so a camera centred on the cell's corner puts the line a cell and a
 * half off the bottom-right of a 1280×800 canvas — which reads in the results
 * as "the frontier is invisible when you zoom in" and is really "the bench was
 * looking somewhere else". Aim at the line.
 */
function onBorder(segs: { xy: Float32Array; count: number }): { x: number; y: number } {
  let best = -1, bestLen = -1;
  for (let k = 0; k < segs.count; k++) {
    const len = Math.abs(segs.xy[k * 4 + 2] - segs.xy[k * 4]) + Math.abs(segs.xy[k * 4 + 3] - segs.xy[k * 4 + 1]);
    if (len > bestLen) { bestLen = len; best = k; }
  }
  if (best < 0) return { x: W * 0.5, y: H * 0.5 };
  return {
    x: (segs.xy[best * 4] + segs.xy[best * 4 + 2]) * 0.5,
    y: (segs.xy[best * 4 + 1] + segs.xy[best * 4 + 3]) * 0.5,
  };
}

// ===========================================================================
console.log('\n1. EL CUBO SE PARA DONDE DEBE');
// A bucket that leaks into the sea, or across the whole continent, is the tool
// being useless in the two ways a reader would notice first.
const seedCell = insideRealm(0) ?? { x: (W * 0.5) | 0, y: (H * 0.5) | 0 };
console.log(`   clic en ${seedCell.x},${seedCell.y} (tierra del reino 0)`);
const cap = Math.max(2000, Math.round(W * H * 0.04));
for (const bounded of ['coast', 'river', 'ridge'] as const) {
  const t0 = Date.now();
  const cells = realmFloodCells(world, { ...seedCell, bounded, maxCells: cap });
  const ms = Date.now() - t0;
  let wet = 0;
  for (const i of cells) if (world.elevation[i] <= 0) wet++;
  console.log(`   ${bounded.padEnd(6)} → ${String(cells.length).padStart(6)} celdas · ${ms} ms · ${wet} bajo el mar`);
  check(wet === 0, `el cubo '${bounded}' nunca reclama mar abierto`, `${wet} celdas mojadas`);
  check(cells.length > 0 && cells.length <= cap, `y respeta el tope de ${cap}`, `${cells.length}`);
  check(ms < 250, 'y cuesta menos que un parpadeo', `${ms} ms`);
}
{
  const coast = realmFloodCells(world, { ...seedCell, bounded: 'coast', maxCells: cap }).length;
  const river = realmFloodCells(world, { ...seedCell, bounded: 'river', maxCells: cap }).length;
  const ridge = realmFloodCells(world, { ...seedCell, bounded: 'ridge', maxCells: cap }).length;
  check(river <= coast && ridge <= coast,
    'poner más bordes nunca reclama MÁS suelo',
    `costa ${coast} · río ${river} · sierra ${ridge}`);
}

// ===========================================================================
console.log('\n2. EL LAZO ENCIERRA LO QUE DIBUJAS');
const cx = seedCell.x, cy = seedCell.y, R = 24;
const square: Pt[] = [
  { x: cx - R, y: cy - R }, { x: cx + R, y: cy - R },
  { x: cx + R, y: cy + R }, { x: cx - R, y: cy + R },
];
const straight = polygonCells(square, false, W, H);
const curved = polygonCells(square, true, W, H);
const want = (2 * R) * (2 * R);
console.log(`   cuadrado de ${2 * R}×${2 * R} celdas → recto ${straight.length} · curvo ${curved.length} (área nominal ${want})`);
check(Math.abs(straight.length - want) / want < 0.06, 'el lazo recto rellena el área que encierra',
  `${((100 * straight.length) / want).toFixed(1)} % del nominal`);
check(curved.length < straight.length && curved.length > want * 0.6,
  'y el curvo redondea las esquinas sin perder la forma',
  `${((100 * curved.length) / straight.length).toFixed(1)} % del recto`);
{
  // A province drawn across the antimeridian is ONE shape. The tell for the
  // broken version is a fill that hugs both edges of the map and nothing in
  // between — which is exactly what an un-wrapped ring produces.
  const seam: Pt[] = [
    { x: W - 12, y: cy - 10 }, { x: W + 12, y: cy - 10 },
    { x: W + 12, y: cy + 10 }, { x: W - 12, y: cy + 10 },
  ];
  const cells = polygonCells(seam, false, W, H);
  const cols = new Set(cells.map((i) => i % W));
  let contiguous = true;
  for (let x = W - 12; x < W + 12; x++) if (!cols.has(((x % W) + W) % W)) contiguous = false;
  console.log(`   sobre el meridiano 0 → ${cells.length} celdas en ${cols.size} columnas`);
  check(cells.length > 0 && contiguous, 'un lazo a caballo de la costura es UNA forma',
    contiguous ? 'las 24 columnas están' : 'hay columnas vacías en medio: la forma se partió');
}

// ===========================================================================
console.log('\n3. LA VUELTA COMPLETA: PINTAR → REGENERAR → LA FRONTERA SE HA MOVIDO');
// The whole point. If `realmOf` does not change, nothing downstream can.
const target = base.realms.length > 1 ? 1 : 0;
const donor = base.realmOf[seedCell.y * W + seedCell.x];
const edits: WorldEdit[] = [
  { kind: 'realmFill', realm: target, x: seedCell.x, y: seedCell.y, bounded: 'ridge', maxCells: cap },
];
const t1 = Date.now();
const painted = applyEdits(world, edits);
const msApply = Date.now() - t1;
check(!!painted.realmCells, 'applyEdits levanta la capa de dueños', painted.realmCells ? 'sí' : 'null');
if (painted.realmCells) {
  let touched = 0, untouched = 0;
  for (let i = 0; i < W * H; i++) (painted.realmCells[i] === -2 ? untouched++ : touched++);
  console.log(`   ${touched} celdas repintadas · ${untouched} intactas · ${msApply} ms`);
  check(untouched > touched, 'y sólo toca lo pintado (−2 sigue siendo "no dije nada")',
    `${((100 * touched) / (W * H)).toFixed(2)} % del mundo`);
}

const world2 = { ...world, painted } as typeof world;
const t2 = Date.now();
const geo2 = buildHumanGeography(world2, DEFAULT_HUMAN_PARAMS);
const msGeo = Date.now() - t2;
let moved = 0;
for (let i = 0; i < W * H; i++) if (geo2.realmOf[i] !== base.realmOf[i]) moved++;
console.log(`   geografía rehecha en ${(msGeo / 1000).toFixed(1)} s · ${moved} celdas cambiaron de dueño`);
check(moved > 0, 'el suelo cambia de país de verdad', `${moved} celdas · reino ${donor} → ${target}`);

let wetClaim = 0;
for (let i = 0; i < W * H; i++) if (world.elevation[i] <= 0 && geo2.realmOf[i] >= 0) wetClaim++;
check(wetClaim === 0, 'y ningún reino acaba reclamando mar', `${wetClaim} celdas de mar con dueño`);

const before = base.settlements.filter((s) => s.realm === target).length;
const after = geo2.settlements.filter((s) => s.realm === target).length;
console.log(`   poblaciones del reino ${target}: ${before} → ${after}`);
check(after >= before, 'las poblaciones del suelo cedido cambian de bandera con él',
  `${after - before} de más`);

const segsBefore = realmBorders(world, base);
const segsAfter = realmBorders(world2, geo2);
check(segsAfter.count !== segsBefore.count,
  'y la línea de la frontera se ha redibujado',
  `${segsBefore.count} → ${segsAfter.count} segmentos`);

// A realm index this world does not have must be ignored, not crash and not
// claim ground: a saved edit list outlives the world it was drawn on.
{
  const stale = applyEdits(world, [
    { kind: 'realmFill', realm: 999, x: seedCell.x, y: seedCell.y, bounded: 'coast', maxCells: 500 },
  ]);
  const g = buildHumanGeography({ ...world, painted: stale } as typeof world, DEFAULT_HUMAN_PARAMS);
  let bogus = 0;
  for (let i = 0; i < W * H; i++) if (g.realmOf[i] >= base.realms.length) bogus++;
  check(bogus === 0, 'un reino que este mundo ya no tiene se ignora sin más', `${bogus} celdas huérfanas`);
}

// ===========================================================================
console.log('\n4. ¿SE VE LA FRONTERA CUANDO TE ACERCAS A ELLA?');
// The previous bench aimed at the busiest ROAD cell and reported 0 segments at
// the regional and local tiers — true, and meaningless, because that camera was
// deep inside one country. This one aims at an actual boundary.
const bcell = onBorder(segsBefore);
{
  let longest = 0;
  for (let k = 0; k < segsBefore.count; k++) {
    longest = Math.max(longest,
      Math.abs(segsBefore.xy[k * 4 + 2] - segsBefore.xy[k * 4])
      + Math.abs(segsBefore.xy[k * 4 + 3] - segsBefore.xy[k * 4 + 1]));
  }
  console.log(`   cámara sobre el centro del tramo más largo (${longest} celdas): `
    + `${bcell.x.toFixed(1)},${bcell.y.toFixed(1)}`);
}
const CW = 1280, CH = 800, sp = PROJECTIONS.equirect;
console.log('\n   tier          span      segmentos  ms/frame  tinta%');
for (const [name, spanKm] of [
  ['planetario ', 20000], ['continental', 6000], ['regional   ', 1200],
  ['local      ', 200], ['local hondo', 40],
] as [string, number][]) {
  const scale = CW / ((spanKm / EARTH_KM) * W);
  const mapW = W * scale, mapH = H * scale;
  const ox = CW * 0.5 - (bcell.x / W) * mapW;
  const oy = CH * 0.5 - (bcell.y / H) * mapH;
  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  const t0 = Date.now();
  const drawn = drawRealmBorders(ctx, segsBefore, {
    worldWidth: W, worldHeight: H,
    toScreen: (u, v) => { const [X, Y] = sp.forward(u, v); return [ox + X * mapW, oy + Y * mapH]; },
    width: CW, height: CH, pxPerCell: scale,
    view: { x: -ox / scale, y: -oy / scale, w: CW / scale, h: CH / scale },
    alpha: 0.72,
  });
  const ms = Date.now() - t0;
  const px = ctx.getImageData(0, 0, CW, CH).data;
  let inked = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) inked++;
  const pct = (100 * inked) / (CW * CH);
  console.log(`   ${name}${String(spanKm).padStart(6)} km  ${String(drawn).padStart(9)}  `
    + `${String(ms).padStart(8)}  ${pct.toFixed(3)}`);
  check(drawn > 0 && inked > 0, `la frontera se ve a ${spanKm} km`, `${drawn} segmentos, ${inked} px`);
  check(ms < 20, `y a ${spanKm} km cuesta menos de un fotograma`, `${ms} ms`);
}

// ---------------------------------------------------------------------------
// The specific shape of "invisible when you zoom in": a run LONGER than the
// window. `mergeRuns` turns a staircase of unit edges into runs of tens of
// cells, and a cull that tests only the run's first corner drops any run that
// starts off-screen — including the one crossing the middle of the view. It is
// invisible at low zoom, where every run fits, and total at high zoom, where
// none of them do.
console.log('\n5. UN TRAMO MÁS LARGO QUE LA VENTANA');
{
  let best = -1, bestLen = -1, horiz = false;
  for (let k = 0; k < segsBefore.count; k++) {
    const dx = Math.abs(segsBefore.xy[k * 4 + 2] - segsBefore.xy[k * 4]);
    const dy = Math.abs(segsBefore.xy[k * 4 + 3] - segsBefore.xy[k * 4 + 1]);
    if (Math.max(dx, dy) > bestLen) { bestLen = Math.max(dx, dy); best = k; horiz = dx > dy; }
  }
  const mid = {
    x: (segsBefore.xy[best * 4] + segsBefore.xy[best * 4 + 2]) * 0.5,
    y: (segsBefore.xy[best * 4 + 1] + segsBefore.xy[best * 4 + 3]) * 0.5,
  };
  // A window a third of the run, centred on its middle: both ends are off
  // screen, the middle crosses it.
  const cells = Math.max(2, bestLen / 3);
  const scale = CW / cells;
  const mapW = W * scale, mapH = H * scale;
  const ox = CW * 0.5 - (mid.x / W) * mapW;
  const oy = CH * 0.5 - (mid.y / H) * mapH;
  // ONLY that run, so the answer cannot be confused with its shorter
  // neighbours happening to fall inside the window.
  const solo = {
    xy: segsBefore.xy.slice(best * 4, best * 4 + 4),
    hue: segsBefore.hue.slice(best, best + 1),
    count: 1,
  };
  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  const drawn = drawRealmBorders(ctx, solo, {
    worldWidth: W, worldHeight: H,
    toScreen: (u, v) => { const [X, Y] = sp.forward(u, v); return [ox + X * mapW, oy + Y * mapH]; },
    width: CW, height: CH, pxPerCell: scale,
    view: { x: -ox / scale, y: -oy / scale, w: CW / scale, h: CH / scale },
    alpha: 0.72,
  });
  const px = ctx.getImageData(0, 0, CW, CH).data;
  let inked = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) inked++;
  console.log(`   tramo ${horiz ? 'horizontal' : 'vertical'} de ${bestLen} celdas · `
    + `ventana de ${cells.toFixed(1)} celdas centrada en su mitad · dibujado solo él`);
  check(drawn > 0 && inked > 0,
    'un tramo que ATRAVIESA la ventana se dibuja aunque empiece fuera de ella',
    `${drawn} segmentos, ${inked} px`);
}

// ===========================================================================
// The path the APPLICATION actually takes on pointerup, which is not the path
// sections 1–3 take. A full rebuild is nineteen seconds and is suppressed for
// as long as a brush is in the reader's hand; what runs after a stroke is the
// cheap patch. If the patch hands back the generator's `realmOf`, the brush is
// a tool that does nothing — and every check above still passes, because they
// all call `buildHumanGeography` directly.
//
// This is lesson #21 again, in a new place: measuring the pipeline is not
// measuring the path the view takes through it.
console.log('\n6. LA VÍA BARATA — LA ÚNICA QUE CORRE TRAS UNA PINCELADA');
{
  const w = getWorld({ seed, width: gridW });
  const g0 = getGeography(w, 'places', DEFAULT_HUMAN_PARAMS);
  const before0 = g0.realmOf.slice();
  const spot = (() => {
    for (let i = 0; i < W * H; i++) {
      if (w.elevation[i] > 0 && g0.realmOf[i] === 0) {
        const x = i % W, y = (i / W) | 0;
        if (x > 2 && x < W - 3 && y > 2 && y < H - 3) return { x, y };
      }
    }
    return { x: (W * 0.5) | 0, y: (H * 0.5) | 0 };
  })();
  const tgt = g0.realms.length > 1 ? 1 : 0;

  // Exactly what a committed stroke does: the applied overlay onto the world,
  // and the revision counter bumped.
  w.painted = applyEdits(w, [
    // Big enough to contain towns. At 4 000 cells this fill held none on the
    // harness seed, so "the flags moved with the ground" was a check that could
    // not fail.
    { kind: 'realmFill', realm: tgt, x: spot.x, y: spot.y, bounded: 'coast', maxCells: 40000 },
  ]);
  w.revision = (w.revision ?? 0) + 1;

  const flagsBefore = g0.settlements.map((s) => s.realm);
  const t0 = Date.now();
  const g1 = getGeography(w, 'places', DEFAULT_HUMAN_PARAMS);
  const ms = Date.now() - t0;
  let changed = 0;
  for (let i = 0; i < W * H; i++) if (g1.realmOf[i] !== before0[i]) changed++;
  console.log(`   parche en ${ms} ms · ${changed} celdas cambiaron de dueño`);
  check(changed > 0, 'la frontera pintada llega a la vista SIN pasada completa',
    `${changed} celdas · reino → ${tgt}`);
  check(g1.realmOf !== g0.realmOf,
    'y sobre un array nuevo, que es la señal de que hay que rehacer línea y tinte',
    g1.realmOf !== g0.realmOf ? 'identidad distinta' : 'MISMO array: las cachés no se enteran');
  check(ms < 120, 'a un coste que cabe entre soltar el pincel y mirar', `${ms} ms`);

  const s1 = realmBorders(w, g1);
  const s0 = realmBorders({ width: W, height: H }, g0);
  check(s1.count !== s0.count, 'la línea se ha vuelto a extraer',
    `${s0.count} → ${s1.count} segmentos`);

  let wet = 0;
  for (let i = 0; i < W * H; i++) if (w.elevation[i] <= 0 && g1.realmOf[i] >= 0) wet++;
  check(wet === 0, 'y la vía barata tampoco reclama mar', `${wet} celdas`);

  // Snapshotted BEFORE the patch: `patchGeography` used to hand back the base's
  // own Settlement objects, so `g0.settlements[k].realm` was mutated under us
  // and this comparison could only ever read zero — it compared an object with
  // itself. The flags have to be copied out while they still say what the
  // generator said.
  const moved = g1.settlements.filter((s, k) => s.realm !== flagsBefore[k]).length;
  console.log(`   ${moved} poblaciones cambiaron de bandera con el suelo`);
  check(moved > 0, 'las poblaciones del suelo cedido cambian de bandera en la vía barata',
    `${moved} de ${flagsBefore.length}`);

  /**
   * AND DESHACER LO DEVUELVE TODO.
   *
   * The half nobody checks. An overlay that reaches the view but cannot be
   * lifted back out is worse than one that never arrived: the reader presses
   * Ctrl+Z, the border springs back, and the towns keep flying the flag of a
   * country that no longer claims them — in the hover readout, in the gazetteer
   * and in the atlas — until a nineteen-second rebuild that is itself
   * suppressed for as long as a brush is in their hand.
   */
  const countsBefore = g0.realms.map((r) => r.cellCount);
  w.painted = applyEdits(w, []);
  w.revision = (w.revision ?? 0) + 1;
  const g2 = getGeography(w, 'places', DEFAULT_HUMAN_PARAMS);
  let back = 0;
  for (let i = 0; i < W * H; i++) if (g2.realmOf[i] !== before0[i]) back++;
  check(back === 0, 'deshacer devuelve el suelo a su dueño', `${back} celdas siguen cambiadas`);
  const stillFlagged = g2.settlements.filter((s, k) => s.realm !== flagsBefore[k]).length;
  check(stillFlagged === 0, 'y las poblaciones devuelven la bandera con él',
    `${stillFlagged} siguen con la bandera del reino borrado`);
  const countsBack = g2.realms.map((r) => r.cellCount);
  const wrongCount = countsBack.filter((c, k) => c !== countsBefore[k]).length;
  check(wrongCount === 0, 'y el recuento de celdas por reino vuelve a ser el del generador',
    wrongCount ? `${countsBack.join(',')} en vez de ${countsBefore.join(',')}` : 'idéntico');

  // An unpainted world must keep handing back the SAME array, or every stroke
  // on every world pays a border re-extraction and a tint rebuild for nothing.
  const clean = getWorld({ seed: `${seed}-limpio`, width: 256 });
  const c0 = getGeography(clean, 'places', DEFAULT_HUMAN_PARAMS);
  clean.revision = (clean.revision ?? 0) + 1;
  const c1 = getGeography(clean, 'places', DEFAULT_HUMAN_PARAMS);
  check(c1.realmOf === c0.realmOf,
    'un mundo que nadie ha pintado no paga nada por esto',
    c1.realmOf === c0.realmOf ? 'mismo array, cachés intactas' : 'array nuevo: coste inventado');
}

console.log(`\n${fails === 0 ? 'TODO EN VERDE' : `${fails} COMPROBACIONES EN ROJO`}`);
process.exit(fails === 0 ? 0 : 1);
