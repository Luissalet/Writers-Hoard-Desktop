// ============================================================================
// SONDA VISUAL: el relleno de la piel de cerca del 3D, EN FRÍO
// ============================================================================
// «Coloca las ciudades» (Luis, 2026-08-11). Bajo el contrato consume, un canon
// frío declina todas las teselas hondas: lo que se ve en el suelo del 3D es
// EXACTAMENTE este relleno — albedo ampliado + ríos a anchura de suelo +
// mancha urbana + caminos. Esta sonda compone ese relleno con las mismas
// rutinas y los mismos parámetros que `composeZoomSkin`, a tres distancias,
// y escribe los PNG para MIRARLOS (lección #31). Además demuestra la costura:
// la misma ventana expresada una copia a la izquierda tiene que dar la misma
// imagen byte a byte.
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { renderBase } from '../src/engines/worldgen/core/render';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { drawWorldRivers } from '../src/engines/worldgen/region/satelliteTile';
import { drawTownStains } from '../src/engines/worldgen/cartography/townStains';
import { drawRoadNetwork } from '../src/engines/worldgen/cartography/roadOverlay';
import { EARTH_KM } from '../src/engines/worldgen/core/camera';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'consume-probe', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);
const W = world.width, H = world.height;
const metresPerCell = (EARTH_KM / W) * 1000;

// El pueblo más gordo DE LOS QUE ESTÁN EN LA RED: la capital de este mundo
// resultó ser una isla sin camino a 69 celdas del asfalto más cercano, y una
// sonda de caminos centrada ahí no sondea nada. Los extremos de cada camino
// son los pueblos que conecta.
const ends = new Set<number>();
for (const r of geography.roads) {
  if (r.cells.length) { ends.add(r.cells[0]); ends.add(r.cells[r.cells.length - 1]); }
}
const RANK_ORDER: Record<string, number> = { capital: 0, city: 1, town: 2, village: 3 };
const connected = geography.settlements
  .filter((s) => ends.has(Math.round(s.y) * W + Math.round(s.x)))
  .sort((a, b) => (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9));
const town = connected[0] ?? geography.settlements[0];
console.log(`pueblo: ${town.name} (${town.rank}) en (${town.x},${town.y}) · ${Math.round(metresPerCell)} m/celda · ${connected.length} pueblos en red`);

// El albedo satélite del 3D, tal cual lo arma World3D: base sin ríos.
const rgba = renderBase(world, 'atlas', { shade: false });
const albedo = createCanvas(W, H);
albedo.getContext('2d').putImageData(new NapiImageData(rgba, W, H), 0, 0);

interface View { x: number; y: number; w: number; h: number }

/** El relleno de `composeZoomSkin`, paso a paso y con los mismos números. */
function composeFill(view: View, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // 1. El suelo, por trozos a través de la costura.
  let x = view.x;
  const end = view.x + view.w;
  while (x < end - 1e-6) {
    const wrapped = ((x % W) + W) % W;
    const run = Math.min(end - x, W - wrapped);
    ctx.drawImage(
      albedo as never,
      wrapped, view.y, run, view.h,
      ((x - view.x) / view.w) * width, 0, (run / view.w) * width, height,
    );
    x += run;
  }
  // 1b. Los ríos, a anchura de suelo.
  drawWorldRivers(world, ctx, view, width);
  // 2b. Las manchas urbanas.
  const stains = drawTownStains(ctx, geography.settlements, {
    worldWidth: W, worldHeight: H, view, width, height, metresPerCell,
  });
  // 2c. Los caminos, por copias este–oeste (el mismo bucle que el compose).
  const s = width / view.w;
  let roads = 0;
  const k0 = Math.floor(view.x / W);
  const k1 = Math.floor((view.x + view.w) / W);
  for (let k = k0; k <= k1; k++) {
    const ox = (k * W - view.x) * s;
    const oy = -view.y * s;
    const r = drawRoadNetwork(ctx, geography.roads, {
      worldWidth: W, worldHeight: H,
      toScreen: (u, v) => [ox + u * W * s, oy + v * H * s],
      width, height, pxPerCell: s, alpha: 1,
      linear: { ox, oy, scale: s },
    });
    roads += r.drawn;
  }
  return { canvas, stains, roads };
}

const PX = 768;
// Tres distancias del hueco frío: lejos (300 m/px ≈ plan z9), media (75 ≈ z11)
// y cerca (19 ≈ z13-z14, el fondo de la rueda con MIN_3D_SPAN_KM=25).
for (const [label, mPerPx] of [['far', 300], ['mid', 75], ['near', 19]] as const) {
  const vw = (mPerPx * PX) / metresPerCell;
  const view = {
    x: town.x + 0.5 - vw / 2,
    y: Math.max(0, Math.min(H - vw, town.y + 0.5 - vw / 2)),
    w: vw, h: vw,
  };
  const { canvas, stains, roads } = composeFill(view, PX, PX);
  writeFileSync(`/tmp/fill-${label}.png`, canvas.toBuffer('image/png'));
  console.log(`${label} (${mPerPx} m/px, ${vw.toFixed(3)} celdas): ${stains} manchas · ${roads} trazos de camino`);
}

// LA COSTURA: la misma ventana, una vuelta entera a la izquierda. Byte a byte.
{
  const mPerPx = 300;
  const vw = (mPerPx * PX) / metresPerCell;
  const view = {
    x: town.x + 0.5 - vw / 2,
    y: Math.max(0, Math.min(H - vw, town.y + 0.5 - vw / 2)),
    w: vw, h: vw,
  };
  const a = composeFill(view, PX, PX);
  const b = composeFill({ ...view, x: view.x - W }, PX, PX);
  const da = a.canvas.getContext('2d').getImageData(0, 0, PX, PX).data;
  const db = b.canvas.getContext('2d').getImageData(0, 0, PX, PX).data;
  let diff = 0;
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
  console.log(`costura: ${diff === 0 ? 'IDÉNTICA byte a byte' : `${diff} bytes distintos — MAL`} (manchas ${a.stains}/${b.stains}, caminos ${a.roads}/${b.roads})`);
  if (diff !== 0) process.exitCode = 1;
}
console.log('escritos /tmp/fill-far.png /tmp/fill-mid.png /tmp/fill-near.png');
