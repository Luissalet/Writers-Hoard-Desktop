// Población editable: ¿no cambia nada si no la tocas, crece si la tocas, y
// sobrevive a guardar?
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { cityParamsFor } from '../src/engines/worldgen/cartography/texture';
import { generateCity } from '../src/engines/worldgen/city/generate';
import { applyEdits, serializeEdits, deserializeEdits, editKey, type WorldEdit } from '../src/engines/worldgen/core/edits';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const s = [...geo.settlements].sort((a, b) => b.population - a.population)[0];
const base = cityParamsFor(world, s);
console.log(`${s.name}: rango ${s.rank}, ${s.population} hab, tamaño base ${base.size}`);

function sizeForPopulation(population: number, baseSize: number, basePopulation: number): number {
  const ratio = population / Math.max(1, basePopulation);
  return Math.max(5, Math.min(220, Math.round(baseSize * Math.pow(ratio, 0.58))));
}

// 1. Untouched must be identical.
const before = generateCity(base);
const after = generateCity({ ...base, size: sizeForPopulation(s.population, base.size, base.population), population: s.population });
const same = JSON.stringify(before) === JSON.stringify(after);
console.log(`sin tocar: ${same ? 'IDÉNTICO' : '¡CAMBIÓ! regresión'} (${before.patches.length} manzanas)`);

// 2. The ladder up to a million.
for (const pop of [500, 5_000, 20_000, 100_000, 400_000, 1_000_000]) {
  const size = sizeForPopulation(pop, base.size, base.population);
  const t = Date.now();
  const plan = generateCity({ ...base, size, population: pop });
  const b = plan.patches.reduce((n, p) => n + p.buildings.length, 0);
  console.log(`${String(pop).padStart(9)} hab → tamaño ${String(size).padStart(3)} · ${plan.patches.length} manzanas · ${b} edificios · ${Date.now() - t} ms`);
}

// 3. Does the edit survive the round trip and reach the geography?
const key = editKey('settlement', s.x, s.y);
const edits: WorldEdit[] = [{ kind: 'populate', target: 'settlement', key, population: 777_000 }];
const round = deserializeEdits(serializeEdits(edits));
const painted = applyEdits(world, round);
console.log(`tras serializar: populations[${key}] = ${painted.populations[key]}`);
const geo2 = buildHumanGeography({ ...world, painted }, DEFAULT_HUMAN_PARAMS);
const s2 = geo2.settlements.find((q) => Math.round(q.x) === Math.round(s.x) && Math.round(q.y) === Math.round(s.y));
console.log(`en la geografía reconstruida: ${s2?.name} tiene ${s2?.population} hab ${s2?.population === 777_000 ? '✓' : '✗'}`);
