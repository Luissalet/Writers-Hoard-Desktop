// ============================================================================
// BANCO DE LA POLÍTICA DE LUGARES (el grifo y el pincel de zonas)
// ============================================================================
// Luis, 2026-08-12: «no he pedido abadías, casas, monasterios». El sembrado
// regional pasa a estar APAGADO por defecto (`sites: 'auto'` sin ediciones),
// se abre entero con `placesEverywhere` y por zonas con `placesZone`. Este
// banco pregunta lo que puede salir mal:
//   A. El defecto de los BANCOS ('everywhere') sigue sembrando — nada viejo
//      cambia de suelo.
//   B. 'auto' sin ediciones: CERO lugares del enrejado; los pueblos del MUNDO
//      y los hitos naturales siguen ahí (no son sembrado).
//   C. 'auto' + grifo abierto == 'everywhere', lugar a lugar — el tick abre
//      exactamente el país de siempre, no uno parecido.
//   D. 'auto' + una zona `add`: lugares SOLO dentro de la zona.
//   E. 'auto' + grifo abierto + zona `remove`: la zona queda vacía y el resto
//      no se entera.
import { getWorld } from './world-cache';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { generateRegion } from '../src/engines/worldgen/region/generate';
import type { RegionData } from '../src/engines/worldgen/region/types';
import type { WorldEdit } from '../src/engines/worldgen/core/edits';

const LATTICE = new Set(['farm', 'hamlet', 'village', 'abbey', 'mill', 'tower',
  'quarry', 'mine', 'inn']);

const w = getWorld({ seed: 'banco-lugares', width: 256 });
const g = getGeography(w, 'full');
const cap = [...g.settlements].sort((a, b) => b.population - a.population)[0];
const win = { cx: cap.x, cy: cap.y, spanKm: 90 };

function sembrados(r: RegionData) {
  // Sólo el ENREJADO regional: lo del mundo (worldId) y los hitos naturales
  // (landmark) no son sembrado y no deben moverse con el grifo.
  return r.places.filter((p) => p.worldId === undefined && LATTICE.has(p.kind));
}
function huella(r: RegionData): string[] {
  return sembrados(r)
    .map((p) => `${p.kind}:${p.name}:${p.worldX.toFixed(2)},${p.worldY.toFixed(2)}`)
    .sort();
}

const sheet = (sites: 'auto' | 'everywhere', edits?: WorldEdit[]) =>
  generateRegion(w, g, win, { params: { sites }, edits });

let rojo = false;
const di = (que: string, ok: boolean, detalle: string) => {
  console.log(`${que}: ${ok ? 'sí' : `NO — ${detalle}`}`);
  if (!ok) rojo = true;
};

// A. El defecto de los bancos sigue sembrando.
const A = sheet('everywhere');
di('A · everywhere siembra', sembrados(A).length > 0, `0 lugares en ${A.places.length}`);

// B. 'auto' sin ediciones: enrejado a cero; mundo e hitos intactos.
const B = sheet('auto');
const mundoB = B.places.filter((p) => p.worldId !== undefined).length;
const hitosB = B.places.filter((p) => p.kind === 'landmark').length;
const mundoA = A.places.filter((p) => p.worldId !== undefined).length;
const hitosA = A.places.filter((p) => p.kind === 'landmark').length;
di('B · auto sin ediciones = 0 sembrados', sembrados(B).length === 0,
  `${sembrados(B).length}: ${huella(B).slice(0, 3).join(' · ')}`);
di('B · los pueblos del mundo se quedan', mundoB === mundoA, `${mundoB} ≠ ${mundoA}`);
di('B · los hitos naturales se quedan', hitosB === hitosA, `${hitosB} ≠ ${hitosA}`);

// C. El grifo abierto reproduce 'everywhere' lugar a lugar.
const C = sheet('auto', [{ kind: 'placesEverywhere', enabled: true }]);
const hA = huella(A).join('\n');
const hC = huella(C).join('\n');
di('C · grifo abierto == everywhere (lugar a lugar)', hA === hC,
  `${huella(A).length} vs ${huella(C).length}`);

// D. Una zona `add`: todo dentro, nada fuera.
// EN CELDAS DEL MUNDO Y A ESCALA DE LA HOJA: en un 256 una celda son ~156 km
// y la hoja entera (90 km) cabe en 0,6 celdas — un radio de 6 celdas la
// tragaba entera y las varas D/E medían una zona sin «fuera» (primer rojo de
// este banco, que era del banco). 0,15 celdas ≈ 23 km: un cuarto de hoja.
const R = 0.15;
const zona: WorldEdit = { kind: 'placesZone', mode: 'add', pts: [{ x: cap.x, y: cap.y }], radius: R };
const D = sheet('auto', [zona]);
const dDentro = (p: { worldX: number; worldY: number }) => {
  let dx = Math.abs(p.worldX - cap.x);
  if (dx > w.width / 2) dx = w.width - dx;
  return Math.hypot(dx, p.worldY - cap.y);
};
const dFuera = sembrados(D).filter((p) => dDentro(p) > R + 0.03);
di('D · la zona add siembra', sembrados(D).length > 0, '0 lugares con la zona puesta');
di('D · nada fuera de la zona', dFuera.length === 0,
  dFuera.slice(0, 3).map((p) => `${p.name}@${dDentro(p).toFixed(1)}c`).join(' · '));

// E. Grifo abierto + zona `remove`: la zona queda vacía, el resto igual.
const E = sheet('auto', [
  { kind: 'placesEverywhere', enabled: true },
  { kind: 'placesZone', mode: 'remove', pts: [{ x: cap.x, y: cap.y }], radius: R },
]);
const eDentro = sembrados(E).filter((p) => dDentro(p) <= R - 0.03);
di('E · la zona remove vacía su suelo', eDentro.length === 0,
  eDentro.slice(0, 3).map((p) => p.name).join(' · '));
di('E · fuera de la zona sigue habitado', sembrados(E).length > 0, '0 en toda la hoja');

console.log(`\nresumen: A=${sembrados(A).length} sembrados · B=${sembrados(B).length}`
  + ` · C=${sembrados(C).length} · D=${sembrados(D).length} · E=${sembrados(E).length}`);
process.exit(rojo ? 1 : 0);
