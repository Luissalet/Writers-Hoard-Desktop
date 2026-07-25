// The paint session is the thing a UI trusts. Three properties have to hold or
// the tool is a liar:
//   1. undo returns the world to exactly the state before the stroke
//   2. a terrain stroke added after a biome paint does not erase it
//   3. the serialized list replays to a byte-identical world
import { getWorld } from './world-cache';
import { PaintSession } from '../src/engines/worldgen/core/paintSession';
import { Biome } from '../src/engines/worldgen/core/types';
import type { WorldEdit } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography } from '../src/engines/worldgen/core/settlements';

const w = getWorld({ seed: 'monstruo', width: 1024 });
const N = w.width * w.height;

const hash = () => {
  let h = 2166136261;
  for (let i = 0; i < N; i += 7) {
    h ^= (w.elevation[i] * 1000) | 0;
    h = (h * 16777619) >>> 0;
    h ^= w.biome[i];
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
};
const countBiome = (b: number) => {
  let n = 0;
  for (let i = 0; i < N; i++) if (w.biome[i] === b) n++;
  return n;
};
const land = () => {
  let n = 0;
  for (let i = 0; i < N; i++) if (w.elevation[i] > 0) n++;
  return n;
};

// Somewhere with land to work on.
let cx = 0, cy = 0;
for (let y = 100; y < w.height - 100 && !cx; y += 3) {
  for (let x = 0; x < w.width; x += 3) {
    if (w.elevation[y * w.width + x] > 0.2) { cx = x; cy = y; break; }
  }
}
console.log(`trabajando en (${cx}, ${cy})`);

const s = new PaintSession(w);
const clean = hash(), cleanLand = land();

// --- 1. undo is exact -------------------------------------------------------
const t0 = Date.now();
s.push({ kind: 'terrain', op: 'raise', stroke: { pts: [{ x: cx, y: cy }, { x: cx + 20, y: cy + 8 }], radius: 10, strength: 0.9, softness: 0.5 } });
const oneStroke = Date.now() - t0;
const raised = hash();
if (raised === clean) throw new Error('la pincelada no cambió nada');
s.undo();
console.log(`deshacer exacto: ${hash() === clean ? 'sí' : 'NO'} (tierra ${land()} vs ${cleanLand})`);
s.redo();
console.log(`rehacer exacto:  ${hash() === raised ? 'sí' : 'NO'}`);

// --- 2. a terrain stroke must not erase an earlier biome paint --------------
s.clear();
s.push({ kind: 'biome', biome: Biome.Erg, stroke: { pts: [{ x: cx, y: cy }], radius: 12, strength: 1, softness: 0.3 } });
const ergAfterPaint = countBiome(Biome.Erg);
s.push({ kind: 'terrain', op: 'raise', stroke: { pts: [{ x: cx + 40, y: cy }], radius: 8, strength: 0.8, softness: 0.5 } });
const ergAfterTerrain = countBiome(Biome.Erg);
console.log(`erg tras pintar ${ergAfterPaint}, tras levantar terreno ${ergAfterTerrain} — ${ergAfterTerrain >= ergAfterPaint * 0.9 ? 'conservado' : 'BORRADO'}`);

// --- 3. serialize / replay determinism -------------------------------------
const edits: WorldEdit[] = [
  { kind: 'land', op: 'land', stroke: { pts: [{ x: cx + 60, y: cy }, { x: cx + 80, y: cy + 10 }], radius: 9, strength: 1, softness: 0.4 } },
  { kind: 'terrain', op: 'roughen', stroke: { pts: [{ x: cx + 70, y: cy + 5 }], radius: 7, strength: 0.7 } },
  { kind: 'biome', biome: Biome.MonsoonForest, stroke: { pts: [{ x: cx + 70, y: cy + 5 }], radius: 6, strength: 1 } },
  { kind: 'river', pts: [{ x: cx, y: cy }, { x: cx + 12, y: cy + 14 }], width: 2 },
  { kind: 'marker', marker: 'settlement', x: cx + 2, y: cy + 2, rank: 'city' },
  { kind: 'marker', marker: 'ruin', x: cx + 24, y: cy - 6, ruin: 'fort' },
  { kind: 'label', x: cx + 10, y: cy + 20, text: 'Tierras Rotas', style: 'region' },
];
s.clear();
const t1 = Date.now();
for (const e of edits) s.push(e);
const seven = Date.now() - t1;
const target = hash();
const json = s.serialize();
s.clear();
s.load(json);
console.log(`replay tras serializar: ${hash() === target ? 'idéntico' : 'DISTINTO'} (${json.length} bytes)`);

// --- 4. how does it scale? -------------------------------------------------
s.clear();
const many: WorldEdit[] = [];
for (let k = 0; k < 60; k++) {
  many.push({
    kind: 'terrain', op: k % 3 === 0 ? 'raise' : k % 3 === 1 ? 'smooth' : 'roughen',
    stroke: { pts: [{ x: (cx + k * 3) % w.width, y: cy + (k % 11) - 5 }], radius: 5, strength: 0.6, softness: 0.5 },
  });
}
for (const e of many.slice(0, 20)) s.push(e);
const t20 = Date.now(); s.push(many[20]); const at20 = Date.now() - t20;
for (const e of many.slice(21, 60)) s.push(e);
const t60 = Date.now(); s.push({ ...many[0] }); const at60 = Date.now() - t60;
console.log(`coste por pincelada: 1ª ${oneStroke} ms · 7 juntas ${seven} ms · con 20 previas ${at20} ms · con 60 previas ${at60} ms`);

// --- 5. does a painted town reach the human geography? ---------------------
s.clear();
s.push({ kind: 'marker', marker: 'settlement', x: cx, y: cy, rank: 'city', name: 'Villa Pintada' });
s.push({ kind: 'marker', marker: 'ruin', x: cx + 18, y: cy + 6, ruin: 'temple', name: 'Templo Pintado' });
const geo = buildHumanGeography(w);
const town = geo.settlements.find((x) => x.name === 'Villa Pintada');
const ruin = geo.ruins.find((x) => x.name === 'Templo Pintado');
const onRoad = town ? geo.roads.some((r) => r.cells.includes(town.y * w.width + town.x)) : false;
console.log(`villa pintada en la geografía: ${town ? `sí (reino ${town.realm}, puerto ${town.port}, en ruta ${onRoad})` : 'NO'}`);
console.log(`ruina pintada en la geografía: ${ruin ? 'sí' : 'NO'}`);
s.clear();
console.log(`estado final limpio: ${hash() === clean ? 'sí' : 'NO'}`);
