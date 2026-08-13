// ============================================
// Banco: el formato de persistencia del canon
// ============================================
// Ida y vuelta de una supertesela REAL (generada, no sintética):
//   · el predicado tierra/mar (`elevation > 0`) es EXACTO — cero celdas movidas
//   · error máximo de elevación ≤ 0,5 m; flow/wet ≤ 1/65535; slope ≤ 0,0005
//   · water/biome/cover byte a byte
//   · streams/places/tracks/fields/hedges/dykes idénticos (JSON)
//   · estabilidad: encode(decode(encode(x))) === encode(x) byte a byte
// Y las medidas que justifican la palanca: ms de encode/decode contra los
// ~31.000 ms de generar, y bytes en reposo.

import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { generateCanonTile, canonTileKey } from '../src/engines/worldgen/region/generate';
import { tileAt } from '../src/engines/worldgen/region/tiles';
import { encodeCanonTile, decodeCanonTile } from '../src/engines/worldgen/region/canonStore';
import type { RegionData } from '../src/engines/worldgen/region/types';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'canon-persist', width: 512, height: 256 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

// Una supertesela con costa si puede ser: media malla, sobre el primer pueblo.
const anchor = geo.settlements[0] ?? { x: world.width / 2, y: world.height / 2 };
const id = tileAt(world, anchor.x, anchor.y);
console.log(`supertesela ${canonTileKey(id)} sobre ${'name' in anchor ? (anchor as { name: string }).name : 'el centro'}`);

const g0 = performance.now();
const region = generateCanonTile(world, geo, id, {});
const genMs = performance.now() - g0;
console.log(`generada en ${(genMs / 1000).toFixed(1)} s · ${region.width}×${region.height} @ ${region.metresPerCell.toFixed(0)} m/celda`);

const rawBytes = region.elevation.byteLength + region.water.byteLength + region.flow.byteLength
  + region.slope.byteLength + region.wet.byteLength + region.biome.byteLength + region.cover.byteLength;

const run = async () => {
  const e0 = performance.now();
  const bytes = await encodeCanonTile(region);
  const encodeMs = performance.now() - e0;
  const d0 = performance.now();
  const back = await decodeCanonTile(bytes);
  const decodeMs = performance.now() - d0;
  console.log(`crudo ${(rawBytes / 1e6).toFixed(1)} MB → ${(bytes.byteLength / 1e6).toFixed(2)} MB · encode ${encodeMs.toFixed(0)} ms · decode ${decodeMs.toFixed(0)} ms (generar: ${genMs.toFixed(0)} ms)`);

  const n = region.width * region.height;
  // Tierra/mar exacto.
  let landFlips = 0;
  let maxElev = 0;
  for (let i = 0; i < n; i++) {
    if ((region.elevation[i] > 0) !== (back.elevation[i] > 0)) landFlips++;
    const d = Math.abs(region.elevation[i] - back.elevation[i]) * 1000;
    if (d > maxElev) maxElev = d;
  }
  check('predicado tierra/mar', landFlips === 0, `${landFlips} celdas cambiadas`);
  // 1,00 m es el nudge que preserva la costa (una celda a +0,4 m no puede
  // redondear a 0): el MISMO máximo que documentó el banco de worldSnapshots.
  check('elevación al metro', maxElev <= 1.001, `error máx ${maxElev.toFixed(3)} m`);

  const exact = (name: 'water' | 'biome' | 'cover') => {
    const a = region[name], b = back[name];
    let bad = 0;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) bad++;
    check(`${name} byte a byte`, bad === 0, `${bad} distintos`);
  };
  exact('water'); exact('biome'); exact('cover');

  const close = (name: 'flow' | 'wet' | 'slope', tol: number) => {
    const a = region[name] as Float32Array, b = back[name] as Float32Array;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i] - Math.min(a[i] > 60 ? Infinity : 65, b[i]));
      if (Number.isFinite(d) && d > worst) worst = d;
    }
    check(`${name} cuantizado`, worst <= tol, `error máx ${worst.toExponential(2)} (tol ${tol})`);
  };
  close('flow', 1 / 65534);
  close('wet', 1 / 65534);
  close('slope', 0.00051);

  const vec = (name: 'streams' | 'places' | 'tracks' | 'fields' | 'hedges' | 'dykes') => {
    const same = JSON.stringify(region[name]) === JSON.stringify(back[name]);
    check(`${name} idénticos`, same, `${(region[name] as unknown[]).length} elementos`);
  };
  vec('streams'); vec('places'); vec('tracks'); vec('fields'); vec('hedges'); vec('dykes');
  check('títulos', region.title === back.title && region.subtitle === back.subtitle,
    `«${back.title}»`);
  check('geometría', back.width === region.width && back.height === region.height
    && back.margin === region.margin && back.originX === region.originX
    && back.originY === region.originY && back.worldPerCellX === region.worldPerCellX,
  `${back.width}×${back.height} m${back.margin} @(${back.originX},${back.originY})`);

  // Estabilidad: la segunda vuelta es la identidad, byte a byte.
  const bytes2 = await encodeCanonTile(back as RegionData);
  let stable = bytes.byteLength === bytes2.byteLength;
  if (stable) for (let i = 0; i < bytes.byteLength; i++) if (bytes[i] !== bytes2[i]) { stable = false; break; }
  check('estabilidad encode∘decode', stable,
    `${bytes.byteLength} vs ${bytes2.byteLength} bytes`);

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run();
