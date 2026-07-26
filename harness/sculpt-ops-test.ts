// The one thing the sculpt view must never get wrong.
//
// While you drag, you are looking at a preview. When you let go, the stroke is
// committed as an edit and the world is rebuilt by replaying the edit list from
// the seed. If those two disagree, the terrain jumps at the moment you release
// the button — and it did, for `flatten`, which levelled to the mean of the whole
// stroke on replay and to a 3×3 neighbourhood while you drew it.
//
// So: for every op, sculpt a stroke the way the view does (point by point, with
// the preview restored and re-applied on each move) and compare the result cell
// for cell against `applyEdits`. They now share one implementation, so this is
// less a test of the arithmetic than a test that nothing has grown a second path.
import { getWorld } from './world-cache';
import { applyEdits, type TerrainOp, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { SculptGesture } from '../src/engines/worldgen/sculpt/ops';

const seed = 'monstruo';
const OPS: TerrainOp[] = ['raise', 'lower', 'smooth', 'flatten', 'roughen', 'sharpen', 'terrace', 'gully', 'grab'];

// A stroke with a corner in it, over ground that has both coast and mountain, so
// every op has something to bite on.
const PTS = [
  { x: 300, y: 240 }, { x: 306, y: 243 }, { x: 313, y: 244 }, { x: 319, y: 249 },
  { x: 324, y: 256 }, { x: 327, y: 264 }, { x: 326, y: 272 }, { x: 321, y: 278 },
];
const RADIUS = 11;
const STRENGTH = 0.8;
const SOFTNESS = 0.55;

let worst = 0;
let failures = 0;
console.log(`${'pincel'.padEnd(9)} ${'celdas'.padStart(7)} ${'Δ máx km'.padStart(10)} ${'≠ vivo/guardado'.padStart(16)}  veredicto`);

for (const op of OPS) {
  // ---- the committed path ------------------------------------------------
  const wa = getWorld({ seed, width: 1024 });
  const stroke = { pts: PTS, radius: RADIUS, strength: STRENGTH, softness: SOFTNESS };
  const edit: WorldEdit = { kind: 'terrain', op, stroke };
  const pristine = Float32Array.from(wa.elevation);
  applyEdits(wa, [edit]);
  const committed = Float32Array.from(wa.elevation);

  // ---- the live path, exactly as the view drives it ----------------------
  const wb = getWorld({ seed, width: 1024 });
  wb.elevation.set(pristine);
  const live = new SculptGesture(wb.elevation, wb.width, wb.height, seed, {
    kind: 'terrain', op, radius: RADIUS, strength: STRENGTH, softness: SOFTNESS,
  });
  for (const p of PTS) live.extend(p);

  let changed = 0, maxDelta = 0, differ = 0, maxDiffer = 0;
  for (let i = 0; i < pristine.length; i++) {
    const d = Math.abs(committed[i] - pristine[i]);
    if (d > 1e-9) { changed++; if (d > maxDelta) maxDelta = d; }
    const q = Math.abs(committed[i] - wb.elevation[i]);
    if (q > 1e-6) { differ++; if (q > maxDiffer) maxDiffer = q; }
  }
  worst = Math.max(worst, maxDiffer);
  const ok = differ === 0 && changed > 0;
  if (!ok) failures++;
  console.log(
    `${op.padEnd(9)} ${String(changed).padStart(7)} ${maxDelta.toFixed(4).padStart(10)} `
    + `${String(differ).padStart(16)}  ${ok ? '·' : '✗'}`
    + (differ ? ` (peor ${maxDiffer.toFixed(6)} km)` : '')
    + (changed === 0 ? ' (no cambió nada)' : ''),
  );
}

// ---- rollback puts everything back -----------------------------------------
{
  const w = getWorld({ seed, width: 1024 });
  const before = Float32Array.from(w.elevation);
  const s = new SculptGesture(w.elevation, w.width, w.height, seed,
    { kind: 'terrain', op: 'raise', radius: 14, strength: 1, softness: 0.5 });
  for (const p of PTS) s.extend(p);
  s.rollback();
  let bad = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== w.elevation[i]) bad++;
  console.log(`\n${bad === 0 ? '·' : '✗'} deshacer la vista previa deja el mundo intacto (${bad} celdas distintas)`);
  if (bad) failures++;
}

// ---- the coast brush too ----------------------------------------------------
{
  const wa = getWorld({ seed, width: 1024 });
  const pristine = Float32Array.from(wa.elevation);
  const stroke = { pts: PTS, radius: RADIUS, strength: 0.9, softness: 0.5 };
  applyEdits(wa, [{ kind: 'land', op: 'sea', stroke }]);
  const wb = getWorld({ seed, width: 1024 });
  wb.elevation.set(pristine);
  const live = new SculptGesture(wb.elevation, wb.width, wb.height, seed,
    { kind: 'land', op: 'sea', radius: RADIUS, strength: 0.9, softness: 0.5 });
  for (const p of PTS) live.extend(p);
  let differ = 0;
  for (let i = 0; i < pristine.length; i++) if (Math.abs(wa.elevation[i] - wb.elevation[i]) > 1e-6) differ++;
  console.log(`${differ === 0 ? '·' : '✗'} el pincel de costa coincide vivo y guardado (${differ} celdas distintas)`);
  if (differ) failures++;
}

// ---- falloff curves change the shape and nothing else ----------------------
{
  const areas: Record<string, number> = {};
  for (const curve of ['smooth', 'sharp', 'linear', 'flat'] as const) {
    const w = getWorld({ seed, width: 1024 });
    const before = Float32Array.from(w.elevation);
    applyEdits(w, [{ kind: 'terrain', op: 'raise', stroke: { pts: [{ x: 300, y: 240 }], radius: 12, strength: 1, softness: 0.8, curve } }]);
    let sum = 0;
    for (let i = 0; i < before.length; i++) sum += w.elevation[i] - before[i];
    areas[curve] = sum;
  }
  // A flat brush lifts a whole disc, a sharp one only its middle: the ordering is
  // the property, not the numbers.
  const ordered = areas.flat > areas.linear && areas.linear > areas.smooth * 0.6 && areas.smooth > areas.sharp;
  console.log(`${ordered ? '·' : '✗'} las curvas de borde ordenan el volumen: `
    + `plano ${areas.flat.toFixed(1)} > lineal ${areas.linear.toFixed(1)} · suave ${areas.smooth.toFixed(1)} > agudo ${areas.sharp.toFixed(1)}`);
  if (!ordered) failures++;
}

// ---- grab drags the ground through the brush --------------------------------
//
// Grab is elastic, not a rigid translation: the rim of the disc is pinned and the
// centre travels the whole way, so the ground stretches. The property to check is
// therefore what arrives AT THE CENTRE — it must be the ground that used to be one
// displacement back — and that nothing outside the disc moved at all.
{
  const w = getWorld({ seed, width: 1024 });
  const before = Float32Array.from(w.elevation);
  const R = 16;
  const a = { x: 300, y: 240 }, b = { x: a.x + 8, y: a.y + 4 };
  applyEdits(w, [{ kind: 'terrain', op: 'grab', stroke: { pts: [a, b], radius: R, strength: 1, softness: 0.5 } }]);
  const at = (arr: Float32Array, x: number, y: number) => arr[Math.round(y) * w.width + Math.round(x)];
  const source = at(before, a.x - (b.x - a.x), a.y - (b.y - a.y));
  const arrived = at(w.elevation, a.x, a.y);
  const wasThere = at(before, a.x, a.y);
  const carried = Math.abs(arrived - source) < Math.abs(arrived - wasThere);

  let outside = 0;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (Math.hypot(x - a.x, y - a.y) <= R + 1.5) continue;
      if (before[y * w.width + x] !== w.elevation[y * w.width + x]) outside++;
    }
  }
  const ok = carried && outside === 0;
  console.log(`${ok ? '·' : '✗'} agarrar arrastra el suelo a través del pincel `
    + `(en el centro llega ${arrived.toFixed(4)}, venía de ${source.toFixed(4)}, allí había ${wasThere.toFixed(4)}; `
    + `${outside} celdas fuera del disco alteradas)`);
  if (!ok) failures++;
}

// ---- symmetry, including where the stroke crosses its own mirror ------------
//
// The hard case, and the reason the gesture restores and re-runs every arm in
// order: a stroke that crosses the mirror line paints ground its own reflection
// also paints, and the second arm must read what the first one wrote. A preview
// that applied both arms against the same starting field would show one of them
// overwriting the other, and the world would change under the reader's hand the
// moment they let go.
for (const [label, mx, my, seedX] of [
  ['espejo E–O', true, false, 512],
  ['espejo N–S', false, true, 300],
  ['los dos', true, true, 512],
] as const) {
  const w = getWorld({ seed, width: 1024 });
  const pristine = Float32Array.from(w.elevation);
  // Deliberately straddling the meridian at x = W/2 so the arms overlap.
  const path = [-14, -8, -3, 2, 7, 13].map((d) => ({ x: seedX + d, y: 250 + d * 0.4 }));

  const g = new SculptGesture(w.elevation, w.width, w.height, seed, {
    kind: 'terrain', op: 'raise', radius: 18, strength: 0.9, softness: 0.6,
    mirrorX: mx, mirrorY: my,
  });
  for (const p of path) g.extend(p);
  const previewed = Float32Array.from(w.elevation);
  const edits = g.edits();
  g.rollback();

  const wb = getWorld({ seed, width: 1024 });
  wb.elevation.set(pristine);
  applyEdits(wb, edits.map((e) => (e.kind === 'land'
    ? { kind: 'land' as const, op: e.op as 'land' | 'sea', stroke: e.stroke }
    : { kind: 'terrain' as const, op: e.op as TerrainOp, stroke: e.stroke })));

  let differ = 0, maxq = 0, touched = 0;
  for (let i = 0; i < pristine.length; i++) {
    if (Math.abs(wb.elevation[i] - pristine[i]) > 1e-9) touched++;
    const q = Math.abs(previewed[i] - wb.elevation[i]);
    if (q > 1e-6) { differ++; if (q > maxq) maxq = q; }
  }
  const ok = differ === 0 && edits.length === (mx ? 2 : 1) * (my ? 2 : 1) && touched > 0;
  console.log(`${ok ? '·' : '✗'} ${label}: ${edits.length} ediciones, ${touched} celdas, `
    + `${differ} distintas entre vista previa y mundo guardado`
    + (differ ? ` (peor ${maxq.toFixed(6)} km)` : ''));
  if (!ok) failures++;
}

// ---- what a stroke costs the CPU --------------------------------------------
//
// The only performance number this machine can produce honestly. The GPU here is a
// software rasteriser, so nothing measured through the browser transfers; what DOES
// transfer is the work the brush does per pointer move, because that happens on the
// main thread and it is the thing that decides whether the ground moves under your
// hand or a moment later. A pointer move that costs more than about eight
// milliseconds will be felt.
{
  const w = getWorld({ seed, width: 2048 });
  console.log(`\ncoste por movimiento del puntero (mundo ${w.width}×${w.height}, en este contenedor):`);
  console.log(`${'pincel'.padEnd(9)} ${'r=8'.padStart(9)} ${'r=24'.padStart(9)} ${'r=60'.padStart(9)}`);
  for (const op of ['raise', 'smooth', 'gully', 'grab', 'flatten'] as TerrainOp[]) {
    const cells: string[] = [];
    for (const radius of [8, 24, 60]) {
      const before = Float32Array.from(w.elevation);
      const g = new SculptGesture(w.elevation, w.width, w.height, seed,
        { kind: 'terrain', op, radius, strength: 0.8, softness: 0.6 });
      // A long stroke: the cost grows with the stroke, so the number that matters
      // is the LAST move, not the first.
      const N = 120;
      const times: number[] = [];
      for (let k = 0; k < N; k++) {
        const t0 = performance.now();
        g.extend({ x: 400 + k * 3, y: 500 + Math.sin(k / 9) * 40 });
        times.push(performance.now() - t0);
      }
      g.rollback();
      w.elevation.set(before);
      cells.push(`${times[N - 1].toFixed(1)} ms`);
    }
    console.log(`${op.padEnd(9)} ${cells.map((c) => c.padStart(9)).join(' ')}`);
  }
  console.log('(el último movimiento de un trazo de 120 puntos, que es el más caro)');
}

console.log(`\n${failures === 0
  ? `Todo coincide. La mayor diferencia entre vista previa y mundo guardado es ${worst.toExponential(1)} km.`
  : `${failures} comprobaciones fallan.`}`);
