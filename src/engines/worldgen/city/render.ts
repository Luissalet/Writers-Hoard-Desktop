// ============================================
// City Generator — Plan rendering
// ============================================
// Draws a CityPlan in the same ink-on-parchment language as the world map, so
// zooming from the atlas into a town is a change of scale rather than a change
// of medium.
//
// Draw order is the order a draughtsman would work in: ground, water, fields,
// blocks, buildings, streets, walls, labels. Roads are laid as a pale ribbon
// with a thin casing rather than a single stroke — that is what makes a street
// read as negative space between buildings instead of a line on top of them.
//
// UN SOLO DIBUJANTE, CON NIVELES DE DETALLE.
//
// Había DOS renderizadores del mismo plano: esta lámina y el pueblo que
// `region/townPlan.ts` pinta sobre el tile satélite. No compartían ni una
// línea — dos paletas, dos órdenes de dibujo y dos ideas distintas de qué es
// una calle — así que mejorar uno no mejoraba el otro y, al pasar del mapa a
// la ficha, el pueblo CAMBIABA DE IDIOMA: en el mapa era un mosaico de manchas
// pardas y en el modal una lámina de tinta sobre pergamino. Peor aún, el mapa
// no dibujaba `courts`, de modo que a esa escala la plaza del mercado, el
// claustro y las cuñas del parque simplemente no existían.
//
// Ahora hay un solo cuerpo de dibujo — `drawCityBody` — con una sola paleta
// (`cityInk`) y un solo orden. El mapa llama al MISMO dibujo con un `lod` más
// bajo: menos detalle del mismo cuadro, no otro cuadro.

import { createRng } from '../core/rng';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import { area, centroid, circle, clipHalfPlane, dist, rect, type Poly, type V } from './geometry';
import {
  MAIN_STREET, WARD_LABEL,
  type Building, type BuildingKind, type CityPlan, type Fortification, type Square,
  type SquareKind, type WardType,
} from './generate';

export interface CityRenderOptions {
  theme: CartoTheme;
  width: number;
  height: number;
  /** Extra margin around the plan, as a fraction of its radius. */
  margin?: number;
  showLabels?: boolean;
  showWardTints?: boolean;
  title?: string;
  /**
   * Cómo se llama cada tipo de barrio, en el idioma del lector.
   *
   * El motor no tiene acceso a `useTranslation` — es código puro y corre
   * también en los bancos y en el worker — así que el idioma entra por aquí.
   * Sin esto, `WARD_LABEL` imprimía español a fuego en un renderizador que la
   * ventana que lo rodea ya tenía traducida.
   */
  labelFor?: (ward: WardType) => string;
  /**
   * Cómo se llama una plaza que no trae nombre propio.
   *
   * Misma razón que `labelFor`: una plaza del generador puede venir con
   * `name` acuñado en la lengua del mundo, y entonces se usa ése; si viene
   * desnuda, el único texto posible sería una cadena a fuego, así que sin esta
   * función NO se rotula. Un plano sin rótulo se lee; un plano con el idioma
   * equivocado, no.
   */
  labelForSquare?: (kind: SquareKind) => string;
  /** La línea bajo el título. Misma razón que `labelFor`. */
  subtitle?: string;
}

// ---------------------------------------------------------------------------
// La paleta, una sola
// ---------------------------------------------------------------------------

/** Las dos aguas de un tejado y su perfil. */
export interface RoofInk { lit: string; shade: string; ink: string }

export interface CityInk {
  /** El suelo del pueblo: lo que hay debajo de todo lo demás. */
  ground: string;
  /** Empedrado: calzada, muelle y plaza. */
  paving: string;
  pavingEdge: string;
  ink: string;
  /** Fábrica de muralla: cara, núcleo y perfil. */
  stone: string;
  stoneShade: string;
  stoneInk: string;
  park: string;
  parkInk: string;
  /** El huerto del corral trasero. */
  garden: string;
  /** El surco del bancal. */
  field: string;
  water: string;
  waterDeep: string;
  waterInk: string;
  shadow: string;
  /** Lavado por barrio, muy claro: las huellas tienen que seguir mandando. */
  ward: Partial<Record<WardType, string>>;
  wardAlpha: number;
  /**
   * Cuatro variantes tonales por tipo de edificio.
   *
   * Un solo pardo convertía cada manzana en una masa de barro — que es
   * exactamente lo que parece un pueblo denso si todos los tejados son del
   * mismo color. La variante se elige con la posición del edificio, así que no
   * cambia entre tiles ni entre niveles.
   */
  roofs: Record<BuildingKind, RoofInk[]>;
}

/** Mezcla hacia blanco (k>0) o hacia negro (k<0). */
function tone(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = k > 0 ? 255 : 0;
  const a = Math.abs(k);
  const r = Math.round(((n >> 16) & 255) + (t - ((n >> 16) & 255)) * a);
  const g = Math.round(((n >> 8) & 255) + (t - ((n >> 8) & 255)) * a);
  const b = Math.round((n & 255) + (t - (n & 255)) * a);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * El tono base de cada tipo de tejado.
 *
 * No es decoración: es la única forma de que una iglesia, un torreón, un
 * almacén y una casa no sean el mismo rectángulo del mismo color. Teja cocida
 * para lo doméstico, plomo azulado para lo sagrado, sillería pálida para lo
 * militar, paja para el campo, tabla parda para el comercio.
 */
const ROOF_BASE: Record<BuildingKind, string> = {
  house: '#c09272',
  shed: '#b8a488',
  hall: '#c59a72',
  inn: '#c8a077',
  guild: '#bd9370',
  forge: '#9b9086',
  mill: '#c8b492',
  warehouse: '#ab957a',
  church: '#a1abb3',
  chapel: '#abb2b7',
  keep: '#c1b8a8',
  tower: '#c7bfaf',
  barracks: '#b2a693',
  farm: '#c9b795',
};

/**
 * Cuánto se aparta cada variante del tono base, y cuánto la vertiente en
 * sombra de la iluminada.
 *
 * Medido sobre `city-villa-1`, 1934 edificios: con ±0,19 de contraste entre
 * aguas la manzana salía en zigzag — a cinco píxeles por casa las dos
 * vertientes se leen antes que la casa — y con la teja a plena saturación las
 * mil novecientas huellas se fundían en una mancha de barro cocido que se
 * comía la calle, la plaza y el papel. Un tercio de eso es todo lo que hace
 * falta para que el caballete se vea.
 */
const ROOF_JITTER = [-0.07, -0.02, 0.035, 0.09];
const ROOF_PITCH = -0.115;

function buildRoofs(): Record<BuildingKind, RoofInk[]> {
  const out = {} as Record<BuildingKind, RoofInk[]>;
  for (const k of Object.keys(ROOF_BASE) as BuildingKind[]) {
    out[k] = ROOF_JITTER.map((j) => {
      const lit = tone(ROOF_BASE[k], j);
      return { lit, shade: tone(lit, ROOF_PITCH), ink: tone(lit, -0.58) };
    });
  }
  return out;
}

const ROOFS = buildRoofs();

/** Per-ward wash, kept very light — the footprints must stay the main event. */
const WARD_TINT: Partial<Record<WardType, string>> = {
  market: '#d8c79b',
  cathedral: '#c9b7d2',
  castle: '#cbb9a0',
  park: '#a9c08d',
  military: '#c4b0a2',
  slum: '#c8bda3',
  patriciate: '#d5c8a4',
  merchant: '#d9cba6',
  administration: '#cfc6ab',
  farm: '#cdc79a',
};

/** La paleta canónica del pueblo, sin tema: la que usa el mapa. */
export const CITY_INK: CityInk = {
  ground: '#efe0bd',
  paving: '#dccaa3',
  pavingEdge: '#b39a68',
  ink: '#3a2c1b',
  stone: '#cfc2a6',
  stoneShade: '#a1937a',
  stoneInk: '#463726',
  park: '#8fa66a',
  parkInk: '#4f6a44',
  garden: '#93a86e',
  field: '#b39a68',
  water: '#7fa8bd',
  waterDeep: '#5c88a3',
  waterInk: '#40566a',
  shadow: 'rgba(58,44,27,0.20)',
  ward: WARD_TINT,
  wardAlpha: 0.5,
  roofs: ROOFS,
};

const INK_BY_THEME = new WeakMap<CartoTheme, CityInk>();

/** Mezcla lineal de dos colores hex, t = 0 → a, t = 1 → b. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh: number) => {
    const va = (pa >> sh) & 255, vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

/** Luminancia 0..1 de un hex. */
function lumOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * Un color llevado a la familia sepia del tema, CONSERVANDO su valor.
 *
 * La rampa va de la tinta del tema (oscuro) al papel (claro); el color de
 * entrada aporta su luminancia — así una iglesia de plomo sigue siendo más
 * fría y clara que una teja doméstica — y un 28 % del matiz original
 * sobrevive, que es el aspecto de un grabado coloreado a mano: se ADIVINA la
 * teja, pero el pliego manda. El techo en 0,82 evita que los tejados claros
 * se fundan con el propio papel del suelo.
 */
function sepiaOf(theme: CartoTheme, hex: string): string {
  const t = Math.min(0.82, Math.max(0.12, (lumOf(hex) - 0.16) / 0.62));
  const ramp = mixHex(theme.settlement.ink, theme.paper.base, t);
  return mixHex(ramp, hex, 0.28);
}

/**
 * La paleta del pueblo, opcionalmente teñida por el tema de la lámina.
 *
 * SIN tema, la canónica a todo color: es la que usan las teselas del
 * satélite, donde el suelo es fotográfico y una teja debe ser una teja.
 *
 * CON tema, TODO pasa por el tema — tejados y fábrica incluidos. La versión
 * anterior teñía sólo el soporte («una teja es una teja en cualquier lámina»)
 * y el resultado fue la lección #28: el plano salió de terracota sobre una
 * lámina que es tinta sobre pergamino, y bajar del atlas a un pueblo era un
 * cambio de medio. Luis eligió cohesión (2026-08-11): en el pergamino, el
 * pueblo es un grabado coloreado a mano de la MISMA plancha que la carta.
 */
export function cityInk(theme?: CartoTheme): CityInk {
  if (!theme) return CITY_INK;
  const hit = INK_BY_THEME.get(theme);
  if (hit) return hit;

  // Los tejados, por la misma fábrica que los canónicos (jitter y vertiente
  // idénticos) pero con las bases llevadas a la familia del tema.
  const roofs = {} as Record<BuildingKind, RoofInk[]>;
  for (const k of Object.keys(ROOF_BASE) as BuildingKind[]) {
    roofs[k] = ROOF_JITTER.map((j) => {
      const lit = tone(sepiaOf(theme, ROOF_BASE[k]), j);
      return { lit, shade: tone(lit, ROOF_PITCH), ink: tone(lit, -0.58) };
    });
  }
  const ward: Partial<Record<WardType, string>> = {};
  for (const [w, c] of Object.entries(WARD_TINT) as [WardType, string][]) {
    ward[w] = mixHex(sepiaOf(theme, c), theme.paper.grain, 0.35);
  }
  const inkRgb = parseInt(theme.settlement.ink.slice(1), 16);

  const v: CityInk = {
    ...CITY_INK,
    ground: theme.paper.base,
    paving: theme.paper.grain,
    pavingEdge: theme.dunes.color,
    ink: theme.settlement.ink,
    stone: sepiaOf(theme, CITY_INK.stone),
    stoneShade: sepiaOf(theme, CITY_INK.stoneShade),
    stoneInk: theme.settlement.ink,
    park: theme.forest.light,
    parkInk: theme.forest.ink,
    garden: sepiaOf(theme, CITY_INK.garden),
    field: theme.dunes.color,
    water: theme.ocean.shallow,
    waterDeep: theme.ocean.deep,
    waterInk: theme.coastline.color,
    // La sombra es la tinta del tema con el mismo peso que llevaba la parda.
    shadow: `rgba(${(inkRgb >> 16) & 255},${(inkRgb >> 8) & 255},${inkRgb & 255},0.20)`,
    ward,
    roofs,
  };
  INK_BY_THEME.set(theme, v);
  return v;
}

// ---------------------------------------------------------------------------
// Niveles de detalle
// ---------------------------------------------------------------------------

/**
 * 3 lámina, 2 pueblo sobre el mapa a media escala, 1 la mancha del pueblo,
 * 0 sólo su silueta.
 *
 * Los cortes están donde la marca deja de leerse, no donde queda bonito: por
 * debajo de 1,3 px por unidad una casa de 2×3 unidades mide 2,6×3,9 px y el
 * caballete cae dentro del propio grosor de la línea; por debajo de 0,42 la
 * manzana entera mide menos que la punta de un lápiz.
 */
export type CityLod = 0 | 1 | 2 | 3;

export function lodFor(pxPerUnit: number): CityLod {
  if (pxPerUnit >= 2.6) return 3;
  if (pxPerUnit >= 1.3) return 2;
  if (pxPerUnit >= 0.42) return 1;
  return 0;
}

export interface CityBodyOptions {
  ink: CityInk;
  /** Unidades de plano por píxel de pantalla — el inverso de la escala. */
  unit: number;
  lod: CityLod;
  /** Pintar suelo opaco bajo cada manzana. El mapa lo necesita porque debajo
   *  hay satélite; el papel del modal ya ES el suelo. */
  groundFill?: boolean;
  wardTints?: boolean;
  /** El rayado de bancales. El tile satélite ya trae sus propios setos. */
  fields?: boolean;
  /**
   * El agua del plano.
   *
   * Sobre el mapa hay que apagarla cuando el plano sólo trae la lectura
   * barata: `plan.coast` es un SEMIPLANO de radio·6 y a escala de tile eso es
   * medio kilómetro cuadrado de azul plano tapando el litoral de verdad que el
   * ráster ya dibujó. `plan.waters`, en cambio, es geometría acotada — la
   * dársena, el brazo del río — que el ráster a esa resolución no sabe
   * enseñar, y ésa sí vale la pena.
   */
  water?: boolean;
  /** Los caminos que salen de las puertas. El mapa ya tiene red viaria. */
  roads?: boolean;
  /** Perfilar la manzana con el color de la calle: a escala de mapa la red
   *  viaria se lee del borde de la manzana, no del eje de la calle. */
  blockEdges?: boolean;
}

function tracePoly(ctx: Ctx, p: Poly): void {
  if (p.length < 3) return;
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
}

function traceLine(ctx: Ctx, p: V[], close = false): void {
  if (p.length < 2) return;
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  if (close) ctx.closePath();
}

/** Caja envolvente holgada: el «todo» de un recorte por regla par-impar. */
function looseBox(poly: V[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const m = Math.max(x1 - x0, y1 - y0);
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** Hash estable de una posición: la variante de tejado no puede cambiar entre
 *  tiles ni entre niveles, así que no puede salir de un rng de dibujo. */
function hashAt(x: number, y: number): number {
  let h = (Math.imul(Math.round(x * 8) | 0, 0x9e3779b1)
    ^ Math.imul(Math.round(y * 8) | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return h >>> 3;
}

// ---------------------------------------------------------------------------
// Adaptadores: la lectura rica cuando está, la barata cuando no
// ---------------------------------------------------------------------------

/**
 * La muralla como fábrica, venga de donde venga.
 *
 * `plan.fort` trae grosor, torres con forma, casa-puerta y foso. Mientras no
 * llegue —y en el mapa, donde la lectura barata basta— se arma una
 * `Fortification` equivalente a partir de `wall`/`towers`/`gates`. El
 * resultado es que hay UN dibujante de murallas y dos formas de alimentarlo,
 * en vez de dos dibujantes que se parecen.
 */
function fortFor(plan: CityPlan): Fortification | null {
  if (plan.fort) return plan.fort;
  const line = plan.wall;
  if (!line || line.length < 2) return null;
  const t = MAIN_STREET * 0.85;
  const c = plan.center;
  // Dirección de la muralla en un punto: la del vértice más cercano.
  const tangentAt = (p: V): V => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d = dist(line[i], p);
      if (d < bd) { bd = d; best = i; }
    }
    const a = line[(best - 1 + line.length) % line.length];
    const b = line[(best + 1) % line.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  return {
    line,
    closed: plan.wallClosed !== false,
    thickness: t,
    towers: plan.towers.map((at) => ({
      at, shape: circle(t * 1.05, 12, at), kind: 'round' as const,
    })),
    gates: plan.gates.map((at) => {
      const tg = tangentAt(at);
      const ang = Math.atan2(tg.y, tg.x);
      // Hacia fuera: la normal que se aleja del centro del pueblo.
      let n = { x: -tg.y, y: tg.x };
      if ((at.x - c.x) * n.x + (at.y - c.y) * n.y < 0) n = { x: -n.x, y: -n.y };
      return {
        at, anchor: at,
        shape: rect(t * 3.4, t * 2.1, at, ang),
        facing: Math.atan2(n.y, n.x),
        barbican: null,
      };
    }),
    moat: null,
  };
}

/**
 * Las plazas, o al menos la del mercado.
 *
 * Sin `plan.squares` el mercado salía como papel en blanco con un rótulo
 * flotando encima: el patio de la manzana `market` se pintaba del mismo tono
 * que el corral trasero de cualquier casa. Aquí se promueve ese patio a plaza
 * para que al menos tenga empedrado, borde y despiece. Sin monumento ni
 * soportales: eso es geometría que le toca inventar al generador, no al
 * dibujante.
 */
function squaresFor(plan: CityPlan): Square[] {
  if (plan.squares && plan.squares.length) return plan.squares;
  const out: Square[] = [];
  for (const q of plan.patches) {
    if (q.ward !== 'market' || !q.courts.length) continue;
    let best = q.courts[0], ba = area(best);
    for (const c of q.courts) { const a = area(c); if (a > ba) { ba = a; best = c; } }
    if (best.length >= 3) out.push({ kind: 'market', shape: best, monument: null, arcades: [] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// El agua
// ---------------------------------------------------------------------------

/**
 * EL MAR NO ES UNA RAYA DE REGLA.
 *
 * La costa se pintaba como semiplano infinito con un trazo recto de `radio·6`:
 * literalmente una regla cruzando la lámina de lado a lado. Un litoral tiene
 * entrantes, y sobre todo tiene BORDE — la línea gruesa y las líneas de
 * resaca que la acompañan son la mitad de lo que hace que el azul se lea como
 * agua y no como un rectángulo de color.
 *
 * Con `plan.waters` se dibuja el litoral de verdad. Sin él se ondula el
 * semiplano: misma información, misma familia de trazos, sin fingir una bahía
 * que la geometría no tiene.
 */
function drawWater(ctx: Ctx, plan: CityPlan, o: CityBodyOptions): void {
  const ink = o.ink;
  const px = (n: number) => n * o.unit;
  const rng = createRng(plan.seed, 'city-water');
  const w = plan.waters;

  const rings = (poly: V[], nrm: (i: number) => V, count: number) => {
    // Las líneas de resaca: paralelas al litoral, hacia dentro del agua y
    // desvaneciéndose. Es el «coastal effect» del mapa mundial, a esta escala.
    if (o.lod < 2) return;
    ctx.strokeStyle = ink.ground;
    const step = plan.radius * 0.035;
    for (let k = 1; k <= count; k++) {
      ctx.globalAlpha = 0.4 * Math.pow(0.62, k - 1);
      ctx.lineWidth = px(1.1);
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const n = nrm(i);
        const x = poly[i].x + n.x * step * k, y = poly[i].y + n.y * step * k;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const normalsOf = (poly: V[], sign: number) => (i: number): V => {
    const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: (-dy / l) * sign, y: (dx / l) * sign };
  };

  // ---- litoral -------------------------------------------------------------
  if (w && w.water.length) {
    for (const poly of w.water) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      tracePoly(ctx, poly);
      ctx.fillStyle = ink.water;
      ctx.fill();
    }
    if (w.shore.length >= 2) {
      // La sonda, recortada contra el agua: un trazo ancho y pálido siguiendo
      // el litoral. Fuera del agua lo corta el recorte, así que la banda de
      // bajío sale con la forma exacta de la costa sin calcular un solo
      // desfase de polígono. Sin ella el mar es un azul plano y no se sabe
      // dónde rompe.
      if (o.lod >= 1) {
        ctx.save();
        ctx.beginPath();
        for (const poly of w.water) tracePoly(ctx, poly);
        ctx.clip();
        ctx.strokeStyle = ink.ground;
        ctx.globalAlpha = 0.15;
        ctx.lineWidth = plan.radius * 0.5;
        ctx.beginPath();
        traceLine(ctx, w.shore);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      // La normal que apunta al agua: la que se aleja del centro del pueblo.
      const mid = w.shore[Math.floor(w.shore.length / 2)];
      const probe = normalsOf(w.shore, 1)(Math.floor(w.shore.length / 2));
      const sign = (mid.x - plan.center.x) * probe.x + (mid.y - plan.center.y) * probe.y > 0 ? 1 : -1;
      rings(w.shore, normalsOf(w.shore, sign), 3);
      ctx.strokeStyle = ink.waterInk;
      ctx.lineWidth = px(1.5);
      ctx.beginPath();
      traceLine(ctx, w.shore);
      ctx.stroke();
    }
  } else if (plan.coast) {
    const { p, n } = plan.coast;
    const far = plan.radius * 6;
    const t = { x: -n.y, y: n.x };
    // Ondula de un borde de la lámina al otro, no sólo por el centro: con la
    // ondulación acotada a dos radios y medio, las líneas de resaca se cortaban
    // a media hoja y el mar quedaba partido en dos mitades distintas.
    // Dos armónicos: uno de ~2,4 radios de onda para la forma de la costa y
    // otro corto para que la orilla no salga peinada.
    const N = 120;
    const shore: V[] = [];
    const amp = plan.radius * 0.09;
    const ph = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2, ph3 = rng() * Math.PI * 2;
    for (let i = 0; i <= N; i++) {
      const s = -1 + (2 * i) / N;
      const k = Math.sin(s * 4.3 + ph3) * 0.46
        + Math.sin(s * 31 + ph) * 0.32 + Math.sin(s * 13.7 + ph2) * 0.22;
      shore.push({
        x: p.x + t.x * s * far + n.x * k * amp,
        y: p.y + t.y * s * far + n.y * k * amp,
      });
    }
    const skirt = (poly: V[], off: number) => {
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i].x + n.x * off, y = poly[i].y + n.y * off;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(shore[N].x + n.x * far, shore[N].y + n.y * far);
      ctx.lineTo(shore[0].x + n.x * far, shore[0].y + n.y * far);
      ctx.closePath();
    };
    skirt(shore, 0);
    ctx.fillStyle = ink.water;
    ctx.fill();
    // Las sondas: dos bandas hacia mar abierto. Con una sola, el salto de tono
    // era otra recta cruzando la lámina — el mismo defecto que la orilla — y
    // con dos a la mitad de alfa se lee como profundidad y no como borde.
    if (o.lod >= 1) {
      ctx.fillStyle = ink.waterDeep;
      ctx.globalAlpha = 0.18;
      for (const d of [0.55, 1.2]) { skirt(shore, plan.radius * d); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    rings(shore, () => n, 3);
    ctx.strokeStyle = ink.waterInk;
    ctx.lineWidth = px(1.5);
    ctx.beginPath();
    traceLine(ctx, shore);
    ctx.stroke();
  }

  // ---- río -----------------------------------------------------------------
  /**
   * UN RÍO TIENE ORILLAS Y NO TIENE UN ANCHO SOLO.
   *
   * Era un trazo de `radio·0,09` de punta a punta: un tubo azul de anchura
   * constante, sin margen y sin crecida. Un río crece aguas abajo y se ensancha
   * en las curvas; dibujarlo como polígono entre dos orillas cuesta lo mismo y
   * además permite perfilar la orilla, que es lo que lo separa de una avenida
   * pintada de azul.
   */
  const line = w?.river?.line ?? plan.river;
  if (line && line.length >= 2) {
    const base = w?.river ? w.river.width : plan.radius * 0.085;
    const left: V[] = [], right: V[] = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const t = line.length > 1 ? i / (line.length - 1) : 0;
      // Crecida aguas abajo (0,62 → 1,25) más una respiración lenta: el ancho
      // deja de ser un número y pasa a ser un perfil.
      const half = base * 0.5 * (0.62 + 0.63 * t) * (1 + 0.16 * Math.sin(t * 7.3 + 1.1));
      left.push({ x: line[i].x + nx * half, y: line[i].y + ny * half });
      right.push({ x: line[i].x - nx * half, y: line[i].y - ny * half });
    }
    ctx.beginPath();
    traceLine(ctx, left);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = ink.water;
    ctx.fill();
    if (o.lod >= 1) {
      ctx.strokeStyle = ink.waterInk;
      ctx.lineWidth = px(1.1);
      ctx.beginPath();
      traceLine(ctx, left);
      ctx.stroke();
      ctx.beginPath();
      traceLine(ctx, right);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Las plazas
// ---------------------------------------------------------------------------

/**
 * LA PLAZA, DIBUJADA COMO PLAZA.
 *
 * Empedrado, borde, despiece radial, monumento y soportales. El despiece es lo
 * que la separa del papel: un polígono relleno de un tono cálido a esta escala
 * es indistinguible de una manzana sin construir, y por eso el mercado se leía
 * como un agujero en la lámina.
 */
function drawSquare(ctx: Ctx, sq: Square, o: CityBodyOptions): void {
  const ink = o.ink;
  const px = (n: number) => n * o.unit;
  if (sq.shape.length < 3) return;
  const c = centroid(sq.shape);

  ctx.beginPath();
  tracePoly(ctx, sq.shape);
  ctx.fillStyle = ink.paving;
  ctx.fill();
  ctx.strokeStyle = ink.pavingEdge;
  ctx.lineWidth = px(1.0);
  ctx.stroke();

  if (o.lod >= 3) {
    // Despiece en abanico desde el centro, recortado contra la plaza. Es como
    // se empedraba y como se dibuja: la junta señala al pozo.
    let r = 0;
    for (const v of sq.shape) r = Math.max(r, dist(v, c));
    ctx.save();
    ctx.beginPath();
    tracePoly(ctx, sq.shape);
    ctx.clip();
    ctx.strokeStyle = ink.pavingEdge;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = px(0.6);
    const n = 18;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * SOPORTALES: UNA CRUJÍA CUBIERTA, NO UNA LÍNEA DE PUNTOS.
   *
   * El primer intento fue un trazo de tinta y una fila de círculos sobre el
   * lado marcado. En la lámina eso salía como una línea de puntos negra
   * cruzando el empedrado — parecía una valla, o un error. Un soportal en
   * planta son tres cosas: la losa en sombra bajo el vuelo, la línea de
   * fachada al fondo y los pilares al filo. Con las tres se lee de un vistazo,
   * y con dos no.
   */
  if (sq.arcades.length && o.lod >= 2) {
    for (const [a, b] of sq.arcades) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1.5) continue;
      let nx = -dy / l, ny = dx / l;
      // Hacia dentro de la plaza.
      if ((c.x - a.x) * nx + (c.y - a.y) * ny < 0) { nx = -nx; ny = -ny; }
      // Fondo de crujía: una vara y media, y nunca más de un cuarto del lado,
      // o en una plazuela el soportal se come la plaza entera.
      const d = Math.min(1.5, l * 0.25);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + nx * d, b.y + ny * d);
      ctx.lineTo(a.x + nx * d, a.y + ny * d);
      ctx.closePath();
      ctx.fillStyle = ink.stoneShade;
      ctx.globalAlpha = 0.46;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ink.stoneInk;
      ctx.lineWidth = px(0.6);
      ctx.beginPath();
      ctx.moveTo(a.x + nx * d, a.y + ny * d);
      ctx.lineTo(b.x + nx * d, b.y + ny * d);
      ctx.stroke();
      if (o.lod >= 3) {
        // Un pilar cada dos varas, y nunca más juntos que su propio grueso.
        // A tinta plena la fila de pilares pesaba tanto como el perfil de los
        // tejados y la plaza salía con un collar de cuentas negras encima.
        const w = Math.max(0.4, o.unit * 1.2);
        const step = Math.max(1.9, w * 2.6);
        const k = Math.max(1, Math.round(l / step));
        const ang = Math.atan2(dy, dx);
        ctx.fillStyle = ink.stoneInk;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        for (let i = 0; i <= k; i++) {
          const t = i / k;
          tracePoly(ctx, rect(w, w, {
            x: a.x + dx * t + nx * d, y: a.y + dy * t + ny * d,
          }, ang));
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  if (sq.monument && sq.monument.length >= 3) {
    ctx.beginPath();
    tracePoly(ctx, sq.monument);
    ctx.fillStyle = ink.stone;
    ctx.fill();
    ctx.strokeStyle = ink.stoneInk;
    ctx.lineWidth = px(1.0);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Los tejados
// ---------------------------------------------------------------------------

/**
 * UN TEJADO, NO UNA HUELLA.
 *
 * Cada edificio era un relleno plano con 0,65 px de perfil. Eso es una PLANTA:
 * dice dónde apoya el edificio y nada más. Lo que hace que el plano de Watabou
 * se lea como un pueblo y no como un catastro es el caballete: una línea por
 * el lomo del tejado y las dos aguas en tonos distintos.
 *
 * `facing` es la dirección de la calle a la que da la casa. De ahí salen las
 * dos orientaciones reales de un tejado urbano:
 *   - parcela ancha  → alero a la calle, caballete PARALELO a la fachada.
 *   - parcela burguesa, estrecha y profunda → hastial a la calle, caballete
 *     PERPENDICULAR.
 * La regla es la proporción de la huella medida en el marco de la fachada, y
 * es lo que da a una hilera de parcelas medievales su peine de hastiales.
 */
function drawRoof(ctx: Ctx, b: Building, o: CityBodyOptions): void {
  const poly = b.shape;
  if (poly.length < 3) return;
  const ink = o.ink;
  const px = (n: number) => n * o.unit;
  const c = centroid(poly);
  const variants = ink.roofs[b.kind] ?? ink.roofs.house;
  const r = variants[hashAt(poly[0].x, poly[0].y) % variants.length];

  const u = { x: Math.cos(b.facing), y: Math.sin(b.facing) };
  const v = { x: -u.y, y: u.x };
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of poly) {
    const du = (p.x - c.x) * u.x + (p.y - c.y) * u.y;
    const dv = (p.x - c.x) * v.x + (p.y - c.y) * v.y;
    if (du < u0) u0 = du; if (du > u1) u1 = du;
    if (dv < v0) v0 = dv; if (dv > v1) v1 = dv;
  }
  const eu = u1 - u0, ev = v1 - v0;
  const deep = ev > eu * 1.15;
  const along = deep ? v : u;
  const across = deep ? u : v;
  const a0 = deep ? v0 : u0, a1 = deep ? v1 : u1;
  const c0 = deep ? u0 : v0, c1 = deep ? u1 : v1;
  const width = c1 - c0;               // luz entre aleros
  const smallest = Math.min(eu, ev) / o.unit;   // en píxeles

  // Por debajo de tres píxeles de luz el caballete cae dentro del grosor del
  // propio perfil: dos aguas serían dos manchas de un píxel y medio.
  const pitched = o.lod >= 3 && smallest >= 3;

  // Los extremos EXACTOS del caballete, cuando hay dos aguas: el corte por
  // semiplano ya inserta los dos puntos donde la línea entra y sale de la
  // huella, así que salen gratis. Es lo que permite trazar el lomo sin
  // recortar contra el edificio — y un `clip()` por edificio, a dos mil
  // edificios por tile, costaba más que todo el resto del tejado junto:
  // medido en `sat-compare` z17, la fila subía de 7,6 s a 11,9 s con recorte y
  // vuelve a 8,0 s sin él, con el mismo dibujo.
  let e0: V | null = null, e1: V | null = null;
  if (pitched) {
    const n = { x: -along.y, y: along.x };
    const A = clipHalfPlane(poly, c, n);
    const B = clipHalfPlane(poly, c, { x: -n.x, y: -n.y });
    // Luz desde arriba a la izquierda, la misma que la sombra proyectada.
    const aLit = n.x + n.y > 0;
    if (A.length >= 3) {
      ctx.beginPath(); tracePoly(ctx, A);
      ctx.fillStyle = aLit ? r.lit : r.shade; ctx.fill();
      let t0 = Infinity, t1 = -Infinity;
      for (const p of A) {
        if (Math.abs((p.x - c.x) * n.x + (p.y - c.y) * n.y) > 1e-6) continue;
        const t = (p.x - c.x) * along.x + (p.y - c.y) * along.y;
        if (t < t0) { t0 = t; e0 = p; }
        if (t > t1) { t1 = t; e1 = p; }
      }
    }
    if (B.length >= 3) {
      ctx.beginPath(); tracePoly(ctx, B);
      ctx.fillStyle = aLit ? r.shade : r.lit; ctx.fill();
    }
  } else {
    ctx.beginPath(); tracePoly(ctx, poly);
    ctx.fillStyle = r.lit; ctx.fill();
  }

  // Lo monumental se perfila más grueso. Una catedral y una casa dibujadas con
  // el mismo pelo de línea pesan lo mismo en la lámina, y entonces la jerarquía
  // del pueblo sólo la lleva el color.
  const mono = b.kind === 'church' || b.kind === 'chapel' || b.kind === 'keep'
    || b.kind === 'tower' || b.kind === 'hall' || b.kind === 'warehouse'
    || b.kind === 'barracks' || b.kind === 'mill';
  ctx.strokeStyle = r.ink;
  ctx.lineWidth = px(mono ? 1.0 : 0.7);
  ctx.beginPath(); tracePoly(ctx, poly);
  ctx.stroke();

  if (o.lod < 2 || smallest < 2.2) return;

  // El caballete, y en lo monumental los faldones.
  const hip = mono && o.lod >= 3 && smallest >= 7;
  const mid = (c0 + c1) / 2;
  const at = (da: number, dc: number): V => ({
    x: c.x + along.x * da + across.x * dc,
    y: c.y + along.y * da + across.y * dc,
  });
  // Sin dos aguas no hay puntos exactos: se usan los límites de la proyección
  // acortados un 6%, que es lo que hace falta para que el lomo no asome por el
  // hastial en una huella que no es del todo rectangular.
  let p0 = e0 ?? at(a0 * 0.94, mid), p1 = e1 ?? at(a1 * 0.94, mid);
  if (hip) {
    // A cuatro aguas el lomo se retranquea media crujía por cada extremo; si
    // el edificio es más ancho que largo, eso lo convierte en pirámide, que es
    // exactamente la planta de un torreón.
    const inset = Math.min(width * 0.5, (a1 - a0) * 0.42);
    p0 = at(a0 + inset, mid); p1 = at(a1 - inset, mid);
  }

  ctx.strokeStyle = r.ink;
  ctx.lineWidth = px(hip ? 0.8 : 0.6);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
  if (hip) {
    // Los faldones se trazan a las esquinas de la caja orientada; en una
    // huella recortada eso puede asomar un pelo, y por eso van al 96%.
    for (const [pt, da] of [[p0, a0], [p1, a1]] as [V, number][]) {
      ctx.moveTo(pt.x, pt.y); ctx.lineTo(at(da * 0.96, c0 * 0.96).x, at(da * 0.96, c0 * 0.96).y);
      ctx.moveTo(pt.x, pt.y); ctx.lineTo(at(da * 0.96, c1 * 0.96).x, at(da * 0.96, c1 * 0.96).y);
    }
  }
  ctx.stroke();
}

function drawRoofs(ctx: Ctx, plan: CityPlan, o: CityBodyOptions): void {
  const all: Building[] = [];
  for (const q of plan.patches) {
    if (!q.withinCity && q.ward !== 'farm' && q.ward !== 'outskirts') continue;
    for (const b of q.buildings) if (b.shape.length >= 3) all.push(b);
  }
  // Orden de pintor por el punto más bajo, para que las sombras se apilen bien.
  all.sort((a, b) => Math.max(...a.shape.map((v) => v.y)) - Math.max(...b.shape.map((v) => v.y)));

  if (o.lod >= 3) {
    // Las sombras, en UNA sola pasada: dos mil rellenos con `globalAlpha` no
    // sólo costaban el doble, además se oscurecían donde se solapaban y una
    // hilera de casas pegadas salía con el borde sucio.
    const d = o.unit * 0.9;
    ctx.beginPath();
    for (const b of all) {
      const p = b.shape;
      ctx.moveTo(p[0].x + d, p[0].y + d);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x + d, p[i].y + d);
      ctx.closePath();
    }
    ctx.fillStyle = o.ink.shadow;
    ctx.fill();
  }
  for (const b of all) drawRoof(ctx, b, o);
}

// ---------------------------------------------------------------------------
// La muralla
// ---------------------------------------------------------------------------

/**
 * LA MURALLA COMO FÁBRICA.
 *
 * Era una polilínea encajada — un trazo grueso oscuro con otro claro encima — y
 * un círculo idéntico en CADA vértice. Eso no es una muralla: es un collar de
 * cuentas. Una muralla en planta tiene dos caras, adarve entre ellas, torres
 * con planta propia, casa-puerta con su paso abierto al camino y, si hubo
 * dinero, barbacana y foso.
 *
 * Las cinco bandas (perfil, fábrica, adarve, fábrica, perfil) salen de tres
 * trazos sobre la MISMA polilínea, sin calcular ningún desfase de polígono; el
 * único desfase que hace falta es el de los merlones, que se saca de la
 * tangente de cada segmento.
 */
function drawFort(ctx: Ctx, fort: Fortification, center: V, o: CityBodyOptions): void {
  const ink = o.ink;
  const px = (n: number) => n * o.unit;
  // Un suelo de grosor en PANTALLA: el generador da 0,67 unidades — dos metros
  // y medio, que es el grueso real de una cerca de villa — y a escala de mapa
  // eso son 0,7 px, o sea nada. Por debajo de dos píxeles y pico la muralla
  // deja de ser fábrica y vuelve a ser la raya que se venía a quitar.
  const t = Math.max(fort.thickness || MAIN_STREET * 0.85, o.unit * 2.2);
  const closed = fort.closed;

  if (fort.moat && fort.moat.length >= 3) {
    /**
     * UN FOSO ESTÁ FUERA DEL RECINTO.
     *
     * El foso llega como un anillo en un solo contorno (56 vértices en
     * `villa-1`), y en las esquinas cóncavas el borde interior cruza al
     * exterior: la regla de relleno se invierte y salen cuñas de agua DENTRO
     * del pueblo, sobre las manzanas. Recortar por fuera del recinto no es
     * maquillaje — es la definición del foso — y de paso lo hace inmune a
     * cualquier anillo que venga mal cerrado.
     */
    ctx.save();
    if (closed && fort.line.length >= 3) {
      const r = looseBox(fort.line);
      ctx.beginPath();
      ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      tracePoly(ctx, fort.line);
      ctx.clip('evenodd');
    }
    ctx.beginPath();
    tracePoly(ctx, fort.moat);
    ctx.fillStyle = ink.water;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink.waterInk;
    ctx.lineWidth = px(0.9);
    ctx.stroke();
    ctx.restore();
  }

  const stroke = (w: number, color: string) => {
    ctx.beginPath();
    traceLine(ctx, fort.line, closed);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  };
  stroke(t + px(2.6), ink.stoneInk);      // las dos caras
  stroke(t, ink.stoneShade);              // la fábrica
  if (o.lod >= 2) stroke(t * 0.34, ink.stone);  // el adarve

  // Merlones sobre la cara exterior. El diente sale del paño hacia fuera y
  // tiene un mínimo en píxeles: atado sólo al grosor, con los 0,67 unidades
  // que da el generador medía 1,5 px y no se veía ninguno. El paso también
  // tiene mínimo, o en un paño largo los dientes se sueldan en una banda.
  if (o.lod >= 3) {
    const din = t * 0.5 - Math.max(t * 0.18, px(0.4));
    const dout = t * 0.5 + Math.max(t * 0.18, px(1.5));
    const step = Math.max(t * 2.6, px(7));
    ctx.strokeStyle = ink.stoneInk;
    ctx.lineWidth = px(0.55);
    ctx.beginPath();
    const n = fort.line.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = fort.line[i], b = fort.line[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 0.001) continue;
      let nx = -dy / l, ny = dx / l;
      const mx = (a.x + b.x) / 2 - center.x, my = (a.y + b.y) / 2 - center.y;
      if (mx * nx + my * ny < 0) { nx = -nx; ny = -ny; }
      const k = Math.floor(l / step);
      for (let j = 0; j <= k; j++) {
        const s = (j * step + (l - k * step) / 2) / l;
        const x = a.x + dx * s, y = a.y + dy * s;
        ctx.moveTo(x + nx * din, y + ny * din);
        ctx.lineTo(x + nx * dout, y + ny * dout);
      }
    }
    ctx.stroke();
  }

  for (const tw of fort.towers) {
    if (tw.shape.length < 3) continue;
    ctx.beginPath();
    tracePoly(ctx, tw.shape);
    ctx.fillStyle = ink.stone;
    ctx.fill();
    ctx.strokeStyle = ink.stoneInk;
    ctx.lineWidth = px(1.0);
    ctx.stroke();
    // El hueco interior: lo que separa una torre de un lunar es que se le vea
    // la cámara. Sólo a lod 3, donde la torre mide más de diez píxeles.
    if (o.lod >= 3) {
      const c = centroid(tw.shape);
      ctx.beginPath();
      tracePoly(ctx, tw.shape.map((p) => ({ x: c.x + (p.x - c.x) * 0.45, y: c.y + (p.y - c.y) * 0.45 })));
      ctx.fillStyle = ink.stoneShade;
      ctx.fill();
    }
  }

  for (const g of fort.gates) {
    if (g.barbican && g.barbican.length >= 3 && o.lod >= 2) {
      ctx.beginPath();
      tracePoly(ctx, g.barbican);
      ctx.fillStyle = ink.stone;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ink.stoneInk;
      ctx.lineWidth = px(1.1);
      ctx.stroke();
    }
    if (g.shape.length < 3) continue;
    ctx.beginPath();
    tracePoly(ctx, g.shape);
    ctx.fillStyle = ink.stone;
    ctx.fill();
    ctx.strokeStyle = ink.stoneInk;
    ctx.lineWidth = px(1.3);
    ctx.stroke();
    // El paso, abierto hacia el camino. Sin él la casa-puerta es un bloque
    // macizo tapando la avenida que acaba de entrar por ella.
    if (o.lod >= 2) {
      const d = { x: Math.cos(g.facing), y: Math.sin(g.facing) };
      const r = t * 1.5;
      ctx.strokeStyle = ink.paving;
      ctx.lineWidth = t * 0.5;
      ctx.beginPath();
      ctx.moveTo(g.at.x - d.x * r, g.at.y - d.y * r);
      ctx.lineTo(g.at.x + d.x * r, g.at.y + d.y * r);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// El cuerpo del plano — compartido por la lámina y por el mapa
// ---------------------------------------------------------------------------

/**
 * El plano entero salvo los rótulos, en coordenadas de plano.
 *
 * Quien llama deja puesta la transformación (traslación y escala) y dice a qué
 * escala está dibujando con `unit`; a partir de ahí todos los grosores se
 * eligen en píxeles de pantalla, que es lo que hace que el mismo dibujo
 * aguante desde el modal a 6,8 px/unidad hasta un tile satélite a 0,5.
 */
export function drawCityBody(ctx: Ctx, plan: CityPlan, o: CityBodyOptions): void {
  const ink = o.ink;
  const px = (n: number) => n * o.unit;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- 1. el suelo ---------------------------------------------------------
  if (o.groundFill) {
    /**
     * El suelo hecho acaba en la muralla.
     *
     * Con un solo relleno opaco para todo `withinCity`, el pueblo se plantaba
     * sobre el tile como un recorte de pergamino con el borde en aristas de
     * Voronoi: media docena de rectas de cien metros separando el arrabal del
     * bosque. Dentro del recinto el suelo SÍ está todo hecho y va opaco;
     * fuera se deja respirar el terreno, que es lo que de verdad hay entre las
     * casas del arrabal.
     */
    ctx.fillStyle = ink.ground;
    for (const inner of [true, false]) {
      ctx.globalAlpha = inner ? 1 : 0.66;
      ctx.beginPath();
      let any = false;
      for (const q of plan.patches) {
        if (!q.withinCity || q.shape.length < 3) continue;
        // Sin muralla no hay dentro ni fuera: el pueblo entero es el arrabal.
        const isInner = plan.wall ? q.withinWalls : true;
        if (isInner !== inner) continue;
        tracePoly(ctx, q.shape);
        any = true;
      }
      if (any) ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (o.wardTints !== false) {
    ctx.globalAlpha = ink.wardAlpha;
    for (const q of plan.patches) {
      const tint = ink.ward[q.ward];
      if (!tint || q.shape.length < 3) continue;
      // El campo no lleva suelo opaco debajo: sobre el mapa tiene que dejar ver
      // el terreno, o el pueblo se planta en un disco de pergamino.
      ctx.globalAlpha = q.withinCity ? ink.wardAlpha : ink.wardAlpha * 0.45;
      ctx.fillStyle = tint;
      ctx.beginPath();
      tracePoly(ctx, q.shape);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * LOS CAMPOS TIENEN EL TAMAÑO DE UN CAMPO, NO EL DE SU CELDA.
   *
   * Antes eran nueve líneas por manzana, espaciadas a `√área · 0,1125` y de
   * largo `√área · 0,5`. En una celda pequeña eso pasa por un rastrojo; en las
   * celdas exteriores, que en un pueblo grande miden media lámina, salían nueve
   * rayas enormes atravesando la hoja entera y cruzándose con las de las celdas
   * vecinas. Lo que el lector veía no eran campos: era una reja.
   *
   * Un bancal medieval mide entre cuarenta y cien metros. A cuatro metros por
   * unidad son 10–25 unidades, y ése es un número FIJO: no depende de lo grande
   * que sea la celda de Voronoi que le tocó. Se rayan en paralelo a intervalo
   * constante y se recortan contra la manzana, que es lo que convierte nueve
   * rayas en una hoja de bancales.
   */
  if (o.fields !== false && o.lod >= 2) {
    const rng = createRng(plan.seed, 'city-fields');
    ctx.save();
    ctx.strokeStyle = ink.field;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = px(0.6);
    const FIELD_SPACING = 14;
    for (const q of plan.patches) {
      if (q.ward !== 'farm') continue;
      const c = centroid(q.shape);
      const a = rng() * Math.PI;
      const dx = Math.cos(a), dy = Math.sin(a);
      // El radio de la celda decide CUÁNTAS rayas caben, no cómo de separadas van.
      let r = 0;
      for (const v of q.shape) r = Math.max(r, dist(v, c));
      const n = Math.min(28, Math.floor(r / FIELD_SPACING));
      if (n < 1) continue;
      // Recortadas contra la manzana: sin esto, un surco de un bancal se mete en
      // el de al lado y las dos direcciones se cruzan en mitad del campo.
      ctx.beginPath();
      tracePoly(ctx, q.shape);
      ctx.save();
      ctx.clip();
      for (let k = -n; k <= n; k++) {
        const off = k * FIELD_SPACING;
        ctx.beginPath();
        ctx.moveTo(c.x - dx * r * 1.2 - dy * off, c.y - dy * r * 1.2 + dx * off);
        ctx.lineTo(c.x + dx * r * 1.2 - dy * off, c.y + dy * r * 1.2 + dx * off);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---- 2. el agua ----------------------------------------------------------
  // Después de los lavados de barrio. Antes, el tinte medio opaco del distrito
  // se pintaba encima del río y salía un borrón gris justo por donde el río
  // cruza el pueblo — o sea, por donde importa.
  if (o.water !== false) drawWater(ctx, plan, o);

  /**
   * UN CORRAL NO ES UNA PLAZA.
   *
   * Los patios se pintaban todos del color de la hoja, así que el corral
   * trasero de una manzana de artesanos salía exactamente igual que la plaza
   * del mercado: un hueco en blanco. Con el nuevo parcelado hay uno por
   * manzana, y la lámina se llenó de agujeros.
   *
   * Tres cosas distintas, tres tratamientos: el parque es arbolado, la plaza es
   * suelo pisado — empedrado, como la calle a la que pertenece — y el corral es
   * huerto, que es lo que de verdad había detrás de una casa de pueblo.
   */
  for (const q of plan.patches) {
    // El campo YA lo lleva el rayado de bancales de más arriba; teñirlo además
    // de huerto pintó de verde toda la hoja hasta el borde.
    if (q.ward === 'farm' || q.ward === 'outskirts') continue;
    const kind = q.ward === 'park' ? 'park' : q.ward === 'market' ? 'paved' : 'yard';
    for (const c of q.courts) {
      if (c.length < 3) continue;
      ctx.beginPath();
      tracePoly(ctx, c);
      ctx.fillStyle = kind === 'park' ? ink.park : kind === 'paved' ? ink.paving : ink.garden;
      ctx.globalAlpha = kind === 'park' ? 0.75 : kind === 'paved' ? 0.9 : 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (kind === 'park' && o.lod >= 2) {
        ctx.strokeStyle = ink.parkInk;
        ctx.lineWidth = px(0.5);
        ctx.stroke();
      }
    }
  }

  // ---- 3. las plazas -------------------------------------------------------
  for (const sq of squaresFor(plan)) drawSquare(ctx, sq, o);

  /**
   * UNA CALLE ES UN SUELO, NO DOS RAYAS.
   *
   * Esto rellenaba con `theme.paper.base` — el color de la hoja. Sobre el hueco
   * entre manzanas, que también es hoja, el relleno era invisible: de una calle
   * sólo se veía el filo, dos pelos de tinta. Y como la jerarquía entre
   * avenida, calle y camino vive en el ANCHO del relleno, la jerarquía no se
   * veía en absoluto. Medido en `city-debug`: una avenida daba una banda
   * contigua de 8 px y una calle secundaria de 49, es decir, invertida.
   *
   * `paving` es el tono al que la hoja envejece: más oscuro que el suelo, de la
   * misma familia, así que el empedrado se lee como suelo pisado sin
   * convertirse en un trazo de color encima del plano.
   */
  const drawRibbon = (path: V[], w: number) => {
    if (path.length < 2) return;
    ctx.beginPath();
    traceLine(ctx, path);
    ctx.strokeStyle = ink.pavingEdge;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = w + px(1.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink.paving;
    ctx.lineWidth = Math.max(px(0.8), w - px(0.4));
    ctx.stroke();
  };
  const fillPoly = (poly: Poly, fill: string, stroke?: string, lw = px(0.8)) => {
    if (poly.length < 3) return;
    ctx.beginPath();
    tracePoly(ctx, poly);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };

  // A escala de mapa la red viaria se lee del borde de la manzana: el hueco
  // entre manzanas ES la calle, y perfilarlo cuesta un trazo por celda en vez
  // de un listado de ejes que a 0,5 px/unidad ya no se distinguen.
  if (o.blockEdges) {
    ctx.strokeStyle = ink.paving;
    ctx.lineWidth = Math.max(px(0.5), MAIN_STREET * 0.8);
    ctx.beginPath();
    for (const q of plan.patches) {
      if (!q.withinCity || q.shape.length < 3) continue;
      tracePoly(ctx, q.shape);
    }
    ctx.stroke();
  }
  if (o.roads !== false) for (const r of plan.roads) drawRibbon(r, MAIN_STREET * 0.8);
  if (o.lod >= 2) for (const st of plan.streets) drawRibbon(st, MAIN_STREET);
  // Avenues last and wider, so the hierarchy survives every crossing.
  for (const st of plan.mainStreets) drawRibbon(st, MAIN_STREET * 1.45);

  // ---- 4. waterfront and bridges ------------------------------------------
  // Drawn after the streets and before the buildings: a quay is paving that the
  // houses stand back from, and a bridge deck has to cover the water the street
  // was just drawn across.
  for (const pier of plan.piers) {
    fillPoly(pier, ink.paving, ink.pavingEdge, px(0.8));
    // Los tablones cruzados: un embarcadero es madera sobre el agua, y sin
    // ellos el muelle sale como una barra parda saliendo del pueblo hacia el
    // mar, que es exactamente lo que se veía.
    if (pier.length === 4 && o.lod >= 3) {
      ctx.save();
      ctx.beginPath(); tracePoly(ctx, pier); ctx.clip();
      ctx.strokeStyle = ink.pavingEdge;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = px(0.7);
      const l = dist(pier[0], pier[1]);
      const k = Math.max(1, Math.round(l / 2.2));
      ctx.beginPath();
      for (let i = 1; i < k; i++) {
        const t = i / k;
        ctx.moveTo(pier[0].x + (pier[1].x - pier[0].x) * t, pier[0].y + (pier[1].y - pier[0].y) * t);
        ctx.lineTo(pier[3].x + (pier[2].x - pier[3].x) * t, pier[3].y + (pier[2].y - pier[3].y) * t);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
  for (const b of plan.bridges) {
    fillPoly(b, ink.ground, ink.ink, px(1.1));
    // Two parapet lines along the deck read as a bridge at any zoom; a plain
    // rectangle over a river reads as a mistake.
    if (b.length === 4) {
      ctx.strokeStyle = ink.ink;
      ctx.lineWidth = px(0.7);
      for (const [i, j] of [[0, 1], [2, 3]] as [number, number][]) {
        ctx.beginPath();
        ctx.moveTo(b[i].x, b[i].y);
        ctx.lineTo(b[j].x, b[j].y);
        ctx.stroke();
      }
    }
  }

  // ---- 5. los tejados ------------------------------------------------------
  if (o.lod >= 2) {
    drawRoofs(ctx, plan, o);
  } else if (o.lod >= 1) {
    // Demasiado fino para dibujarlos uno a uno: un lavado por manzana a la
    // densidad que los edificios REALMENTE tienen, que es lo que el ojo lee de
    // todos modos. Con un alfa fijo, un arrabal medio vacío salía tan macizo
    // como el centro.
    for (const q of plan.patches) {
      if (!q.withinCity || q.shape.length < 3 || !q.buildings.length) continue;
      let built = 0;
      for (const b of q.buildings) built += area(b.shape);
      const d = Math.min(1, built / Math.max(1, area(q.shape)));
      ctx.beginPath();
      tracePoly(ctx, q.shape);
      ctx.fillStyle = ink.roofs.house[1].shade;
      ctx.globalAlpha = 0.28 + 0.55 * d;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---- 6. la muralla -------------------------------------------------------
  const fort = fortFor(plan);
  if (fort) drawFort(ctx, fort, plan.center, o);
  if (plan.citadel && plan.citadel.length >= 3) {
    ctx.beginPath();
    tracePoly(ctx, plan.citadel);
    ctx.strokeStyle = ink.stoneInk;
    ctx.lineWidth = MAIN_STREET * 0.7;
    ctx.stroke();
    if (o.lod >= 2) {
      ctx.strokeStyle = ink.stone;
      ctx.lineWidth = MAIN_STREET * 0.24;
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// La lámina
// ---------------------------------------------------------------------------

export function renderCity(plan: CityPlan, ctx: Ctx, opts: CityRenderOptions): void {
  const { theme, width: W, height: H } = opts;
  const margin = opts.margin ?? 0.35;
  const ink = cityInk(theme);

  // Fit the plan to the canvas.
  const extent = plan.radius * (1 + margin) * 2;
  const s = Math.min(W, H) / extent;
  const ox = W / 2 - plan.center.x * s;
  const oy = H / 2 - plan.center.y * s;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.paper.base;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  drawCityBody(ctx, plan, {
    ink,
    unit: 1 / s,
    // La lámina siempre al máximo: es el sitio donde el lector MIRA el pueblo.
    lod: 3,
    wardTints: opts.showWardTints !== false,
  });

  ctx.restore();

  // ---- labels -------------------------------------------------------------
  if (opts.showLabels !== false) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /**
     * Los rótulos no se pisan.
     *
     * Antes se escribían en el centroide sin más, y en una lámina de doce
     * paneles «Plaza del mercado» y «Catedral» se solapaban en ocho. Un rótulo
     * ilegible es peor que ninguno: ocupa el sitio de lo que tapa y encima no
     * se puede leer.
     *
     * La regla es la que usa un delineante: se colocan por importancia, cada
     * uno prueba unas pocas posiciones alrededor de su sitio, y el que no
     * encuentra hueco no se dibuja. Las cajas se guardan y se comprueban contra
     * las ya puestas.
     */
    const label = opts.labelFor ?? ((w: WardType) => WARD_LABEL[w]);
    const named: WardType[] = ['market', 'cathedral', 'castle', 'military', 'park'];
    const size = Math.max(8, Math.min(15, W / 46));
    ctx.font = `500 ${size}px ${theme.type.display}`;
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const free = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      !taken.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

    /**
     * Un rótulo de barrio se letrea SIGUIENDO el barrio.
     *
     * Un distrito no tiene un punto, tiene una forma alargada, y un delineante
     * escribe su nombre a lo largo de esa forma: pequeño, espaciado y girado
     * con el eje. Escrito horizontal en el centroide, el nombre de un barrio
     * estrecho se sale por los dos lados y tapa las casas de los vecinos.
     *
     * La caja que se guarda es la envolvente de la caja GIRADA — de ahí las
     * cuatro esquinas —, así que el mismo `free()` sirve para los dos casos y
     * no hay dos pruebas de colisión que puedan discrepar.
     */
    const place = (
      text: string, at: V, angle: number, fSize: number, track: number, alpha: number,
      tries: [number, number][],
    ): boolean => {
      const glyphs = [...text];
      const wText = glyphs.reduce((a, ch) => a + ctx.measureText(ch).width, 0)
        + track * Math.max(0, glyphs.length - 1);
      const hText = fSize * 1.24;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      for (const [dx, dy] of tries) {
        const cx = at.x + dx, cy = at.y + dy;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
          const px2 = (qx * (wText / 2 + 2)) * ca - (qy * (hText / 2)) * sa;
          const py2 = (qx * (wText / 2 + 2)) * sa + (qy * (hText / 2)) * ca;
          x0 = Math.min(x0, cx + px2); x1 = Math.max(x1, cx + px2);
          y0 = Math.min(y0, cy + py2); y1 = Math.max(y1, cy + py2);
        }
        const box = { x0, y0, x1, y1 };
        if (!free(box)) continue;
        taken.push(box);
        ctx.save();
        ctx.translate(cx, cy);
        if (angle) ctx.rotate(angle);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.type.halo;
        ctx.fillStyle = theme.type.color;
        let cur = -wText / 2;
        for (const ch of glyphs) {
          const cw = ctx.measureText(ch).width;
          ctx.strokeText(ch, cur + cw / 2, 0);
          ctx.fillText(ch, cur + cw / 2, 0);
          cur += cw + track;
        }
        ctx.restore();
        return true;
      }
      return false;
    };

    const seen = new Set<WardType>();
    // Una plaza con nombre propio ya se rotula como plaza: repetirla como
    // barrio ponía «Plaza Mayor» y «Plaza del mercado» una debajo de otra sobre
    // el mismo empedrado.
    const sqLabel = opts.labelForSquare;
    const squareText = (sq: Square) => sq.name ?? (sqLabel ? sqLabel(sq.kind) : null);
    if ((plan.squares ?? []).some((sq) => sq.kind === 'market' && squareText(sq))) seen.add('market');
    // Por el orden de `named`, que es el orden de importancia: si sólo cabe uno,
    // que sea la plaza.
    for (const ward of named) {
      for (const q of plan.patches) {
        if (!q.withinCity || q.ward !== ward || seen.has(ward)) continue;
        const c = centroid(q.shape);
        const at = { x: c.x * s + ox, y: c.y * s + oy };
        // El sitio propio primero; luego arriba, abajo y a los lados, a una
        // línea de distancia. Un rótulo desplazado sigue señalando su manzana.
        const tw = ctx.measureText(label(ward)).width;
        const tries: [number, number][] = [
          [0, 0], [0, -size * 1.5], [0, size * 1.5], [-tw * 0.55, 0], [tw * 0.55, 0],
        ];
        if (place(label(ward), at, 0, size, 0, 1, tries)) seen.add(ward);
        if (seen.has(ward)) break;
      }
    }

    // Las plazas con nombre propio, después de los barrios y antes de los
    // distritos: una plaza es más pequeña que un barrio y más nombrada.
    for (const sq of plan.squares ?? []) {
      const text = squareText(sq);
      if (!text || sq.shape.length < 3) continue;
      const c = centroid(sq.shape);
      place(text, { x: c.x * s + ox, y: c.y * s + oy }, 0, size, 0, 1,
        [[0, 0], [0, -size * 1.4], [0, size * 1.4]]);
    }

    // Los distritos con nombre propio, letreados a lo largo de su eje mayor.
    const dSize = size * 0.78;
    const dTrack = dSize * 0.34;
    ctx.font = `500 ${dSize}px ${theme.type.display}`;
    const names = plan.districtNames ?? [];
    // De mayor a menor: si dos barrios se disputan el mismo hueco, el nombre
    // que se queda es el del barrio que ocupa más plano. Sin ordenar, el que
    // ganaba era el que tocara antes en el índice de `patches`, que no
    // significa nada.
    const districts = plan.patches
      .map((q, i) => ({ q, text: names[i] }))
      .filter((d) => d.text && d.q.withinCity && d.q.shape.length >= 3)
      .sort((a, b) => area(b.q.shape) - area(a.q.shape));
    for (const { q, text } of districts) {
      // El eje mayor es la cuerda más larga de la manzana. Con menos de doce
      // vértices por celda, el cuadrático cuesta menos que cualquier finura.
      let a = q.shape[0], b = q.shape[0], bd = -1;
      for (let j = 0; j < q.shape.length; j++) {
        for (let k = j + 1; k < q.shape.length; k++) {
          const d = dist(q.shape[j], q.shape[k]);
          if (d > bd) { bd = d; a = q.shape[j]; b = q.shape[k]; }
        }
      }
      let ang = Math.atan2((b.y - a.y) * s, (b.x - a.x) * s);
      // Nunca del revés: un rótulo boca abajo no es un rótulo.
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const up = (text as string).toUpperCase();
      const wText = [...up].reduce((acc, ch) => acc + ctx.measureText(ch).width, 0)
        + dTrack * Math.max(0, up.length - 1);
      // Si el nombre no cabe holgado a lo largo del distrito, no cabe:
      // escribirlo igualmente lo saca por los dos extremos y tapa a los
      // vecinos. Con el 94% de la cuerda, en una aldea de cinco manzanas
      // «GLAULIVELENG» ocupaba la manzana entera de punta a punta; con el 78%
      // sólo se rotula el barrio que de verdad tiene sitio.
      if (wText > bd * s * 0.78) continue;
      const c = centroid(q.shape);
      place(up, { x: c.x * s + ox, y: c.y * s + oy }, ang, dSize, dTrack, 0.82,
        [[0, 0], [0, -dSize * 1.6], [0, dSize * 1.6]]);
    }

    const title = opts.title ?? plan.name;
    const tSize = Math.max(16, W * 0.036);
    ctx.font = `600 ${tSize}px ${theme.type.display}`;
    ctx.fillStyle = theme.type.color;
    ctx.strokeStyle = theme.type.halo;
    ctx.lineWidth = 5;
    let cursor = 0;
    const tracking = tSize * 0.32;
    const up = title.toUpperCase();
    const total = [...up].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + tracking * (up.length - 1);
    cursor = W / 2 - total / 2;
    for (const ch of up) {
      const w = ctx.measureText(ch).width;
      ctx.strokeText(ch, cursor + w / 2, tSize * 1.2);
      ctx.fillText(ch, cursor + w / 2, tSize * 1.2);
      cursor += w + tracking;
    }
    ctx.font = `italic 400 ${tSize * 0.4}px ${theme.type.body}`;
    ctx.lineWidth = 3;
    const sub = opts.subtitle
      ?? `${plan.population.toLocaleString('es-ES')} habitantes · ${plan.wall ? 'ciudad amurallada' : 'villa abierta'}`;
    ctx.strokeText(sub, W / 2, tSize * 2.05);
    ctx.fillText(sub, W / 2, tSize * 2.05);
    ctx.restore();
  }
}
