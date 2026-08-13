// ============================================
// Banco: el convenio de la máscara del pincel (B6, raíz)
// ============================================
// Tres contratos, tras pasar `stampDisc` de medir índices a medir CENTROS:
//   1. CENTRADO — el centroide del suelo entintado cae en el puntero (antes:
//      +0,500, +0,500 exactas — la media celda al sur-este de B6).
//   2. MIGRACIÓN — una lista v1 (array pelado) deserializa con sus puntos
//      +0,5, y su suelo entintado queda EXACTAMENTE donde estaba: centroide
//      en p+0,5, que es donde la fórmula vieja lo puso y el lector lo vio.
//   3. COHESIÓN DE ESCALAS — el mismo trazo rasterizado en la malla del mundo
//      y en una malla 8× más fina (el canon) entinta el mismo suelo físico;
//      con el convenio viejo divergían media celda DE CADA malla.

import { strokeMask, tipOf } from '../src/engines/worldgen/sculpt/ops';
import { serializeEdits, deserializeEdits, type WorldEdit, type Stroke } from '../src/engines/worldgen/core/edits';

const W = 256, H = 256;
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

function centroid(stroke: Stroke, w = W, h = H): { x: number; y: number; cells: number } {
  const m = strokeMask(stroke, w, h, false);
  if (!m) return { x: NaN, y: NaN, cells: 0 };
  let sx = 0, sy = 0, sw = 0, n = 0;
  m.each((i, c) => {
    const gx = i % w, gy = Math.floor(i / w);
    // El suelo de la celda k está centrado en k+0,5: el centroide se mide en
    // el espacio CONTINUO, que es el que comparte con el puntero.
    sx += (gx + 0.5) * c; sy += (gy + 0.5) * c; sw += c; n++;
  });
  return { x: sx / sw, y: sy / sw, cells: n };
}

// ---- 1. centrado ----------------------------------------------------------
console.log('— centrado (puntero en el centro exacto de una celda) —');
for (const r of [1, 2, 4, 9, 25]) {
  const p = { x: 128.5, y: 128.5 };
  const c = centroid({ pts: [p], radius: r, strength: 1, softness: 0.6 });
  const dx = c.x - p.x, dy = c.y - p.y;
  check(`radio ${r}`, Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05,
    `centroide (${dx >= 0 ? '+' : ''}${dx.toFixed(3)}, ${dy >= 0 ? '+' : ''}${dy.toFixed(3)}), ${c.cells} celdas`);
}
console.log('— centrado (punto cualquiera dentro de la celda) —');
for (const [px, py] of [[100.13, 90.87], [77.71, 140.29], [130.5, 60.0]]) {
  const c = centroid({ pts: [{ x: px, y: py }], radius: 6, strength: 1, softness: 0.6 });
  const dx = c.x - px, dy = c.y - py;
  // La cuantización del borde deja ±0,3 como en la medición vieja de B6 —
  // pero centrada en CERO, no en +0,5.
  check(`punto (${px},${py})`, Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35,
    `centroide (${dx >= 0 ? '+' : ''}${dx.toFixed(3)}, ${dy >= 0 ? '+' : ''}${dy.toFixed(3)})`);
}

// ---- 2. migración v1 ------------------------------------------------------
console.log('— migración v1 → v2 —');
const v1pts = [{ x: 80.25, y: 120.75 }, { x: 84.5, y: 118.25 }];
const v1json = JSON.stringify([
  { kind: 'terrain', op: 'raise', stroke: { pts: v1pts, radius: 5, strength: 0.7, softness: 0.5 } },
  { kind: 'river', pts: v1pts, width: 2 },
]);
const migrated = deserializeEdits(v1json);
const mStroke = (migrated[0] as WorldEdit & { stroke: Stroke }).stroke;
check('puntos de trazo +0,5', mStroke.pts.every((p, i) =>
  p.x === v1pts[i].x + 0.5 && p.y === v1pts[i].y + 0.5),
`(${mStroke.pts[0].x}, ${mStroke.pts[0].y})`);
const mRiver = migrated[1] as { pts: { x: number; y: number }[] };
check('puntos de río intactos (geometría de curva)', mRiver.pts.every((p, i) =>
  p.x === v1pts[i].x && p.y === v1pts[i].y),
`(${mRiver.pts[0].x}, ${mRiver.pts[0].y})`);
// El suelo del trazo migrado: centroide en p+0,5 — donde la fórmula vieja lo
// entintó (B6 lo midió) y por tanto donde el mundo guardado lo tiene.
const cm = centroid(mStroke);
const mid = { x: (v1pts[0].x + v1pts[1].x) / 2, y: (v1pts[0].y + v1pts[1].y) / 2 };
check('el suelo no se mueve', Math.abs(cm.x - (mid.x + 0.5)) < 0.35 && Math.abs(cm.y - (mid.y + 0.5)) < 0.35,
  `centroide (${cm.x.toFixed(2)}, ${cm.y.toFixed(2)}) ≈ viejo (${(mid.x + 0.5).toFixed(2)}, ${(mid.y + 0.5).toFixed(2)})`);
// Ida y vuelta v2: serializar y deserializar es la identidad.
const v2json = serializeEdits(migrated);
check('v2 lleva versión', v2json.startsWith('{"v":2'), v2json.slice(0, 20));
const roundTrip = deserializeEdits(v2json);
const rtStroke = (roundTrip[0] as WorldEdit & { stroke: Stroke }).stroke;
check('v2 ida y vuelta identidad', rtStroke.pts.every((p, i) =>
  p.x === mStroke.pts[i].x && p.y === mStroke.pts[i].y), 'puntos intactos');
check('v1 vacío y basura', deserializeEdits('[]').length === 0 && deserializeEdits('no json').length === 0
  && deserializeEdits('{"x":1}').length === 0, 'las tres ramas devuelven []');

// ---- 3. cohesión mundo ↔ canon -------------------------------------------
console.log('— el mismo trazo en dos mallas (mundo 1×, canon 8×) —');
for (const tipKind of ['disc', 'square', 'ridge'] as const) {
  const stroke: Stroke = {
    pts: [{ x: 100.3, y: 100.6 }, { x: 108.7, y: 96.2 }],
    radius: 4, strength: 1, softness: 0.5,
    ...(tipKind === 'square' ? { tip: 'square' as const, tipAngle: 0.4 }
      : tipKind === 'ridge' ? { tip: 'ridge' as const, tipAspect: 2.2, tipAngle: 0.4 } : {}),
  };
  void tipOf(stroke); // el mismo resolutor que usa la máscara
  const cWorld = centroid(stroke);
  const K = 8;
  const fine: Stroke = {
    ...stroke,
    pts: stroke.pts.map((p) => ({ x: p.x * K, y: p.y * K })),
    radius: stroke.radius * K,
  };
  const cFine = centroid(fine, W * K, H * K);
  const dx = cFine.x / K - cWorld.x, dy = cFine.y / K - cWorld.y;
  // Con el convenio viejo esto daba ~(−0,44, −0,44): media celda de mundo
  // menos media celda fina. Ahora las dos mallas entintan el mismo suelo.
  check(`punta ${tipKind}`, Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1,
    `divergencia (${dx.toFixed(3)}, ${dy.toFixed(3)}) celdas de mundo`);
}

console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
if (failures) process.exit(1);
