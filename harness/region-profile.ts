// Where do the two seconds go? Tuning without this is guessing, and guessing is
// how the avenue widths got tuned twice on a downscaled screenshot.
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import {
  regionGeometry, extractPatch, buildElevation, carveWorldRivers, erodeSheet,
  buildHydrology, extractStreams,
} from '../src/engines/worldgen/region/terrain';
import { buildNaturalCover, applyHabitation } from '../src/engines/worldgen/region/cover';
import { buildHabitation } from '../src/engines/worldgen/region/places';
import { buildTracks } from '../src/engines/worldgen/region/tracks';
import { buildFields } from '../src/engines/worldgen/region/fields';
import { DEFAULT_REGION_PARAMS } from '../src/engines/worldgen/region/types';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const s = [...geo.settlements].sort((a, b) => b.population - a.population)[0];
const params = DEFAULT_REGION_PARAMS;

const marks: [string, number][] = [];
let t = Date.now();
const lap = (name: string) => { marks.push([name, Date.now() - t]); t = Date.now(); };

const g = regionGeometry(world, { cx: s.x, cy: s.y, spanKm: 120 }, params);
lap('geometría');
const patch = extractPatch(world, g);
lap('parche del mundo');
const elevation = buildElevation(world, g, patch, params);
lap('elevación (ruido)');
const rivers = carveWorldRivers(world, g, elevation);
lap('tallar ríos');
erodeSheet(elevation, g.width, g.height, g.metresPerCell, 3, 0.0055 * params.detail);
lap('erosión (3 pasadas)');
const tf = buildHydrology(world, g, patch, elevation);
lap('hidrología');
const streams = extractStreams(g, tf, rivers, params);
lap('extraer cursos');
const natural = buildNaturalCover(world, g, patch, tf, params);
lap('vegetación');
const hab = buildHabitation(world, geo, g, patch, tf, natural.cover, streams, params);
lap('poblamiento');
const farmed = applyHabitation(world, g, tf, natural, hab.places, params);
lap('cultivo');
const tracks = buildTracks(world, geo, g, tf, farmed.cover, hab.places, streams, hab.fields, params);
lap('caminos');
buildFields(g, tf, farmed.cover, farmed.tilth, hab.places, params);
lap('cercas');

const total = marks.reduce((a, [, v]) => a + v, 0);
console.log(`rejilla ${g.width}×${g.height} = ${(g.width * g.height / 1000).toFixed(0)}k celdas · ${Math.round(g.metresPerCell)} m/celda\n`);
for (const [name, ms] of [...marks].sort((a, b) => b[1] - a[1])) {
  const pct = (ms / total) * 100;
  console.log(`${name.padEnd(22)} ${String(ms).padStart(5)} ms  ${'█'.repeat(Math.round(pct / 2))}${pct >= 1 ? ` ${pct.toFixed(0)}%` : ''}`);
}
console.log(`${'TOTAL'.padEnd(22)} ${String(total).padStart(5)} ms`);
console.log(`\n${streams.length} cursos · ${hab.places.length} lugares · ${tracks.length} caminos`);
