// ============================================
// Banco: los caminos siguen a un pueblo movido
// ============================================
// La deuda (PENDIENTE §3, pasada 7): la base de la geografía se construye con
// `corrections=false`, así que `buildRoads` enrutaba con las posiciones de
// ORIGEN para siempre — mover un pueblo dejaba la carretera apuntando al solar
// antiguo hasta regenerar el mundo. El arreglo enruta contra las posiciones ya
// mudadas (fuera del flag) manteniendo las llaves por origen.
//
// La prueba recorre la vía BARATA REAL (lección #23): applyEdits sobre el
// mundo → getGeography (patch) → rebuildGeography (el pase completo que
// WorldView programa al soltar). Y el colapso de cadenas: dos mudanzas del
// mismo pueblo, la segunda emitida con la llave del DIBUJO (destino de la
// primera), deben dejar UNA entrada en `moves` y todas las vistas de acuerdo.

import { getWorld } from './world-cache';
import { applyEdits, editKey, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { getGeography, rebuildGeography } from '../src/engines/worldgen/cartography/texture';

const t0 = performance.now();
const world = getWorld({ seed: 'moved-roads', width: 512, height: 256 });
console.log(`mundo 512×256 en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const W = world.width;

// El pase completo de partida.
const geo0 = rebuildGeography(world, 'full');
const roadEnds = (cells: number[]) => [cells[0], cells[cells.length - 1]];
const cellOf = (x: number, y: number) => Math.round(y) * W + Math.round(x);

// Un pueblo con caminos y sitio para mudarse.
const withRoads = geo0.settlements.filter((s) =>
  geo0.roads.some((r) => roadEnds(r.cells).includes(cellOf(s.x, s.y))));
if (!withRoads.length) throw new Error('ningún pueblo con caminos en esta semilla');
const town = withRoads[Math.floor(withRoads.length / 2)];
const originKey = editKey('settlement', town.x, town.y);
const degree0 = geo0.roads.filter((r) => roadEnds(r.cells).includes(cellOf(town.x, town.y))).length;
console.log(`pueblo: ${town.name} (${town.x},${town.y}) rango ${town.rank}, ${degree0} caminos`);

// Destino: tierra firme a ~20 celdas, la más alta de las candidatas.
let dest = { x: town.x, y: town.y };
let bestElev = -1;
for (let dy = -22; dy <= 22; dy += 4) {
  for (let dx = -22; dx <= 22; dx += 4) {
    if (Math.hypot(dx, dy) < 14) continue;
    const nx = ((Math.round(town.x + dx) % W) + W) % W;
    const ny = Math.round(town.y + dy);
    if (ny < 2 || ny >= world.height - 2) continue;
    const e = world.elevation[ny * W + nx];
    if (e > 0.02 && e > bestElev) { bestElev = e; dest = { x: nx, y: ny }; }
  }
}
if (dest.x === town.x && dest.y === town.y) throw new Error('sin destino en tierra');
console.log(`destino: (${dest.x},${dest.y})`);

// ---- 1. la mudanza, por la vía real -------------------------------------
const edits: WorldEdit[] = [
  { kind: 'move', target: 'settlement', key: originKey, x: dest.x, y: dest.y },
];
applyEdits(world, edits);
world.revision = (world.revision ?? 0) + 1;

// El parche barato: el pueblo se dibuja mudado, los caminos aún no.
const patched = getGeography(world, 'full');
const pTown = patched.settlements.find((s) => s.name === town.name);
if (!pTown || Math.round(pTown.x) !== dest.x || Math.round(pTown.y) !== dest.y) {
  throw new Error(`el parche no mudó el pueblo: ${pTown?.x},${pTown?.y}`);
}
console.log('parche: pueblo mudado ✓ (caminos viejos, por contrato)');

// El pase completo: los caminos llegan al solar nuevo.
const rebuilt = rebuildGeography(world, 'full');
const atDest = rebuilt.roads.filter((r) => roadEnds(r.cells).includes(cellOf(dest.x, dest.y))).length;
const atOrigin = rebuilt.roads.filter((r) =>
  roadEnds(r.cells).includes(cellOf(town.x, town.y))).length;
console.log(`rebuild: ${atDest} caminos al destino, ${atOrigin} al solar antiguo`);
if (atDest < 1) throw new Error('ningún camino termina en el destino tras el pase completo');
if (atOrigin > 0) throw new Error('sigue habiendo caminos al solar antiguo');
const rTown = rebuilt.settlements.find((s) => s.name === town.name);
if (!rTown || Math.round(rTown.x) !== dest.x) throw new Error('el rebuild perdió la mudanza del listado');

// ---- 2. segunda mudanza con la llave del DIBUJO (colapso de cadenas) ----
const drawnKey = editKey('settlement', rTown.x, rTown.y); // la llave que el hit del 2D llevaría
const dest2 = { x: ((dest.x + 9) % W), y: Math.max(2, dest.y - 7) };
edits.push({ kind: 'move', target: 'settlement', key: drawnKey, x: dest2.x, y: dest2.y });
applyEdits(world, edits);
world.revision = (world.revision ?? 0) + 1;

const mvs = world.painted?.moves ?? {};
const entries = Object.keys(mvs);
console.log(`moves tras dos arrastres: ${entries.length} entrada(s): ${entries.join(' · ')}`);
if (entries.length !== 1) throw new Error('la cadena no se colapsó: debería quedar UNA entrada');
if (entries[0] !== originKey) throw new Error(`la entrada no es la llave de origen: ${entries[0]}`);
const fin = mvs[originKey];
if (Math.round(fin.x) !== dest2.x || Math.round(fin.y) !== dest2.y) {
  throw new Error(`el destino final no es el segundo: ${fin.x},${fin.y}`);
}

// Y el parche dibuja el destino final — lo que verían 2D, carta, 3D y atlas.
const patched2 = getGeography(world, 'full');
const p2 = patched2.settlements.find((s) => s.name === town.name);
if (!p2 || Math.round(p2.x) !== dest2.x || Math.round(p2.y) !== dest2.y) {
  throw new Error(`la segunda mudanza no llega al dibujo: ${p2?.x},${p2?.y}`);
}
console.log('segunda mudanza: una llave, un destino, todas las vistas de acuerdo ✓');

console.log(`\nEN VERDE en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
