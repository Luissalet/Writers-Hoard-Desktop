// The map as an index of the manuscript.
// There is no manuscript in the bench, so this fabricates a small one and checks
// the parts that would actually break in the app: keys stable across a
// regeneration, the reverse lookup, and — the one that matters — what happens to
// links whose place stops existing.
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import {
  buildAtlas, buildIndex, describePlace, placeAt, placesForEntity,
  reconcile, snapshotPositions, type ManuscriptLink,
} from '../src/engines/worldgen/core/atlas';
import { editKey } from '../src/engines/worldgen/core/edits';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);

const t0 = Date.now();
const atlas = buildAtlas(world, geo);
console.log(`atlas: ${atlas.places.length} lugares con clave estable en ${Date.now() - t0} ms`);
const byKind = new Map<string, number>();
for (const p of atlas.places) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
console.log(`  ${[...byKind].map(([k, v]) => `${k} ${v}`).join(' · ')}`);

// ---- a fabricated manuscript ---------------------------------------------
const byPop = [...geo.settlements].sort((a, b) => b.population - a.population);
const capital = byPop[0], second = byPop[1], home = byPop[6];
const ruin = geo.ruins[0];
const sea = geo.features.find((f) => f.kind === 'sea' || f.kind === 'ocean');

const links: ManuscriptLink[] = [
  { placeKey: editKey('settlement', home.x, home.y), placeName: home.name, kind: 'character', id: 'c1', title: 'Aldrin', relation: 'birth' },
  { placeKey: editKey('settlement', home.x, home.y), placeName: home.name, kind: 'character', id: 'c2', title: 'Ysolde', relation: 'home' },
  { placeKey: editKey('settlement', home.x, home.y), placeName: home.name, kind: 'scene', id: 's1', title: 'La partida', where: 'capítulo 1', order: 1 },
  { placeKey: editKey('settlement', capital.x, capital.y), kind: 'character', id: 'c1', title: 'Aldrin', relation: 'visit' },
  { placeKey: editKey('settlement', capital.x, capital.y), kind: 'scene', id: 's4', title: 'La audiencia', where: 'capítulo 9', order: 9 },
  { placeKey: editKey('settlement', capital.x, capital.y), kind: 'scene', id: 's5', title: 'El juicio', where: 'capítulo 14', order: 14 },
  { placeKey: editKey('settlement', capital.x, capital.y), kind: 'event', id: 'e1', title: 'Coronación de Hrolf', where: 'año 812' },
  { placeKey: editKey('settlement', second.x, second.y), kind: 'character', id: 'c1', title: 'Aldrin', relation: 'death' },
  { placeKey: editKey('ruin', ruin.x, ruin.y), kind: 'event', id: 'e2', title: 'La batalla del vado', where: 'año 780' },
  ...(sea ? [{ placeKey: editKey('feature', sea.x, sea.y, `${sea.kind}:`), kind: 'scene' as const, id: 's7', title: 'La travesía', where: 'capítulo 6', order: 6 }] : []),
  { placeKey: 'settlement:99999,99999', kind: 'note', id: 'n1', title: 'una nota huérfana' },
];

const index = buildIndex(atlas, links);
console.log(`\n${links.length} enlaces · ${index.byPlace.size} lugares con contenido · ${index.orphans.length} huérfanos`);

for (const key of [editKey('settlement', home.x, home.y), editKey('settlement', capital.x, capital.y)]) {
  const p = atlas.byKey.get(key)!;
  console.log(`\n${p.name} (${p.type}):`);
  for (const line of describePlace(p, index.byPlace.get(key) ?? [])) console.log(`  ${line}`);
}

const aldrinPlaces = placesForEntity(index, 'c1');
console.log(`\nAldrin aparece en ${aldrinPlaces.length} lugares: ${aldrinPlaces.map((p) => p.name).join(', ')}`);

// ---- clicking ------------------------------------------------------------
const hit = placeAt(atlas, world, capital.x + 1, capital.y + 1, 8);
console.log(`\npinchando a una celda de ${capital.name} → ${hit?.name ?? 'nada'}`);
// Restringido a asentamientos: sin filtro, pinchar a 60 celdas SÍ acierta —
// una sierra mide sesenta celdas y estás dentro de ella, que es la respuesta
// correcta y no un fallo.
const miss = placeAt(atlas, world, capital.x + 60, capital.y + 60, 8, ['settlement']);
console.log(`pinchando a 60 celdas (solo poblaciones) → ${miss?.name ?? 'nada'}`);
const area = placeAt(atlas, world, capital.x + 60, capital.y + 60, 8);
console.log(`  ...y sin filtro, cae dentro de: ${area?.name ?? 'nada'} (${area?.type})`);

// ---- the real test: do the keys survive a regeneration? -------------------
const before = snapshotPositions(atlas);
const geo2 = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const atlas2 = buildAtlas(world, geo2);
let kept = 0;
for (const k of atlas.byKey.keys()) if (atlas2.byKey.has(k)) kept++;
console.log(`\ntras regenerar la geografía humana: ${kept}/${atlas.byKey.size} claves siguen existiendo`);

// And with a genuinely different world — where most links SHOULD be orphaned,
// and the interesting question is whether the reconciler says something useful.
const geo3 = buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, settlementDensity: 1.6, realmCount: 11 });
const atlas3 = buildAtlas(world, geo3);
const index3 = buildIndex(atlas3, links);
console.log(`con otra densidad de poblamiento: ${index3.orphans.length}/${links.length} enlaces huérfanos`);
const fixes = reconcile(atlas3, world, index3.orphans, before);
for (const f of fixes) {
  console.log(`  «${f.link.title}» → ${f.suggestion
    ? `¿${f.suggestion.name}? (por ${f.by === 'name' ? 'nombre' : 'posición'}, a ${f.distanceCells.toFixed(0)} celdas)`
    : 'sin candidato'}`);
}

// ---- ¿qué cambio del mundo conserva los enlaces, y cuál no? --------------
// Distinguirlo importa: si el lector cambia el número de reinos no debe perder
// nada, y si cambia la densidad de poblamiento las ciudades son OTRAS y
// pretender lo contrario sería peor que perderlas.
const geo4 = buildHumanGeography(world, { ...DEFAULT_HUMAN_PARAMS, realmCount: 11, cultureCount: 4 });
const index4 = buildIndex(buildAtlas(world, geo4), links);
console.log(`\ncambiando solo reinos y culturas: ${index4.orphans.length}/${links.length} huérfanos`);

// Y la recuperación por nombre, probada donde de verdad actúa: la misma villa
// que se ha movido unas celdas.
const moved = buildAtlas(world, {
  ...geo,
  settlements: geo.settlements.map((s) => (s.id === home.id ? { ...s, x: s.x + 7, y: s.y + 5 } : s)),
});
const movedIndex = buildIndex(moved, links);
const movedFixes = reconcile(moved, world, movedIndex.orphans, before);
console.log(`si ${home.name} se desplaza 9 celdas: ${movedIndex.orphans.length} huérfanos, `
  + `${movedFixes.filter((f) => f.by === 'name').length} recuperados por nombre`);
for (const f of movedFixes) {
  console.log(`  «${f.link.title}» → ${f.suggestion
    ? `${f.suggestion.name} (por ${f.by === 'name' ? 'nombre' : 'posición'}, a ${f.distanceCells.toFixed(0)} celdas)`
    : 'sin candidato'}`);
}

const ok = [
  ['todos los asentamientos tienen clave', atlas.places.filter((p) => p.kind === 'settlement').length === geo.settlements.length],
  ['la nota inventada queda huérfana', index.orphans.length === 1],
  ['las claves sobreviven a regenerar', kept === atlas.byKey.size],
  ['pinchar cerca acierta', hit?.name === capital.name],
  ['pinchar lejos no acierta a una población', miss === null],
  ['cambiar reinos y culturas no rompe ningún enlace', index4.orphans.length === index.orphans.length],
  ['una villa desplazada se recupera por nombre',
    movedFixes.filter((f) => f.by === 'name').length === 3],
  ['no se inventan candidatos cuando la villa ya no existe',
    fixes.every((f) => f.suggestion === null || f.by === 'name')],
  ['Aldrin sale en 3 lugares', aldrinPlaces.length === 3],
] as const;
console.log();
for (const [name, pass] of ok) console.log(`${pass ? '·' : '✗'} ${name}`);
