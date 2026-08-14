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
// Y desde el segundo parte de Luis (2026-08-13, «se ha creado ya con ciudades
// y caminos») el grifo también manda EN EL MUNDO:
//   G. Un mundo desnudo (sin ediciones) no genera ciudades, ni calzadas, ni
//      ruinas — nada humano que no esté pintado.
//   H. El grifo abierto reproduce el país de SIEMPRE, ciudad a ciudad — no
//      uno parecido.
import { getWorld } from './world-cache';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { generateRegion } from '../src/engines/worldgen/region/generate';
import type { RegionData } from '../src/engines/worldgen/region/types';
import { applyEdits, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';

const LATTICE = new Set(['farm', 'hamlet', 'village', 'abbey', 'mill', 'tower',
  'quarry', 'mine', 'inn']);

let rojo = false;
const di = (que: string, ok: boolean, detalle: string) => {
  console.log(`${que}: ${ok ? 'sí' : `NO — ${detalle}`}`);
  if (!ok) rojo = true;
};

// ---- El mundo, tres veces: intacto (legado), cerrado a mano, y abierto -----
// `getWorld` desempaqueta un objeto NUEVO por llamada; el grifo de uno no
// alcanza al otro.
//
// LA SEMÁNTICA (corregida el 2026-08-13, tras borrarle a Luis el contenido
// de sus mundos): la AUSENCIA de edición de lugares es LEGADO — el mundo
// conserva el país con el que nació. El desnudo es una edición EXPLÍCITA
// (`placesEverywhere:false`) que el flujo de creación escribe en los mundos
// NUEVOS. «Una cosa es lo que te pedí para NUEVOS mundos o REGENERADOS.
// Pero no te pedí que borrases lo existente.»
const wLegado = getWorld({ seed: 'banco-lugares', width: 256 });
const gLegado = getGeography(wLegado, 'full');

const wCerrado = getWorld({ seed: 'banco-lugares', width: 256 });
applyEdits(wCerrado, [{ kind: 'placesEverywhere', enabled: false }]);
const gCerrado = getGeography(wCerrado, 'full');

const w = getWorld({ seed: 'banco-lugares', width: 256 });
applyEdits(w, [{ kind: 'placesEverywhere', enabled: true }]);
const g = getGeography(w, 'full');

// F. LA RESTAURACIÓN — la vara del parte de Luis: un mundo EXISTENTE (sin
// ediciones de lugares) conserva su país entero, ciudad a ciudad.
const legado = buildHumanGeography(wLegado, DEFAULT_HUMAN_PARAMS, 'full', false);
const ciudades = (lista: { name: string; x: number; y: number }[]) =>
  lista.map((s) => `${s.name}:${s.x},${s.y}`).sort().join('\n');
di('F · mundo SIN ediciones == legado (nada se borra)',
  ciudades(gLegado.settlements) === ciudades(legado.settlements)
  && gLegado.settlements.length > 0,
  `${gLegado.settlements.length} vs ${legado.settlements.length}`);
di('F · sus calzadas siguen', gLegado.roads.length === legado.roads.length
  && gLegado.roads.length > 0, `${gLegado.roads.length} ≠ ${legado.roads.length}`);
di('F · sus ruinas siguen', ciudades(gLegado.ruins) === ciudades(legado.ruins),
  `${gLegado.ruins.length} vs ${legado.ruins.length}`);

// G. El grifo CERRADO A MANO (el asiento de los mundos nuevos) no genera
// humanidad.
di('G · grifo cerrado: 0 ciudades', gCerrado.settlements.length === 0, `${gCerrado.settlements.length}`);
di('G · grifo cerrado: 0 calzadas', gCerrado.roads.length === 0, `${gCerrado.roads.length}`);
di('G · grifo cerrado: 0 ruinas', gCerrado.ruins.length === 0, `${gCerrado.ruins.length}`);

// H. El grifo abierto == el país de siempre, ciudad a ciudad.
di('H · grifo abierto == legado (ciudad a ciudad)',
  ciudades(g.settlements) === ciudades(legado.settlements),
  `${g.settlements.length} vs ${legado.settlements.length}`);
di('H · mismas calzadas', g.roads.length === legado.roads.length,
  `${g.roads.length} ≠ ${legado.roads.length}`);
di('H · mismas ruinas', ciudades(g.ruins) === ciudades(legado.ruins),
  `${g.ruins.length} vs ${legado.ruins.length}`);

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

// A. El defecto de los bancos sigue sembrando.
const A = sheet('everywhere');
di('A · everywhere siembra', sembrados(A).length > 0, `0 lugares en ${A.places.length}`);

// B1. 'auto' SIN ediciones = LEGADO: la hoja siembra exactamente como
// 'everywhere' — un mundo existente no pierde ni una granja (la corrección
// del 2026-08-13).
const B = sheet('auto');
const mundoB = B.places.filter((p) => p.worldId !== undefined).length;
const mundoA = A.places.filter((p) => p.worldId !== undefined).length;
const hitosA = A.places.filter((p) => p.kind === 'landmark').length;
di('B1 · auto sin ediciones == everywhere (legado)',
  huella(B).join('\n') === huella(A).join('\n'),
  `${huella(B).length} vs ${huella(A).length}`);
di('B1 · los pueblos del mundo se quedan', mundoB === mundoA, `${mundoB} ≠ ${mundoA}`);

// B2. El grifo CERRADO A MANO: enrejado a cero, pueblos del mundo intactos,
// y los hitos NOMBRADOS también callan (Luis: «lo mismo con fuentes,
// puentes» — el accidente es geografía, su nombre es contenido inventado).
const B2 = sheet('auto', [{ kind: 'placesEverywhere', enabled: false }]);
const mundoB2 = B2.places.filter((p) => p.worldId !== undefined).length;
const hitosB2 = B2.places.filter((p) => p.kind === 'landmark').length;
di('B2 · grifo cerrado = 0 sembrados', sembrados(B2).length === 0,
  `${sembrados(B2).length}: ${huella(B2).slice(0, 3).join(' · ')}`);
di('B2 · los pueblos del mundo se quedan', mundoB2 === mundoA, `${mundoB2} ≠ ${mundoA}`);
di('B2 · los hitos nombrados también callan', hitosB2 === 0, `${hitosB2} (A tiene ${hitosA})`);

// C. El grifo abierto reproduce 'everywhere' lugar a lugar.
const C = sheet('auto', [{ kind: 'placesEverywhere', enabled: true }]);
const hA = huella(A).join('\n');
const hC = huella(C).join('\n');
di('C · grifo abierto == everywhere (lugar a lugar)', hA === hC,
  `${huella(A).length} vs ${huella(C).length}`);
const hitosC = C.places.filter((p) => p.kind === 'landmark').length;
di('C · y los hitos vuelven todos', hitosC === hitosA, `${hitosC} ≠ ${hitosA}`);

// D. Una zona `add`: todo dentro, nada fuera.
// EN CELDAS DEL MUNDO Y A ESCALA DE LA HOJA: en un 256 una celda son ~156 km
// y la hoja entera (90 km) cabe en 0,6 celdas — un radio de 6 celdas la
// tragaba entera y las varas D/E medían una zona sin «fuera» (primer rojo de
// este banco, que era del banco). 0,15 celdas ≈ 23 km: un cuarto de hoja.
const R = 0.15;
const zona: WorldEdit = { kind: 'placesZone', mode: 'add', pts: [{ x: cap.x, y: cap.y }], radius: R };
// La lista de un mundo NUEVO con una zona pintada: el asiento `false` de
// nacimiento + la zona. (Una zona `add` a secas sobre suelo legado-abierto
// es redundante — el gesto con sentido allí es `remove`, la vara E.)
const D = sheet('auto', [{ kind: 'placesEverywhere', enabled: false }, zona]);
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
