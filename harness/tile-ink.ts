// ============================================================================
// BANCO DE ENTINTADO GOOGLE-MAPS (¿la tesela DIBUJA la ciudad y los caminos?)
// ============================================================================
// Luis, 2026-08-13: «Tiene que ser literalmente un google maps. deberías poder
// acercarte y ver caminos y la propia ciudad en el mapa. No solo si la
// pinchas.» Su z12 enseñaba verde plano — pero era el RASTER del mundo de
// respaldo (las teselas nunca llegaban, la fila india del pool). Este banco
// separa las dos preguntas: entregadas las teselas, ¿se VEN la ciudad y los
// caminos? Se mide por DIFERENCIA de píxeles, sin adivinar colores:
//   · misma tesela con y sin capa de caminos  → los caminos entintan
//   · misma tesela con mundo habitado y desnudo → la ciudad entinta
// a z10 / z12 / z14 / z16 sobre la capital, con el plano de calles exigido
// donde su umbral promete (≤5 m/px, PLAN_MAX_METRES_PER_PX).
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { applyEdits } from '../src/engines/worldgen/core/edits';
import {
  renderSatelliteDeepTile, satelliteDeepSupported, satPxPerCanonCell,
} from '../src/engines/worldgen/region/satelliteTile';
import { makeCanonCache } from '../src/engines/worldgen/region/deepTile';
import { canonMetresPerCell, tileCountX as canonCountX } from '../src/engines/worldgen/region/tiles';
import { TILE_PX, tileCountX } from '../src/engines/worldgen/cartography/tiles';
import type { HumanGeography } from '../src/engines/worldgen/core/settlements';
import type { WorldData } from '../src/engines/worldgen/core/types';
import { cityInk } from '../src/engines/worldgen/city/render';

void canonCountX;

const w = getWorld({ seed: 'banco-tinta', width: 256 });
// El grifo abierto: este banco mide el ENTINTADO de un mundo habitado.
applyEdits(w, [{ kind: 'placesEverywhere', enabled: true }]);
const gCon = getGeography(w, 'full');
const cap = [...gCon.settlements].sort((a, b) => b.population - a.population)[0];
console.log(`capital "${cap.name}" en (${cap.x},${cap.y}) · pob ${cap.population}`
  + ` · caminos del mundo: ${gCon.roads.length}`);

// El mundo desnudo, PARA COMPARAR: mismo suelo, sin humanidad generada.
// `getWorld` desempaqueta del disco un objeto NUEVO por llamada, así que éste
// no lleva el grifo del de arriba. El cierre es EXPLÍCITO desde el
// 2026-08-13: la ausencia de edición significa LEGADO (abierto) — el asiento
// `false` es como nacen los mundos nuevos.
const wSin = getWorld({ seed: 'banco-tinta', width: 256 });
applyEdits(wSin, [{ kind: 'placesEverywhere', enabled: false }]);
const gSin = getGeography(wSin, 'full');
console.log(`desnudo: ${gSin.settlements.length} ciudades · ${gSin.roads.length} caminos`
  + ` (deben ser 0 y 0)`);

function renderTile(
  world: WorldData, geo: HumanGeography, z: number, tx: number, ty: number,
  roads: boolean, cache = makeCanonCache(),
): Uint8ClampedArray {
  const canvas = createCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  renderSatelliteDeepTile(world, geo, cache, ctx, { z, tx, ty }, {
    layers: { rivers: true, roads, fields: true },
    density: 1,
  }, { cap: 8, bytes: 512 * 1024 * 1024 });
  return ctx.getImageData(0, 0, TILE_PX, TILE_PX).data as unknown as Uint8ClampedArray;
}

function diffPx(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++;
  }
  return n;
}

const groundHex = cityInk().ground;
const groundRgb = [1, 3, 5].map((i) => Number.parseInt(groundHex.slice(i, i + 2), 16));
function opaqueGroundPx(city: Uint8ClampedArray, bare: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < city.length; i += 4) {
    const nearGround = Math.abs(city[i] - groundRgb[0]) + Math.abs(city[i + 1] - groundRgb[1])
      + Math.abs(city[i + 2] - groundRgb[2]) < 18;
    const changed = Math.abs(city[i] - bare[i]) + Math.abs(city[i + 1] - bare[i + 1])
      + Math.abs(city[i + 2] - bare[i + 2]) > 24;
    if (nearGround && changed) n++;
  }
  return n;
}

let rojo = false;
const di = (que: string, ok: boolean, detalle: string) => {
  console.log(`${que}: ${ok ? 'sí' : `NO — ${detalle}`}`);
  if (!ok) rojo = true;
};

// Cachés de canon por mundo, compartidas entre niveles: la supertesela bajo la
// capital se genera UNA vez por mundo y todos los z componen de ella.
const cacheCon = makeCanonCache();
const cacheSin = makeCanonCache();

// EL CAMINO SE MIDE EN CAMPO ABIERTO, no en el casco urbano: la primera
// versión de este banco apuntaba a la tesela de la capital y daba «caminos
// 0px» con las calzadas perfectamente entintadas — la mancha urbana y los
// tejados pintan ENCIMA en las dos pasadas y la diferencia se anula. El punto
// de medida es el centro de la calzada más larga, lejos del caserío.
const roadRef = [...gCon.roads].sort((a, b) => b.cells.length - a.cells.length)[0];
const midCell = roadRef.cells[Math.floor(roadRef.cells.length / 2)];
const roadX = midCell % w.width, roadY = Math.floor(midCell / w.width);
console.log(`punto de calzada: (${roadX},${roadY})`);

for (const z of [10, 12, 14, 16]) {
  if (!satelliteDeepSupported(w, z)) { console.log(`z${z}: sin soporte hondo (¡revisar!)`); rojo = true; continue; }
  const cells = w.width / tileCountX(z);
  const mPx = canonMetresPerCell(w) / satPxPerCanonCell(w, z);

  const rtx = Math.floor(roadX / cells), rty = Math.floor(roadY / cells);
  const conCaminos = renderTile(w, gCon, z, rtx, rty, true, cacheCon);
  const sinCaminos = renderTile(w, gCon, z, rtx, rty, false, cacheCon);
  const caminosPx = diffPx(conCaminos, sinCaminos);

  // The visible marker, roads, regional habitation and town plan all share the
  // centre of the settlement's world cell. The old bank asked for raw `cap.x`
  // and therefore proved there was a city several kilometres away from its dot.
  const tx = Math.floor((cap.x + 0.5) / cells), ty = Math.floor((cap.y + 0.5) / cells);
  const ciudad = renderTile(w, gCon, z, tx, ty, true, cacheCon);
  const desnuda = renderTile(wSin, gSin, z, tx, ty, true, cacheSin);
  const ciudadPx = diffPx(ciudad, desnuda);
  const sueloOpacoPx = opaqueGroundPx(ciudad, desnuda);

  console.log(`z${z} (${mPx.toFixed(1)} m/px) · calzada ${rtx},${rty} ${caminosPx}px`
    + ` · ciudad ${tx},${ty} ${ciudadPx}px · suelo claro opaco ${sueloOpacoPx}px`);
  // La vara: desde el primer nivel hondo los caminos se VEN (≥40 px de una
  // tesela de 65.536) y la ciudad deja huella (≥150 px: mancha urbana, tejados
  // o plano según el nivel). En el nivel del plano (≤5 m/px) la ciudad debe
  // ser una presencia grande (≥1000 px).
  di(`z${z} · los caminos entintan`, caminosPx >= 40, `${caminosPx}px`);
  di(`z${z} · la ciudad entinta`, ciudadPx >= 150, `${ciudadPx}px`);
  if (mPx <= 5) {
    di(`z${z} · plano de calles presente`, ciudadPx >= 1000, `${ciudadPx}px`);
    di(`z${z} · el plano no tapa el terreno con pergamino`,
      sueloOpacoPx <= Math.max(80, ciudadPx * 0.08), `${sueloOpacoPx}/${ciudadPx}px`);
  }
}

process.exit(rojo ? 1 : 0);
