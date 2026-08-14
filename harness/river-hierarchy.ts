// ==========================================================================
// River hierarchy across the shallow → canon hand-off.
// ==========================================================================
// A blue pixel only proves presence. This bench proves identity and magnitude:
// a world trunk must carry its global discharge into the canon, while nearby
// local streams keep their own catchment-based width.

import { getWorld } from './world-cache';
import { riverKey } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { generateCanonTile } from '../src/engines/worldgen/region/generate';
import { riverStrokePixels } from '../src/engines/worldgen/region/satelliteInk';
import { streamWidthMetres, worldRiverWidthMetres } from '../src/engines/worldgen/region/riverScale';
import { carveWorldRivers, degenerateLocalStream } from '../src/engines/worldgen/region/terrain';
import { tileAt, tileGeometry } from '../src/engines/worldgen/region/tiles';
import type { RegionStream } from '../src/engines/worldgen/region/types';

let failed = false;
function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failed = true;
}

const brook: RegionStream = {
  id: 1, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  flow: 0.4, areaKm2: 4, trunk: false,
};
const great: RegionStream = {
  id: 2, pts: [{ x: 0, y: 4 }, { x: 10, y: 4 }],
  flow: 0.8, areaKm2: 4, trunk: true,
  worldFlow: 0.9, sourceRiverKey: 'synthetic-main',
};

const expectedMetres = worldRiverWidthMetres(great.worldFlow!);
check(
  'un tronco usa exactamente la escala física mundial',
  streamWidthMetres(great) === expectedMetres,
  `${streamWidthMetres(great)} m ≠ ${expectedMetres} m`,
);

for (const [metresPerPx, pxPerCell] of [[1000, 0.8], [100, 2], [10, 12]] as const) {
  const bigPx = riverStrokePixels(great, metresPerPx, pxPerCell);
  const smallPx = riverStrokePixels(brook, metresPerPx, pxPerCell);
  const ratio = smallPx > 0 ? bigPx / smallPx : Infinity;
  const ok = metresPerPx >= 100
    ? bigPx >= 2 && smallPx === 0
    : smallPx > 0 && ratio >= 10;
  check(
    `jerarquía visible a ${metresPerPx} m/px`,
    ok,
    `principal ${bigPx.toFixed(2)} px · arroyo ${smallPx.toFixed(2)} px · razón ${ratio.toFixed(2)}`,
  );
}

// Integration: choose the strongest real river and generate the canon tile
// around its middle reach. This exercises carving, local drainage, overlap
// ownership and the stored RegionStream contract—not just the width helper.
const world = getWorld({ seed: 'river-hierarchy', width: 256 });
const main = [...world.rivers].sort((a, b) => b.flow - a.flow)[0];
if (!main || main.cells.length < 3) throw new Error('fixture world has no usable river');
const middle = main.cells[Math.floor(main.cells.length * 0.55)];
const id = tileAt(world, middle % world.width, Math.floor(middle / world.width));
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'places');
const region = generateCanonTile(world, geography, id);
const geometry = tileGeometry(world, id);
const carved = carveWorldRivers(
  world, geometry, new Float32Array(geometry.width * geometry.height),
);
const key = riverKey(main.cells);
const inherited = region.streams.filter((s) => s.sourceRiverKey === key);
const allInherited = region.streams.filter((s) => s.worldFlow !== undefined);
const local = region.streams.filter((s) => s.worldFlow === undefined);

check(
  'el río mundial llega al canon con identidad única',
  inherited.length === 1,
  `se encontraron ${inherited.length} tramos con la clave ${key}`,
);
if (inherited[0]) {
  const source = carved.find((river) => river.sourceRiverKey === key);
  const exactRoute = !!source
    && source.pts.length === inherited[0].pts.length
    && source.pts.every((p, index) => (
      p.x === inherited[0].pts[index].x && p.y === inherited[0].pts[index].y
    ));
  check(
    'la clave mundial conserva su polilínea completa, no una línea próxima',
    exactRoute,
    `fuente ${source?.pts.length ?? 0} puntos · canon ${inherited[0].pts.length} puntos`,
  );
  check(
    'el caudal global sobrevive sin renormalización local',
    Math.abs(inherited[0].worldFlow! - main.flow) < 1e-9,
    `${inherited[0].worldFlow} ≠ ${main.flow}`,
  );
  check(
    'el ancho profundo coincide con el ancho lejano',
    Math.abs(streamWidthMetres(inherited[0]) - worldRiverWidthMetres(main.flow)) < 1e-9,
    `${streamWidthMetres(inherited[0])} m ≠ ${worldRiverWidthMetres(main.flow)} m`,
  );
}

const duplicateKeys = new Map<string, number>();
for (const stream of allInherited) {
  const source = stream.sourceRiverKey ?? '(sin clave)';
  duplicateKeys.set(source, (duplicateKeys.get(source) ?? 0) + 1);
}
const duplicated = [...duplicateKeys].filter(([, count]) => count > 1);
check(
  'ningún tributario hereda identidad por proximidad',
  duplicated.length === 0 && local.every((s) => !s.trunk && s.sourceRiverKey === undefined),
  `duplicadas ${JSON.stringify(duplicated)} · locales mal clasificadas ${local.filter((s) => s.trunk || s.sourceRiverKey !== undefined).length}`,
);

const regionAreaKm2 = region.width * region.height * Math.pow(region.metresPerCell / 1000, 2);
const largestLocalArea = local.reduce((max, stream) => Math.max(max, stream.areaKm2), 0);
check(
  'ningún cauce local hereda la cuenca de su receptor',
  largestLocalArea <= regionAreaKm2 + 1e-6,
  `máxima ${largestLocalArea.toFixed(1)} km² · hoja ${regionAreaKm2.toFixed(1)} km²`,
);
check(
  'no sobreviven rayas cardinales D8 kilométricas',
  local.every((stream) => !degenerateLocalStream(stream.pts)),
  `${local.filter((stream) => degenerateLocalStream(stream.pts)).length} cauces degenerados`,
);

console.log(
  `canon ${id.tx},${id.ty}: ${region.streams.length} cauces · ${allInherited.length} troncos mundiales · `
  + `${local.length} locales · principal ${main.flow.toFixed(3)} = ${worldRiverWidthMetres(main.flow).toFixed(0)} m`,
);

if (failed) process.exitCode = 1;
