// ============================================
// Sculpt — la vegetación
// ============================================
// Lo que faltaba para que el relieve dejara de leerse como «un mapa en relieve
// bien iluminado» y pasara a leerse como un PAÍS. El color del atlas ya dice
// dónde hay bosque; lo que no dice es que el bosque tenga grosor. Un bosque sin
// grosor es una mancha verde, y una mancha verde no tiene escala: sin algo del
// tamaño de un árbol en el encuadre, el ojo no tiene con qué medir la montaña
// que hay detrás, y todo vuelve a ser una maqueta.
//
// El idioma es el de FlowScape: plantas INSTANCIADAS, sembradas a puñados,
// baratas y estilizadas. No modelos botánicos — a la distancia a la que se ven
// aquí, un abeto de mil polígonos y un abeto de cuatro triángulos son el mismo
// puñado de píxeles, y sólo uno de los dos cabe veinte mil veces en un
// fotograma de treinta milisegundos.
//
// LAS CUATRO DECISIONES, por orden de cuánto mandan sobre el resultado:
//
//   1. EL TAMAÑO SIGUE AL ENCUADRE. Esta vista va de 20 km de ancho a 40.000:
//      tres órdenes de magnitud. Un árbol de veinte metros es medio píxel en el
//      encuadre más cerrado que existe aquí — o sea, NO HAY tamaño literal que
//      se vea. Así que la planta mide una fracción fija del encuadre, igual que
//      el oleaje de water.ts mide noventa píxeles siempre y que el relieve
//      inventado de scene3d.ts persigue el píxel y no el mundo. Es la tercera
//      vez que esta casa toma la misma decisión, y por la misma razón.
//   2. LA REJILLA ESTÁ CUANTIZADA A OCTAVAS, el tamaño no. Si las posiciones
//      resbalaran con el zoom, el bosque REPTARÍA al acercarse — el defecto que
//      más delata a un sistema de dispersión. Las posiciones cuelgan de una
//      rejilla de lado SIZE_X·2^-nivel, así que sólo cambian cuando cambia el
//      nivel entero; el tamaño interpola de forma continua entre ellos y lo que
//      se ve es que las plantas RESPIRAN, no que se muevan.
//   3. NIVELES CONCÉNTRICOS, no un disco. Un disco de plantas del mismo tamaño
//      alrededor de la cámara o se queda corto (anillo pelado a media pantalla)
//      o cuesta cien mil instancias. Cada nivel siembra su propio disco, y el
//      alcance de un nivel es proporcional a su paso: los niveles gruesos llegan
//      lejos y ralos, los finos cerca y densos. El coste por nivel es CONSTANTE
//      (siempre el mismo número de celdas) y el alcance total se dobla por
//      nivel. Cinco niveles = 48 celdas de alcance fino y 768 de alcance basto.
//   4. NADA ES TRANSPARENTE. Todos los desvanecidos — el que entra con el zoom,
//      el del borde de cada anillo, el de la bruma — se hacen ESCALANDO A CERO,
//      no con alfa. Así no hay orden de dibujo que resolver, ni mezcla, ni
//      discard, ni segundo pase: una sola llamada de dibujo opaca que el
//      z-buffer coloca sola entre el terreno y el agua.
//
// TODO DETERMINISTA. La posición, la especie, el giro y el tamaño de cada
// planta salen de un picado entero de (celda, nivel, semilla) — el mismo picado
// de 32 bits que usan el terreno, el cielo y el agua, bit a bit igual en
// cualquier driver. No hay `Math.random` ni `Date.now` en este archivo. Quien
// se aleje y vuelva encuentra el mismo bosque, árbol por árbol.
//
// Y LA ALTURA SALE DEL MISMO CAMPO QUE LA MALLA. `heightAt` reconstruye el
// R32F con los mismos pesos suavizados que `baseHeightAt` del vertex shader del
// terreno (ver scene3d.ts) — o mejor, con la propia `surface.heightAtUV` si
// quien llama la pasa. Si los dos lados reconstruyeran distinto, los árboles
// flotarían sobre las lomas y se hundirían en los valles, medio metro de escena
// que a este tamaño son doscientos metros de nada.

import * as THREE from 'three';
// `R_GLOBE` no se importa: el radio del globo entra por `ScatterOptions.radius`,
// que es lo que hace que este módulo se pueda probar sin una escena montada.
import { SIZE_X, GLOBE_RELIEF } from './scene3d';
import { EARTH_KM } from '../core/camera';
import { Biome, BIOME_COUNT } from '../core/types';
import { BIOME_COLORS } from '../core/render';

export interface ScatterOptions {
  seed: string;
  /** Lado del plano de mundo en unidades de escena (hoy SIZE_X = 240). */
  sizeX: number;
  sizeZ: number;
  /** Radio del globo, hoy 240/2π. */
  radius: number;
  /**
   * Tope duro de instancias. Por defecto 20.000; ver EL PRESUPUESTO más abajo.
   */
  maxInstances?: number;
}

/**
 * La luz, tal cual la devuelve `sky.sunLight()`.
 *
 * `ambient` llega SIN NORMALIZAR (es medio cénit medio horizonte, o sea el
 * color real del relleno) y se normaliza aquí con exactamente la misma cuenta
 * que `SculptSurface.setSunLight` hace con el suyo. Si no, la vegetación se
 * pintaría un 40 % más oscura y más azul que el suelo sobre el que crece.
 */
export interface ScatterSun {
  color: THREE.Color;
  intensity: number;
  ambient: THREE.Color;
}

export interface Scatter {
  group: THREE.Object3D;
  /**
   * El mundo cambió: nueva altura, nuevo bioma, o una pincelada. Vuelve a
   * sembrar lo que haga falta. Barato de llamar; caro sólo si de verdad cambió.
   *
   * No siembra aquí: marca sucio y el siguiente `update` hace el trabajo. Así
   * una ráfaga de pinceladas en el mismo fotograma cuesta una siembra, no
   * treinta.
   */
  setWorld(o: {
    elevation: Float32Array; biome: Uint8Array;
    width: number; height: number;
    /** Unidades de escena por km de altura. */
    yMul: number;
    seaLevel: number;
    /**
     * NUEVO Y OPCIONAL: la altura que la MALLA está dibujando de verdad.
     *
     * Pasar `(u, v) => surface.heightAtUV(u, v)` es la única forma de que las
     * plantas se apoyen en el terreno cuando hay un parche canónico atado
     * (`setDetailPatch`): ese parche levanta el suelo hasta un kilómetro y esta
     * clase no lo ve. Sin ella se usa la reconstrucción propia del campo de
     * mundo, que es correcta mientras no haya parche.
     */
    heightAt?: (u: number, v: number) => number;
    /**
     * NUEVO Y OPCIONAL: temperatura media por celda, en °C.
     *
     * Es lo que hace falta para que el límite del arbolado sea el de verdad —
     * el del atlas (`core/render.ts`) sale de la temperatura, no de la altura.
     * Sin ella se usa un techo de altura, que en un mundo cálido deja bosque
     * doscientos metros por encima de donde el mapa ya pinta nieve.
     */
    temperature?: Float32Array;
  }): void;
  /** Una vez por fotograma, antes de renderizar. */
  update(o: {
    camera: THREE.PerspectiveCamera;
    sun: THREE.Vector3;
    shape: 'plane' | 'globe';
    /** Ancho del encuadre en km: por debajo de cierto valor hay que sembrar. */
    spanKm: number;
    /** La ventana uv que el terreno está dibujando: {u, v, size}. */
    window: { u: number; v: number; size: number };
    time: number;
    /** Color del horizonte, para que la vegetación lejana funda con la bruma. */
    horizon: THREE.Color;
    /** Luz del sol, como la devuelve sky.sunLight(). */
    sun3: ScatterSun;
    /**
     * NUEVO Y OPCIONAL: el horizonte del lado del sol,
     * `sky.waterSky().horizonWarm`. La niebla del terreno y la del agua
     * calientan hacia él con `pow(dot(-V,sol),3)·0,55`; sin él aquí se deriva
     * uno aproximado y la vegetación lejana funde a un color que no es el del
     * suelo que tiene detrás — una costura a lo largo del horizonte.
     */
    horizonWarm?: THREE.Color;
  }): void;
  /** Cuántas instancias hay dibujándose ahora, para el HUD. */
  stats(): { instances: number; kinds: number; ms: number };
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Las especies
// ---------------------------------------------------------------------------
// Cinco. No es una limitación de la instanciación —cabrían más— sino de lo que
// se distingue: a veinticinco píxeles de alto, una encina y un haya son la
// misma silueta. Lo que sí se distingue es CÓNICO / REDONDO / EN ABANICO /
// RASTRERO / SIN HOJAS, y eso es lo que hay.

// Los índices se nombran para que la tabla de biomas de más abajo se lea como
// una frase y no como una fila de números. `BROADLEAF` no aparece por su nombre
// en ningún sitio — el bosque templado lo pide por posición — pero quitarlo
// dejaría la tabla con un hueco mudo entre el conífero y la palmera.
const CONIFER = 0;
const BROADLEAF = 1;
const PALM = 2;
const SCRUB = 3;
const ROCK = 4;
const KIND_COUNT = 5;
void BROADLEAF;

/**
 * La silueta de cada especie: tres cuadriláteros apilados por carta.
 *
 * Cada uno es (y0, y1, w0, w1) en fracciones de la altura de la planta: dónde
 * empieza, dónde acaba, y su semianchura en cada extremo. Tres son los que hace
 * falta para que el contorno tenga SEIS lados en vez de cuatro, que es la
 * diferencia entre «un árbol» y «un trapecio»: tronco, falda de la copa y
 * remate. Doce triángulos por planta, y ni uno más.
 *
 * Los cuadriláteros se SOLAPAN a propósito (la copa arranca por debajo de donde
 * acaba el tronco): sin solape, el punto de unión deja un pinchazo de fondo de
 * un píxel que a veinte metros de distancia parpadea.
 */
const QUADS: number[][] = [
  // conífera: tronco fino, falda ancha, aguja
  [0.00, 0.32, 0.052, 0.040], [0.13, 0.62, 0.360, 0.235], [0.55, 1.00, 0.225, 0.012],
  // fronda: tronco, copa que se ABRE hacia arriba y remate redondeado
  [0.00, 0.44, 0.058, 0.046], [0.24, 0.66, 0.290, 0.450], [0.60, 1.00, 0.440, 0.085],
  // palmera: estípite largo y un abanico de hojas arriba
  [0.00, 0.70, 0.046, 0.036], [0.58, 0.84, 0.170, 0.560], [0.80, 1.00, 0.470, 0.070],
  // matorral: casi todo copa, pegado al suelo
  [0.00, 0.20, 0.062, 0.052], [0.02, 0.56, 0.430, 0.490], [0.50, 1.00, 0.460, 0.080],
  // roca: un bulto. Ancha y baja (ver KIND_SQUASH)
  [0.00, 0.32, 0.640, 0.610], [0.22, 0.64, 0.620, 0.430], [0.58, 0.94, 0.440, 0.100],
];

/** Cuánto se aplasta cada especie respecto a la altura base. */
const KIND_SQUASH = [1.00, 0.94, 1.06, 0.46, 0.34];

/** Cuánto del primer cuadrilátero es TRONCO (color de corteza) y no follaje. */
const KIND_BARK = [1.0, 1.0, 1.0, 0.35, 0.0];

/**
 * Cuánto se mece: una roca no se mece, una palmera sí.
 *
 * Escrito y todavía sin consumir: el balanceo pide una `time` que llegue al
 * shader por instancia, y eso es un atributo más en el búfer. Se queda porque
 * la tabla es la decisión —qué se mece cuánto— y esa decisión ya está tomada;
 * lo que falta es el cableado. Marcado a propósito para que el compilador no
 * lo borre y el siguiente que pase sepa que existe.
 */
const KIND_WIND = [0.55, 0.80, 1.30, 0.70, 0.0];
void KIND_WIND;

// ---------------------------------------------------------------------------
// Qué crece dónde
// ---------------------------------------------------------------------------
// `density` es la fracción de sitios de la rejilla que germinan, así que es
// directamente el coste: un bioma a 0,85 pone seis veces más instancias que uno
// a 0,14. Los números están puestos para que la selva se lea como una masa
// cerrada y el desierto como cuatro cosas dispersas — que es lo que el ojo
// espera y lo que reparte el presupuesto donde se nota.

interface Planting {
  density: number;
  /** Pesos ACUMULADOS por especie, 0–1. Ver `pickKind`. */
  cum: number[];
  /**
   * Cuánto tira el follaje hacia el verde canónico, 0–1. Los biomas exóticos
   * van a cero: teñir de verde un bosque fúngico morado sería borrarlo.
   */
  green: number;
}

const PLANTING: Planting[] = [];

function plant(
  id: number, density: number, green: number,
  co: number, br: number, pa: number, sc: number, ro: number,
): void {
  const w = [co, br, pa, sc, ro];
  let sum = 0;
  for (let k = 0; k < KIND_COUNT; k++) sum += w[k];
  const cum: number[] = [];
  let acc = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    acc += sum > 0 ? w[k] / sum : 0;
    cum.push(acc);
  }
  PLANTING[id] = { density, cum, green };
}

for (let i = 0; i < BIOME_COUNT; i++) plant(i, 0, 0.4, 0, 0, 0, 1, 0);

//                                    dens  verde  conif fronda palma matorr roca
plant(Biome.Tundra, /*             */ 0.16, 0.30, 0.00, 0.00, 0.00, 0.80, 0.20);
plant(Biome.BorealForest, /*       */ 0.72, 0.45, 0.92, 0.04, 0.00, 0.04, 0.00);
plant(Biome.TemperateForest, /*    */ 0.70, 0.45, 0.30, 0.62, 0.00, 0.08, 0.00);
plant(Biome.TemperateRainforest, /**/ 0.80, 0.50, 0.55, 0.40, 0.00, 0.05, 0.00);
plant(Biome.Grassland, /*          */ 0.10, 0.35, 0.00, 0.22, 0.00, 0.72, 0.06);
plant(Biome.Shrubland, /*          */ 0.30, 0.28, 0.00, 0.08, 0.00, 0.88, 0.04);
plant(Biome.Savanna, /*            */ 0.18, 0.38, 0.00, 0.55, 0.02, 0.38, 0.05);
plant(Biome.TropicalForest, /*     */ 0.78, 0.45, 0.00, 0.72, 0.24, 0.04, 0.00);
plant(Biome.TropicalRainforest, /* */ 0.85, 0.48, 0.00, 0.70, 0.28, 0.02, 0.00);
plant(Biome.Desert, /*             */ 0.02, 0.20, 0.00, 0.00, 0.00, 0.55, 0.45);
plant(Biome.ColdDesert, /*         */ 0.05, 0.20, 0.00, 0.00, 0.00, 0.50, 0.50);
plant(Biome.Alpine, /*             */ 0.10, 0.25, 0.06, 0.00, 0.00, 0.22, 0.72);
plant(Biome.Beach, /*              */ 0.07, 0.40, 0.00, 0.00, 0.55, 0.40, 0.05);
plant(Biome.Mangrove, /*           */ 0.62, 0.50, 0.00, 0.75, 0.15, 0.10, 0.00);
plant(Biome.SaltMarsh, /*          */ 0.14, 0.30, 0.00, 0.00, 0.00, 1.00, 0.00);
plant(Biome.Marsh, /*              */ 0.20, 0.38, 0.00, 0.08, 0.00, 0.92, 0.00);
plant(Biome.PeatBog, /*            */ 0.12, 0.28, 0.00, 0.00, 0.00, 1.00, 0.00);
plant(Biome.Steppe, /*             */ 0.09, 0.25, 0.00, 0.00, 0.00, 0.90, 0.10);
plant(Biome.Chaparral, /*          */ 0.34, 0.28, 0.00, 0.12, 0.00, 0.82, 0.06);
plant(Biome.MonsoonForest, /*      */ 0.66, 0.45, 0.00, 0.78, 0.14, 0.08, 0.00);
plant(Biome.CloudForest, /*        */ 0.74, 0.48, 0.32, 0.58, 0.00, 0.10, 0.00);
plant(Biome.MontaneForest, /*      */ 0.70, 0.48, 0.86, 0.08, 0.00, 0.06, 0.00);
plant(Biome.AlpineMeadow, /*       */ 0.12, 0.32, 0.00, 0.00, 0.00, 0.86, 0.14);
plant(Biome.Erg, /*                */ 0.006, 0.15, 0.00, 0.00, 0.00, 1.00, 0.00);
plant(Biome.Reg, /*                */ 0.03, 0.15, 0.00, 0.00, 0.00, 0.20, 0.80);
plant(Biome.Badlands, /*           */ 0.07, 0.18, 0.00, 0.00, 0.00, 0.22, 0.78);
plant(Biome.RiparianForest, /*     */ 0.70, 0.48, 0.00, 0.80, 0.06, 0.14, 0.00);
plant(Biome.Karst, /*              */ 0.46, 0.42, 0.00, 0.55, 0.00, 0.15, 0.30);
plant(Biome.Bamboo, /*             */ 0.72, 0.42, 0.86, 0.00, 0.00, 0.14, 0.00);
plant(Biome.FogDesert, /*          */ 0.05, 0.20, 0.00, 0.00, 0.00, 0.80, 0.20);
plant(Biome.ThornScrub, /*         */ 0.34, 0.24, 0.00, 0.07, 0.00, 0.88, 0.05);
plant(Biome.Moor, /*               */ 0.22, 0.26, 0.00, 0.00, 0.00, 0.94, 0.06);
plant(Biome.Puna, /*               */ 0.10, 0.22, 0.00, 0.00, 0.00, 0.82, 0.18);
plant(Biome.Volcanic, /*           */ 0.06, 0.10, 0.00, 0.00, 0.00, 0.10, 0.90);
plant(Biome.AshPlain, /*           */ 0.03, 0.10, 0.00, 0.00, 0.00, 0.30, 0.70);
// Los raros. `green` a cero: su color ES la gracia y no se toca.
plant(Biome.PetrifiedForest, /*    */ 0.20, 0.00, 0.70, 0.00, 0.00, 0.00, 0.30);
plant(Biome.FungalForest, /*       */ 0.66, 0.00, 0.00, 0.70, 0.00, 0.30, 0.00);
plant(Biome.CrystalFlats, /*       */ 0.10, 0.00, 0.00, 0.00, 0.00, 0.00, 1.00);
plant(Biome.GlowMarsh, /*          */ 0.24, 0.00, 0.00, 0.15, 0.00, 0.85, 0.00);
// Y los que no llevan nada, explícitos para que se vea que es una decisión:
// océano, lago, casquete, glaciar y salina.
PLANTING[Biome.Ocean].density = 0;
PLANTING[Biome.Lake].density = 0;
PLANTING[Biome.IceCap].density = 0;
PLANTING[Biome.Glacier].density = 0;
PLANTING[Biome.SaltFlat].density = 0;

/** El verde al que tira el follaje. Una hoja no es del color del suelo. */
const FOLIAGE: [number, number, number] = [0.176, 0.318, 0.145];

/**
 * El color de una planta, DERIVADO DE LA PALETA DEL MAPA.
 *
 * Sale de `BIOME_COLORS` a propósito y no de una tabla propia: si el bosque
 * boreal del atlas es #43634d, un pinar plantado encima tiene que ser ese mismo
 * verde un poco más oscuro y un poco más saturado — no un verde parecido
 * afinado por separado, que es como se consigue que la vegetación parezca
 * pegada encima en vez de crecida allí.
 *
 * Un 22 % más oscuro que el suelo. Es lo justo para que los grupos se lean como
 * grupos contra la ladera; más y salen como manchas de tinta, menos y a
 * cincuenta píxeles el bosque desaparece dentro de su propio color.
 */
function tintFor(biome: number, kind: number, out: [number, number, number]): void {
  const c = BIOME_COLORS[biome] ?? BIOME_COLORS[Biome.Grassland] as [number, number, number];
  let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  if (kind === ROCK) {
    // La piedra no es vegetal: se desatura hacia el gris del propio bioma en
    // vez de tirar al verde, o los pedregales de un desierto salen musgosos.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r += (lum - r) * 0.62; g += (lum - g) * 0.62; b += (lum - b) * 0.62;
    r *= 0.84; g *= 0.84; b *= 0.86;
  } else {
    const pull = PLANTING[biome].green * (kind === SCRUB ? 0.55 : 1);
    r = r * 0.78 + (FOLIAGE[0] - r * 0.78) * pull;
    g = g * 0.78 + (FOLIAGE[1] - g * 0.78) * pull;
    b = b * 0.78 + (FOLIAGE[2] - b * 0.78) * pull;
    if (kind === CONIFER) { r *= 0.86; g *= 0.94; b *= 0.96; }
    if (kind === PALM) { r *= 1.08; g *= 1.06; b *= 0.90; }
  }
  out[0] = r; out[1] = g; out[2] = b;
}

/** Corteza: un pardo frío, no un marrón de juguete. */
const BARK: [number, number, number] = [0.152, 0.118, 0.094];

/**
 * La tabla entera, resuelta una vez al cargar el módulo.
 *
 * `BIOME_COLORS` es un Record con claves numéricas, o sea un objeto en modo
 * diccionario: cada lectura es una búsqueda con picado, no un índice. Hacerla
 * dieciséis mil veces por siembra costaba más que todo el filtrado junto.
 * Aquí son 44 x 5 x 3 flotantes —660 números, 2,6 kB— y una multiplicación.
 */
const TINTS = new Float32Array(BIOME_COUNT * KIND_COUNT * 3);
{
  const t: [number, number, number] = [0, 0, 0];
  for (let b = 0; b < BIOME_COUNT; b++) {
    for (let k = 0; k < KIND_COUNT; k++) {
      tintFor(b, k, t);
      const i = (b * KIND_COUNT + k) * 3;
      TINTS[i] = t[0]; TINTS[i + 1] = t[1]; TINTS[i + 2] = t[2];
    }
  }
}

// ---------------------------------------------------------------------------
// El picado
// ---------------------------------------------------------------------------

/**
 * El mismo picado entero de 32 bits que `tipLattice` en scene3d.ts y `wHash` en
 * water.ts. NO un picado de sin(): sin() tiene precisión distinta en cada
 * driver, y aquí además la mitad de las cuentas las hace la CPU y la otra mitad
 * la GPU — con sin() «el mismo bosque» sería otro bosque en otra máquina, y en
 * la misma máquina el árbol no estaría donde el shader lo dibuja.
 */
function ihash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** La semilla, de cadena a entero. Mismo FNV-1a de 32 bits que el resto. */
function seedToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * La reconstrucción del campo de alturas, IDÉNTICA a `baseHeightAt` del vertex
 * shader del terreno: pesos suavizados, x envuelta, y recortada. Copiada y no
 * importada porque `bilinearWrapped` de scene3d.ts no está exportada; si algún
 * día lo está, esto se borra. Cualquier diferencia entre las dos sale como
 * árboles flotando sobre las lomas.
 */
function heightFromField(
  values: Float32Array, width: number, height: number, u: number, v: number,
): number {
  const tx = u * width - 0.5;
  const ty = v * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const sx = tx - x0, sy = ty - y0;
  const fx = sx * sx * (3 - 2 * sx);
  const fy = sy * sy * (3 - 2 * sy);
  const ax = ((x0 % width) + width) % width;
  const bx = (((x0 + 1) % width) + width) % width;
  const ay = Math.min(height - 1, Math.max(0, y0));
  const by = Math.min(height - 1, Math.max(0, y0 + 1));
  const a = values[ay * width + ax] * (1 - fx) + values[ay * width + bx] * fx;
  const b = values[by * width + ax] * (1 - fx) + values[by * width + bx] * fx;
  return a * (1 - fy) + b * fy;
}

// ---------------------------------------------------------------------------
// Los números que gobiernan la siembra
// ---------------------------------------------------------------------------

/**
 * Cuántas plantas caben a lo ancho del encuadre, a la distancia del punto que
 * se está mirando. 42 medido: con 30 el bosque sale como un huerto (se ve la
 * rejilla aunque esté agitada), con 70 las copas se solapan tanto que el
 * conjunto vuelve a ser una mancha lisa y se paga cinco veces más.
 */
const SITES_ACROSS = 42;

/**
 * Altura de la planta en pasos de rejilla.
 *
 * Kilo y medio, no uno. Con 1,22 —el primer número— la copa de una conífera
 * medía 0,88 pasos de ancho, o sea que entre dos árboles vecinos quedaba
 * siempre un hueco: medido en la pose comarcal del banco, la selva tropical se
 * dibujaba como PIMIENTA sobre el verde en vez de como una masa. Con 1,55 las
 * copas se tocan y el conjunto se lee como dosel, que es lo que es. Cuesta
 * relleno, no instancias.
 */
const PLANT_H = 1.55;
// Ya no lo lee nadie: el tamaño lo decide `PLANT_M` en metros, y el suelo se
// escribe contra el encuadre. Se queda porque es la MEDIDA que explica de dónde
// sale el 0,0103 de ahí abajo — `1,55 · (1/42) · 0,28` — y borrarlo dejaría ese
// número sin procedencia.
void PLANT_H;

/**
 * LA ALTURA DE UN ÁRBOL, EN METROS, PORQUE ESTOS MUNDOS SON DEL TAMAÑO DE LA
 * TIERRA.
 *
 * `PLANT_H` sola ataba la planta al ENCUADRE: `uSize = PLANT_H · frameUnits /
 * SITES_ACROSS`, o sea que un árbol medía siempre el 3,7 % de lo que estuvieras
 * mirando. Se alejaba uno diez veces y el árbol se alejaba con él, del mismo
 * tamaño en pantalla. Reportado por el lector — «los árboles son demasiado
 * grandes, estos mundos son del tamaño de la Tierra» — y tiene toda la razón:
 * un pino de treinta metros en una celda de treinta y nueve kilómetros es una
 * milésima de la celda, y lo que se dibujaba era del tamaño de un valle.
 *
 * Así que la altura pasa a ser FÍSICA, en metros, convertida a unidades de
 * escena por el mismo `yMul` que estira las montañas. Eso mantiene la
 * proporción correcta contra el relieve: si un pico de tres mil metros se
 * dibuja con la exageración vertical de esta vista, un pino de treinta se
 * dibuja con la misma, y la razón entre los dos sigue siendo 1:100.
 *
 * Sigue habiendo un tope contra el encuadre, y no por gusto: con la exageración
 * en su tope (60) el `yMul` es diez veces el de por defecto, y un pino saldría
 * midiendo un tercio de la pantalla. El tope dice «nunca más de esto», no «esto
 * exactamente», así que quien mira una cordillera no ve pinos del tamaño de la
 * cordillera y quien baja al suelo sí los ve.
 */
const PLANT_M = 28;
/** Y el techo: fracción del alto del encuadre que una planta no puede pasar. */
const PLANT_MAX_FRAME = 0.012;

/**
 * Alcance de cada nivel, en pasos de SU rejilla. Constante por nivel, así que
 * cada nivel cuesta lo mismo —(2·48)² = 9.216 celdas de barrido— y llega al
 * doble de lejos que el siguiente. Con cinco niveles el alcance total es 16
 * veces el del nivel fino, y en el borde exterior una planta mide un píxel: es
 * el punto en el que el color del terreno toma el relevo, y por eso ahí se
 * acaba.
 */
const REACH_CELLS = 48;

/** Cuántos niveles gruesos por debajo del fino. */
const LEVELS_OUT = 3;

/** Cuánto se agita cada sitio dentro de su celda. Casi entero: por debajo de
 *  0,8 la rejilla se ve, y una rejilla visible es lo contrario de un bosque. */
const JITTER = 0.92;

/**
 * La pendiente a la que se acaba la vegetación, en unidades de escena por
 * unidad de escena (o sea: tangente del ángulo del terreno TAL COMO SE DIBUJA,
 * con su exageración vertical dentro). Medido sobre el mundo por defecto: la
 * llanura anda por 0,05, una ladera de cordillera por 0,5, y un farallón pasa
 * de 1. Se apaga entre los dos últimos.
 */
const SLOPE_FULL = 0.55;
const SLOPE_NONE = 1.05;

/** Altura a la que se acaba el arbolado si nadie pasa temperaturas, en km. */
const TREELINE_KM = 3.2;
const TREELINE_BARE_KM = 4.1;
/** Y con temperaturas: la isoterma del mes más frío que el atlas ya usa. */
const TREELINE_C = -5.5;
const TREELINE_BARE_C = -11;

/**
 * EL DESVANECIDO GLOBAL POR ENCUADRE, que es la respuesta a «a vista de planeta
 * tiene que haber cero instancias».
 *
 * A 900 km de encuadre una planta mide unos veinticinco píxeles de las 1.200 de
 * ancho: se lee como planta. A 4.500 mide cinco, o sea que ya no es una planta
 * sino grano sobre el mapa — y el color del bioma, que a esa escala es lo único
 * que se ve, ya dice «bosque» mucho mejor que veinte mil puntitos. Entre esos
 * dos números el tamaño baja a cero y la llamada de dibujo desaparece entera.
 *
 * Los dos números subieron después de mirar el banco: con 520/3400 la pose
 * comarcal (1.780 km medidos) dibujaba las plantas al 59 % de su tamaño y la
 * ladera arbolada salía gris. El corte tiene que caer donde el símbolo deja de
 * decir algo, no donde el encuadre deja de ser íntimo.
 *
 * Y EL DESVANECIDO VA AL CUADRADO, que es la diferencia entre «un bosque que se
 * aleja» y PIMIENTA. Con la rampa recta, la pose regional del banco (3.823 km
 * medidos) dibujaba las plantas al 9 % — cuatro píxeles de un verde un 22 % más
 * oscuro que el suelo, o sea grano sucio repartido sobre la ladera, que es peor
 * que no tener nada. El problema no es el tamaño, es el CONTRASTE: por debajo de
 * unos diez píxeles una copa ya no es una copa, es un punto oscuro, y el color
 * del bioma dice «bosque» mejor que veinte mil puntos oscuros. Al cuadrado, la
 * comarcal apenas baja (0,81 → 0,65: sigue midiendo veintinueve píxeles) y la
 * regional cae por debajo del 3 % y desaparece entera. El corte efectivo queda
 * en 3.400 km de encuadre.
 */
const FRAME_FULL_KM = 900;
const FRAME_OFF_KM = 4500;

/**
 * Cuánto puede alejarse el ancla antes de volver a sembrar, en fracción del
 * alcance del nivel fino. Con 0,12, sembrar de nuevo cuesta ~1 ms y pasa cada
 * doce por ciento de un encuadre de recorrido; y lo que entra al hacerlo entra
 * por el borde del anillo, donde la escala ya está en cero y no se ve aparecer.
 */
const RESEED_MOVE = 0.12;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
precision highp float;

uniform vec3  uSun;         // dirección AL sol
uniform vec3  uSunCol;
uniform float uSunPower;
uniform vec3  uAmbient;     // ya normalizado a luminancia 1 (ver setSun)
uniform vec3  uHorizon;
uniform vec3  uFogWarm;
uniform float uFogDist;
uniform float uFogOn;
uniform float uShape;       // 0 plano, 1 globo
uniform float uSize;        // altura base de la planta, unidades de escena
uniform float uLod;         // el nivel continuo del encuadre
uniform float uReach;       // alcance del nivel 0, en unidades de escena
uniform float uReachMax;    // y su tope: el horizonte, en el globo
uniform vec3  uAnchor;      // el punto que se está mirando
uniform float uTime;
uniform float uWind;
uniform float uGlobal;      // 0–1, el desvanecido por encuadre
uniform vec4  uQuad[15];    // (y0, y1, w0, w1) por especie·3 + cuadrilátero
uniform float uBark[5];
uniform vec3  uBarkCol;

in float aCard;             // 0 o 1: cuál de las dos cartas cruzadas
in vec3  iPos;              // el pie de la planta, en el mundo
in vec4  iParam;            // (especie, nivel, escala, fase)
in vec3  iTint;

out vec3 vCol;

void main() {
  int kind = int(iParam.x + 0.5);
  float level = iParam.y;
  vec3 up = uShape < 0.5 ? vec3(0.0, 1.0, 0.0) : normalize(iPos);

  // ---- ¿existe esta planta ahora mismo, y cuánto mide? ---------------------
  //
  // Tres desvanecidos multiplicados, TODOS SOBRE LA ESCALA y ninguno sobre el
  // alfa: una planta que se va se encoge hasta desaparecer. Es lo que permite
  // que todo esto sea una sola llamada opaca.
  //
  //   · grow: el nivel más fino ENTRA creciendo según se acerca la cámara, y
  //     el más grueso SALE encogiendo. Sin esto, cada vez que el nivel entero
  //     cambia aparecerían de golpe cuatro veces más árboles — el «pop» clásico
  //     de un sistema de niveles, y el más fácil de ver de todos.
  //   · ring: el borde del disco de este nivel. Un disco con canto es un
  //     círculo de bosque perfectamente recortado alrededor de la cámara.
  //   · hazeOut: donde la bruma ya vale casi uno, la planta es un píxel del
  //     color del horizonte. Quitarla es gratis y no se nota.
  float grow = smoothstep(-1.0, -0.08, uLod - level)
             * (1.0 - smoothstep(3.0, 3.9, uLod - level));
  // El tope tiene que ser el MISMO que aplica la siembra o el desvanecido del
  // borde del anillo no coincidiría con dónde deja de haber plantas: se vería
  // un canto de bosque en vez de un borde que se apaga.
  float reach = min(uReach * exp2(-level), uReachMax);
  float ring = 1.0 - smoothstep(0.76, 1.0, length(iPos - uAnchor) / max(1e-6, reach));

  vec3 toCam = cameraPosition - iPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-5);

  // Distancia HORIZONTAL en el plano, como el terreno y el agua: es la que mide
  // el aire que atraviesa la mirada. Desde muy alto y mirando a plomo el camino
  // es corto, y ahí la vista de mapa tiene que quedar limpia.
  float dxz = uShape < 0.5 ? length(iPos.xz - cameraPosition.xz) : dist;
  float fog = uFogOn * (1.0 - exp(-pow(dxz / max(1e-3, uFogDist), 1.3)));
  float hazeOut = 1.0 - smoothstep(0.90, 0.998, fog);

  float h = uSize * iParam.z * grow * ring * uGlobal * hazeOut;

  // ---- la carta ------------------------------------------------------------
  //
  // ORIENTADA A LA CÁMARA, no al mundo. Dos cartas cruzadas con giro fijo son
  // más «correctas», y tienen un fallo que se ve siempre: en cuanto la mirada
  // se alinea con una de las dos, esa carta se ve de canto y la planta pierde
  // la mitad de su silueta. Anclarlas a la cámara es el idioma del impostor y
  // cuesta exactamente lo mismo. Lo que se pierde —que un árbol se vea distinto
  // desde el otro lado— no existe: son cuadriláteros de color plano.
  // Y MIRANDO A PLOMO SE ENDEREZAN CONTRA LA PANTALLA. Una carta vertical vista
  // desde arriba es una línea, y la vista cenital se quedaba sin vegetación.
  //
  // La primera versión inclinaba el eje HACIA la cámara, y era peor: un eje
  // paralelo a la mirada se escorza hasta medir cero en pantalla, así que cada
  // árbol salía como una raya oscura del ancho de la copa. Lo que hay que hacer
  // es lo contrario — llevar el eje a la PROYECCIÓN de la vertical sobre el
  // plano perpendicular a la mirada, que es un billboard completo y conserva
  // toda la silueta. Justo en el nadir esa proyección se anula y no hay
  // dirección preferida: ahí se coge una fija, y como cada planta ya trae su
  // fase, el conjunto se lee como copas sueltas y no como un peine.
  float steep = abs(dot(V, up));
  float tilt = smoothstep(0.70, 0.99, steep);
  vec3 f = up - V * dot(up, V);
  float fl = length(f);
  vec3 faceUp = fl > 1e-3 ? f / fl : normalize(cross(V, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 axis = normalize(mix(up, faceUp, tilt));
  // Con tilt=1 el eje es perpendicular a la mirada, así que este producto
  // vectorial no puede degenerar; con tilt=0 el eje es la vertical, y el único
  // caso en que la vertical es paralela a la mirada es el nadir, donde tilt ya
  // vale uno. Las dos degeneraciones no se solapan nunca.
  vec3 side = normalize(cross(axis, V));
  // La segunda carta se apaga por dos motivos: cuando la planta baja de unos
  // ocho píxeles (la cruz y una sola carta son el mismo puñado de píxeles, y la
  // cruz cuesta el doble de relleno) y cuando la primera pasa a billboard
  // completo (la segunda queda paralela a la mirada, o sea invisible y cara).
  float two = (1.0 - smoothstep(70.0, 150.0, dist / max(1e-6, h))) * (1.0 - tilt);
  vec3 card = aCard < 0.5 ? side : normalize(cross(axis, side));
  float cardW = aCard < 0.5 ? 1.0 : two;
  // Y tumbada, la planta se acorta. Un árbol visto desde arriba ocupa lo que
  // mide su copa de ancho, no lo que mide de alto: sin esto, la vista cenital
  // dibuja el bosque como una lluvia de trazos largos.
  h *= mix(1.0, 0.52, tilt);

  int qi = int(position.z + 0.5);
  vec4 q = uQuad[kind * 3 + qi];
  float y = mix(q.x, q.y, position.y);
  // EL TRONCO DESAPARECE AL TUMBARSE, y esto es el fallo que más delataba a las
  // cartas. Visto a plomo un árbol enseña COPA, no tronco; pero con la carta ya
  // horizontal el cuadrilátero del tronco —cinco centésimas de ancho por tres
  // décimas de largo— se dibuja de plano y de cara, y sale como una RAYA del
  // color de la corteza. En la cenital y en el globo de cerca eran cientos de
  // palitos negros sembrados por encima del dosel: leídos como ramas secas, o
  // directamente como suciedad en la pantalla.
  //
  // Se apaga con el mismo tilt que tumba la carta, y SÓLO en las especies que
  // tienen tronco. Para la roca el cuadrilátero 0 no es un tronco sino su base,
  // y desde arriba es justo lo único que se ve: uBark vale cero ahí y el mix no
  // la toca. Para el matorral vale 0,35 y se adelgaza a medias, que es lo suyo.
  float trunk = qi == 0 ? mix(1.0, 1.0 - tilt, uBark[kind]) : 1.0;
  float w = mix(q.z, q.w, position.y) * position.x * cardW * trunk;

  // El viento. Cuadrático en la altura: el tronco no se mueve y la punta sí,
  // que es lo único que hace falta para que una copa parezca viva.
  vec3 windDir = uShape < 0.5 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
  float sway = sin(uTime * 1.35 + iParam.w * 6.2831853) * uWind * y * y;

  // Y EL PIE SE HUNDE UN DIEZ POR CIENTO. La malla dibuja el terreno
  // interpolado entre sus vértices; este árbol se apoya en el campo suave. En
  // cuanto un cuadrilátero de la malla abarca más de una celda, las dos
  // superficies difieren, y de los dos errores posibles —flotar o hundirse—
  // sólo uno se ve.
  //
  // PERO TUMBADA HAY QUE LEVANTARLA, y esto es un fallo medido, no una
  // precaución. Con el eje ya horizontal, una carta enraizada en el pie queda
  // TENDIDA SOBRE EL PLANO TANGENTE — o sea, enterrada en el terreno: en la
  // vista cenital del globo salía un agujero elíptico de bosque justo debajo de
  // la cámara, con plantas alrededor y ninguna en el centro. Eran 1.867
  // instancias en pantalla y no se veía casi ninguna. Levantándola media altura
  // según se tumba, la copa queda por encima del suelo, que es donde está.
  float lift = h * (0.55 * tilt - 0.10 * (1.0 - tilt));
  vec3 world = iPos + up * lift + axis * (y * h) + card * (w * h) + windDir * (sway * h);

  // ---- la luz, analítica, porque en esta escena no hay ni una THREE.Light ---
  //
  // Misma lámpara que el terreno (ver el bloque de luz de scene3d.ts): la misma
  // curva de día, el mismo relleno normalizado, el mismo 0,92 de directa. Lo
  // único distinto es que aquí no se aplica uFlatLight: una piel de satélite
  // trae su propia luz dentro y por eso el suelo se aplana, pero un árbol es un
  // objeto, no una fotografía, y aplanarlo lo devolvería a ser una calcomanía.
  vec3 nrm = normalize(card * (w * 1.6) + up * 0.62 + V * 0.26);
  vec3 L = normalize(uSun);
  // Hoja fina: la luz la ATRAVIESA. Un lambert recto deja media copa en negro,
  // que es como se ve un modelo, no un árbol.
  float lit = clamp(dot(nrm, L) * 0.62 + 0.38, 0.0, 1.0);
  float skyT = 0.5 + 0.5 * dot(nrm, up);
  float dayAmt = 0.12 + 0.88 * pow(clamp(uSunPower, 0.0, 1.0), 0.65);
  vec3 amb = uAmbient * dayAmt;
  vec3 sun = uSunCol * clamp(uSunPower, 0.0, 1.0);

  vec3 base = mix(iTint, uBarkCol, qi == 0 ? uBark[kind] : 0.0);
  // El interior de la copa está en su propia sombra. Un degradado vertical hace
  // más por el volumen, a este tamaño, que cualquier otra cosa que se pague.
  base *= 0.60 + 0.40 * smoothstep(0.0, 0.90, y);

  vec3 col = base * (amb * 0.34 + sun * (0.92 * lit) * 0.72 + amb * (0.20 * skyT));
  // Contraluz. Una copa contra el sol se ENCIENDE, y esa es la mitad del
  // carácter de una tarde; sin ella el bosque a contraluz es una silueta negra.
  col += base * sun * (pow(max(dot(-V, L), 0.0), 5.0) * 0.55 * clamp(uSunPower, 0.0, 1.0));

  // Y la lejanía funde al MISMO color que el terreno y el agua: el horizonte,
  // calentado hacia el lado del sol con el mismo pow(dot(-V,sol),3)·0,55. Si no
  // coincidiera, un bosque lejano se recortaría contra su propia ladera.
  vCol = mix(col, mix(uHorizon, uFogWarm, pow(max(dot(-V, L), 0.0), 3.0) * 0.55), fog);

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

in vec3 vCol;
out vec4 outColor;

// Todo el sombreado vive en el vértice. Una planta tiene veinticuatro vértices
// y puede tener cien píxeles: pagar la luz por píxel sería pagarla cuatro veces
// de más, y sobre veinte mil instancias eso es el presupuesto entero. Lo que se
// pierde —un degradado dentro de cada cuadrilátero— no existe: los
// cuadriláteros ya interpolan entre sus cuatro esquinas.
void main() {
  outColor = vec4(vCol, 1.0);
}
`;

// ---------------------------------------------------------------------------
// La geometría: dos cartas cruzadas de tres cuadriláteros
// ---------------------------------------------------------------------------

function buildCards(): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const card: number[] = [];
  const idx: number[] = [];
  for (let c = 0; c < 2; c++) {
    for (let q = 0; q < 3; q++) {
      const base = pos.length / 3;
      // (x del borde, t del carril, índice del cuadrilátero). El vertex shader
      // los convierte en una silueta según la especie; aquí no hay forma
      // ninguna, que es lo que permite que las cinco compartan una geometría y
      // por tanto UNA llamada de dibujo.
      pos.push(-1, 0, q, 1, 0, q, 1, 1, q, -1, 1, q);
      card.push(c, c, c, c);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aCard', new THREE.BufferAttribute(new Float32Array(card), 1));
  g.setIndex(idx);
  // Las posiciones de verdad las calcula el shader, así que la esfera
  // envolvente de este atributo no significa nada y el frustum culling la
  // tiraría entera. Se apaga en la malla y se pone una esfera enorme por si
  // alguien la mira.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SIZE_X * 4);
  return g;
}

// ---------------------------------------------------------------------------

export function createScatter(o: ScatterOptions): Scatter {
  const seedInt = seedToInt(o.seed);
  // EL PRESUPUESTO. 20.000 instancias × 12 triángulos = 240.000 triángulos, que
  // es menos de lo que cuesta la propia malla del terreno en su ajuste más
  // bajo (512² × 2 = 524.288) y del orden de un tercio del ajuste medio. Sale
  // de la cuenta de la siembra y no de un número redondo: cinco niveles × un
  // disco de 48 celdas de radio × (π/4 del cuadro de barrido) × ~0,45 que
  // sobrevive al recorte del tronco de visión = 16.300 sitios, y eso es con
  // TODOS los sitios germinando, o sea selva de horizonte a horizonte. Un
  // encuadre normal anda por 4.000–9.000.
  const maxInstances = Math.max(256, Math.round(o.maxInstances ?? 20000));
  const kmPerUnit = EARTH_KM / o.sizeX;

  const geometry = buildCards();
  const iPos = new Float32Array(maxInstances * 3);
  const iParam = new Float32Array(maxInstances * 4);
  const iTint = new Float32Array(maxInstances * 3);
  const aPos = new THREE.InstancedBufferAttribute(iPos, 3);
  const aParam = new THREE.InstancedBufferAttribute(iParam, 4);
  const aTint = new THREE.InstancedBufferAttribute(iTint, 3);
  aPos.setUsage(THREE.DynamicDrawUsage);
  aParam.setUsage(THREE.DynamicDrawUsage);
  aTint.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iPos', aPos);
  geometry.setAttribute('iParam', aParam);
  geometry.setAttribute('iTint', aTint);
  geometry.instanceCount = 0;

  const quadArr: THREE.Vector4[] = QUADS.map((q) => new THREE.Vector4(q[0], q[1], q[2], q[3]));

  const uniforms = {
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 0.97, 0.93) },
    uSunPower: { value: 1 },
    uAmbient: { value: new THREE.Color(1, 1, 1) },
    uHorizon: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uFogWarm: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uFogDist: { value: o.sizeX * 8 },
    uFogOn: { value: 1 },
    uShape: { value: 0 },
    uSize: { value: 0.02 },
    uLod: { value: 12 },
    uReach: { value: REACH_CELLS * o.sizeX },
    uReachMax: { value: 1e9 },
    uAnchor: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uWind: { value: 0.05 },
    uGlobal: { value: 0 },
    uQuad: { value: quadArr },
    uBark: { value: KIND_BARK.slice() },
    uBarkCol: { value: new THREE.Color(BARK[0], BARK[1], BARK[2]) },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    // Opaco y de dos caras. De dos caras porque una carta se ve por los dos
    // lados; opaco porque NADA aquí es transparente (ver la cabecera), y eso
    // vale por sí solo: sin mezcla no hay orden de dibujo que resolver, y el
    // z-buffer coloca la vegetación entre el terreno y el agua sin ayuda.
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Después del terreno (renderOrder 0) y antes del agua (1): así el agua, que
  // sí es transparente, se mezcla sobre la vegetación de la orilla ya dibujada.
  mesh.renderOrder = 0;

  const group = new THREE.Object3D();
  group.matrixAutoUpdate = false;
  group.add(mesh);

  // ---- el mundo -----------------------------------------------------------
  let elevation: Float32Array | null = null;
  let biomeArr: Uint8Array | null = null;
  let temperature: Float32Array | null = null;
  let externalHeight: ((u: number, v: number) => number) | null = null;
  let W = 1, H = 1;
  let yMul = 1;
  let seaLevel = 0;
  let worldDirty = false;

  // ---- estado de la última siembra ----------------------------------------
  let sown = 0;
  let sownKinds = 0;
  let sowMs = 0;
  /** Altura de la cámara sobre el suelo que tiene debajo, en unidades de
   *  escena. La calcula `findAnchor` y la usa la siembra para el horizonte. */
  let camAbove = 1;
  let lastLevel = -999;
  let lastShape = '';
  // La ventana de la última siembra, YA CUANTIZADA. Ver el gate de `update`.
  let lastWinS = -1;
  let lastWinU = 0;
  let lastWinV = 0;
  const lastAnchor = new THREE.Vector3(1e9, 1e9, 1e9);

  // Reservados una vez: `update` corre sesenta veces por segundo y un vector
  // nuevo por fotograma es basura para el recolector justo en el hilo que
  // dibuja.
  const anchor = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function heightAt(u: number, v: number): number {
    if (externalHeight) return externalHeight(u, v);
    if (!elevation) return 0;
    return heightFromField(elevation, W, H, u, v);
  }

  /** Dónde cae un uv en la escena. Gemelo exacto de `placeAt` en scene3d.ts. */
  function place(u: number, v: number, e: number, globe: boolean, out: THREE.Vector3): void {
    if (!globe) {
      out.set((u - 0.5) * o.sizeX, e * yMul, (v - 0.5) * o.sizeZ);
      return;
    }
    const lon = (u - 0.5) * Math.PI * 2;
    const lat = (0.5 - v) * Math.PI;
    const r = o.radius + e * yMul * GLOBE_RELIEF;
    const cl = Math.cos(lat);
    out.set(r * cl * Math.cos(lon), r * Math.sin(lat), r * cl * Math.sin(lon));
  }

  /**
   * El punto que el lector está mirando, y a qué distancia lo tiene.
   *
   * NO SE USA `window` PARA ESTO, y es la corrección más importante del
   * archivo. `window` es lo que devuelve `visibleWindow`, que vale el MUNDO
   * ENTERO en cuanto un rayo de esquina se escapa por encima del horizonte — o
   * sea exactamente en la pose de cámara baja, que es justo donde la vegetación
   * es medio fotograma. Sembrar según ese número apagaría el bosque en la única
   * vista donde importa. El encuadre se saca de la cámara, y `window` se usa
   * sólo para lo que sí sabe: hasta dónde llega la malla (ver la siembra).
   */
  function findAnchor(camera: THREE.PerspectiveCamera, globe: boolean): number {
    camera.getWorldDirection(fwd);
    const p = camera.position;
    let hit = false;
    let hKm = 0;
    let t = 0;
    // Tres iteraciones: cortar contra la superficie a la altura que se creía,
    // leer la altura ahí, repetir. Converge en dos sobre cualquier ladera de
    // este mundo, y la tercera es por si acaso.
    for (let k = 0; k < 3; k++) {
      if (!globe) {
        const planeY = hKm * yMul;
        if (fwd.y > -1e-4) { hit = false; break; }
        t = (planeY - p.y) / fwd.y;
        if (t <= 0) { hit = false; break; }
        const x = p.x + fwd.x * t;
        const z = p.z + fwd.z * t;
        const v = z / o.sizeZ + 0.5;
        if (v < 0 || v > 1) { hit = false; break; }
        hKm = heightAt(x / o.sizeX + 0.5, v);
        anchor.set(x, hKm * yMul, z);
      } else {
        const r = o.radius + Math.max(0, hKm) * yMul * GLOBE_RELIEF;
        const b = p.dot(fwd);
        const c = p.lengthSq() - r * r;
        const disc = b * b - c;
        if (disc <= 0) { hit = false; break; }
        t = -b - Math.sqrt(disc);
        if (t <= 0) { hit = false; break; }
        anchor.set(p.x + fwd.x * t, p.y + fwd.y * t, p.z + fwd.z * t);
        const rr = Math.max(1e-5, anchor.length());
        const lat = Math.asin(Math.min(1, Math.max(-1, anchor.y / rr)));
        hKm = heightAt(Math.atan2(anchor.z, anchor.x) / (Math.PI * 2) + 0.5, 0.5 - lat / Math.PI);
      }
      hit = true;
    }

    // Cuánto vuela la cámara sobre el suelo que tiene DEBAJO. Es el techo del
    // encuadre, y hace falta: mirando casi al horizonte el rayo corta el
    // terreno a decenas de unidades —o no lo corta— y con esa distancia las
    // plantas del primer plano saldrían del tamaño de una colina.
    let above: number;
    if (!globe) {
      const gu = p.x / o.sizeX + 0.5;
      const gv = Math.min(1, Math.max(0, p.z / o.sizeZ + 0.5));
      above = p.y - heightAt(gu, gv) * yMul;
    } else {
      const rr = Math.max(1e-5, p.length());
      const lat = Math.asin(Math.min(1, Math.max(-1, p.y / rr)));
      const gh = heightAt(Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5, 0.5 - lat / Math.PI);
      above = rr - (o.radius + Math.max(0, gh) * yMul * GLOBE_RELIEF);
    }
    above = Math.max(1e-3, above);
    camAbove = above;

    if (!hit) {
      // Mirando al cielo o fuera del globo: se ancla en el subpunto de la
      // cámara con su propia altura como distancia. Es la vista de «estoy aquí
      // y miro al frente», y es la que tiene que seguir teniendo bosque.
      if (!globe) {
        const gu = p.x / o.sizeX + 0.5;
        const gv = Math.min(1, Math.max(0, p.z / o.sizeZ + 0.5));
        anchor.set(p.x, heightAt(gu, gv) * yMul, gv * o.sizeZ - o.sizeZ / 2);
      } else {
        anchor.copy(p).setLength(o.radius);
      }
      return above;
    }
    // DIECIOCHO VECES la altura, no seis. Con seis, la pose a ras de suelo del
    // banco —cámara a 0,30 sobre el terreno mirando cuesta abajo a un valle
    // arbolado— encuadraba 270 km y plantaba árboles de sesenta metros: el
    // fotograma salía con pimienta verde en vez de bosque, porque el valle que
    // se estaba mirando queda a veinte veces esa distancia. Dieciocho es una
    // vista tres grados por debajo de la horizontal, que es el límite en el que
    // «estoy mirando el paisaje» pasa a ser «estoy mirando el horizonte».
    return Math.min(t, above * 18);
  }

  /**
   * La siembra.
   *
   * Cinco niveles concéntricos alrededor del ancla. Cada uno barre el cuadro
   * de (2·48)² celdas de SU rejilla, así que el coste es el mismo en todos y
   * el alcance se dobla en cada uno hacia fuera.
   *
   * Las pruebas van de la más barata a la más cara a propósito — de 48.000
   * candidatos, el disco se lleva el 21 %, el tronco de visión otro 55 % de lo
   * que queda, y sólo entonces se toca el bioma. Al revés costaría cinco veces
   * más y daría exactamente lo mismo.
   */
  function sow(
    camera: THREE.PerspectiveCamera, globe: boolean, level: number,
    win: { u: number; v: number; size: number },
  ): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    sown = 0;
    let kindMask = 0;
    if (!elevation || !biomeArr) { sowMs = 0; sownKinds = 0; return; }
    // Copias locales. El bucle toca estos tres cuarenta mil veces, y a través
    // de una variable de cierre que además puede ser nula el motor vuelve a
    // comprobarlo en cada acceso.
    const elevA = elevation;
    const biomeA = biomeArr;
    const tempA = temperature;

    const cam = camera.position;
    // La dirección de la vista, APLANADA, para el recorte grosero por delante /
    // por detrás. Con guardia: mirando a plomo el aplanado da el vector cero, y
    // entonces no hay «delante» que valga y no se recorta nada.
    camera.getWorldDirection(fwd);
    const flat = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);
    // EN EL GLOBO NO SE RECORTA POR DELANTE, y no es una simplificación: sería
    // un error. (dx,dz) son desplazamientos en el plano TANGENTE al ancla —
    // longitud y latitud— y (anchor.x-cam.x, anchor.z-cam.z) son coordenadas de
    // mundo; en la esfera esas dos bases no tienen nada que ver, y sumarlas
    // dejó un agujero elíptico de bosque justo debajo de la cámara en la vista
    // cenital del planeta. Allí no hace falta: el horizonte ya acota el
    // alcance, y una vista de globo mira siempre a plomo a su subpunto (ver
    // focusWindow), así que no hay «detrás» que quitar.
    const useFront = flat > 0.22 && !globe;
    const fx = useFront ? fwd.x / flat : 0;
    const fz = useFront ? fwd.z / flat : 0;

    const reachMax = globe ? Math.sqrt(2 * o.radius * camAbove) * 1.25 : 1e9;
    const anchorOX = anchor.x - cam.x;
    const anchorOZ = anchor.z - cam.z;

    const anchorU = globe
      ? Math.atan2(anchor.z, anchor.x) / (Math.PI * 2) + 0.5
      : anchor.x / o.sizeX + 0.5;
    const anchorV = globe
      ? 0.5 - Math.asin(Math.min(1, Math.max(-1, anchor.y / Math.max(1e-5, anchor.length())))) / Math.PI
      : anchor.z / o.sizeZ + 0.5;

    // La ventana de la MALLA. Fuera de ella el terreno no se dibuja: una planta
    // ahí se quedaría flotando sobre el vacío. 0,43 y no 0,48 porque la ventana
    // que se compara está cuantizada a octavos (ver el gate de `update`): entre
    // dos siembras puede haberse ido medio octavo, y 0,43 + 0,0625 sigue estando
    // dentro del medio ancho de la malla. Como la ventana ya trae un 35 % de
    // relleno, el recorte sigue cayendo muy por fuera de la pantalla.
    const winHalf = win.size >= 0.999 ? 9 : win.size * 0.43;

    const p = new THREE.Vector3();
    // Las dos constantes de la pendiente, fuera del bucle.
    const gradX = yMul / (2 * (o.sizeX / W));
    const gradZ = yMul / (2 * (o.sizeZ / H));

    for (let d = -1; d <= LEVELS_OUT; d++) {
      const lv = level - d;
      if (lv < 1) continue;
      // EL TOPE SE PAGA POR ANILLOS ENTEROS, no a mitad de uno. Si se agotara
      // el presupuesto en medio de un nivel, lo que quedaría en pantalla sería
      // media corona de bosque terminada en línea recta — mucho peor que no
      // tener esa corona. Se para antes de empezar el siguiente, y como los
      // niveles van de fino a grueso, lo que se pierde es siempre lo más lejano
      // y lo más pequeño.
      if (sown > maxInstances * 0.82) break;
      const n = Math.pow(2, lv);                // columnas de rejilla en el mundo
      const cell = o.sizeX / n;                 // paso, en unidades de escena
      const vStep = cell / o.sizeZ;             // el mismo paso, en v
      // EN EL GLOBO, NADA MÁS ALLÁ DEL HORIZONTE.
      //
      // Los niveles gruesos alcanzan hasta 768 celdas, y en un planeta de radio
      // 38 unidades eso da la vuelta entera: la primera versión sembraba media
      // esfera, apilaba dieciséis mil instancias contra el limbo —donde se ven
      // de canto y se amontonan— y dejaba el borde como un muro de copas. El
      // horizonte de una cámara a h sobre una esfera de radio R está a
      // sqrt(2·R·h) de arco; un 25 % más por el relieve, y ahí se acaba.
      const reach = Math.min(REACH_CELLS * cell, reachMax);
      const reachCells = reach / cell;
      const reach2 = reach * reach;
      const aC = anchorU * n;
      const bC = anchorV / vStep;
      // EL BARRIDO SE CORTA CONTRA LA VENTANA DE LA MALLA, no sólo cada sitio.
      // Los niveles gruesos alcanzan hasta dieciséis veces más lejos que el
      // fino, y con la cámara baja la ventana mide una vigésima parte de eso:
      // sin este recorte, cuatro de los cinco niveles barrían 9.216 celdas para
      // tirar 9.100. Medido: la siembra bajó de 35 ms a menos de 4.
      let a0 = Math.floor(aC - reachCells);
      let a1 = Math.ceil(aC + reachCells);
      let b0 = Math.max(0, Math.floor(bC - reachCells));
      let b1 = Math.min(Math.floor(1 / vStep) - 1, Math.ceil(bC + reachCells));
      if (winHalf < 9) {
        // La rama envuelta de la ventana más cercana al ancla: si no, una
        // ventana al otro lado de la costura recortaría el mundo entero.
        let dwc = win.u - anchorU;
        dwc -= Math.round(dwc);
        a0 = Math.max(a0, Math.floor((anchorU + dwc - winHalf) * n));
        a1 = Math.min(a1, Math.ceil((anchorU + dwc + winHalf) * n));
        b0 = Math.max(b0, Math.floor((win.v - winHalf) / vStep));
        b1 = Math.min(b1, Math.ceil((win.v + winHalf) / vStep));
      }
      const salt = seedInt ^ Math.imul(lv, 0x9e3779b1);

      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          // El picado va con la columna ENVUELTA, la posición con la columna
          // tal cual: así el bosque cruza la costura del mundo sin cambiar de
          // sitio y sin repetirse.
          const aw = ((a % n) + n) % n;
          const h1 = ihash(aw, b, salt);
          const jx = (h1 & 0xffff) / 65536;
          const jy = (h1 >>> 16) / 65536;

          const ca = a + 0.5 + (jx - 0.5) * JITTER;
          const cb = b + 0.5 + (jy - 0.5) * JITTER;
          let dx = (ca - aC) * cell;
          const dz = (cb - bC) * cell;
          // En el globo los meridianos convergen: una celda de longitud mide
          // menos suelo cuanto más al norte. Sin el coseno, los discos de los
          // niveles se estirarían hasta dar la vuelta al mundo cerca del polo.
          if (globe) dx *= Math.cos((0.5 - cb * vStep) * Math.PI);
          if (dx * dx + dz * dz > reach2) continue;

          // EL RECORTE POR DELANTE VA AQUÍ, no al final. Los discos están
          // centrados en el ancla, que está DELANTE de la cámara: buena parte
          // de los niveles gruesos cae detrás, y medido en la pose a ras de
          // suelo eso es el 65 % de los candidatos que sobreviven a todo lo
          // demás. Hacerlo antes del bioma y de la altura ahorra ese 65 % del
          if (useFront) {
            const ox = anchorOX + dx, oz = anchorOZ + dz;
            // Todo lo que quede a más de 107° de la mirada. Generoso a
            // propósito: recortar justo al borde del tronco de visión pone
            // árboles que aparecen al girar, y girar es medio uso de la vista.
            //
            // AL CUADRADO, sin raíz. cos(a) < -0,3 con a el ángulo entre el
            // desplazamiento y la mirada equivale a producto<0 y producto² >
            // 0,09·|d|². Math.hypot vale diez veces una raíz —hace el cálculo a
            // prueba de desbordamiento— y esto se ejecuta treinta mil veces por
            // siembra: medido, la siembra bajó un 20 % sólo por esto.
            const dot = ox * fx + oz * fz;
            if (dot < 0 && dot * dot > 0.09 * (ox * ox + oz * oz)) continue;
          }

          const u = ca / n;
          const v = cb * vStep;
          if (v <= 0.0005 || v >= 0.9995) continue;
          let dw = u - win.u;
          dw -= Math.round(dw);
          if (Math.abs(dw) > winHalf || Math.abs(v - win.v) > winHalf) continue;

          const cx = ((Math.floor(u * W) % W) + W) % W;
          const cy = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
          const ci = cy * W + cx;
          const pl = PLANTING[biomeA[ci]] ?? PLANTING[0];
          if (pl.density <= 0) continue;

          const h2 = ihash(aw, b, salt ^ 0x85ebca6b);
          if ((h2 & 0xffff) / 65536 >= pl.density) continue;

          // La pendiente, del campo de mundo y con lecturas AL VECINO, sin
          // bilineal. Es una prueba de rechazo: una ladera medida media celda
          // más allá sigue siendo la misma ladera, y cuatro lecturas por
          // candidato en vez de dieciséis es la diferencia entre un milisegundo
          // y cuatro. Mismo argumento que hace `sunShadow` en scene3d.ts.
          const xm = (cx + W - 1) % W, xp = (cx + 1) % W;
          const ym = Math.max(0, cy - 1), yp = Math.min(H - 1, cy + 1);
          const sx = (elevA[cy * W + xp] - elevA[cy * W + xm]) * gradX;
          const sz = (elevA[yp * W + cx] - elevA[ym * W + cx]) * gradZ;
          const slope = Math.sqrt(sx * sx + sz * sz);
          if (slope >= SLOPE_NONE) continue;

          const e = heightAt(u, v);
          if (e <= seaLevel) continue;

          // El límite del arbolado. Con temperaturas es el que usa el atlas;
          // sin ellas, un techo de altura — que es peor, y por eso el contrato
          // las pide.
          let cold: number;
          if (tempA) {
            cold = smoothstep(TREELINE_C, TREELINE_BARE_C, tempA[ci]);
          } else {
            cold = smoothstep(TREELINE_KM, TREELINE_BARE_KM, e);
          }
          if (cold >= 1) continue;

          // Cuánto se queda en pie después de la pendiente y del frío. Se
          // aplica como PROBABILIDAD y no como escala: un bosque que se
          // adelgaza hacia la cumbre es lo que hay arriba; un bosque de árboles
          // enanos, no.
          const keep = (1 - smoothstep(SLOPE_FULL, SLOPE_NONE, slope)) * (1 - cold);
          if (((h2 >>> 16) & 0x3ff) / 1024 >= keep) continue;

          place(u, v, e, globe, p);

          const h3 = ihash(aw, b, salt ^ 0xc2b2ae35);
          const pick = (h3 & 0xffff) / 65536;
          let kind = KIND_COUNT - 1;
          for (let k = 0; k < KIND_COUNT; k++) {
            if (pick < pl.cum[k]) { kind = k; break; }
          }
          // Una planta que se sale del bioma no vale: si el bioma no le da peso
          // a ninguna especie, el bucle deja la última y saldría un pedregal.
          if (pl.cum[KIND_COUNT - 1] <= 0) continue;

          const j = sown;
          iPos[j * 3] = p.x; iPos[j * 3 + 1] = p.y; iPos[j * 3 + 2] = p.z;
          iParam[j * 4] = kind;
          iParam[j * 4 + 1] = lv;
          // Tamaño: entre 0,72 y 1,42 del base, por la forma de la especie. La
          // variación es lo que impide que un grupo se lea como una plantación.
          iParam[j * 4 + 2] = KIND_SQUASH[kind] * (0.72 + ((h3 >>> 16) & 0x3ff) / 1024 * 0.70);
          iParam[j * 4 + 3] = ((h3 >>> 26) & 0x3f) / 64;

          // Un 16 % de variación de valor por planta. Sin ella, cien copas del
          // mismo verde exacto se leen como una superficie y no como cien copas.
          const shade = 0.84 + ((h1 >>> 8) & 0xff) / 255 * 0.32;
          // Y las de arriba palidecen un poco, como palidece el terreno con la
          // altura en el atlas (ver la corrección hipsométrica de render.ts).
          const pale = Math.min(0.34, Math.max(0, e - 1.2) * 0.09);
          const ti = (biomeA[ci] * KIND_COUNT + kind) * 3;
          iTint[j * 3] = TINTS[ti] * shade + pale * 0.32;
          iTint[j * 3 + 1] = TINTS[ti + 1] * shade + pale * 0.31;
          iTint[j * 3 + 2] = TINTS[ti + 2] * shade + pale * 0.29;

          kindMask |= 1 << kind;
          sown++;
          if (sown >= maxInstances) { b = b1 + 1; d = LEVELS_OUT + 1; break; }
        }
      }
    }
    aPos.clearUpdateRanges(); aPos.addUpdateRange(0, sown * 3); aPos.needsUpdate = true;
    aParam.clearUpdateRanges(); aParam.addUpdateRange(0, sown * 4); aParam.needsUpdate = true;
    aTint.clearUpdateRanges(); aTint.addUpdateRange(0, sown * 3); aTint.needsUpdate = true;
    geometry.instanceCount = sown;

    sownKinds = 0;
    for (let k = 0; k < KIND_COUNT; k++) if (kindMask & (1 << k)) sownKinds++;
    sowMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  return {
    group,

    setWorld(w) {
      elevation = w.elevation;
      biomeArr = w.biome;
      temperature = w.temperature ?? null;
      externalHeight = w.heightAt ?? null;
      W = Math.max(1, w.width);
      H = Math.max(1, w.height);
      yMul = w.yMul;
      seaLevel = w.seaLevel;
      // Sólo marca: la siembra la hace el siguiente `update`. Una ráfaga de
      // pinceladas en el mismo fotograma cuesta una siembra y no treinta.
      worldDirty = true;
    },

    update(u) {
      const globe = u.shape === 'globe';
      uniforms.uShape.value = globe ? 1 : 0;
      uniforms.uTime.value = u.time;

      if (!elevation || !biomeArr) {
        mesh.visible = false;
        geometry.instanceCount = 0;
        sown = 0;
        sowMs = 0;
        sownKinds = 0;
        return;
      }

      const camera = u.camera;
      camera.updateMatrixWorld();

      // ---- el encuadre ------------------------------------------------------
      const dist = Math.max(1e-4, findAnchor(camera, globe));
      const halfFov = Math.tan((camera.fov * Math.PI) / 360);
      const frameUnits = 2 * dist * halfFov * Math.max(0.5, camera.aspect || 1);
      // El que llegue por contrato acota, no manda: `spanKm` sale de la ventana
      // de la malla y vale el mundo entero con la cámara baja (ver findAnchor).
      const frameKm = Math.min(frameUnits * kmPerUnit, Math.max(1, u.spanKm));

      // Al cuadrado: ver FRAME_OFF_KM. La rampa recta deja las plantas cuatro
      // píxeles durante media década de encuadre, y cuatro píxeles oscuros son
      // grano, no bosque.
      const shrink = 1 - smoothstep(FRAME_FULL_KM, FRAME_OFF_KM, frameKm);
      const global = shrink * shrink;
      uniforms.uGlobal.value = global;
      if (global <= 0.03) {
        // CERO INSTANCIAS a vista de planeta, no instancias de tamaño cero: la
        // llamada de dibujo entera desaparece y el HUD dice la verdad.
        //
        // El corte está en el 3 % y no en cero porque al 3 % la planta más
        // grande del encuadre mide medio píxel: no hay salto que ver, y en
        // cambio hay unos miles de instancias que dibujar para nada.
        mesh.visible = false;
        geometry.instanceCount = 0;
        sown = 0;
        // Y EL HUD TIENE QUE DECIR CERO, no lo que costó la última siembra. Sin
        // esto, `stats()` seguía devolviendo los milisegundos y las especies de
        // la pose anterior mientras la vegetación estaba apagada: el banco
        // apuntaba treinta milisegundos de siembra en una vista de mapa que no
        // siembra nada, y eso es exactamente la clase de número que luego se
        // persigue durante media tarde.
        sowMs = 0;
        sownKinds = 0;
        lastLevel = -999;
        return;
      }
      mesh.visible = true;

      // El paso de la rejilla fina que da SITES_ACROSS plantas de ancho, y su
      // nivel. El nivel se redondea hacia abajo; la fracción vive en `uLod` y
      // gobierna el tamaño, que sí es continuo.
      const cellUnits = Math.max(1e-6, frameUnits / SITES_ACROSS);
      const lod = Math.min(21, Math.max(2, Math.log2(o.sizeX / cellUnits)));
      const level = Math.floor(lod);
      uniforms.uLod.value = lod;
      /**
       * FÍSICA PRIMERO, TOPE DESPUÉS.
       *
       * `PLANT_M` metros pasados por el mismo `yMul` que el relieve; el tope
       * contra el encuadre sólo muerde con exageraciones altas o encuadres muy
       * cerrados. `PLANT_H · cellUnits` se conserva como SUELO: por debajo de
       * él las copas dejan de tocarse y la masa se rompe en pimienta, que es
       * peor que no dibujar nada — y para eso ya está el desvanecido, que a
       * esas alturas ya ha apagado la capa entera.
       */
      const fisica = (PLANT_M / 1000) * yMul;
      const tope = frameUnits * PLANT_MAX_FRAME;
      /**
       * EL SUELO NO PUEDE IR ATADO AL ESPACIADO.
       *
       * Estaba escrito como `PLANT_H · cellUnits · 0,28`, y `cellUnits` es
       * `frameUnits / SITES_ACROSS`. Al subir la densidad para recuperar la
       * masa del bosque, el suelo encogió con ella y las plantas salieron MÁS
       * pequeñas: medido, la pantalla con planta bajó del 5,2 % al 1,5 % — lo
       * contrario de lo que el cambio pretendía. Dos cosas distintas atadas al
       * mismo número.
       *
       * El suelo es contra el ENCUADRE, que es lo que decide si algo se ve: por
       * debajo de esta fracción una planta es medio píxel y para eso ya está el
       * desvanecido, que a esas alturas ya ha apagado la capa.
       */
      // 0,0103 es EXACTAMENTE el suelo que había — `PLANT_H · (frameUnits/42) ·
      // 0,28` — sólo que escrito contra el encuadre y no contra el espaciado,
      // que es lo que lo hacía moverse cuando no debía. Puesto a 0,0016 la
      // pantalla con planta se fue al 0,2 %: el bosque desapareció.
      const suelo = frameUnits * 0.0103;
      uniforms.uSize.value = Math.max(suelo, Math.min(tope, fisica));
      uniforms.uReach.value = REACH_CELLS * o.sizeX;
      // El mismo tope de horizonte que aplica la siembra. `camAbove` lo acaba
      // de dejar `findAnchor`, unas líneas más arriba.
      uniforms.uReachMax.value = globe
        ? Math.sqrt(2 * o.radius * camAbove) * 1.25
        : 1e9;
      (uniforms.uAnchor.value as THREE.Vector3).copy(anchor);
      // El viento, en fracción de la altura de la planta. Poco: una vegetación
      // que ondea de verdad, a veinte píxeles, se lee como que tiembla la
      // imagen.
      uniforms.uWind.value = 0.055;

      // ---- ¿hay que volver a sembrar? --------------------------------------
      //
      // LA VENTANA SE CUANTIZA, y esto es un fallo medido y no una precaución.
      // `visibleWindow` es CONTINUA: u, v y size se mueven en el cuarto decimal
      // en cuanto la cámara gira un píxel. Comparándola tal cual, CUALQUIER
      // movimiento del mando volvía a sembrar EN CADA FOTOGRAMA — nueve
      // milisegundos de CPU encima de un fotograma que además dibuja el terreno,
      // y el renderer baja el pixelRatio en cuanto uno pasa de treinta.
      //
      // Se puede cuantizar porque la ventana aquí sólo hace UNA cosa: recortar
      // lo que cae fuera de la malla, que es una prueba de sí-o-no con margen de
      // sobra (la ventana ya viene con un 35 % de relleno). Un desfase de un
      // octavo de ventana no cambia qué plantas pasan; por eso el tamaño va a
      // octavos de octava y el centro a octavos de ventana, y por eso winHalf
      // vale 0,43 y no 0,48 — 0,43 + el medio octavo de desfase peor posible
      // sigue quedando dentro de la malla. El ancla, que sí manda sobre dónde
      // están las plantas, no se cuantiza: tiene su propio umbral en RESEED_MOVE.
      const winFull = u.window.size >= 0.999;
      const wq = winFull ? 1 : Math.pow(2, Math.round(Math.log2(u.window.size) * 8) / 8);
      const wu = winFull ? 0 : Math.round(u.window.u / (wq * 0.125));
      const wv = winFull ? 0 : Math.round(u.window.v / (wq * 0.125));
      const moved = lastAnchor.distanceTo(anchor);
      const reachFine = REACH_CELLS * o.sizeX * Math.pow(2, -level);
      if (worldDirty || level !== lastLevel || u.shape !== lastShape
        || wq !== lastWinS || wu !== lastWinU || wv !== lastWinV
        || moved > RESEED_MOVE * reachFine) {
        sow(camera, globe, level, u.window);
        worldDirty = false;
        lastLevel = level;
        lastShape = u.shape;
        lastWinS = wq; lastWinU = wu; lastWinV = wv;
        lastAnchor.copy(anchor);
      }

      // ---- la luz ----------------------------------------------------------
      const sun = u.sun.lengthSq() < 1e-12 ? fwd.set(0, 1, 0) : fwd.copy(u.sun).normalize();
      (uniforms.uSun.value as THREE.Vector3).copy(sun);
      (uniforms.uSunCol.value as THREE.Color).copy(u.sun3.color);
      uniforms.uSunPower.value = u.sun3.intensity;
      // EL RELLENO SE NORMALIZA AQUÍ, con la misma cuenta que
      // `SculptSurface.setSunLight`: a luminancia 1 y luego un 35 % hacia el
      // gris. Sin ella la vegetación saldría un 40 % más oscura y más azul que
      // el suelo del que sale, que es la forma más rápida de que parezca
      // pegada encima.
      const amb = u.sun3.ambient;
      const lum = 0.2126 * amb.r + 0.7152 * amb.g + 0.0722 * amb.b;
      const k = 1 / Math.max(1e-3, lum);
      (uniforms.uAmbient.value as THREE.Color).setRGB(
        1 + (amb.r * k - 1) * 0.35,
        1 + (amb.g * k - 1) * 0.35,
        1 + (amb.b * k - 1) * 0.35,
      );

      // ---- la lejanía ------------------------------------------------------
      (uniforms.uHorizon.value as THREE.Color).copy(u.horizon);
      if (u.horizonWarm) {
        (uniforms.uFogWarm.value as THREE.Color).copy(u.horizonWarm);
      } else {
        // Sin el horizonte cálido se deriva uno: el del lado del sol es el
        // mismo horizonte tirando hacia el color de la luz. Funciona, y deja
        // una diferencia medible contra la niebla del terreno al atardecer —
        // por eso el campo existe.
        (uniforms.uFogWarm.value as THREE.Color).setRGB(
          u.horizon.r + (u.sun3.color.r - u.horizon.r) * 0.30,
          u.horizon.g + (u.sun3.color.g - u.horizon.g) * 0.30,
          u.horizon.b + (u.sun3.color.b - u.horizon.b) * 0.30,
        );
      }
      // LA MISMA CUENTA QUE EL AGUA Y QUE LA NIEBLA DEL TERRENO, copiada a mano
      // porque ninguno de los dos la expone: escala con la ALTURA sobre el mar,
      // con suelo en el 6 % del mundo y techo en ocho mundos. Si estos tres
      // números se separan, un bosque en la costa lejana funde a un color y la
      // ladera que tiene detrás a otro, y se ve la costura.
      const camH = Math.max(0.05, Math.abs(camera.position.y - seaLevel * yMul));
      uniforms.uFogDist.value = Math.min(6 * Math.max(camH, o.sizeX * 0.06), o.sizeX * 8);
      // En el globo la niebla llega apagada, igual que en el terreno: allí no
      // hay horizonte al que fundir, lo que rodea al planeta es espacio.
      uniforms.uFogOn.value = globe ? 0 : 1;
    },

    stats() {
      return { instances: mesh.visible ? sown : 0, kinds: sownKinds, ms: sowMs };
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
