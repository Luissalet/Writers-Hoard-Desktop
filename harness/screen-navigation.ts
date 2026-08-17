// =========================================================================
// Banco: la navegación de pantalla — buscar, acercarse al cursor, orientarse
// =========================================================================
// Cubre las tres cuentas del paquete de navegación (2026-08-15). Ninguna de las
// tres se puede comprobar mirando una captura: un buscador que ordena mal
// devuelve resultados igual de plausibles, una rueda mal anclada se ve como una
// rueda, y una brújula al revés sigue pareciendo una brújula. Por eso las tres
// viven en módulos puros y por eso existe este fichero.
//
//   npx tsx harness/screen-navigation.ts
//
// La cámara del segundo bloque es una `THREE.PerspectiveCamera` de verdad, con
// el mismo `lookAt(target)` que hace `OrbitControls.update()`: se proyecta el
// punto anclado ANTES y DESPUÉS del acercamiento y se comparan los PÍXELES. Si
// la invariante se rompe alguna vez, esto lo dice con un número.

import * as THREE from 'three';
import { foldForSearch, matchRank } from '../src/engines/worldgen/core/searchText';
import {
  anchoredDolly, anchoredGlobeDolly, northOnGlobe,
} from '../src/engines/worldgen/core/zoomAnchor';
import { niceScaleKm, northOnScreen } from '../src/engines/worldgen/cartography/screenFurniture';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------
console.log('── el localizador ──');

// Los nombres son los que ESTE motor produce: `core/naming.ts` compone «Río
// {n}», «Océano {n}», «Cañada {n}», «Bahía de {n}» y el epíteto «Sombrío».
const encuentra = (nombre: string, consulta: string): boolean =>
  matchRank(foldForSearch(nombre), foldForSearch(consulta)) >= 0;

check('«rio» encuentra «Río Sombrío»', encuentra('Río Sombrío', 'rio'),
  `rank=${matchRank(foldForSearch('Río Sombrío'), foldForSearch('rio'))}`);
check('«oceano» encuentra «Océano Vandarel»', encuentra('Océano Vandarel', 'oceano'), 'sin tilde');
check('«canada» encuentra «Cañada Honda»', encuentra('Cañada Honda', 'canada'), 'la eñe pliega a ene');
check('«bahia de» encuentra «Bahía de Torm»', encuentra('Bahía de Torm', 'bahia de'), 'con espacio');
check('la tilde de la CONSULTA tampoco estorba', encuentra('Rio Seco', 'río'),
  'plegar los dos lados, no sólo uno');
check('sigue sin encontrar lo que no está', !encuentra('Puerto Alto', 'zzz'), 'rank=-1');

const rInicio = matchRank(foldForSearch('Vado'), 'vado');
const rPalabra = matchRank(foldForSearch('Alto Vado'), 'vado');
const rDentro = matchRank(foldForSearch('Salvador'), 'vado');
check('empezar el nombre gana a empezar una palabra', rInicio < rPalabra, `${rInicio} < ${rPalabra}`);
check('empezar una palabra gana a caer dentro', rPalabra < rDentro, `${rPalabra} < ${rDentro}`);

// El orden completo del panel, con el desempate por importancia y por longitud.
interface Sitio { name: string; importance: number }
const ordenar = (pozo: Sitio[], q: string): string[] => {
  const fq = foldForSearch(q);
  return pozo
    .map((p) => ({ p, r: matchRank(foldForSearch(p.name), fq) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r || b.p.importance - a.p.importance || a.p.name.length - b.p.name.length)
    .map((m) => m.p.name);
};
const pozo: Sitio[] = [
  { name: 'Gran Vado Real', importance: 1.0 },   // capital: lo contiene
  { name: 'Vado', importance: 0.1 },             // aldea: se llama así
  { name: 'Salvadora', importance: 0.9 },        // lo lleva dentro de una palabra
];
const orden = ordenar(pozo, 'vado');
check('la aldea que SE LLAMA así va antes que la capital que lo contiene',
  orden[0] === 'Vado', orden.join(' · '));
check('lo que lleva la consulta dentro de una palabra va el último',
  orden[orden.length - 1] === 'Salvadora', orden.join(' · '));

// ---------------------------------------------------------------------------
console.log('\n── la rueda anclada al cursor ──');

/** Píxeles de un punto del mundo, con la cámara puesta como la pone el orbitador. */
const aPixeles = (cam: THREE.PerspectiveCamera, target: THREE.Vector3, P: THREE.Vector3,
  w: number, h: number) => {
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const v = P.clone().project(cam);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
};

const W = 1600, H = 900;
/** La pose del 3D: 52° sobre el suelo, mirando a un punto del terreno. */
const casos: { nombre: string; cam: [number, number, number]; mira: [number, number, number]; P: [number, number, number] }[] = [
  {
    nombre: 'ancla en el centro (el caso fácil)',
    cam: [0, 7.87, 6.15], mira: [0, 0, 0], P: [0, 0, 0],
  },
  {
    nombre: 'ancla en una ESQUINA del encuadre',
    cam: [0, 7.87, 6.15], mira: [0, 0, 0], P: [-3.4, 0.12, -2.1],
  },
  {
    nombre: 'cámara girada 40° y ancla a un lado',
    cam: [5.0, 6.2, 4.1], mira: [0.4, 0, -0.2], P: [-1.9, 0.35, 1.4],
  },
  {
    nombre: 'casi a ras de suelo (encuadre de comarca)',
    cam: [0.2, 0.42, 0.55], mira: [0.2, 0.05, 0.02], P: [0.05, 0.06, 0.10],
  },
];

for (const caso of casos) {
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.001, 4000);
  cam.position.set(...caso.cam);
  const mira = new THREE.Vector3(...caso.mira);
  const P = new THREE.Vector3(...caso.P);
  const antes = aPixeles(cam, mira, P, W, H);
  const dirAntes = new THREE.Vector3().subVectors(mira, cam.position).normalize();

  // Cuatro muescas de acercamiento seguidas, que es lo que da un golpe de rueda.
  for (let i = 0; i < 4; i++) {
    anchoredDolly(cam.position, mira, P, Math.pow(0.95, 1), 0.0001, 1e6);
  }
  const despues = aPixeles(cam, mira, P, W, H);
  const dirDespues = new THREE.Vector3().subVectors(mira, cam.position).normalize();
  const deriva = Math.hypot(despues.x - antes.x, despues.y - antes.y);
  // El ángulo con `atan2(|a×b|, a·b)` y no con `acos(a·b)`: cerca de cero
  // grados el coseno es plano y el arcocoseno pierde la mitad de las cifras —
  // dos vectores idénticos hasta el último bit daban 1,2e-6 grados de «giro»,
  // que es ruido del punto flotante y no una rotación. Así sale 1e-16.
  const giro = Math.atan2(
    new THREE.Vector3().crossVectors(dirAntes, dirDespues).length(),
    dirAntes.dot(dirDespues),
  ) * 180 / Math.PI;
  const acercado = cam.position.distanceTo(mira);

  check(`no se mueve lo señalado · ${caso.nombre}`, deriva < 0.01,
    `deriva ${deriva.toFixed(5)} px de ${W}×${H} · ${antes.x.toFixed(1)},${antes.y.toFixed(1)}`);
  check(`la orientación no cambia · ${caso.nombre}`, giro < 1e-6,
    `${giro.toExponential(1)}° · distancia ahora ${acercado.toFixed(3)}`);
}

// El alejamiento es el mismo gesto al revés, y tiene que volver al mismo sitio.
{
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.001, 4000);
  cam.position.set(0, 7.87, 6.15);
  const mira = new THREE.Vector3(0, 0, 0);
  const P = new THREE.Vector3(-3.4, 0.12, -2.1);
  const p0 = cam.position.clone(), m0 = mira.clone();
  anchoredDolly(cam.position, mira, P, Math.pow(0.95, 3), 0.0001, 1e6);
  anchoredDolly(cam.position, mira, P, Math.pow(0.95, -3), 0.0001, 1e6);
  const vuelta = cam.position.distanceTo(p0) + mira.distanceTo(m0);
  check('acercar y alejar lo mismo devuelve la cámara donde estaba', vuelta < 1e-9,
    `error ${vuelta.toExponential(2)}`);
}

// Los topes del orbitador siguen mandando: es el suelo de MIN_3D_SPAN_KM.
{
  const cam = { x: 0, y: 3, z: 4 };            // distancia 5 al origen
  const mira = { x: 0, y: 0, z: 0 };
  const P = { x: -1, y: 0, z: 1 };
  const movido = anchoredDolly(cam, mira, P, 0.5, 5, 100);
  check('en el suelo de acercamiento no se mueve nada', !movido && cam.y === 3,
    `movido=${movido} · cámara ${cam.x},${cam.y},${cam.z}`);
  const lejos = anchoredDolly(cam, mira, P, 2, 5, 100);
  const d = Math.hypot(cam.x - mira.x, cam.y - mira.y, cam.z - mira.z);
  check('alejarse desde el suelo sí funciona, y respeta el techo', lejos && d <= 100 + 1e-9,
    `distancia ${d.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
console.log('\n── la rueda anclada, en el GLOBO ──');

// Aquí no hay homotecia que valga: el punto de mira es el centro del planeta y
// no se puede tocar. La cámara se acerca Y gira, y lo que hay que demostrar es
// lo mismo — que el punto señalado no se mueve de su píxel.
const R_GLOBO = 1;   // el radio no importa: todo escala con él.

/** Píxeles de un punto, con la cámara mirando al centro del planeta. */
const globoAPixeles = (cam: THREE.PerspectiveCamera, P: THREE.Vector3, w: number, h: number) => {
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const v = P.clone().project(cam);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
};

const casosGlobo: { nombre: string; cam: [number, number, number]; P: [number, number, number] }[] = [
  {
    nombre: 'ancla en el centro',
    cam: [0, 0, 3], P: [0, 0, R_GLOBO],
  },
  {
    nombre: 'ancla a un tercio del borde',
    cam: [0, 0, 3], P: [0.42, 0.28, Math.sqrt(Math.max(0, 1 - 0.42 * 0.42 - 0.28 * 0.28))],
  },
  {
    nombre: 'cámara sobre latitud alta, ancla al sur',
    cam: [0.9, 2.2, 1.6], P: [0.2, 0.55, 0.81],
  },
  {
    nombre: 'muy cerca de la superficie',
    cam: [0.28, 0.35, 1.12], P: [0.24, 0.30, 0.92],
  },
];

for (const caso of casosGlobo) {
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.001, 4000);
  cam.position.set(...caso.cam);
  const P = new THREE.Vector3(...caso.P).normalize().multiplyScalar(R_GLOBO);
  const antes = globoAPixeles(cam, P, W, H);
  const ndcX = (antes.x / W) * 2 - 1;
  const ndcY = -((antes.y / H) * 2 - 1);
  const r0 = cam.position.length();

  for (let i = 0; i < 4; i++) {
    anchoredGlobeDolly(
      cam.position, P, ndcX, ndcY, cam.fov, cam.aspect,
      Math.pow(0.95, 1), R_GLOBO * 1.02, 40,
    );
  }
  const despues = globoAPixeles(cam, P, W, H);
  const deriva = Math.hypot(despues.x - antes.x, despues.y - antes.y);
  const r1 = cam.position.length();
  check(`el globo no mueve lo señalado · ${caso.nombre}`, deriva < 0.05,
    `deriva ${deriva.toFixed(4)} px · radio ${r0.toFixed(3)} → ${r1.toFixed(3)}`);
  check(`y de verdad se ha acercado · ${caso.nombre}`, r1 < r0 - 1e-6,
    `${((1 - r1 / r0) * 100).toFixed(1)} % más cerca`);
}

// El respaldo tiene que existir y tiene que ser un acercamiento recto.
{
  const cam = { x: 0, y: 3, z: 0 };            // justo encima del polo
  const P = { x: 0, y: 1, z: 0 };
  const movido = anchoredGlobeDolly(cam, P, 0.4, 0.3, 50, 1.7, 0.95, 1.02, 40);
  const enElEje = Math.abs(cam.x) < 1e-12 && Math.abs(cam.z) < 1e-12;
  check('sobre el polo se cae al acercamiento recto y no salta',
    movido && enElEje && Math.abs(cam.y - 2.85) < 1e-9,
    `cámara ${cam.x},${cam.y.toFixed(3)},${cam.z}`);
}
{
  const cam = { x: 0, y: 0, z: 1.02 };
  const P = { x: 0, y: 0, z: 1 };
  const movido = anchoredGlobeDolly(cam, P, 0, 0, 50, 1.7, 0.5, 1.02, 40);
  check('en el suelo de acercamiento del globo no se mueve nada',
    !movido && cam.z === 1.02, `movido=${movido} · z=${cam.z}`);
}

// ---------------------------------------------------------------------------
console.log('\n── el norte del globo: la razón de que NO haya brújula ──');

// La afirmación que sostiene la decisión de no dibujarla: con «arriba» clavado
// en +Y, la tangente del meridiano del punto que se mira se proyecta SIEMPRE en
// la vertical de la pantalla. Se comprueba contra una cámara de verdad:
// proyectando el punto sub-cámara y otro un pelo más al norte.
for (const pos of [
  [0, 0, 3], [2.1, 0.4, -1.8], [-1.2, 2.4, 0.7], [0.3, -2.6, 1.1],
] as const) {
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.001, 4000);
  cam.position.set(...pos);
  const Q = cam.position.clone().normalize().multiplyScalar(R_GLOBO);
  // Un paso hacia el norte SOBRE la esfera: la componente de +Y perpendicular.
  const t = new THREE.Vector3(0, 1, 0).addScaledVector(Q.clone().normalize(), -Q.clone().normalize().y).normalize();
  const Qn = Q.clone().addScaledVector(t, 0.02);
  const a = globoAPixeles(cam, Q, W, H);
  const b = globoAPixeles(cam, Qn, W, H);
  const real = { x: b.x - a.x, y: b.y - a.y };
  const l = Math.hypot(real.x, real.y);
  const dicho = northOnGlobe({ x: pos[0], y: pos[1], z: pos[2] });
  const ok = !!dicho && l > 1e-9
    && Math.hypot(dicho.x - real.x / l, dicho.y - real.y / l) < 1e-3;
  check(`el norte está ARRIBA desde (${pos.join(', ')})`,
    ok && !!dicho && Math.abs(dicho.x) < 1e-9 && Math.abs(dicho.y + 1) < 1e-9,
    dicho ? `dicho (${dicho.x.toFixed(3)}, ${dicho.y.toFixed(3)}) · cámara real (${(real.x / l).toFixed(3)}, ${(real.y / l).toFixed(3)})` : 'null');
}
check('sobre el polo no hay norte que señalar', northOnGlobe({ x: 0, y: 2, z: 0 }) === null, 'null');

// ---------------------------------------------------------------------------
console.log('\n── la escala y la brújula ──');

for (const [max, esperado] of [[150, 100], [4999, 2000], [5000, 5000], [0.9, 0.5], [1, 1]] as const) {
  const got = niceScaleKm(max);
  check(`la barra elige 1-2-5 · cabe ${max} km`, got === esperado && got <= max,
    `${got} km`);
}
check('una escala imposible no dibuja nada', niceScaleKm(0) === 0 && niceScaleKm(NaN) === 0, 'devuelve 0');

// Los cuatro rumbos que se pueden comprobar a mano. El norte del mundo es −z.
const rumbos: { nombre: string; f: [number, number]; esperado: [number, number] }[] = [
  { nombre: 'mirando al norte, el norte está ARRIBA', f: [0, -1], esperado: [0, -1] },
  { nombre: 'mirando al sur, el norte está ABAJO', f: [0, 1], esperado: [0, 1] },
  { nombre: 'mirando al oeste, el norte está a la DERECHA', f: [-1, 0], esperado: [1, 0] },
  { nombre: 'mirando al este, el norte está a la IZQUIERDA', f: [1, 0], esperado: [-1, 0] },
];
for (const r of rumbos) {
  const n = northOnScreen(r.f[0], r.f[1]);
  const ok = !!n && Math.abs(n.x - r.esperado[0]) < 1e-9 && Math.abs(n.y - r.esperado[1]) < 1e-9;
  check(r.nombre, ok, n ? `(${n.x.toFixed(2)}, ${n.y.toFixed(2)})` : 'null');
}
check('una mirada vertical no tiene rumbo', northOnScreen(0, 0) === null, 'null');

console.log(failures ? `\n${failures} varas ROJAS` : '\nTODO VERDE');
process.exit(failures ? 1 : 0);
