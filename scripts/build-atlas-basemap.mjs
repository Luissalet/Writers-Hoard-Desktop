// ============================================================================
// Build the real atlas' offline basemap
// ============================================================================
//
// Turns Natural Earth's 1:110m country polygons (the `world-atlas` TopoJSON,
// public domain) into the compact JSON the map layer in
// `src/engines/real-atlas/components/AtlasMap.tsx` draws when the OSM tile
// layer is off — which is the default, because the renderer must not need
// the network to show a map at all.
//
// TopoJSON is decoded here rather than in the app so the renderer carries no
// topology library: arcs are delta-encoded integer runs on a quantised grid,
// and a ring is a list of arc indices (a negative index means "that arc,
// reversed"). Forty lines, once, at build time.
//
// Output: one object per country with its name and its polygons, each polygon
// a list of rings (outer first, holes after) and each ring a FLAT array of
// integers, longitude then latitude, in hundredths of a degree — two decimals
// is ~1 km, far below what a 1:110m outline resolves. Rings are left open
// (the closing point is dropped; the SVG path closes them with `Z`).
//
// Longitudes are UNWRAPPED within a ring. world-atlas stitches the pieces of
// a country that the antimeridian cuts (Russia, Fiji) back into one ring, so
// the ring jumps from 178°E straight to 180°W: drawn on a flat Mercator that
// jump is a 360°-wide band across the whole map, and the country's bounding
// box becomes the whole world, which is how "RUSSIA" ended up labelled over
// the North Sea. Here a step of more than 180° between neighbouring points is
// taken the short way round, so Chukotka sits at 180..190°E next to the rest
// of Siberia; a ring may therefore extend past ±180°, and the map layer draws
// it shifted by ±360° when the view is on the other side. Edges that run
// along the seam itself are left alone on purpose: Antarctica's are the two
// sides of its Mercator band, and removing them would close it diagonally.
// The build fails if any ring still steps more than 180° between neighbours.
//
// Usage:
//   node scripts/build-atlas-basemap.mjs            # downloads the TopoJSON
//   node scripts/build-atlas-basemap.mjs <file>     # uses a local copy
//
// Regenerate only when bumping the world-atlas version; the JSON is committed.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'engines', 'real-atlas', 'data', 'countries-110m.json');
/** Coordinates are stored as integers in units of 1/SCALE degrees. */
const SCALE = 100;
const BUDGET_BYTES = 250_000;

async function loadTopology(argument) {
  if (argument) return JSON.parse(await readFile(argument, 'utf8'));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
  return response.json();
}

/** Every arc as absolute [lon, lat] pairs (the topology's transform undone). */
function decodeArcs(topology) {
  const { scale, translate } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

/**
 * Longitudes made continuous along the ring (see the header), then the whole
 * ring shifted by a multiple of 360° so the middle of its extent lies within
 * [-180, 180]: Chukotka ends up at 180..190°E, and a ring that lies entirely
 * west of the seam after unwrapping is brought back to the east side.
 */
function unwrapLongitudes(points) {
  const out = [];
  let prev = null;
  for (const [lon, lat] of points) {
    let unwrapped = lon;
    if (prev !== null) {
      if (unwrapped - prev < -180) unwrapped += 360;
      else if (unwrapped - prev > 180) unwrapped -= 360;
    }
    out.push([unwrapped, lat]);
    prev = unwrapped;
  }
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon] of out) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const shift = 360 * Math.round(-((minLon + maxLon) / 2) / 360);
  return shift ? out.map(([lon, lat]) => [lon + shift, lat]) : out;
}

/** One ring as a flat integer array, consecutive duplicates and the closing point dropped. */
function decodeRing(arcRefs, arcs) {
  const points = [];
  for (const ref of arcRefs) {
    const arc = ref < 0 ? [...arcs[~ref]].reverse() : arcs[ref];
    // Adjacent arcs share their end point; keep it once.
    for (let i = points.length ? 1 : 0; i < arc.length; i += 1) points.push(arc[i]);
  }
  const flat = [];
  for (const [lon, lat] of unwrapLongitudes(points)) {
    const qx = Math.round(lon * SCALE);
    const qy = Math.round(lat * SCALE);
    const n = flat.length;
    if (n >= 2 && flat[n - 2] === qx && flat[n - 1] === qy) continue;
    flat.push(qx, qy);
  }
  if (flat.length >= 4 && flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1]) {
    flat.length -= 2;
  }
  return flat.length >= 6 ? flat : null;
}

function decodePolygon(ringRefs, arcs) {
  const rings = ringRefs.map((refs) => decodeRing(refs, arcs)).filter(Boolean);
  // A polygon whose OUTER ring collapsed is nothing; a lost hole is fine.
  return rings.length && ringRefs.length && rings[0] ? rings : null;
}

function decodeCountry(geometry, arcs) {
  const polygonRefs = geometry.type === 'Polygon'
    ? [geometry.arcs]
    : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
  const polygons = polygonRefs.map((refs) => decodePolygon(refs, arcs)).filter(Boolean);
  return polygons.length ? { name: geometry.properties?.name ?? '', polygons } : null;
}

async function main() {
  const topology = await loadTopology(process.argv[2]);
  const arcs = decodeArcs(topology);
  const countries = topology.objects.countries.geometries
    .map((geometry) => decodeCountry(geometry, arcs))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const points = countries.reduce(
    (sum, c) => sum + c.polygons.reduce((s, p) => s + p.reduce((r, ring) => r + ring.length / 2, 0), 0),
    0,
  );
  for (const country of countries) {
    for (const ring of country.polygons.flat()) {
      for (let i = 2; i < ring.length; i += 2) {
        if (Math.abs(ring[i] - ring[i - 2]) > 180 * SCALE) {
          throw new Error(`${country.name}: a ring still jumps across the antimeridian at point ${i / 2}`);
        }
      }
    }
  }
  const json = JSON.stringify({ source: 'world-atlas@2.0.2 countries-110m (Natural Earth, public domain)', scale: SCALE, countries });
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, json, 'utf8');
  const bytes = Buffer.byteLength(json, 'utf8');
  console.log(`${path.relative(ROOT, OUT)}: ${countries.length} countries, ${points} points, ${(bytes / 1000).toFixed(1)} kB`);
  if (bytes > BUDGET_BYTES) {
    console.error(`ERROR basemap is over its ${BUDGET_BYTES / 1000} kB budget`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
