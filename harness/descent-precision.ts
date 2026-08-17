// ==========================================================================
// Banco: EL MARCO LOCAL — la aritmética que fijaba el suelo del 3D en 2 km
// ==========================================================================
// `descent-3d` mide la ESCALERA (vano → nivel de la piel → m/px). Este mide lo
// otro: la PRECISIÓN, que es lo que impedía bajar de dos kilómetros aunque la
// escalera llegara. No es una opinión sobre coma flotante — es la misma cuenta
// que hace el vértice, ejecutada aquí en float32 de verdad con `Math.fround`.
//
//   npx tsx harness/descent-precision.ts
//
// Los DOS escalones que había, los dos del mismo tamaño:
//
//  1 · LA UV DEL VÉRTICE. `w = uUVMin + uv * uUVSize`. Cerca de u = 0,5 el
//      escalón de un float32 es 2⁻²⁴ ≈ 6e-8, que en un mundo de 40.075 km son
//      2,4 m. El fragmento remataba la faena restando `vUV - uZoomMin` —dos
//      números de ~0,5 para dar ~1e-8—, que es una cancelación catastrófica de
//      manual, justo en la cuenta de la que sale el plano de calles.
//  2 · LA MATRIZ. `modelViewMatrix * p` restaba dos números de ~96 unidades de
//      escena para dar ~1e-3. A esa magnitud el escalón del float32 son 7,6e-6
//      unidades ≈ 1,3 m. Arreglar sólo el primero habría movido el tope de 2 km
//      a 1 y ahí se habría quedado, que es exactamente el tipo de arreglo que
//      parece funcionar y no funciona.
//
// La cura: el vértice trabaja en coordenadas RELATIVAS al centro de su ventana
// (números pequeños, toda la precisión) y las dos restas grandes suben a la CPU,
// que las hace en doble precisión — `mesh.position` para la matriz y `uZoomRel`
// para la piel. Este banco mide el antes y el después de las dos.

import { EARTH_KM, MIN_3D_SPAN_KM, MIN_SPAN_KM } from '../src/engines/worldgen/core/camera';
import { MIN_UV_WINDOW, SIZE_X } from '../src/engines/worldgen/sculpt/scene3d';
import { planZoomSkin } from '../src/engines/worldgen/cartography/zoomSkin';
import { PLAN_MAX_METRES_PER_PX } from '../src/engines/worldgen/region/townPlan';
import { MAX_SAT_TILE_Z } from '../src/engines/worldgen/region/satelliteTile';

let fallos = 0;
const vara = (nombre: string, ok: boolean, detalle: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${nombre} — ${detalle}`);
  if (!ok) fallos++;
};

const f = Math.fround;
const world = { width: 2048, height: 1024 };
/** Ancho de pantalla con el que se traducen los metros a píxeles. */
const PANTALLA_PX = 1400;
/**
 * El centro de la ventana. 0,5 NO es un caso cómodo elegido para que salga mal:
 * es el peor caso honesto y además el más probable —el mundo se genera centrado
 * y la cámara empieza ahí— y es donde el exponente del float32 cambia de tramo.
 * Con u = 0,37 los números salen parecidos; con u = 0,999 salen peores.
 */
const U0 = 0.5;
const V0 = 0.5;

/**
 * Cuántos valores DISTINTOS produce una cuenta a lo largo de una fila de
 * píxeles, y cuántos píxeles cuesta cada salto.
 *
 * Es la medida que importa y no «cuántos decimales se pierden»: lo que el
 * lector ve es que varios píxeles seguidos caen en el mismo punto del mundo y
 * el ráster se parte en escalones. Si hay tantos valores distintos como
 * píxeles, no hay bandas que ver.
 */
function escalon(muestra: (t: number) => number, n = PANTALLA_PX): { distintos: number; pxPorSalto: number } {
  const vistos = new Set<number>();
  for (let i = 0; i < n; i++) vistos.add(muestra(i / (n - 1)));
  return { distintos: vistos.size, pxPorSalto: n / Math.max(1, vistos.size) };
}

// ── 1 · La uv del vértice y la resta del fragmento ─────────────────────────
/** ANTES: la cuenta tal cual estaba, en float32. */
function zlViejo(spanKm: number) {
  const size = Math.max(MIN_UV_WINDOW, spanKm / EARTH_KM);
  const uvMin = f(U0 - size / 2);
  const zoomMin = f(U0 - size / 2);          // la piel cubre la misma ventana
  const sizeF = f(size);
  return escalon((t) => {
    const w = f(uvMin + f(t * sizeF));        // vUV, en el vértice
    const zx = f(w - zoomMin);                // la cancelación, en el fragmento
    return f(zx / sizeF);
  });
}
/** AHORA: `vLocal` pequeño y `uZoomRel` restado en la CPU en float64. */
function zlNuevo(spanKm: number) {
  const size = Math.max(MIN_UV_WINDOW, spanKm / EARTH_KM);
  const sizeF = f(size);
  // uZoomRel = centro de la ventana de la malla − esquina de la piel, en float64.
  const rel = f(U0 - (U0 - size / 2));
  return escalon((t) => {
    const d = f(f(t - 0.5) * sizeF);          // vLocal, en el vértice
    return f(f(rel + d) / sizeF);
  });
}

// ── 2 · La matriz ──────────────────────────────────────────────────────────
/** ANTES: el vértice daba su punto ABSOLUTO y la matriz restaba la cámara. */
function matrizVieja(spanKm: number) {
  const size = Math.max(MIN_UV_WINDOW, spanKm / EARTH_KM);
  const uvMin = f(U0 - size / 2);
  const sizeF = f(size);
  // La traslación de la modelView: −(posición de la cámara), del orden de 96.
  const tx = f(-(U0 - 0.5) * SIZE_X);
  return escalon((t) => {
    const w = f(uvMin + f(t * sizeF));
    const px = f(f(w - 0.5) * SIZE_X);        // placeAt
    return f(px + tx);                        // modelViewMatrix * p
  });
}
/** AHORA: el vértice da coordenadas locales y three.js compone la matriz en la
 *  CPU en doble precisión, así que la traslación que llega ya es pequeña. */
function matrizNueva(spanKm: number) {
  const size = Math.max(MIN_UV_WINDOW, spanKm / EARTH_KM);
  const sizeF = f(size);
  const tx = f(0);                            // pivote y cámara casi coinciden
  return escalon((t) => {
    const d = f(f(t - 0.5) * sizeF);
    return f(f(d * SIZE_X) + tx);
  });
}

const VANOS = [2, 1, 0.5, 0.25];
console.log('── el escalón de la PIEL (la uv del vértice + la resta del fragmento) ──');
console.log('   vano |        antes         |         ahora');
console.log('        | valores  px/salto    | valores  px/salto');
const piel: { km: number; antes: number; ahora: number }[] = [];
for (const km of VANOS) {
  const a = zlViejo(km), b = zlNuevo(km);
  piel.push({ km, antes: a.pxPorSalto, ahora: b.pxPorSalto });
  console.log(`${String(km).padStart(7)} | ${String(a.distintos).padStart(7)}  ${a.pxPorSalto.toFixed(2).padStart(7)}    `
    + `| ${String(b.distintos).padStart(7)}  ${b.pxPorSalto.toFixed(2).padStart(7)}`);
}

console.log('\n── el escalón de la MATRIZ (píxeles de pantalla por salto) ──');
console.log('   vano | antes | ahora');
const matriz: { km: number; antes: number; ahora: number }[] = [];
for (const km of VANOS) {
  const a = matrizVieja(km), b = matrizNueva(km);
  matriz.push({ km, antes: a.pxPorSalto, ahora: b.pxPorSalto });
  console.log(`${String(km).padStart(7)} | ${a.pxPorSalto.toFixed(2).padStart(5)} | ${b.pxPorSalto.toFixed(2).padStart(5)}`);
}

/**
 * Y EL ESCALÓN DE VERDAD, sin depender de cuántas muestras tome este banco.
 *
 * Contar valores distintos a lo largo de 1400 muestras no puede dar nunca menos
 * de «un valor por muestra», así que con la cuenta NUEVA la tabla se planta en
 * 1,00 px y no dice cuánto margen hay de sobra — y pedirle menos de un
 * milímetro era pedirle algo aritméticamente imposible (el primer intento de
 * este banco lo hizo y salió rojo midiendo su propio muestreo). El escalón real
 * es el ULP del float32 a la magnitud en la que se hace la cuenta.
 */
const ulp32 = (m: number) => 2 ** (Math.floor(Math.log2(Math.abs(m))) - 23);
const M_POR_UV = EARTH_KM * 1000;
const M_POR_UNIDAD = (EARTH_KM * 1000) / SIZE_X;
const uvAntes = ulp32(U0) * M_POR_UV;                       // sumar sobre ~0,5
const uvAhora = ulp32(MIN_3D_SPAN_KM / EARTH_KM / 2) * M_POR_UV;  // sobre ~size/2
const mvAntes = ulp32(0.4 * SIZE_X) * M_POR_UNIDAD;         // restar sobre ~96 u
const mvAhora = ulp32((MIN_3D_SPAN_KM / EARTH_KM / 2) * SIZE_X) * M_POR_UNIDAD;
console.log('\n── el escalón REAL, por el ULP del float32 (metros de suelo) ──');
console.log(`   uv del vértice : ${uvAntes.toFixed(3)} m  →  ${(uvAhora * 1e6).toFixed(2)} µm`);
console.log(`   modelView      : ${mvAntes.toFixed(3)} m  →  ${(mvAhora * 1e6).toFixed(2)} µm`);

console.log('');

// ── Las varas ──────────────────────────────────────────────────────────────

// La vara que retrata el problema: a 0,25 km, ANTES, la piel saltaba de píxel
// en píxel de diez en diez. Si esto deja de ser verdad es que el banco ya no
// mide la cuenta que había, y entonces el «después» no demuestra nada.
{
  const a = piel.find((p) => p.km === 0.25)!;
  vara('el banco reproduce el fallo: a 0,25 km la piel saltaba cada muchos píxeles',
    a.antes >= 5, `${a.antes.toFixed(1)} px por salto con la cuenta vieja`);
}
// Y la que retrata el SEGUNDO escalón, el de la matriz, que es el que habría
// dejado el arreglo a medias: arreglar la uv y no esto mueve el tope a 1 km.
{
  const m = matriz.find((p) => p.km === 0.25)!;
  vara('y el segundo escalón, el de la matriz, era del mismo orden',
    m.antes >= 5 && mvAntes > 0.5,
    `${m.antes.toFixed(1)} px por salto · ULP de ${mvAntes.toFixed(2)} m`);
}
// El después: un valor distinto por píxel, que es todo lo que se puede pedir.
for (const p of piel) {
  vara(`a ${p.km} km de vano la piel tiene un valor por píxel`,
    p.ahora <= 1.001, `${p.ahora.toFixed(3)} px por salto`);
}
for (const m of matriz) {
  vara(`a ${m.km} km de vano la geometría tiene un valor por píxel`,
    m.ahora <= 1.001, `${m.ahora.toFixed(3)} px por salto`);
}

// EL PRESUPUESTO que justifica el número nuevo: el escalón tiene que caber
// dentro de un píxel de pantalla, que es la única definición operativa de «no
// se ve». Con el ULP real, y no con el muestreo de este banco.
{
  const pxPorMetro = PANTALLA_PX / (MIN_3D_SPAN_KM * 1000);
  vara('en el suelo nuevo, los dos escalones caben mil veces dentro de un píxel',
    Math.max(uvAhora, mvAhora) * pxPorMetro < 0.001,
    `uv ${(uvAhora * pxPorMetro).toExponential(1)} px · matriz `
      + `${(mvAhora * pxPorMetro).toExponential(1)} px (antes: `
      + `${(uvAntes * pxPorMetro).toFixed(1)} y ${(mvAntes * pxPorMetro).toFixed(1)})`);
}

// Y las consecuencias declaradas, que son las que puede romper alguien que
// «limpie» una constante sin leer el comentario.
vara('el suelo del 3D es ya el del contrato compartido',
  MIN_3D_SPAN_KM === MIN_SPAN_KM, `${MIN_3D_SPAN_KM} km = ${MIN_SPAN_KM} km`);
vara('MIN_UV_WINDOW deja de ser el tope escondido, con margen de sobra',
  MIN_UV_WINDOW * 6 <= MIN_3D_SPAN_KM / EARTH_KM,
  `${(MIN_UV_WINDOW * EARTH_KM).toFixed(3)} km de ventana mínima frente a `
    + `${MIN_3D_SPAN_KM} km de vano mínimo (×${(MIN_3D_SPAN_KM / EARTH_KM / MIN_UV_WINDOW).toFixed(1)})`);

// Y que al fondo del descenso sigue habiendo calles que enseñar.
{
  const uSize = Math.max(MIN_UV_WINDOW, MIN_3D_SPAN_KM / EARTH_KM);
  const plan = planZoomSkin(world, { u: U0, v: V0, uSize, vSize: uSize }, { maxZ: MAX_SAT_TILE_Z });
  const mpp = plan ? ((plan.view.w / world.width) * EARTH_KM * 1000) / plan.width : Infinity;
  vara('en el nuevo suelo la piel sigue entintando calles',
    !!plan && mpp <= PLAN_MAX_METRES_PER_PX,
    plan ? `z${plan.z} · ${mpp.toFixed(2)} m/px (el plano dibuja desde ${PLAN_MAX_METRES_PER_PX})` : 'sin plan');
}

console.log(fallos ? `\n${fallos} varas ROJAS` : '\nTODO VERDE');
process.exit(fallos ? 1 : 0);
