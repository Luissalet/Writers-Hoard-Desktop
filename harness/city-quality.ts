// Banco: ¿el plano de la ciudad SIRVE, o sólo tiene las piezas contadas?
//
//   npx tsx harness/city-quality.ts [semilla]
//
// Los bancos que ya había miden el reloj y el inventario: cuántas manzanas,
// cuántos edificios, cuántas puertas, cuántas torres, cuántos puentes. Ninguno
// mide si el trazado se puede habitar. Todos los defectos reales de este
// generador se han encontrado MIRANDO la lámina, y el único fallo estructural
// —el barrio 'gate', que no se asignó jamás en ningún pueblo— sobrevivió a
// cuatro pasadas medidas porque no había una sola cifra que lo contara.
//
// Lo que se mide aquí es lo que un lector nota sin saber por qué:
//
//   · una casa a la que no se llega,
//   · una casa que no da a ninguna calle,
//   · una casa de doce metros cuadrados o de mil,
//   · un camino que sale de la muralla por donde no hay puerta,
//   · dos rótulos escritos encima,
//   · una casa dentro del río,
//   · el mismo pueblo que sale distinto dos veces.
//
// El método para las dos primeras es una RASTERIZACIÓN del plano: se pintan los
// edificios y el agua en una malla fina, el suelo del pueblo se toma como
// dominio, y se inunda desde las puertas. Lo que la inundación no toca, no se
// alcanza. Medirlo sobre vectores —«¿está esta casa cerca de una polilínea de
// calle?»— da la respuesta equivocada, porque la mayoría de las casas de este
// generador no dan a una calle trazada: dan al HUECO entre manzanas, que no se
// exporta y que es, de hecho, la calle.
//
// Y donde la malla puede mentir —anchos de calle a la escala de la celda— se
// mide otra vez sin ella, recorriendo el lindero y la calzada y midiendo la
// distancia al edificio más cercano. Las dos veces que este banco se equivocó
// durante su propia construcción, fue la medida vectorial la que lo destapó.
//
// Convive con `city-shape.ts` (forma y centralidad) y `city-debug.ts` (anchos
// de banda en pantalla); esto es lo que va debajo de los dos.

import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {
  generateCity, DEFAULT_CITY,
  type CityPlan, type CityParams, type WardType,
} from '../src/engines/worldgen/city/generate';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import { area, centroid, dist, type V, type Poly } from '../src/engines/worldgen/city/geometry';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

try { GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora'); } catch { /* la fuente es un lujo, no un requisito */ }

// ---------------------------------------------------------------------------
// Convenios
// ---------------------------------------------------------------------------

/** Una unidad de ciudad son cuatro metros. Todo lo humano se dice en metros. */
const M_POR_U = 4;
const m2 = (areaEnU2: number) => areaEnU2 * M_POR_U * M_POR_U;

const SEMILLA = process.argv[2] || 'calidad';

let rojos = 0;
let cheques = 0;
const check = (ok: boolean, etiqueta: string, detalle: string) => {
  cheques++;
  if (!ok) rojos++;
  console.log(`  ${ok ? 'OK   ' : 'ROJO '} ${etiqueta} — ${detalle}`);
};
const info = (etiqueta: string, detalle: string) => console.log(`  ·     ${etiqueta} — ${detalle}`);

const pct = (xs: number[], q: number): number =>
  xs.length ? xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * q)))] : NaN;
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const f0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—');

// ---------------------------------------------------------------------------
// El corpus
// ---------------------------------------------------------------------------
// Cuatro geografías por tres tamaños. Las cuatro geografías existen porque cada
// una rompe una cosa distinta: el río parte el pueblo en dos y necesita
// puentes, la costa recorta la muralla y prohíbe puertas, y las dos juntas son
// donde se cruzan los dos recortes. Los tamaños van de aldea (8) a ciudad
// grande (40) porque las dos puntas fallan por motivos opuestos: en la aldea no
// hay nada, y en la ciudad hay demasiado para el mismo número de puertas.

interface Caso { tag: string; params: CityParams }
const CASOS: Caso[] = [];
{
  const geos: [string, Partial<CityParams>][] = [
    ['interior', {}],
    ['río', { river: true, riverDir: { x: 1, y: 0.25 } }],
    ['costa', { coast: true, coastDir: { x: 0, y: 1 } }],
    ['río+costa', { river: true, riverDir: { x: 0.25, y: 1 }, coast: true, coastDir: { x: 0, y: 1 } }],
  ];
  for (const [gtag, g] of geos) {
    for (const size of [8, 20, 40]) {
      CASOS.push({
        tag: `${gtag} ${size}`,
        params: {
          ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
          walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
        },
      });
    }
  }
}

console.log(`\nCALIDAD DEL PLANO URBANO · semilla «${SEMILLA}» · ${CASOS.length} ciudades`);
const t0 = Date.now();
const PLANOS: { caso: Caso; plan: CityPlan }[] = CASOS.map((caso) => ({ caso, plan: generateCity(caso.params) }));
console.log(`${PLANOS.length} planos generados en ${Date.now() - t0} ms\n`);

// ---------------------------------------------------------------------------
// La malla: el plano pintado, para poder recorrerlo
// ---------------------------------------------------------------------------

interface Malla {
  x0: number; y0: number; cell: number; w: number; h: number;
  /** 1 = infranqueable: edificio o agua. */
  bloq: Uint8Array;
  /** 1 = agua abierta (para el informe del agua, no para el paso). */
  agua: Uint8Array;
  /**
   * 1 = suelo del pueblo.
   *
   * LA MURALLA NO SE PINTA COMO OBSTÁCULO, se usa como BORDE DEL DOMINIO. Se
   * intentó pintarla y fue un desastre instructivo: el trazo con que se dibuja
   * mide 1,7 u (6,8 m, grosor de tinta, no de fábrica) y va centrado en el
   * mismo contorno del que las manzanas se retranquean 0,5 u, así que la banda
   * se tragaba entera la calle de ronda y sellaba el pueblo. El banco medía su
   * propia venda: 10 % de fachada en un pueblo que la tiene toda.
   *
   * El dominio es la unión de los distritos interiores, que es exactamente el
   * suelo intramuros, más un disco en cada puerta para que el hueco exista.
   */
  dentro: Uint8Array;
  /** Distancia al obstáculo más cercano, en unidades. Media anchura del hueco. */
  holgura: Float32Array;
}

const idx = (m: Malla, i: number, j: number) => j * m.w + i;
const celdaDe = (m: Malla, v: V) => {
  const i = Math.floor((v.x - m.x0) / m.cell);
  const j = Math.floor((v.y - m.y0) / m.cell);
  if (i < 0 || j < 0 || i >= m.w || j >= m.h) return -1;
  return j * m.w + i;
};

/** Rellena un polígono por barrido de líneas, marcando la celda cuyo CENTRO cae
 *  dentro. Redondear hacia fuera engordaba cada casa media celda y estrechaba
 *  todos los callejones, que es justo lo que este banco mide. */
function pintaPoligono(m: Malla, buf: Uint8Array, poly: Poly, valor = 1): void {
  if (poly.length < 3) return;
  let ya = Infinity, yb = -Infinity;
  for (const v of poly) { ya = Math.min(ya, v.y); yb = Math.max(yb, v.y); }
  const j0 = Math.max(0, Math.floor((ya - m.y0) / m.cell));
  const j1 = Math.min(m.h - 1, Math.ceil((yb - m.y0) / m.cell));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const yc = m.y0 + (j + 0.5) * m.cell;
    xs.length = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      if ((a.y <= yc) === (b.y <= yc)) continue;
      xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - m.x0) / m.cell - 0.5));
      const i1 = Math.min(m.w - 1, Math.floor((xs[k + 1] - m.x0) / m.cell - 0.5));
      const base = j * m.w;
      for (let i = i0; i <= i1; i++) buf[base + i] = valor;
    }
  }
}

/** Marca todo lo que esté a menos de `r` de una polilínea: murallas y ríos. */
function pintaLinea(m: Malla, buf: Uint8Array, pts: V[], r: number, valor = 1): void {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - m.x0) / m.cell));
    const i1 = Math.min(m.w - 1, Math.ceil((Math.max(a.x, b.x) + r - m.x0) / m.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - m.y0) / m.cell));
    const j1 = Math.min(m.h - 1, Math.ceil((Math.max(a.y, b.y) + r - m.y0) / m.cell));
    const dx = b.x - a.x, dy = b.y - a.y;
    const ll = dx * dx + dy * dy || 1e-9;
    for (let j = j0; j <= j1; j++) {
      const yc = m.y0 + (j + 0.5) * m.cell;
      for (let i = i0; i <= i1; i++) {
        const xc = m.x0 + (i + 0.5) * m.cell;
        let t = ((xc - a.x) * dx + (yc - a.y) * dy) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = xc - (a.x + dx * t), ey = yc - (a.y + dy * t);
        if (ex * ex + ey * ey <= r * r) buf[j * m.w + i] = valor;
      }
    }
  }
}

function pintaDisco(m: Malla, buf: Uint8Array, c: V, r: number, valor = 1): void {
  const i0 = Math.max(0, Math.floor((c.x - r - m.x0) / m.cell));
  const i1 = Math.min(m.w - 1, Math.ceil((c.x + r - m.x0) / m.cell));
  const j0 = Math.max(0, Math.floor((c.y - r - m.y0) / m.cell));
  const j1 = Math.min(m.h - 1, Math.ceil((c.y + r - m.y0) / m.cell));
  for (let j = j0; j <= j1; j++) {
    const yc = m.y0 + (j + 0.5) * m.cell;
    for (let i = i0; i <= i1; i++) {
      const xc = m.x0 + (i + 0.5) * m.cell;
      if ((xc - c.x) ** 2 + (yc - c.y) ** 2 <= r * r) buf[j * m.w + i] = valor;
    }
  }
}

/** El ancho del río, en unidades. El generador lo fija en `radio · 0,09`; si el
 *  contrato nuevo (`waters.river.width`) llega a llenarse, manda ése. */
const anchoRio = (plan: CityPlan) => plan.waters?.river?.width ?? plan.radius * 0.09;

const mojado = (plan: CityPlan, v: V, holgura = 0): boolean => {
  const c = plan.coast;
  return !!c && (v.x - c.p.x) * c.n.x + (v.y - c.p.y) * c.n.y > holgura;
};
const enRio = (plan: CityPlan, v: V, r: number): boolean =>
  !!plan.river && plan.river.some((rp) => dist(rp, v) < r);

function construyeMalla(plan: CityPlan): Malla {
  // El encuadre: los distritos interiores más las puertas y sus caminos de
  // salida, con margen. El campo entero no hace falta y multiplicaría por
  // cuatro el coste.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const mete = (v: V) => { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); };
  for (const q of plan.patches) if (q.withinCity) for (const v of q.shape) mete(v);
  for (const g of plan.gates) mete(g);
  for (const r of plan.roads) mete(r[Math.min(2, r.length - 1)]);
  if (!Number.isFinite(x0)) { x0 = plan.center.x - plan.radius; y0 = plan.center.y - plan.radius; x1 = -x0; y1 = -y0; }
  const pad = 8;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;

  // Celda de 0,3 u = 1,2 m. Es la resolución a la que un callejón de 2,4 m
  // (ALLEY = 0,6 u) sigue teniendo dos celdas de interior; a 0,8 u desaparece y
  // el banco declara selladas manzanas que no lo están. Comprobado bajando a
  // 0,25 u: el suelo alcanzado sólo sube del 48,6 % al 54,0 %, o sea que lo que
  // queda cerrado lo está de verdad y no es el redondeo. Tope de 2 000 celdas
  // por lado para que una ciudad de tamaño 40 no se coma la memoria.
  const extent = Math.max(x1 - x0, y1 - y0);
  const cell = Math.max(0.3, extent / 2000);
  const w = Math.max(4, Math.ceil((x1 - x0) / cell));
  const h = Math.max(4, Math.ceil((y1 - y0) / cell));
  const m: Malla = {
    x0, y0, cell, w, h,
    bloq: new Uint8Array(w * h), agua: new Uint8Array(w * h),
    dentro: new Uint8Array(w * h), holgura: new Float32Array(w * h),
  };

  // 1. El dominio: el suelo del pueblo, distrito a distrito, más el hueco de
  //    cada puerta. La ciudadela NO se cierra: tiene una puerta que el
  //    generador no modela, y tapiarla declararía el castillo inalcanzable en
  //    todas las ciudades.
  for (const q of plan.patches) if (q.withinCity) pintaPoligono(m, m.dentro, q.shape);
  for (const g of plan.gates) pintaDisco(m, m.dentro, g, 3.0);

  // 2. Los edificios.
  for (const q of plan.patches) for (const b of q.buildings) pintaPoligono(m, m.bloq, b.shape);

  // 3. El agua. El mar como semiplano y el río como banda; se marca aparte
  //    porque el informe de agua la necesita separada de la piedra.
  const rio = anchoRio(plan);
  if (plan.coast) {
    const c = plan.coast;
    for (let j = 0; j < h; j++) {
      const yc = y0 + (j + 0.5) * cell;
      for (let i = 0; i < w; i++) {
        const xc = x0 + (i + 0.5) * cell;
        if ((xc - c.p.x) * c.n.x + (yc - c.p.y) * c.n.y > 0) m.agua[j * w + i] = 1;
      }
    }
  }
  if (plan.river) pintaLinea(m, m.agua, plan.river, rio * 0.8);
  // 4. Puentes y embarcaderos devuelven el paso sobre el agua.
  for (const b of plan.bridges) pintaPoligono(m, m.agua, b, 0);
  for (const p of plan.piers) pintaPoligono(m, m.agua, p, 0);
  for (let k = 0; k < m.agua.length; k++) if (m.agua[k]) m.bloq[k] = 1;
  // Un puente es suelo, y es suelo del pueblo aunque el cauce no lo sea.
  for (const b of plan.bridges) { pintaPoligono(m, m.bloq, b, 0); pintaPoligono(m, m.dentro, b, 1); }

  // 5. Transformada de distancia (chamfer 3-4 en dos pasadas): cuánto hueco hay
  //    en cada punto. Es lo que distingue una calle de una grieta entre casas.
  const D = m.holgura;
  const BIG = 1e6;
  for (let k = 0; k < D.length; k++) D[k] = m.bloq[k] ? 0 : BIG;
  const d1 = 0.9619, d2 = 1.3604; // chamfer 5-7-11 normalizado: < 2 % de error
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (D[k] === 0) continue;
      let v = D[k];
      if (i > 0) v = Math.min(v, D[k - 1] + d1);
      if (j > 0) v = Math.min(v, D[k - w] + d1);
      if (i > 0 && j > 0) v = Math.min(v, D[k - w - 1] + d2);
      if (i < w - 1 && j > 0) v = Math.min(v, D[k - w + 1] + d2);
      D[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      if (D[k] === 0) continue;
      let v = D[k];
      if (i < w - 1) v = Math.min(v, D[k + 1] + d1);
      if (j < h - 1) v = Math.min(v, D[k + w] + d1);
      if (i < w - 1 && j < h - 1) v = Math.min(v, D[k + w + 1] + d2);
      if (i > 0 && j < h - 1) v = Math.min(v, D[k + w - 1] + d2);
      D[k] = v;
    }
  }
  for (let k = 0; k < D.length; k++) D[k] = Math.min(D[k], BIG) * cell;
  return m;
}

/**
 * Inunda desde `semillas` por el suelo del pueblo cuya holgura llegue al mínimo.
 *
 * LA VECINDAD NO ES UN DETALLE. A pie se anda en cruz (cuatro vecinos): así dos
 * edificios que sólo se tocan por la esquina no dejan pasar a nadie, que es lo
 * correcto. Para el carro se anda en las ocho direcciones, y esto costó una
 * lectura falsa entera: una calle en diagonal produce una cadena de celdas
 * holgadas que NO están conectadas en cruz, y el banco declaró intransitable el
 * 97 % de la red de un pueblo cuyas calles miden, medidas una a una sobre el
 * lindero, 1,00 u de punta a punta. En diagonal no hay fuga por esquina porque
 * la propia exigencia de holgura ya la impide.
 */
function inunda(m: Malla, semillas: V[], minHolgura: number): Uint8Array {
  const vis = new Uint8Array(m.w * m.h);
  const cola = new Int32Array(m.w * m.h);
  const paso = (n: number) => !vis[n] && m.dentro[n] === 1 && !m.bloq[n] && m.holgura[n] >= minHolgura;
  const diag = minHolgura > 0;
  let cab = 0, fin = 0;
  for (const s of semillas) {
    const k = celdaLibreCerca(m, s, 5, minHolgura);
    if (k >= 0 && !vis[k]) { vis[k] = 1; cola[fin++] = k; }
  }
  while (cab < fin) {
    const k = cola[cab++];
    const i = k % m.w, j = (k / m.w) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if ((!di && !dj) || (!diag && di && dj)) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= m.w || jj >= m.h) continue;
        const n = jj * m.w + ii;
        if (paso(n)) { vis[n] = 1; cola[fin++] = n; }
      }
    }
  }
  return vis;
}

/** La celda de suelo libre más cercana a `v`, en espiral hasta `r` unidades. */
function celdaLibreCerca(m: Malla, v: V, r: number, minHolgura = 0): number {
  const ok = (k: number) => m.dentro[k] === 1 && !m.bloq[k] && m.holgura[k] >= minHolgura;
  const k0 = celdaDe(m, v);
  if (k0 >= 0 && ok(k0)) return k0;
  const R = Math.ceil(r / m.cell);
  const i0 = Math.floor((v.x - m.x0) / m.cell), j0 = Math.floor((v.y - m.y0) / m.cell);
  for (let rad = 1; rad <= R; rad++) {
    for (let dj = -rad; dj <= rad; dj++) {
      for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
        const k = j * m.w + i;
        if (ok(k)) return k;
      }
    }
  }
  return -1;
}

/**
 * Los puntos de fachada de un edificio: sobre cada lado, hacia FUERA.
 *
 * Muestrear el contorno cada media unidad y salir por la normal exterior da,
 * para una casa de burgo de 6 × 10 m, unos veinte tanteos — bastantes para no
 * perder un portal de dos metros, y baratos comparados con recorrer la caja
 * envolvente celda a celda (mil por casa, cinco mil casas por ciudad).
 */
function puntosFachada(poly: Poly, salidas: number[]): V[] {
  const c = centroid(poly);
  const out: V[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const L = dist(a, b);
    const pasos = Math.max(1, Math.round(L / 0.5));
    let nx = -(b.y - a.y) / (L || 1), ny = (b.x - a.x) / (L || 1);
    const mx = (a.x + b.x) / 2 - c.x, my = (a.y + b.y) / 2 - c.y;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } // hacia fuera, siempre
    for (const salida of salidas) {
      for (let s = 0; s <= pasos; s++) {
        const t = s / pasos;
        out.push({ x: a.x + (b.x - a.x) * t + nx * salida, y: a.y + (b.y - a.y) * t + ny * salida });
      }
    }
  }
  return out;
}

// ===========================================================================
// 1 y 2. CONECTIVIDAD Y FACHADA
// ===========================================================================
// Las dos preguntas que decide la misma inundación, a dos granos distintos:
//
//   CONECTIVIDAD (manzana → puerta, con un carro). Un pueblo cuyo centro no
//   llega a su muralla no es un pueblo. Se exige holgura de carro: 0,25 u de
//   distancia al obstáculo más cercano. Ese número sale de la propia malla y no
//   de la nada: a 0,3 u de celda, la transformada de distancia sólo puede dar
//   0,29 · 0,58 · 0,87…, y 0,29 significa «hay al menos una celda entera de
//   separación», o sea un pasillo de tres celdas ≥ 0,9 u ≈ 3,6 m. Eso es
//   exactamente lo que ocupa un carro. Y coincide con la medida vectorial, que
//   no depende de la malla: recorriendo el lindero entre distritos, el hueco
//   libre mide 1,00 u de mediana (4 m) y sólo el 1-5 % baja de 0,9 u — o sea
//   que las calles son de carro y los callejones interiores (ALLEY = 0,6 u) no.
//
//   FACHADA (edificio → espacio público, a pie). Qué fracción de las casas tiene
//   de verdad una puerta a algo, en vez de quedarse en mitad de la manzana. Es
//   la cifra que justifica el parcelado en burgos: sin él, `createAlleys`
//   cortaba cuadriláteros y el interior de una manzana grande quedaba macizo.
//   A pie: holgura 0, o sea cualquier hueco de una celda.

console.log('1 · CONECTIVIDAD — ¿sale un carro de cada manzana hasta una puerta?');

const HOLGURA_CARRO = 0.25;
const SALIDA_FACHADA = [0.35, 0.8];       // el umbral de la puerta, a 1,4 y 3,2 m
const ALCANCE_CARRO = [0.5, 1.2, 2.0, 3.0]; // hasta dónde vale que la calle esté

interface MedidaAcceso {
  caso: Caso; plan: CityPlan;
  edificios: number; varados: number;
  /** Tiene hueco pegado a la pared, pero ese hueco no comunica con la calle. */
  huecoCiego: number;
  /** No tiene hueco ninguno: está macizado contra sus vecinos por los cuatro lados. */
  sinHueco: number;
  manzanas: number; manzanasAisladas: number;
  conFachada: number;
  puertasDesdeMercado: number; puertas: number;
}
/** Fachada por barrio, acumulada sobre todo el corpus: [total, con fachada]. */
const FACHADA_BARRIO = new Map<WardType, [number, number]>();
/** Qué puertas no ve el mercado, para poder ir a mirarlas. */
const PUERTAS_CIEGAS: string[] = [];

const ACCESO: MedidaAcceso[] = [];
const tAcc = Date.now();
for (const { caso, plan } of PLANOS) {
  const m = construyeMalla(plan);
  const aPie = inunda(m, plan.gates, 0);
  const aCarro = inunda(m, plan.gates, HOLGURA_CARRO);
  const mercado = plan.patches.find((q) => q.ward === 'market');
  const desdeMercado = inunda(m, [mercado ? centroid(mercado.shape) : plan.center], HOLGURA_CARRO);

  let edificios = 0, varados = 0, conFachada = 0, manzanas = 0, aisladas = 0;
  let huecoCiego = 0, sinHueco = 0;
  for (const q of plan.patches) {
    if (!q.withinCity || !q.buildings.length) continue;
    manzanas++;
    let algunaConCarro = false;
    const pb = FACHADA_BARRIO.get(q.ward) ?? [0, 0];
    for (const b of q.buildings) {
      edificios++;
      pb[0]++;
      // Fachada: ¿hay hueco alcanzable a pie pegado a la pared? Y si no lo hay,
      // ¿es porque no hay hueco, o porque el hueco que hay no lleva a ninguna
      // parte? Son dos defectos distintos y piden dos arreglos distintos.
      let frente = false, hueco = false;
      for (const p of puntosFachada(b.shape, SALIDA_FACHADA)) {
        const k = celdaDe(m, p);
        if (k < 0) continue;
        if (!m.bloq[k]) hueco = true;
        if (aPie[k]) { frente = true; break; }
      }
      if (frente) { conFachada++; pb[1]++; } else if (hueco) huecoCiego++; else sinHueco++;
      // Carro: ¿hay calle de verdad a menos de tres unidades de la casa?
      if (!algunaConCarro) {
        for (const p of puntosFachada(b.shape, ALCANCE_CARRO)) {
          const k = celdaDe(m, p);
          if (k >= 0 && aCarro[k]) { algunaConCarro = true; break; }
        }
      }
    }
    FACHADA_BARRIO.set(q.ward, pb);
    if (!algunaConCarro) { aisladas++; varados += q.buildings.length; }
  }
  let puertasOk = 0;
  plan.gates.forEach((g, gi) => {
    // La celda semilla se busca YA con holgura de carro: cogerla a pie y
    // preguntar por ella en la inundación rodada es comparar dos redes
    // distintas, y devuelve puertas «inalcanzables» que sí lo son.
    const k = celdaLibreCerca(m, g, 4, HOLGURA_CARRO);
    if (k >= 0 && desdeMercado[k]) puertasOk++;
    else PUERTAS_CIEGAS.push(`${caso.tag}#${gi}${k < 0 ? ' (sin hueco de carro)' : ''}`);
  });
  ACCESO.push({
    caso, plan, edificios, varados, huecoCiego, sinHueco, manzanas, manzanasAisladas: aisladas,
    conFachada, puertas: plan.gates.length, puertasDesdeMercado: puertasOk,
  });
}
// Una ciudad sin puertas no tiene nada que alcanzar: sale de la media de
// conectividad y de fachada, y la denuncia el bloque 4, que es su sitio. Si se
// dejara dentro, un solo pueblo mal cerrado teñiría de rojo los otros once y no
// se sabría cuál de las dos cosas está pasando.
const CONPUERTA = ACCESO.filter((a) => a.puertas > 0);
const SINPUERTA = ACCESO.filter((a) => a.puertas === 0);
console.log(`  (malla + inundación: ${Date.now() - tAcc} ms)`);
console.log('  caso            manzanas  aisladas   edificios  varados   fachada');
for (const a of ACCESO) {
  const varPct = a.edificios ? (100 * a.varados) / a.edificios : 0;
  const facPct = a.edificios ? (100 * a.conFachada) / a.edificios : 0;
  const cola = a.puertas ? '' : '   ← SIN PUERTAS';
  console.log(`  ${a.caso.tag.padEnd(14)} ${String(a.manzanas).padStart(6)}  ${String(a.manzanasAisladas).padStart(7)}  ${String(a.edificios).padStart(9)}  ${(f1(varPct) + ' %').padStart(8)}  ${(f1(facPct) + ' %').padStart(8)}${cola}`);
}
{
  const tot = CONPUERTA.reduce((s, a) => s + a.edificios, 0);
  const var_ = CONPUERTA.reduce((s, a) => s + a.varados, 0);
  const aisl = CONPUERTA.reduce((s, a) => s + a.manzanasAisladas, 0);
  const peor = Math.max(0, ...CONPUERTA.map((a) => (a.edificios ? (100 * a.varados) / a.edificios : 0)));
  // Umbral 2 %. Un pueblo real tiene traspatios a los que sólo se entra por una
  // casa; lo que no tiene es un BARRIO al que no llega el carro. Y el grano de
  // esta medida es la MANZANA entera: basta con que una sola de sus casas tenga
  // calle rodada a menos de 3 u para que la manzana cuente como servida, así
  // que un 2 % ya son manzanas enteras encerradas y no ruido de muestreo.
  check(100 * var_ / Math.max(1, tot) < 2,
    'menos del 2 % de los edificios queda sin acceso rodado',
    `${var_} de ${tot} (${f1(100 * var_ / Math.max(1, tot))} %) · peor ciudad ${f1(peor)} % · ${aisl} manzanas aisladas`);
  // Y ninguna ciudad concreta puede pasar del 8 %: la media puede esconder un
  // pueblo entero partido por su río.
  check(peor < 8, 'y ninguna ciudad suelta pasa del 8 %', `peor ${f1(peor)} %`);
  if (SINPUERTA.length) info('excluidas por no tener puerta', SINPUERTA.map((a) => a.caso.tag).join(', '));
}

/**
 * ¿Y CUÁNTO MIDE ESA CALLE?
 *
 * Sin malla, para no depender de ella: se camina por el lindero entre distritos
 * — que es donde va la calle, porque la calle ES el hueco entre manzanas — y en
 * cada paso se mide la distancia al edificio más cercano. El doble de esa
 * distancia es el ancho libre.
 *
 * Existe porque la primera versión de este banco declaró estrangulada el 97 %
 * de la red por un fallo de vecindad, y la única forma de saber que era mentira
 * fue medir el ancho sin malla. Ahora se queda como comprobación: si alguien
 * toca el retranqueo, esta línea lo dice antes que ninguna lámina.
 */
{
  const anchos: number[] = [];
  const avenidas: number[] = [];
  const calles: number[] = [];
  const estrangulos: string[] = [];
  for (const { caso, plan } of PLANOS) {
    const CELL = 4;
    const hash = new Map<string, [V, V][]>();
    for (const q of plan.patches) for (const b of q.buildings) {
      for (let k = 0; k < b.shape.length; k++) {
        const a = b.shape[k], c = b.shape[(k + 1) % b.shape.length];
        const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
        const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
        for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
          for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
            const kk = `${gx},${gy}`;
            let l = hash.get(kk); if (!l) hash.set(kk, (l = [])); l.push([a, c]);
          }
      }
    }
    const dSeg = (p: V, a: V, b: V) => {
      const dx = b.x - a.x, dy = b.y - a.y, ll = dx * dx + dy * dy || 1e-9;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / ll; t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    };
    const libre = (p: V): number => {
      let best = 6;
      for (let gx = Math.floor((p.x - 6) / CELL); gx <= Math.floor((p.x + 6) / CELL); gx++)
        for (let gy = Math.floor((p.y - 6) / CELL); gy <= Math.floor((p.y + 6) / CELL); gy++) {
          const l = hash.get(`${gx},${gy}`); if (!l) continue;
          for (const [u, v] of l) { const d = dSeg(p, u, v); if (d < best) best = d; }
        }
      return 2 * best;
    };
    for (const q of plan.patches) {
      if (!q.withinCity || q.shape.length < 3) continue;
      for (let k = 0; k < q.shape.length; k++) {
        const a = q.shape[k], b = q.shape[(k + 1) % q.shape.length];
        const n = Math.max(2, Math.round(dist(a, b) / 1.5));
        for (let s = 1; s < n; s++) {
          const t = s / n;
          anchos.push(libre({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
        }
      }
    }
    // Y ahora por la calzada trazada, que es otra pregunta: la avenida se suaviza
    // con dos pasadas de Chaikin DESPUÉS de decidirse el retranqueo, así que
    // recorta las esquinas y se mete dentro de las manzanas por donde el
    // retranqueo no la esperaba.
    for (const st of plan.mainStreets) {
      let mn = Infinity;
      for (const p of st) { const a = libre(p); avenidas.push(a); mn = Math.min(mn, a); }
      if (mn < 0.9) estrangulos.push(`${caso.tag} ${f1(mn * M_POR_U)} m`);
    }
    for (const st of plan.streets) for (const p of st) calles.push(libre(p));
  }
  anchos.sort((a, b) => a - b); avenidas.sort((a, b) => a - b); calles.sort((a, b) => a - b);
  const estrecho = 100 * anchos.filter((a) => a < 0.9).length / Math.max(1, anchos.length);
  console.log(`  ancho libre sobre el lindero (${anchos.length} muestras): p05 ${f1(pct(anchos, 0.05) * M_POR_U)} · mediana ${f1(pct(anchos, 0.5) * M_POR_U)} · p95 ${f1(pct(anchos, 0.95) * M_POR_U)} m`);
  console.log(`  ancho libre sobre la calzada trazada: avenidas p05 ${f1(pct(avenidas, 0.05) * M_POR_U)} · mediana ${f1(pct(avenidas, 0.5) * M_POR_U)} m · calles mediana ${f1(pct(calles, 0.5) * M_POR_U)} m`);
  // Umbral 8 %. Medido: 1,2 % en la ciudad grande y 4,6 % en la de veinte
  // distritos, y lo que hay por debajo son los frentes de plaza, que se
  // retranquean a propósito un 40 % (`facesSquare`), y el patio del castillo.
  // Por encima del 8 % ya no serían las excepciones: sería el retranqueo roto.
  check(estrecho < 8, 'menos del 8 % del lindero baja de 3,6 m de ancho libre',
    `${f1(estrecho)} % · mediana ${f1(pct(anchos, 0.5) * M_POR_U)} m`);
  // Y ninguna avenida puede estrangularse por debajo de 3,6 m: una avenida con
  // una casa dentro no es una avenida estrecha, es una avenida cortada. Este es
  // el número que EXPLICA las puertas que el mercado no alcanza en el bloque 4:
  // la avenida mide 9,2 m de mediana y se cierra a 20 cm en un vértice suelto.
  check(estrangulos.length === 0, 'ninguna avenida se estrangula por debajo de 3,6 m',
    estrangulos.length ? `${estrangulos.length} de ${PLANOS.reduce((s, p) => s + p.plan.mainStreets.length, 0)}: ${estrangulos.slice(0, 6).join(' · ')}` : 'ninguna');
}

console.log('\n2 · FACHADA — ¿tiene cada casa una puerta a algo?');
{
  const tot = CONPUERTA.reduce((s, a) => s + a.edificios, 0);
  const con = CONPUERTA.reduce((s, a) => s + a.conFachada, 0);
  const ciego = CONPUERTA.reduce((s, a) => s + a.huecoCiego, 0);
  const macizo = CONPUERTA.reduce((s, a) => s + a.sinHueco, 0);
  const peor = Math.min(100, ...CONPUERTA.map((a) => (a.edificios ? (100 * a.conFachada) / a.edificios : 100)));
  console.log(`  con fachada ${con} · con hueco que no comunica ${ciego} · macizadas sin hueco ${macizo} · de ${tot}`);
  const filas = [...FACHADA_BARRIO].filter(([, v]) => v[0] >= 20).sort((a, b) => a[1][1] / a[1][0] - b[1][1] / b[1][0]);
  console.log('  por barrio: ' + filas.map(([wd, [t, c]]) => `${wd} ${f0(100 * c / t)} %`).join(' · '));
  // Umbral 92 %. El parcelado en burgos coloca las casas EN el perímetro de su
  // manzana mirando a la calle, así que la respuesta correcta es «casi todas».
  // Lo que legítimamente se queda fuera son las casetas de corral —
  // `burgageBlock` cuelga hasta siete por manzana grande DENTRO del corral, y a
  // un corral se entra por el portalón de la casa — y esas son, medidas, entre
  // el 3 y el 6 % de lo construido. Por debajo de 92 % ya no son las casetas:
  // son hileras enteras dando a un patio ciego, que es exactamente el defecto
  // que el parcelado en burgos vino a arreglar.
  check(100 * con / Math.max(1, tot) >= 92,
    'al menos el 92 % de las casas da a un espacio público',
    `${f1(100 * con / Math.max(1, tot))} % · peor ciudad ${f1(peor)} %`);
  check(peor >= 85, 'y ninguna ciudad baja del 85 %', `peor ${f1(peor)} %`);
}

// ===========================================================================
// 3. TAMAÑOS
// ===========================================================================
// Una casa de pueblo medieval mide entre 40 y 120 m². Por debajo de 20 m² no es
// una vivienda sino un cobertizo, y el generador tiene un tipo para eso
// ('shed'), así que las casas por debajo de 20 son un error de corte. Por
// encima de 300 m² tampoco es una casa: es un salón gremial o una iglesia, y
// también hay tipos para eso.

console.log('\n3 · TAMAÑOS — ¿mide una casa lo que mide una casa?');
{
  const casas: number[] = [];
  const todos: number[] = [];
  const distritos: number[] = [];
  for (const { plan } of PLANOS) {
    for (const q of plan.patches) {
      if (q.withinCity && q.shape.length >= 3) distritos.push(m2(area(q.shape)) / 10000); // ha
      for (const b of q.buildings) {
        const a = m2(area(b.shape));
        todos.push(a);
        if (b.kind === 'house') casas.push(a);
      }
    }
  }
  casas.sort((a, b) => a - b); todos.sort((a, b) => a - b); distritos.sort((a, b) => a - b);
  console.log(`  casa ('house')  n=${casas.length}  p10 ${f0(pct(casas, 0.1))} · mediana ${f0(pct(casas, 0.5))} · p90 ${f0(pct(casas, 0.9))} m²  (mín ${f1(casas[0])} · máx ${f0(casas[casas.length - 1])})`);
  console.log(`  todo lo edificado n=${todos.length}  p10 ${f0(pct(todos, 0.1))} · mediana ${f0(pct(todos, 0.5))} · p90 ${f0(pct(todos, 0.9))} m²`);
  console.log(`  distrito interior n=${distritos.length}  p10 ${f1(pct(distritos, 0.1))} · mediana ${f1(pct(distritos, 0.5))} · p90 ${f1(pct(distritos, 0.9))} ha`);

  const dentro = casas.filter((a) => a >= 40 && a <= 120).length;
  const enanas = casas.filter((a) => a < 20).length;
  const gigantes = casas.filter((a) => a > 300).length;
  info('en la horquilla canónica 40–120 m²', `${f1(100 * dentro / Math.max(1, casas.length))} % de las casas`);
  // La mediana es la cifra que decide: si cae dentro de 40–120, la distribución
  // está centrada donde debe y las colas son variedad, no error.
  check(pct(casas, 0.5) >= 40 && pct(casas, 0.5) <= 120,
    'la mediana de una casa cae en 40–120 m²', `${f0(pct(casas, 0.5))} m²`);
  // Las colas: hasta un 5 % de chabolas (< 20 m²) es plausible en un arrabal;
  // más que eso es el cortador dejando esquirlas. Medido en la primera pasada:
  // los cortes de `slicePlots` producen lotes residuales al final de cada tira.
  check(100 * enanas / Math.max(1, casas.length) < 5,
    'menos del 5 % de las casas baja de 20 m² (esquirlas de corte)',
    `${enanas} de ${casas.length} (${f1(100 * enanas / Math.max(1, casas.length))} %)`);
  check(100 * gigantes / Math.max(1, casas.length) < 2,
    'menos del 2 % pasa de 300 m² (un salón no es una casa)',
    `${gigantes} de ${casas.length} (${f1(100 * gigantes / Math.max(1, casas.length))} %)`);
  // Una manzana urbana medieval va de 0,1 a 1 ha. Si la mediana se dispara, el
  // pueblo son cuatro celdas de Voronoi enormes y no un tejido.
  check(pct(distritos, 0.5) >= 0.15 && pct(distritos, 0.5) <= 3.0,
    'el distrito mediano mide entre 0,15 y 3 ha', `${f1(pct(distritos, 0.5))} ha`);
}

// ===========================================================================
// 4. PUERTAS Y CAMINOS
// ===========================================================================

console.log('\n4 · PUERTAS Y CAMINOS — ¿sale cada camino por una puerta?');
{
  let caminos = 0, huerfanos = 0, sinPuerta = 0, puertasTot = 0, puertasVistas = 0;
  const pocas: string[] = [];
  const sinMuralla: string[] = [];
  for (const a of ACCESO) {
    const { plan } = a;
    for (const r of plan.roads) {
      caminos++;
      if (!plan.gates.some((g) => dist(g, r[0]) < 1.5)) huerfanos++;
    }
    puertasTot += a.puertas;
    puertasVistas += a.puertasDesdeMercado;
    if (a.puertas === 0) sinPuerta++;
    // Se pidió muralla en los doce casos. Que el plano vuelva sin ella no es una
    // decisión del generador: es que el recorte por el litoral dejó el arco con
    // menos de seis vértices y `wall` salió nulo — y con él, TODAS las puertas.
    if (a.caso.params.walls && !plan.wall) sinMuralla.push(a.caso.tag);
    // Una ciudad grande con menos de tres puertas no es una ciudad amurallada,
    // es un corral. El reparto del generador quiere 2 + nInner/12.
    const quiere = Math.max(1, Math.min(6, 2 + Math.floor((plan.size / 12) * (plan.coast ? 0.75 : 1))));
    if (a.puertas < quiere) pocas.push(`${a.caso.tag}: ${a.puertas}/${quiere}`);
  }
  info('puertas por ciudad', ACCESO.map((a) => `${a.caso.tag}→${a.puertas}`).join(' · '));
  check(huerfanos === 0, 'todo camino arranca en una puerta', `${huerfanos} de ${caminos} caminos huérfanos`);
  check(sinMuralla.length === 0, 'toda ciudad que pide muralla la tiene',
    sinMuralla.length ? `sin muralla: ${sinMuralla.join(', ')}` : `${ACCESO.length} de ${ACCESO.length}`);
  check(sinPuerta === 0, 'ninguna ciudad se queda sin puerta', `${sinPuerta} ciudades`);
  check(puertasVistas === puertasTot,
    'toda puerta se alcanza en carro desde el mercado',
    `${puertasVistas} de ${puertasTot}${PUERTAS_CIEGAS.length ? ' · ciegas: ' + PUERTAS_CIEGAS.join(', ') : ''}`);
  // El generador PIDE un número de puertas y luego descarta las que caen al
  // agua sin reponerlas, así que un puerto grande acaba con la mitad. No es
  // ruido: es el bucle de `gates` saltando en vez de reintentar.
  check(pocas.length === 0,
    'y cada ciudad tiene las puertas que su propio reparto pide',
    pocas.length ? pocas.join(' · ') : 'todas completas');

  // `roadBearings`: si el generador ya lo acepta, cada rumbo pedido tiene que
  // acabar en una puerta. Se detecta por comportamiento, no por el tipo: si el
  // plano sale idéntico con y sin el parámetro, el generador lo ignora y esto
  // es informativo. (Ahora mismo no existe; el puente mundo→ciudad lo está
  // añadiendo mientras esto corre.)
  const rumbos = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const base = { ...DEFAULT_CITY, seed: `${SEMILLA}-rumbos`, size: 24 };
  const sinR = JSON.stringify(generateCity(base));
  const conR = generateCity({ ...base, roadBearings: rumbos } as CityParams & { roadBearings: number[] });
  if (JSON.stringify(conR) === sinR) {
    info('roadBearings', 'sin implementar: el plano sale idéntico con y sin él (informativo)');
  } else {
    const falta = rumbos.filter((b) => !conR.gates.some((g) => {
      const ang = Math.atan2(g.y - conR.center.y, g.x - conR.center.x);
      let d = Math.abs(ang - b) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d < 0.45; // ±26°: un rumbo pedido no puede errar más de un octante
    }));
    check(falta.length === 0, 'cada rumbo pedido en roadBearings tiene su puerta',
      `${rumbos.length - falta.length} de ${rumbos.length}`);
  }
}

// ===========================================================================
// 5. RÓTULOS
// ===========================================================================
// Se miden los rótulos QUE SE DIBUJAN, espiando `fillText` sobre el contexto
// real, no reimplantando la lógica del dibujante: un banco que copia la regla
// de colocación sólo comprueba que se copió bien. Así también entran el título,
// el subtítulo y cualquier rótulo que los renderizadores nuevos añadan.

console.log('\n5 · RÓTULOS — ¿se pisan?');

/** Una caja EN COORDENADAS LOCALES, con la matriz que la lleva a la lámina. */
interface Caja { t: string; x0: number; y0: number; x1: number; y1: number; glifo: boolean; ctm: number[] }

/**
 * El espía.
 *
 * Dos detalles que costaron una lectura falsa cada uno:
 *
 *   1. LA MATRIZ. El dibujante letrea los barrios GIRADOS: hace `translate` al
 *      centro del distrito, `rotate` al eje mayor y escribe en el origen. Las
 *      coordenadas que llegan a `fillText` no son de la lámina, son locales, y
 *      leerlas como si lo fueran amontona todos los rótulos alrededor del (0,0)
 *      y declara solapes que no existen. Se guarda la caja local y se pasa por
 *      `getTransform()` al volcarla.
 *   2. LOS GLIFOS. Todo rótulo se escribe letra a letra para poder espaciarlo.
 *      Sin volver a pegarlas, cada palabra choca consigo misma tantas veces
 *      como pares de letras tenga: 1 820 solapes inventados en la primera
 *      pasada. Se pega una tirada de glifos consecutivos que compartan matriz
 *      y vayan avanzando a la derecha a la misma altura: eso es una palabra.
 */
function espia(real: any): { ctx: any; cajas: Caja[] } {
  const cajas: Caja[] = [];
  const proxy: any = new Proxy(real, {
    get(t, k) {
      const v = t[k];
      if (k === 'fillText') {
        return (text: string, x: number, y: number, ...rest: any[]) => {
          if (text.trim()) {
            const mt = t.measureText(text);
            const w = mt.width;
            const izq = Number.isFinite(mt.actualBoundingBoxLeft) && mt.actualBoundingBoxLeft > 0
              ? mt.actualBoundingBoxLeft : (t.textAlign === 'center' ? w / 2 : 0);
            const der = Number.isFinite(mt.actualBoundingBoxRight) && mt.actualBoundingBoxRight > 0
              ? mt.actualBoundingBoxRight : (t.textAlign === 'center' ? w / 2 : w);
            const asc = Number.isFinite(mt.actualBoundingBoxAscent) ? mt.actualBoundingBoxAscent : 8;
            const des = Number.isFinite(mt.actualBoundingBoxDescent) ? mt.actualBoundingBoxDescent : 3;
            const m = t.getTransform();
            cajas.push({
              t: text, x0: x - izq, x1: x + der, y0: y - asc, y1: y + des,
              glifo: [...text].length === 1, ctm: [m.a, m.b, m.c, m.d, m.e, m.f],
            });
          }
          return v.call(t, text, x, y, ...rest);
        };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx: proxy, cajas };
}

/** Caja local + matriz → caja envolvente en la lámina. */
function aLamina(c: Caja): { t: string; x0: number; y0: number; x1: number; y1: number } {
  const [a, b, cc, d, e, f] = c.ctm;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]]) {
    const X = a * px + cc * py + e, Y = b * px + d * py + f;
    x0 = Math.min(x0, X); x1 = Math.max(x1, X);
    y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  return { t: c.t, x0, y0, x1, y1 };
}

function fusionaGlifos(cajas: Caja[]): Caja[] {
  const out: Caja[] = [];
  let corriendo = false;
  for (const c of cajas) {
    const last = out[out.length - 1];
    if (last && corriendo && c.glifo
      && last.ctm.every((v, i) => v === c.ctm[i])
      && c.x0 >= last.x0 && c.x0 - last.x1 < (last.y1 - last.y0) * 1.2
      && c.y0 < last.y1 && c.y1 > last.y0) {
      last.t += c.t;
      last.x1 = Math.max(last.x1, c.x1);
      last.y1 = Math.max(last.y1, c.y1);
      last.y0 = Math.min(last.y0, c.y0);
      continue;
    }
    out.push({ ...c });
    corriendo = c.glifo;
  }
  return out;
}

{
  const tema = themeById('wonder');
  let choques = 0, dibujados = 0;
  const ejemplos: string[] = [];
  for (const { caso, plan } of PLANOS) {
    for (const S of [360, 700, 1100]) {
      const cv = createCanvas(S, S);
      const { ctx, cajas } = espia(cv.getContext('2d'));
      try {
        renderCity(plan, ctx as unknown as Ctx, { theme: tema, width: S, height: S });
      } catch (e) {
        check(false, `el renderizador no revienta (${caso.tag} a ${S} px)`, String(e).slice(0, 90));
        continue;
      }
      const cs = fusionaGlifos(cajas).map(aLamina);
      dibujados += cs.length;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const a = cs[i], b = cs[j];
          if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) {
            choques++;
            if (ejemplos.length < 4) ejemplos.push(`«${a.t}»×«${b.t}» en ${caso.tag}@${S}`);
          }
        }
      }
    }
  }
  info('rótulos dibujados', `${dibujados} en ${PLANOS.length * 3} láminas`);
  // Cero. Un rótulo ilegible es peor que ninguno: ocupa el sitio de lo que tapa
  // y encima no se lee. El dibujante ya prueba cinco posiciones y renuncia si no
  // cabe, así que cualquier choque es una vía que se saltó esa prueba — el
  // título y el subtítulo, por ejemplo, se escriben sin consultarla.
  check(choques === 0, 'cero cajas de rótulo solapadas',
    choques ? `${choques} solapes · ${ejemplos.join(' · ')}` : `0 en ${dibujados} rótulos`);
}

// ===========================================================================
// 6. AGUA
// ===========================================================================

console.log('\n6 · AGUA — ¿hay algo construido dentro de ella?');
{
  let nMar = 0, nRio = 0, cruces = 0, sinPuente = 0, puertasMojadas = 0, callesEnMar = 0;
  const detalle: string[] = [];
  const dondeMar: string[] = [];
  const dondePuerta: string[] = [];
  for (const { caso, plan } of PLANOS) {
    const rio = anchoRio(plan);
    let mar_ = 0, riv_ = 0;
    for (const q of plan.patches) {
      for (const b of q.buildings) {
        // Media unidad de margen: el generador recorta por vértice y un vértice
        // justo en la línea no es una casa en el mar.
        if (b.shape.some((v) => mojado(plan, v, 0.5))) mar_++;
        // El cauce DIBUJADO es media anchura a cada lado; más allá es ribera.
        else if (b.shape.some((v) => enRio(plan, v, rio * 0.5))) riv_++;
      }
    }
    nMar += mar_; nRio += riv_;
    if (mar_ || riv_) detalle.push(`${caso.tag}: ${mar_} mar / ${riv_} río`);

    // Una calle que cruza el cauce sin puente es un vado dibujado como calle.
    if (plan.river) {
      for (const st of [...plan.mainStreets, ...plan.streets]) {
        for (let k = 0; k + 1 < st.length; k++) {
          const a = st[k], b = st[k + 1];
          if (!(enRio(plan, a, rio * 0.35) === false && enRio(plan, b, rio * 0.35) === false)) continue;
          // dos puntos secos con el eje del río entre medias
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (!enRio(plan, mid, rio * 0.5)) continue;
          cruces++;
          const tapado = plan.bridges.some((br) => dist(centroid(br), mid) < rio * 2.2);
          if (!tapado) sinPuente++;
        }
      }
    }
    // Ni una calle mar adentro que no sea un embarcadero. Dos unidades (8 m) de
    // margen: el litoral es una línea recta y el muelle corre pegado a ella, así
    // que medio metro de desbordamiento es redondeo. Ocho metros ya es una calle
    // pintada sobre el agua, y se ve.
    for (const st of [...plan.mainStreets, ...plan.streets]) {
      for (const v of st) {
        if (!mojado(plan, v, 2.0)) continue;
        if (plan.piers.some((p) => dist(centroid(p), v) < 8)) continue;
        callesEnMar++;
        if (dondeMar.length < 4) dondeMar.push(`${caso.tag} a ${f1(M_POR_U * ((v.x - plan.coast!.p.x) * plan.coast!.n.x + (v.y - plan.coast!.p.y) * plan.coast!.n.y))} m de la orilla`);
      }
    }
    // Una puerta con menos de cuatro metros de tierra por delante está en el
    // muelle, no en la muralla; y una puerta a menos de media anchura del eje
    // del río está DENTRO del cauce dibujado. El generador dice explícitamente
    // «Never put a gate on the waterfront» y sólo comprueba el signo, que a
    // trece centímetros del agua sigue siendo el correcto.
    for (const g of plan.gates) {
      const sMar = plan.coast ? (g.x - plan.coast.p.x) * plan.coast.n.x + (g.y - plan.coast.p.y) * plan.coast.n.y : -Infinity;
      const dRio = plan.river ? Math.min(...plan.river.map((rp) => dist(rp, g))) : Infinity;
      if (!mojado(plan, g, -1.0) && !enRio(plan, g, rio * 0.5)) continue;
      puertasMojadas++;
      dondePuerta.push(`${caso.tag}: ${Number.isFinite(sMar) && sMar > -1 ? `${f1(-sMar * M_POR_U)} m de tierra hasta el mar` : `${f1(dRio * M_POR_U)} m al eje de un río de ${f1(rio * M_POR_U)} m`}`);
    }
  }
  const totalEd = PLANOS.reduce((s, p) => s + p.plan.patches.reduce((n, q) => n + q.buildings.length, 0), 0);
  check(nMar === 0, 'ni un edificio dentro del mar', `${nMar} de ${totalEd}${detalle.length ? ' · ' + detalle.join(' · ') : ''}`);
  check(nRio === 0, 'ni un edificio dentro del cauce', `${nRio} de ${totalEd}`);
  check(sinPuente === 0, 'toda calle que cruza el río lo hace por un puente', `${sinPuente} vados de ${cruces} cruces`);
  check(callesEnMar === 0, 'ninguna calle se mete en el mar',
    `${callesEnMar} vértices mojados${dondeMar.length ? ' · ' + dondeMar.join(' · ') : ''}`);
  check(puertasMojadas === 0, 'ninguna puerta da al agua',
    `${puertasMojadas} puertas${dondePuerta.length ? ' · ' + dondePuerta.join(' · ') : ''}`);
}

// ===========================================================================
// 7. DETERMINISMO
// ===========================================================================
// Barato, y protege todo lo demás: si el plano no es reproducible, ninguna cifra
// de esta tabla significa nada mañana. La versión que importa es la TERCERA
// llamada, después de haber generado otra ciudad: lo que se está probando es que
// no hay estado global entre generaciones.

console.log('\n7 · DETERMINISMO — ¿mismo parámetro, mismo plano?');
{
  const p: CityParams = { ...DEFAULT_CITY, seed: `${SEMILLA}-det`, size: 22, river: true, riverDir: { x: 1, y: 0.4 } };
  const a = JSON.stringify(generateCity(p));
  const b = JSON.stringify(generateCity(p));
  generateCity({ ...p, seed: 'otra-cosa', size: 31, coast: true, coastDir: { x: 1, y: 0 } });
  const c = JSON.stringify(generateCity(p));
  check(a === b, 'dos llamadas seguidas dan el mismo plano', a === b ? `${(a.length / 1024).toFixed(0)} kB idénticos` : 'difieren');
  check(a === c, 'y sigue igual tras generar otra ciudad en medio', a === c ? 'sin estado global' : 'HAY estado compartido entre generaciones');
}

// ===========================================================================
// 8. BARRIOS: EL CENSO Y LA VEROSIMILITUD
// ===========================================================================
// Aquí es donde vivía el fallo del barrio 'gate': un tipo declarado, con
// etiqueta, con parámetros de parcelado propios, que no se asignó nunca. Contar
// los tipos que salen es de las cosas más baratas que se pueden medir y es la
// única que lo habría cazado.

console.log('\n8 · BARRIOS — ¿salen todos, y donde deben?');
{
  const censo = new Map<WardType, number>();
  const dCentro = new Map<WardType, number[]>();
  const N = 36;
  for (let k = 0; k < N; k++) {
    const plan = generateCity({
      ...DEFAULT_CITY, seed: `${SEMILLA}-censo-${k}`, size: 10 + (k % 26),
      walls: true, citadel: true, river: k % 3 === 0, coast: k % 4 === 0,
      riverDir: { x: Math.cos(k), y: Math.sin(k) }, coastDir: { x: Math.sin(k), y: Math.cos(k) },
    });
    for (const q of plan.patches) {
      censo.set(q.ward, (censo.get(q.ward) ?? 0) + 1);
      if (!q.withinCity || q.shape.length < 3) continue;
      const d = dist(centroid(q.shape), plan.center) / Math.max(1, plan.radius);
      let l = dCentro.get(q.ward); if (!l) dCentro.set(q.ward, (l = [])); l.push(d);
    }
  }
  const TIPOS: WardType[] = ['craftsmen', 'merchant', 'patriciate', 'administration', 'military',
    'slum', 'gate', 'market', 'cathedral', 'castle', 'park', 'farm', 'outskirts'];
  const ausentes = TIPOS.filter((t) => !censo.get(t));
  console.log(`  censo en ${N} pueblos: ${TIPOS.map((t) => `${t} ${censo.get(t) ?? 0}`).join(' · ')}`);
  // Cero ausentes. Un tipo de barrio declarado que no sale nunca es código
  // muerto que el lector nunca verá, y es exactamente la forma que tenía el
  // fallo de 'gate' (0 de 6 puertas en tres semillas, cuatro pasadas medidas).
  check(ausentes.length === 0, 'ningún tipo de barrio declarado se queda sin salir jamás',
    ausentes.length ? `no aparecen: ${ausentes.join(', ')}` : `los ${TIPOS.length} tipos aparecen`);

  const md = (w: WardType) => media(dCentro.get(w) ?? []);
  console.log(`  distancia media al centro (radios): mercado ${f1(md('market'))} · catedral ${f1(md('cathedral'))} · castillo ${f1(md('castle'))} · patricio ${f1(md('patriciate'))} · arrabal ${f1(md('slum'))} · puerta ${f1(md('gate'))}`);
  // Las tres reglas que el propio generador dice cumplir, medidas:
  check(md('market') < 0.45, 'el mercado es lo más céntrico que hay', `${f1(md('market'))} radios`);
  check(md('castle') > 0.35, 'el castillo manda desde un borde, no desde el medio', `${f1(md('castle'))} radios`);
  check(md('gate') > md('market'), 'el barrio de la puerta está más fuera que el mercado',
    `puerta ${f1(md('gate'))} vs mercado ${f1(md('market'))}`);
  check(md('slum') > md('patriciate'), 'los pobres viven más lejos del centro que los ricos',
    `arrabal ${f1(md('slum'))} vs patricio ${f1(md('patriciate'))}`);

  // Distritos interiores completamente vacíos: ni una casa, ni un patio. En la
  // lámina son agujeros de papel en blanco en mitad del tejido.
  let vacios = 0, interiores = 0;
  for (const { plan } of PLANOS) {
    for (const q of plan.patches) {
      if (!q.withinCity || q.shape.length < 3) continue;
      interiores++;
      if (!q.buildings.length && !q.courts.length) vacios++;
    }
  }
  check(100 * vacios / Math.max(1, interiores) < 3,
    'menos del 3 % de los distritos interiores sale en blanco',
    `${vacios} de ${interiores} (${f1(100 * vacios / Math.max(1, interiores))} %)`);
}

// ===========================================================================
// 9. EL CONTRATO NUEVO
// ===========================================================================
// `squares`, `fort`, `waters` y `districtNames` están declarados en `CityPlan` y
// las tandas que los llenan están aterrizando mientras esto corre. Se informa de
// su estado sin ponerlo en rojo: un campo vacío hoy es trabajo en curso, no un
// defecto. Cuando se llenen, estas líneas empiezan a decir cuánto.

console.log('\n9 · CONTRATO NUEVO — estado de los campos que se están llenando');
{
  const conSq = PLANOS.filter((p) => (p.plan.squares ?? []).length).length;
  const conFort = PLANOS.filter((p) => p.plan.fort).length;
  const conAgua = PLANOS.filter((p) => p.plan.waters).length;
  const conNom = PLANOS.filter((p) => (p.plan.districtNames ?? []).some(Boolean)).length;
  info('squares', `${conSq}/${PLANOS.length} planos con plazas`);
  info('fort', `${conFort}/${PLANOS.length} con muralla como fábrica`);
  info('waters', `${conAgua}/${PLANOS.length} con agua modelada`);
  info('districtNames', `${conNom}/${PLANOS.length} con distritos nombrados`);
  if (conSq) {
    let sinMonumento = 0, fuera = 0;
    for (const { plan } of PLANOS) {
      for (const s of plan.squares ?? []) {
        if (!s.monument) sinMonumento++;
        if (dist(centroid(s.shape), plan.center) > plan.radius * 1.05) fuera++;
      }
    }
    check(fuera === 0, 'ninguna plaza cae fuera del pueblo', `${fuera} fuera del radio`);
    info('plazas sin monumento', `${sinMonumento}`);
  }
}

// ===========================================================================
// 10. LA LÁMINA DE CONTACTO
// ===========================================================================
// Doce pueblos de un vistazo. Ninguna de las cifras de arriba sustituye a mirar,
// y mirar de una en una no deja comparar. Mismo enfoque que `city-shape.ts`.

console.log('\n10 · LÁMINA DE CONTACTO');
{
  mkdirSync('harness/out/city', { recursive: true });
  const tema = themeById('wonder');
  const S = 380;
  const hoja = createCanvas(S * 4, S * 3);
  const hc = hoja.getContext('2d');
  hc.fillStyle = '#12100c';
  hc.fillRect(0, 0, hoja.width, hoja.height);
  let pintados = 0;
  PLANOS.forEach(({ caso, plan }, i) => {
    if (i >= 12) return;
    const cv = createCanvas(S, S);
    try {
      renderCity(plan, cv.getContext('2d') as unknown as Ctx, { theme: tema, width: S, height: S });
      pintados++;
    } catch { /* el fallo ya se contó en el bloque 5 */ }
    const px2 = (i % 4) * S, py = Math.floor(i / 4) * S;
    hc.drawImage(cv, px2, py);
    // Cintillo oscuro bajo el pie de foto: el papel de la lámina es claro y un
    // rótulo claro encima de él no se lee, que es un fallo tonto de cometer en
    // el banco que cuenta rótulos ilegibles.
    // Al pie, no en la cabecera: arriba está el nombre del pueblo, que es lo
    // primero que quiere leer quien mira doce planos a la vez.
    hc.fillStyle = 'rgba(18,16,12,0.80)';
    hc.fillRect(px2, py + S - 22, S, 22);
    hc.fillStyle = '#f0ede6';
    hc.font = '600 13px sans-serif';
    const a = ACCESO[i];
    hc.fillText(`${caso.tag} · ${a.puertas} puertas · ${a.edificios} edif · ${f1(100 * a.conFachada / Math.max(1, a.edificios))} % con fachada`,
      px2 + 8, py + S - 7);
  });
  const f = 'harness/out/city/calidad.png';
  writeFileSync(f, hoja.toBuffer('image/png'));
  check(pintados === Math.min(12, PLANOS.length), 'las doce láminas se dibujan', `${pintados}/12 · escrito ${f}`);
}

console.log(`\n${cheques} comprobaciones · ${rojos === 0 ? 'TODO EN VERDE' : `${rojos} EN ROJO`}`);
process.exit(rojos === 0 ? 0 : 1);
