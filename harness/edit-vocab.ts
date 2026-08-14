// Renombrar, borrar y redibujar sobre contenido GENERADO: ¿sobrevive al replay,
// y sobrevive a que el mundo se regenere desde la semilla?
import { getWorld } from './world-cache';
import { PaintSession } from '../src/engines/worldgen/core/paintSession';
import { editKey, type WorldEdit } from '../src/engines/worldgen/core/edits';
import { getGeography, rebuildGeography } from '../src/engines/worldgen/cartography/texture';

const w = getWorld({ seed: 'monstruo', width: 1024 });
// EL GRIFO ABIERTO, y DENTRO de la sesión: desde la pasada 10 un mundo nace
// desnudo, y este banco renombra capitales y ruinas GENERADAS. El grifo va
// como primera edición de la sesión para que la lista serializada sea
// autosuficiente — la mitad «regenerar desde la semilla» arranca de un mundo
// desnudo fresco y debe reabrir el grifo ella sola desde el JSON.
const s = new PaintSession(w);
s.push({ kind: 'placesEverywhere', enabled: true });
const g0 = rebuildGeography(w);
const cap = g0.settlements.find((s) => s.rank === 'capital')!;
const doomed = g0.settlements.filter((s) => s.rank === 'village')[0];
const ruin = g0.ruins[0];
const sea = g0.features.find((f) => f.kind === 'ocean')!;
const realm = g0.realms[0];
console.log(`antes: capital "${cap.name}", aldea "${doomed.name}", ruina "${ruin.name}"`);
console.log(`       océano "${sea.name}", reino "${realm.name}" · ${g0.roads.length} calzadas`);

const edits: WorldEdit[] = [
  { kind: 'rename', target: 'settlement', key: editKey('settlement', cap.x, cap.y), name: 'Ciudad de las Puertas' },
  { kind: 'remove', target: 'settlement', key: editKey('settlement', doomed.x, doomed.y) },
  { kind: 'rename', target: 'ruin', key: editKey('ruin', ruin.x, ruin.y), name: 'El Sepulcro' },
  { kind: 'rename', target: 'feature', key: editKey('feature', sea.x, sea.y, `${sea.kind}:`), name: 'Mar de los Ahogados' },
  { kind: 'rename', target: 'realm', key: `realm:${realm.id}`, name: 'Imperio de Hierro' },
  { kind: 'road', pts: [{ x: cap.x, y: cap.y }, { x: cap.x + 40, y: cap.y + 25 }, { x: cap.x + 80, y: cap.y + 10 }], major: true },
];
for (const e of edits) s.push(e);
const g1 = rebuildGeography(w);
const has = (n: string) => g1.settlements.some((x) => x.name === n) || g1.ruins.some((x) => x.name === n)
  || g1.features.some((x) => x.name === n) || g1.realms.some((x) => x.name === n);
console.log(`\ncapital renombrada:    ${has('Ciudad de las Puertas') ? 'sí' : 'NO'}`);
console.log(`aldea borrada:         ${g1.settlements.some((x) => x.x === doomed.x && x.y === doomed.y) ? 'NO' : 'sí'}`);
console.log(`ruina renombrada:      ${has('El Sepulcro') ? 'sí' : 'NO'}`);
console.log(`océano renombrado:     ${has('Mar de los Ahogados') ? 'sí' : 'NO'}`);
console.log(`reino renombrado:      ${has('Imperio de Hierro') ? 'sí' : 'NO'}`);
console.log(`calzada a mano:        ${g1.roads.length === g0.roads.length + 1 ? 'sí' : `NO (${g0.roads.length} → ${g1.roads.length})`}`);

// Vía barata (la que se usa entre pincelada y pincelada)
const g2 = getGeography(w);
console.log(`\nvía rápida conserva el renombrado: ${g2.settlements.some((x) => x.name === 'Ciudad de las Puertas') ? 'sí' : 'NO'}`);

// Y lo que de verdad importa: ¿sobrevive a regenerar el mundo desde la semilla?
const json = s.serialize();
console.log(`lista serializada: ${json.length} bytes`);
const fresh = getWorld({ seed: 'monstruo', width: 1024 });
const s2 = new PaintSession(fresh);
s2.load(json);
const g3 = rebuildGeography(fresh);
console.log(`tras regenerar desde la semilla:   ${g3.settlements.some((x) => x.name === 'Ciudad de las Puertas') ? 'sí' : 'NO'}`);
