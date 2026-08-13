// ============================================
// City Generator — Medieval town layout
// ============================================
// A seeded city plan: Voronoi districts, a curtain wall with gates and towers,
// a street network routed from the gates to the market, wards assigned by
// suitability, and building footprints produced by recursive subdivision.
//
// The two details that decide whether the result reads as a medieval town or
// as noise:
//
//   1. ANGLE SUPPRESSION — the recursive subdivider skews its cuts on large
//      blocks but goes strictly perpendicular once a block is within 4× the
//      minimum lot. The last two levels of recursion are always square-on, so
//      buildings come out rectangular even inside a chaotic ward.
//   2. GAPLESS SPLITS — most deep cuts open no alley, so houses share party
//      walls and form terraced rows. Only large blocks get a real gap.
//
// Both come from the reference implementation; without them the footprints are
// random quadrilaterals and the plan reads as static.

import { createRng, type Rng } from '../core/rng';
import { generateName, type CultureId } from '../core/naming';
import { buildLanguageFamily, coinName, type Gloss, type Language } from '../core/language';
import {
  area, bisect, centroid, circle, clipHalfPlane, compactness, contains, cut, dist, lerp, longestEdge,
  norm, perimeter, radial, rect, relax, ring, rot90, semiRadial, shrink, shrinkEdges, signedArea,
  slicePlots, smoothPoly, sub, voronoi,
  type Poly, type V,
} from './geometry';

// Street widths, in city units. One unit ≈ 4 m, so a main street is ~8 m.
export const MAIN_STREET = 2.0;
export const REGULAR_STREET = 1.0;
export const ALLEY = 0.6;

export type WardType =
  | 'craftsmen' | 'merchant' | 'patriciate' | 'administration' | 'military'
  | 'slum' | 'gate' | 'market' | 'cathedral' | 'castle' | 'park' | 'farm' | 'outskirts';

export const WARD_LABEL: Record<WardType, string> = {
  craftsmen: 'Barrio de artesanos',
  merchant: 'Barrio mercantil',
  patriciate: 'Barrio patricio',
  administration: 'Barrio administrativo',
  military: 'Cuartel',
  slum: 'Arrabal',
  gate: 'Barrio de la puerta',
  market: 'Plaza del mercado',
  cathedral: 'Catedral',
  castle: 'Ciudadela',
  park: 'Parque',
  farm: 'Granjas',
  outskirts: 'Afueras',
};

/**
 * QUÉ ES ESE EDIFICIO.
 *
 * Hasta ahora un edificio era un `Poly` y nada más: una taberna, una fragua y
 * una casa salían del generador siendo el mismo cuadrilátero anónimo, y el
 * dibujante no tenía forma de distinguirlos porque no había nada que
 * distinguir. Un barrio elegía su tipo y después, dentro, no había ni un solo
 * dato que reflejara esa elección.
 *
 * `facing` es la dirección de la fachada en radianes — a qué calle mira. Sale
 * gratis del parcelado (la parcela se corta contra su frente) y es lo que
 * permite dibujar el caballete del tejado en el sentido correcto, poner la
 * puerta donde toca y, más adelante, levantarlo en tres dimensiones.
 */
export type BuildingKind =
  | 'house' | 'shed' | 'hall' | 'inn' | 'guild' | 'forge' | 'mill'
  | 'warehouse' | 'church' | 'chapel' | 'keep' | 'tower' | 'barracks' | 'farm';

export interface Building {
  shape: Poly;
  kind: BuildingKind;
  /** Radianes: hacia dónde da la fachada. */
  facing: number;
}

export interface Patch {
  shape: Poly;
  withinCity: boolean;
  /** Dentro del recinto amurallado. Falso en los arrabales y en el campo. */
  withinWalls: boolean;
  ward: WardType;
  buildings: Building[];
  /** Open space inside the ward: courtyards, cloisters, plazas. */
  courts: Poly[];
}

/**
 * UN ESPACIO PÚBLICO, COMO OBJETO.
 *
 * La plaza del mercado era un `Patch` cuyo `courts[0]` era la manzana entera y
 * un pozo de dos unidades en medio. En la lámina eso salía como un rótulo
 * flotando sobre papel en blanco: sin contorno, sin soportales, sin cruz, y sin
 * una sola casa que le diera fachada. Y había exactamente UNA — ni plaza de la
 * iglesia, ni mercado del pescado, ni el ensanche donde se cruzan dos calles.
 */
export type SquareKind = 'market' | 'church' | 'gate' | 'harbour' | 'lesser';

export interface Square {
  kind: SquareKind;
  /** El empedrado. */
  shape: Poly;
  /** El pozo, la cruz o la picota. Nulo si la plaza está desnuda. */
  monument: Poly | null;
  /** Los lados con soportal: pares de vértices consecutivos de `shape`. */
  arcades: [V, V][];
  /** Nombre propio, cuando el mundo tiene lengua con la que acuñarlo. */
  name?: string;
}

/**
 * LA MURALLA COMO FÁBRICA, NO COMO RAYA.
 *
 * `wall: Poly` era una polilínea y `towers: V[]` puntos pelados: sin grosor,
 * sin adarve, sin cara interior, sin casa-puerta, sin foso — y una torre en
 * CADA vértice del anillo, que en un pueblo de cuatro mil quinientas almas eran
 * veinticuatro cuentas de collar repartidas a intervalos idénticos porque el
 * relajado de Lloyd había igualado el espaciado.
 *
 * Convive con `wall`/`gates`/`towers`, que siguen siendo la lectura barata para
 * quien sólo necesita la línea.
 */
export interface Fortification {
  /** Eje de la muralla. */
  line: V[];
  closed: boolean;
  /** Grosor de la fábrica, en unidades. */
  thickness: number;
  towers: { at: V; shape: Poly; kind: 'round' | 'square' | 'bastion' }[];
  gates: {
    /** Sobre la línea dibujada. */
    at: V;
    /** El vértice soldado: lo que comparten las manzanas y el grafo de calles. */
    anchor: V;
    /** La casa-puerta. */
    shape: Poly;
    /** Radianes, hacia fuera. */
    facing: number;
    /** El barbacana, cuando la puerta es lo bastante importante. */
    barbican: Poly | null;
  }[];
  /** El foso, donde el terreno lo permitía. */
  moat: Poly | null;
}

/**
 * EL AGUA CON FORMA.
 *
 * `coast: {p, n}` era un semiplano infinito: el mar salía como una línea de
 * regla cruzando la lámina de lado a lado, sin bahía, sin punta, sin dársena y
 * sin islas. Un puerto de Watabou tiene el agua MODELADA y el pueblo abrazando
 * una dársena.
 *
 * `shore` es el litoral de verdad, como polilínea; `water` los polígonos de
 * agua ya cerrados y listos para rellenar. El semiplano se conserva porque
 * sigue siendo la prueba barata de "¿está esto mojado?" que usan el recorte de
 * manzanas y el peso del A*.
 */
export interface CityWater {
  /** Litoral, de un borde del plano al otro. */
  shore: V[];
  /** Masas de agua cerradas: mar, dársena, lagunas. */
  water: Poly[];
  /** El eje del río con su anchura real, si lo hay. */
  river: { line: V[]; width: number } | null;
}

export interface CityPlan {
  name: string;
  seed: string;
  /** Requested size class; drives patch count and whether walls exist. */
  size: number;
  patches: Patch[];
  /** Curtain-wall ring, or null for an open town. */
  wall: Poly | null;
  /** False when the wall is an open arc ending at the water on both sides. */
  wallClosed: boolean;
  /** Wall vertices that are gates. */
  gates: V[];
  towers: V[];
  /** Citadel wall, if the town has one. */
  citadel: Poly | null;
  /** Street centrelines inside the town. */
  streets: V[][];
  /** The avenues: gate → market, routed along the gaps between blocks. */
  mainStreets: V[][];
  /** Bridge decks, only where a street really crosses the water. */
  bridges: Poly[];
  /**
   * Los embarcaderos que salen del muelle.
   *
   * El muelle en sí NO está aquí: va en `mainStreets`, porque un muelle es la
   * calle a la que dan los almacenes y no una losa. Modelarlo como polígono
   * dibujaba una barra marrón que cruzaba el puerto y salía por el otro lado
   * del pueblo. Hubo un campo `quays` para eso; estuvo vacío desde el primer
   * día y lo leían dos dibujantes que no pintaban nada con él.
   */
  piers: Poly[];
  /** Roads leaving the gates into the countryside. */
  roads: V[][];
  /** River polyline crossing the town, if any. */
  river: V[] | null;
  /** Water half-plane for a coastal town: everything on the far side is sea. */
  coast: { p: V; n: V } | null;
  center: V;
  radius: number;
  population: number;
  /** Plazas y ensanches. Vacío en una aldea que no tiene ninguno. */
  squares: Square[];
  /** La muralla con cuerpo. Nula donde no hay muralla. */
  fort: Fortification | null;
  /** El agua con forma. Nula en un pueblo de secano. */
  waters: CityWater | null;
  /** Los distritos con nombre propio, indexados como `patches`. */
  districtNames: (string | null)[];
}

export interface CityParams {
  seed: string;
  name?: string;
  culture?: CultureId;
  /** Roughly the number of inner districts: 6 = hamlet, 40 = large city. */
  size: number;
  walls: boolean;
  citadel: boolean;
  /** Put a river through the town. */
  river: boolean;
  /** Put the sea on one side. */
  coast: boolean;
  /** Ring of farmland outside the walls. */
  farms: boolean;
  population?: number;

  /**
   * WHERE THINGS ACTUALLY ARE.
   *
   * `river` and `coast` were booleans, and the generator picked a random
   * bearing for each. That is why no town was ever shaped by its own
   * geography: the plan knew it had a river but not which way it ran, so the
   * outline could not follow it, and the plan could not be laid on the map
   * without the water in it pointing somewhere the map disagrees with.
   *
   * These are unit vectors in plan space, y DOWN, matching the world raster's
   * axes, so a plan built with them lands on the map already oriented.
   */
  /** Direction from the town out to open sea. Absent = not a port. */
  coastDir?: V | null;
  /** Direction the river runs (either sense; the axis is what matters). */
  riverDir?: V | null;
  /** Direction of the rising ground, and how strongly it rises (0–1). */
  slopeDir?: V | null;
  slopeAmount?: number;
  /** 0 = a perfect disc, 1 = wildly lobed. Real towns sit near 0,5. */
  irregularity?: number;

  /**
   * LO QUE EL ATLAS YA SABE.
   *
   * El mundo sabe que la calzada entra por el nordeste, dónde rompe el mar y
   * por dónde va el río; el plano se lo inventaba todo otra vez. Así salía un
   * pueblo cuyas puertas no daban a ningún camino y cuyo puerto era una raya
   * de regla, y la lámina de la comarca y la del pueblo se contradecían.
   *
   * Los tres son OPCIONALES a propósito: sin ellos el generador sigue
   * sintetizando lo suyo, que es lo que hace falta para un pueblo suelto de
   * un banco de pruebas.
   */
  /** Bearings of the world roads that actually arrive, radians, outward. */
  roadBearings?: number[];
  /** The real shoreline near the town, in city units relative to the centre. */
  shoreLine?: V[] | null;
  /** The real river course through the town, in city units, with its width. */
  riverCourse?: { line: V[]; width: number } | null;
  /**
   * La lengua viva del pueblo y la protolengua de su familia.
   *
   * `buildHumanGeography` ya construye el árbol lingüístico del mundo y asigna
   * una lengua viva por cultura; si llega hasta aquí, los nombres de los
   * barrios son COGNADOS de los nombres de los pueblos vecinos, que es el
   * pago de todo el módulo de lenguas. Sin él se deriva una lengua por
   * cultura, consistente pero ajena al árbol del mundo.
   */
  language?: { lang: Language; proto: Language } | null;
}

export const DEFAULT_CITY: CityParams = {
  seed: 'ciudad',
  size: 15,
  walls: true,
  citadel: true,
  river: false,
  coast: false,
  farms: true,
  irregularity: 0.55,
};

// ---------------------------------------------------------------------------
// Patch construction
// ---------------------------------------------------------------------------

/**
 * Sites on an expanding spiral. The spiral is what gives a medieval town its
 * characteristic radial density gradient: tight in the middle, loosening
 * outward, with no grid axis anywhere.
 */
function spiralSites(rng: Rng, count: number): V[] {
  const sa = rng() * 2 * Math.PI;
  const pts: V[] = [];
  for (let i = 0; i < count; i++) {
    const a = sa + Math.sqrt(i) * 5;
    const r = i === 0 ? 0 : 10 + i * (2 + rng());
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

/** Merge vertices that are nearly coincident so patches share exact corners —
 *  the street graph depends on that identity. */
function weldVertices(patches: Poly[], tol = 0.35): void {
  const pool: V[] = [];
  const key = (v: V) => `${Math.round(v.x / tol)},${Math.round(v.y / tol)}`;
  const map = new Map<string, V>();
  for (const p of patches) {
    for (let i = 0; i < p.length; i++) {
      const k = key(p[i]);
      let hit = map.get(k);
      if (!hit) {
        // Also probe the 8 neighbouring buckets so a vertex sitting on a bucket
        // boundary still welds.
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c = map.get(`${Math.round(p[i].x / tol) + dx},${Math.round(p[i].y / tol) + dy}`);
            if (c && dist(c, p[i]) <= tol) { hit = c; break; }
          }
        }
      }
      if (hit) p[i] = hit;
      else { map.set(k, p[i]); pool.push(p[i]); }
    }
  }
}

// ---------------------------------------------------------------------------
// The street graph
// ---------------------------------------------------------------------------
// A town's streets are not lines drawn across it. They are the GAPS BETWEEN ITS
// BLOCKS, which means the street network already exists the moment the patches
// do: it is the edge graph of the patch subdivision. Routing along it is what
// makes a main street bend around a block the way a real one does, instead of
// cutting through six houses on its way to the market.
//
// `weldVertices` has already made neighbouring patches share vertex OBJECTS, so
// the graph can be keyed on identity and needs no geometric matching.

interface StreetGraph {
  nodes: V[];
  index: Map<V, number>;
  adj: number[][];
  /** How many patches an edge borders: 1 = on the town's edge, 2 = interior. */
  shared: Map<string, number>;
}

function buildStreetGraph(patches: Poly[]): StreetGraph {
  const index = new Map<V, number>();
  const nodes: V[] = [];
  const adj: number[][] = [];
  const shared = new Map<string, number>();
  const id = (v: V) => {
    let i = index.get(v);
    if (i === undefined) {
      i = nodes.length;
      index.set(v, i);
      nodes.push(v);
      adj.push([]);
    }
    return i;
  };
  const ek = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const poly of patches) {
    for (let i = 0; i < poly.length; i++) {
      const a = id(poly[i]), b = id(poly[(i + 1) % poly.length]);
      if (a === b) continue;
      const k = ek(a, b);
      const seen = shared.get(k) ?? 0;
      shared.set(k, seen + 1);
      if (seen === 0) { adj[a].push(b); adj[b].push(a); }
    }
  }
  return { nodes, index, adj, shared };
}

/**
 * Cheapest path along the block boundaries.
 *
 * The cost is length, but scaled by a per-edge multiplier the caller supplies —
 * that is where "prefer streets that already exist" and "never route through the
 * castle" live. Straight A* on raw length gives every gate the same boring
 * radial, which is exactly what this replaced.
 */
function routeStreet(
  g: StreetGraph,
  from: number,
  to: number,
  weight: (a: number, b: number) => number,
): number[] | null {
  const n = g.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number) => dist(g.nodes[i], g.nodes[to]);
  gScore[from] = 0;
  // A binary heap is overkill here: a town has a few hundred nodes and the
  // linear scan is measurably faster than the bookkeeping.
  const open = new Set<number>([from]);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const i of open) {
      const f = gScore[i] + h(i);
      if (f < best) { best = f; cur = i; }
    }
    if (cur < 0) break;
    if (cur === to) {
      const path: number[] = [];
      for (let i = to; i >= 0; i = came[i]) path.push(i);
      return path.reverse();
    }
    open.delete(cur);
    closed[cur] = 1;
    for (const nb of g.adj[cur]) {
      if (closed[nb]) continue;
      const w = weight(cur, nb);
      if (!Number.isFinite(w)) continue;
      const tentative = gScore[cur] + dist(g.nodes[cur], g.nodes[nb]) * w;
      if (tentative >= gScore[nb]) continue;
      gScore[nb] = tentative;
      came[nb] = cur;
      open.add(nb);
    }
  }
  return null;
}

/** Nearest graph node to a point, restricted to nodes passing `ok`. */
function nearestNode(g: StreetGraph, at: V, ok?: (i: number) => boolean): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    if (ok && !ok(i)) continue;
    const d = dist(g.nodes[i], at);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Round off a routed path.
 *
 * A path along Voronoi edges is correct and looks like a circuit diagram. Two
 * Chaikin passes turn the corners into the slight curves a street worn by traffic
 * actually has, while keeping it inside the gap between the blocks.
 */
function smoothStreet(pts: V[]): V[] {
  let out = pts;
  for (let pass = 0; pass < 2; pass++) {
    if (out.length < 3) break;
    const next: V[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      next.push(lerp(out[i], out[i + 1], 0.25), lerp(out[i], out[i + 1], 0.75));
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Where a polyline crosses another, as a list of intersection points. */
function crossings(a: V[], b: V[]): { at: V; dir: V }[] {
  const out: { at: V; dir: V }[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    const p1 = a[i], p2 = a[i + 1];
    for (let j = 0; j < b.length - 1; j++) {
      const p3 = b[j], p4 = b[j + 1];
      const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
      const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({
        at: lerp(p1, p2, t),
        dir: norm(sub(p2, p1)),
      });
    }
  }
  return out;
}

/** Ordered boundary of a set of patches: edges used exactly once. */
function outerRing(patches: Poly[]): Poly {
  const count = new Map<string, { a: V; b: V; n: number }>();
  const ek = (a: V, b: V) => {
    const ka = `${a.x.toFixed(4)},${a.y.toFixed(4)}`;
    const kb = `${b.x.toFixed(4)},${b.y.toFixed(4)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const p of patches) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const k = ek(a, b);
      const hit = count.get(k);
      if (hit) hit.n++;
      else count.set(k, { a, b, n: 1 });
    }
  }
  const edges = [...count.values()].filter((e) => e.n === 1);
  if (!edges.length) return [];

  // Walk the boundary edges into a ring.
  const byPoint = new Map<string, { a: V; b: V }[]>();
  const pk = (v: V) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
  for (const e of edges) {
    for (const v of [e.a, e.b]) {
      let arr = byPoint.get(pk(v));
      if (!arr) byPoint.set(pk(v), (arr = []));
      arr.push(e);
    }
  }
  const used = new Set<{ a: V; b: V }>();
  const start = edges[0];
  const ringOut: V[] = [start.a, start.b];
  used.add(start);
  for (let guard = 0; guard < edges.length + 4; guard++) {
    const tail = ringOut[ringOut.length - 1];
    const cands = byPoint.get(pk(tail)) ?? [];
    const next = cands.find((e) => !used.has(e));
    if (!next) break;
    used.add(next);
    const other = pk(next.a) === pk(tail) ? next.b : next.a;
    if (pk(other) === pk(ringOut[0])) break;
    ringOut.push(other);
  }
  return ringOut;
}

// ---------------------------------------------------------------------------
// Building subdivision
// ---------------------------------------------------------------------------

interface AlleyParams {
  minSq: number;
  gridChaos: number;
  sizeChaos: number;
  emptyProb: number;
}

/**
 * Recursively bisect a block into building footprints.
 *
 * Every cut is perpendicular to the block's LONGEST edge — that alone keeps
 * footprints rectangular. The cut position is centred on the midpoint with a
 * spread proportional to `gridChaos`, so a planned quarter halves cleanly while
 * a slum splits 10/90. The recursion stops at a STOCHASTIC area threshold, so
 * one ward contains a spread of building sizes rather than a uniform grid.
 */
function createAlleys(poly: Poly, p: AlleyParams, rng: Rng, split = true, depth = 0): Poly[] {
  if (depth > 14 || poly.length < 3) return [];
  const a = area(poly);
  const e = longestEdge(poly);
  const spread = 0.8 * p.gridChaos;
  const ratio = (1 - spread) / 2 + rng() * spread;
  // Below 4× the minimum lot the cut goes strictly perpendicular. This is what
  // stops small buildings from becoming random quadrilaterals.
  const angleSpread = (Math.PI / 6) * p.gridChaos * (a < p.minSq * 4 ? 0 : 1);
  const angle = (rng() - 0.5) * 2 * angleSpread;
  const gap = split ? ALLEY : 0;

  const halves = bisect(poly, e, ratio, angle, gap);
  const out: Poly[] = [];
  for (const h of halves) {
    const ha = area(h);
    const threshold = p.minSq * Math.pow(2, 4 * p.sizeChaos * (rng() - 0.5));
    if (ha < threshold) {
      if (rng() >= p.emptyProb) out.push(h);
    } else {
      const u = rng();
      out.push(...createAlleys(h, p, rng, ha > p.minSq / Math.max(1e-3, u * u), depth + 1));
    }
  }
  return out;
}

/** Axis-locked subdivision for castles and cathedrals: every cut aligns to one
 *  of two fixed perpendicular axes, so the complex reads as built rather than
 *  subdivided. `fill` below 1 leaves courtyards and wings. */
function createOrthoBuilding(poly: Poly, minBlockSq: number, fill: number, rng: Rng): Poly[] {
  const angle = rng() * Math.PI;
  const build = (p: Poly, depth: number): Poly[] => {
    if (depth > 10 || p.length < 3) return [];
    if (area(p) < minBlockSq) return rng() < fill ? [p] : [];
    // Alternate between the two fixed axes rather than the polygon's own edges.
    const e = longestEdge(p);
    const ratio = 0.4 + rng() * 0.2;
    const edgeDir = Math.atan2(
      p[(e + 1) % p.length].y - p[e].y,
      p[(e + 1) % p.length].x - p[e].x,
    );
    const target = Math.abs(Math.cos(edgeDir - angle)) > 0.5 ? angle : angle + Math.PI / 2;
    const halves = bisect(p, e, ratio, target - edgeDir, 0);
    const out: Poly[] = [];
    for (const h of halves) out.push(...build(h, depth + 1));
    return out;
  };
  return build(poly, 0);
}

// ---------------------------------------------------------------------------
// Wards
// ---------------------------------------------------------------------------

const WARD_WEIGHTS: [WardType, number][] = [
  ['craftsmen', 40], ['merchant', 6], ['patriciate', 4], ['administration', 3],
  ['military', 3], ['slum', 11], ['park', 3],
];

/**
 * How many districts of a kind a town is allowed.
 *
 * Drawing each ward independently from a weighted bag is right for the common
 * ones and wrong for the singular ones: a town of twenty districts came out with
 * three cathedrals and three parks, or with none at all, because 4% of twenty is
 * a coin toss and nobody had told the generator that a cathedral is *the*
 * cathedral. Rare wards get a quota instead.
 */
function wardQuota(ward: WardType, innerCount: number): number {
  switch (ward) {
    case 'cathedral': return innerCount >= 10 ? 1 : 0;
    case 'park': return Math.max(1, Math.round(innerCount / 14));
    case 'military': return Math.max(1, Math.round(innerCount / 12));
    case 'administration': return Math.max(1, Math.round(innerCount / 15));
    case 'patriciate': return Math.max(1, Math.round(innerCount / 10));
    default: return Infinity;
  }
}

function pickWard(rng: Rng): WardType {
  const total = WARD_WEIGHTS.reduce((s, w) => s + w[1], 0);
  let r = rng() * total;
  for (const [w, n] of WARD_WEIGHTS) {
    r -= n;
    if (r <= 0) return w;
  }
  return 'craftsmen';
}

/**
 * How a district of this ward is built out, in metres of real frontage.
 *
 * One city unit is about four metres, and these numbers are chosen in metres
 * and divided back, because the thing being described is a house on a street
 * and not a parameter.
 *
 * A burgage — the standard town lot from the twelfth century on — is a narrow
 * street frontage with a long yard behind: five to eight metres wide, thirty to
 * eighty deep. The house sits at the front of it. That is the whole reason a
 * medieval street reads as a terrace: everyone's narrow end is on the road.
 */
interface BurgageParams {
  /** Street frontage of one lot, in city units. */
  frontage: number;
  /** How far back the house itself goes. The rest of the lot is yard. */
  houseDepth: number;
  /** Blocks are split with a lane until their inradius drops below this. */
  blockDepth: number;
  /** Clearance between neighbours. 0 = shared party walls, a dense old core. */
  party: number;
  /** Chance a lot is standing empty — a yard, a garden, a burnt plot. */
  emptyProb: number;
}

const M = 0.25; // one metre, in city units

/**
 * Envuelve un polígono como edificio, deduciendo su fachada.
 *
 * Sin un frente conocido, la orientación se lee del lado largo: un edificio
 * apaisado mira por su lado largo, que en una hilera de parcelas es la calle.
 * Los sitios que SÍ saben a qué calle dan pasan `facing` a mano y esto no se
 * usa; existe para el castillo, la catedral y las casetas del corral, que
 * salen de otros cortadores.
 */
function asBuilding(shape: Poly, kind: BuildingKind = 'house', facing?: number): Building {
  if (facing !== undefined) return { shape, kind, facing };
  if (shape.length < 2) return { shape, kind, facing: 0 };
  const e = longestEdge(shape);
  const a = shape[e], b = shape[(e + 1) % shape.length];
  return { shape, kind, facing: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Distancia de un punto a un SEGMENTO, no a un extremo. */
function distToSegment(p: V, a: V, b: V): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** ¿Pasa este trazado a menos de `r` del punto? */
function nearPath(path: V[], p: V, r: number): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    if (distToSegment(p, path[i], path[i + 1]) < r) return true;
  }
  return path.length === 1 && dist(path[0], p) < r;
}

function burgageParamsFor(ward: WardType, rng: Rng): BurgageParams {
  const r = () => rng();
  switch (ward) {
    // The rich build wide and set back, with gardens behind.
    case 'patriciate':
      return { frontage: (11 + 7 * r()) * M, houseDepth: (13 + 6 * r()) * M, blockDepth: (34 + 14 * r()) * M, party: 0.9 * M, emptyProb: 0.16 };
    case 'merchant':
      return { frontage: (8 + 4 * r()) * M, houseDepth: (12 + 5 * r()) * M, blockDepth: (30 + 12 * r()) * M, party: 0.4 * M, emptyProb: 0.09 };
    case 'administration':
      return { frontage: (14 + 8 * r()) * M, houseDepth: (15 + 6 * r()) * M, blockDepth: (34 + 10 * r()) * M, party: 0.6 * M, emptyProb: 0.05 };
    // The poor build narrow, deep and touching, and fill the yards in.
    case 'slum':
      return { frontage: (3.6 + 1.8 * r()) * M, houseDepth: (7 + 3 * r()) * M, blockDepth: (17 + 6 * r()) * M, party: 0, emptyProb: 0.03 };
    // Right inside the gate: inns, stables, carriers. Wide doors, deep yards.
    case 'gate':
      return { frontage: (7 + 5 * r()) * M, houseDepth: (11 + 5 * r()) * M, blockDepth: (26 + 10 * r()) * M, party: 0.3 * M, emptyProb: 0.08 };
    // Barracks: long ranges, not lots.
    case 'military':
      return { frontage: (20 + 14 * r()) * M, houseDepth: (11 + 4 * r()) * M, blockDepth: (40 + 16 * r()) * M, party: 1.6 * M, emptyProb: 0.22 };
    case 'outskirts':
      return { frontage: (9 + 8 * r()) * M, houseDepth: (9 + 5 * r()) * M, blockDepth: (30 + 20 * r()) * M, party: 2.4 * M, emptyProb: 0.5 };
    // Craftsmen: the ordinary town house, and most of the town.
    default:
      return { frontage: (5.5 + 2.8 * r()) * M, houseDepth: (9 + 4 * r()) * M, blockDepth: (22 + 9 * r()) * M, party: 0.15 * M, emptyProb: 0.05 };
  }
}

/**
 * Split a district into blocks with lanes between them.
 *
 * A district is not a block. It is the ground between four streets, and inside
 * it there are lanes, and between the lanes there are blocks. Skipping that
 * layer is what made the old plan a quilt: the Voronoi cell went straight into
 * a recursive cutter and came out as footprints, so nothing inside a district
 * had any relationship to the street outside it.
 *
 * The cut always goes right across, so every lane it opens meets the street at
 * both ends: a lane that dead-ends inside a block is a modern cul-de-sac, and a
 * town with no through-route from its middle to its wall is a town nobody could
 * get a cart out of.
 *
 * `area / perimeter` is the inradius of a circle and a good enough proxy for
 * any convex-ish block: it is what decides whether a perimeter of houses would
 * meet in the middle or leave a yard.
 */
function splitIntoBlocks(poly: Poly, p: BurgageParams, rng: Rng, depth = 0): Poly[] {
  if (poly.length < 3) return [];
  const a = area(poly);
  if (a < 1e-3) return [];
  const inradius = a / Math.max(1e-6, perimeter(poly)) * 2;
  if (depth >= 5 || inradius <= p.blockDepth) return [poly];
  const e = longestEdge(poly);
  // Off-centre, and slightly skewed: a lane laid dead down the middle at a
  // right angle is a grid, and a grid is the one thing a town that grew is not.
  const ratio = 0.42 + rng() * 0.16;
  const skew = (rng() - 0.5) * 0.34;
  /**
   * EL PRIMER CORTE ABRE UNA CALLE; LOS DE DENTRO, CALLEJONES.
   *
   * Todos los cortes abrían el mismo hueco: `ALLEY · 0,9–1,7`, o sea 2,2–4,1 m.
   * Por debajo de 3,6 m no pasa un carro, así que la mitad de las manzanas
   * quedaban colgadas de un callejón por el que no se podía sacar un carro —
   * medido en `city-quality`, sólo el 60,2 % de las casas tenía salida rodada,
   * y el reparto lo delataba: arrabal 38 %, plaza 100 %.
   *
   * En una ciudad real la jerarquía existe: el primer reparto de un distrito
   * abre una calle de servicio por la que entran las mercancías, y sólo los
   * repartos de dentro se conforman con un callejón de pie. Así que el hueco
   * decrece con la profundidad en vez de sortearse plano.
   */
  const lane = depth === 0
    ? REGULAR_STREET * (1.05 + rng() * 0.45)
    : depth === 1
      ? REGULAR_STREET * (0.95 + rng() * 0.25)
      : ALLEY * (0.9 + rng() * 0.8);
  const halves = bisect(poly, e, ratio, skew, lane);
  if (halves.length < 2) return [poly];
  return halves.flatMap((h) => splitIntoBlocks(h, p, rng, depth + 1));
}

/**
 * Build out one block as a perimeter of burgages around a yard.
 *
 * `ring` peels a band of `houseDepth` off the inside — that band IS the row of
 * houses, and what it leaves is the back yards, which is why the core comes
 * back as a court rather than being thrown away. Then each side of the band is
 * sliced at the frontage into individual lots.
 *
 * `ring` peels the SHORT edges first, so the corners resolve without two rows
 * fighting over the same ground: by the time a long side is peeled, the corner
 * it shares has already been taken.
 */
function burgageBlock(block: Poly, p: BurgageParams, rng: Rng): { houses: Building[]; yard: Poly | null } {
  const houses: Building[] = [];
  if (block.length < 3) return { houses, yard: null };
  const a = area(block);
  // Too small to have a front and a back: build it solid, the way an infilled
  // island in the middle of an old town actually is.
  if (a < p.houseDepth * p.frontage * 5) {
    if (a > p.frontage * p.frontage * 0.8) houses.push(asBuilding(block));
    return { houses, yard: null };
  }
  const { strips, court } = ring(block, p.houseDepth);
  /**
   * EL PASO DE CARRO.
   *
   * Una hilera de parcelas cerrada del todo deja el corral sin salida: la casa
   * da a la calle por delante, pero al corral, a la leñera y a la cuadra no se
   * llega más que atravesando la vivienda. Medido en `city-quality`: sólo el
   * 50,8 % de los edificios tenía un hueco contiguo al que se llegara desde una
   * puerta de la muralla, y el reparto lo delataba — arrabal 38 %, artesanos
   * 51 %, plaza del mercado 100 %.
   *
   * La solución es la que usaron de verdad: un paso cubierto que atraviesa la
   * hilera y mete el carro al corral. Uno por manzana, en una parcela sorteada
   * de la tira más larga, que es la que da a la mejor calle.
   */
  /**
   * UN PASO POR CADA FRENTE, NO UNO POR MANZANA.
   *
   * Con un solo paso, en la tira más larga, el corral quedaba colgado de un
   * único frente — y si esa tira daba a un callejón que a su vez estaba
   * cerrado, la bolsa entera quedaba sellada. Medido con la sonda sobre un
   * pueblo de tamaño 20: 192 bolsas de suelo sin salida, siete de ellas entre
   * 1 400 y 3 600 m², y no eran corrales de casa sino interiores de manzana
   * enteros, en barrios de artesanos, mercaderes y puerta.
   *
   * Un frente, un paso: es además lo normal en una manzana de perímetro, donde
   * cada calle que la rodea tiene su propio portalón al patio.
   */
  const pendAt = Math.floor(rng() * 8);
  /**
   * Y ANCHO DE CARRO, NO DE PARCELA.
   *
   * Una parcela de artesano mide 5,5–8,3 m de frente; una de arrabal, 3,6. Con
   * un solo lote saltado, el paso de un arrabal quedaba en 3,6 m y el de una
   * hilera apretada por debajo — y por debajo de eso no entra el carro que el
   * paso existe para meter. Medido con la sonda: 242 bolsas de suelo selladas
   * en un pueblo de tamaño 20, la mayor de 3 600 m², o sea distritos enteros y
   * no corrales sueltos.
   *
   * Así que el paso se mide en metros y se lleva por delante los lotes que
   * haga falta.
   */
  const pendLots = Math.max(1, Math.ceil((4.5 * M) / Math.max(1e-3, p.frontage)));
  for (const strip of strips) {
    // LA FACHADA DE LA TIRA ES LA CALLE. Se calcula una vez por tira, no por
    // parcela: todas las casas de una hilera dan a la misma calle, y deducirlo
    // parcela a parcela del lado más largo daba un tejado girado en cada lote
    // estrecho — que es el aspecto de grava en una bolsa que teníamos.
    const fe = longestEdge(strip);
    const fa = strip[fe], fb = strip[(fe + 1) % strip.length];
    const facing = Math.atan2(fb.y - fa.y, fb.x - fa.x);
    const lots = slicePlots(strip, p.frontage, p.party);
    for (let li = 0; li < lots.length; li++) {
      const lot = lots[li];
      if (lot.length < 3) continue;
      // El paso: esas parcelas no se construyen, y por ahí entra el carro.
      if (lots.length > pendLots) {
        const from = pendAt % lots.length;
        let skip = false;
        for (let k = 0; k < pendLots; k++) if ((from + k) % lots.length === li) skip = true;
        if (skip) continue;
      }
      if (rng() < p.emptyProb) continue;
      // A house does not fill its lot to the millimetre; the eaves gap is what
      // stops a whole row from reading as one long shed.
      const built = p.party > 0 ? lot : shrink(lot, 0.06 * M);
      const f = built.length >= 3 ? built : lot;
      if (area(f) > p.frontage * p.frontage * 0.25) houses.push(asBuilding(f, 'house', facing));
    }
  }

  /**
   * EL CORRAL NO ESTÁ VACÍO.
   *
   * Lo que queda dentro del anillo de casas son los corrales traseros, y en un
   * pueblo de verdad ahí hay leñeras, cuadras, letrinas, un horno, un pozo. Sin
   * nada, una manzana grande se lee como una plaza en blanco en mitad del
   * barrio — y en la lámina había una docena de esos agujeros.
   *
   * Se cuelgan del borde del corral, que es donde de verdad se construye: el
   * fondo de la parcela, contra la medianera. El centro se deja libre, porque
   * ése es el huerto.
   */
  if (court && area(court) > p.houseDepth * p.houseDepth * 6) {
    const c = centroid(court);
    const n = Math.min(7, Math.max(2, Math.round(area(court) / (p.houseDepth * p.houseDepth * 3.5))));
    for (let i = 0; i < n; i++) {
      const v = court[Math.floor(rng() * court.length)];
      const nx = court[(court.indexOf(v) + 1) % court.length] ?? v;
      // Sobre el borde, no en el vértice: una caseta clavada en la esquina de
      // todos los corrales delata la retícula que hay debajo.
      const on = lerp(v, nx, 0.2 + rng() * 0.6);
      const spot = lerp(on, c, 0.16 + rng() * 0.2);
      const w = p.frontage * (0.7 + rng() * 0.7);
      const d = p.houseDepth * (0.35 + rng() * 0.35);
      const ang = Math.atan2(nx.y - v.y, nx.x - v.x) + (rng() - 0.5) * 0.4;
      const shed = rect(w, d, spot, ang);
      // Recortada al corral: una caseta que se sale por detrás de su manzana
      // aparece en mitad de la calle de al lado.
      const inside = shed.every((sv) => contains(court, sv));
      if (inside) houses.push(asBuilding(shed, 'shed', ang));
    }
  }
  return { houses, yard: court };
}

function alleyParamsFor(ward: WardType, blockArea: number, rng: Rng): AlleyParams {
  const r = () => rng();
  switch (ward) {
    case 'merchant': return { minSq: 50 + 60 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.7, emptyProb: 0.15 };
    case 'patriciate': return { minSq: 80 + 30 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.8, emptyProb: 0.2 };
    case 'administration': return { minSq: 80 + 30 * r() * r(), gridChaos: 0.1 + 0.3 * r(), sizeChaos: 0.3, emptyProb: 0.04 };
    case 'military': return { minSq: Math.sqrt(blockArea) * (1 + r()), gridChaos: 0.1 + 0.3 * r(), sizeChaos: 0.3, emptyProb: 0.25 };
    case 'slum': return { minSq: 10 + 30 * r() * r(), gridChaos: 0.6 + 0.4 * r(), sizeChaos: 0.8, emptyProb: 0.03 };
    case 'gate': return { minSq: 10 + 50 * r() * r(), gridChaos: 0.5 + 0.3 * r(), sizeChaos: 0.7, emptyProb: 0.04 };
    case 'outskirts': return { minSq: 30 + 60 * r() * r(), gridChaos: 0.7 + 0.3 * r(), sizeChaos: 0.9, emptyProb: 0.55 };
    default: return { minSq: 10 + 80 * r() * r(), gridChaos: 0.5 + 0.2 * r(), sizeChaos: 0.6, emptyProb: 0.04 };
  }
}

// ---------------------------------------------------------------------------
// Geometría de apoyo
// ---------------------------------------------------------------------------

/** Distancia de un punto a un segmento. */
function segDist(q: V, a: V, b: V): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return dist(q, a);
  let t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
}

/**
 * Distancia de un punto a una polilínea, POR SEGMENTOS.
 *
 * La prueba de mojado era `river.some((rp) => dist(rp, v) < w)`: distancia a
 * los VÉRTICES. Con el cauce sintético los vértices caían cada 0,14·radio ≈ 5
 * unidades y el ancho era 0,09·radio ≈ 3,4, así que entre dos vértices quedaba
 * un hueco seco por el que se colaban casas y calles. Con un cauce que llega de
 * fuera el muestreo es arbitrario y el fallo es peor.
 */
function lineDist(q: V, line: V[]): number {
  if (!line.length) return Infinity;
  if (line.length === 1) return dist(q, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = segDist(q, line[i], line[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Recorta un polígono contra otro CONVEXO (Sutherland–Hodgman). */
function clipToConvex(poly: Poly, clip: Poly): Poly {
  if (poly.length < 3 || clip.length < 3) return [];
  const c = signedArea(clip) < 0 ? [...clip].reverse() : clip;
  let out = poly;
  for (let i = 0; i < c.length && out.length >= 3; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const e = sub(b, a);
    // Con este giro `rot90` apunta hacia DENTRO, y `clipHalfPlane` conserva la
    // mitad de producto escalar negativo: la normal que hay que pasarle es la
    // de fuera, que es la contraria.
    out = clipHalfPlane(out, a, { x: e.y, y: -e.x });
  }
  return out.length >= 3 && area(out) > 1e-9 ? out : [];
}

/**
 * ACHAFLANAR — lo que convierte una celda en una plaza.
 *
 * Una plaza medieval no es un polígono cualquiera: es un espacio cuyas esquinas
 * están comidas por las casas que dan a ella, y por eso se lee como recinto y no
 * como hueco. Sin esto el empedrado tenía exactamente el contorno de la celda de
 * Voronoi que había debajo, que es justo lo que delata al generador.
 *
 * Una de cada cuatro esquinas se deja en pico: un octógono perfecto es una
 * rotonda, no una plaza.
 */
function chamfer(poly: Poly, rng: Rng, amount = 0.16): Poly {
  if (poly.length < 3) return poly;
  const n = poly.length;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], v = poly[i], next = poly[(i + 1) % n];
    const lp = dist(v, prev), ln = dist(v, next);
    if (rng() < 0.25 || lp < 1.2 || ln < 1.2) { out.push(v); continue; }
    const k = Math.min(0.4, amount * (0.7 + rng() * 0.8));
    out.push(lerp(v, prev, k), lerp(v, next, k));
  }
  return out.length >= 3 ? out : poly;
}

/** Una cruz, como polígono cerrado. */
function crossPoly(c: V, arm: number, thick: number, ang: number): Poly {
  const raw = [
    [-thick, -arm], [thick, -arm], [thick, -thick], [arm, -thick],
    [arm, thick], [thick, thick], [thick, arm], [-thick, arm],
    [-thick, thick], [-arm, thick], [-arm, -thick], [-thick, -thick],
  ];
  const co = Math.cos(ang), si = Math.sin(ang);
  return raw.map(([x, y]) => ({ x: c.x + x * co - y * si, y: c.y + x * si + y * co }));
}

/**
 * EL MONUMENTO.
 *
 * `Square.monument` es UN polígono, así que la variedad tiene que estar en la
 * forma: el pozo es un brocal redondo, la fuente un pilón ochavado, la cruz de
 * término una cruz y la picota un poyo cuadrado. El dibujante no necesita saber
 * cuál es — los cuatro se pintan igual — pero el lector los distingue.
 */
function monumentFor(kind: SquareKind, c: V, span: number, rng: Rng): Poly | null {
  const roll = rng();
  const ang = rng() * Math.PI;
  // Un ensanche de ocho metros no lleva cruz de término: sería un estorbo.
  if (span < 6) return roll < 0.4 ? circle(0.4 + rng() * 0.25, 8, c) : null;
  if (kind === 'church') {
    return roll < 0.7
      ? crossPoly(c, 1.1 + rng() * 0.6, 0.28 + rng() * 0.14, ang)
      : circle(0.7 + rng() * 0.4, 10, c);
  }
  // En el muelle no hay pozo: hay el peso público y la grúa.
  if (kind === 'harbour') return roll < 0.55 ? rect(1.1 + rng(), 1.1 + rng(), c, ang) : null;
  if (roll < 0.32) return circle(0.55 + rng() * 0.35, 10, c);
  if (roll < 0.56) return circle(0.95 + rng() * 0.6, 8, c);
  if (roll < 0.82) return crossPoly(c, 1.1 + rng() * 0.7, 0.26 + rng() * 0.16, ang);
  return rect(0.85 + rng() * 0.5, 0.85 + rng() * 0.5, c, ang);
}

/**
 * LOS SOPORTALES.
 *
 * Van donde está el comercio: en el lado por el que entra la avenida — el que
 * cruza todo el que llega de fuera — y en el que mira al centro del pueblo, que
 * es el que da sombra por la tarde y el que ocupan los cambistas. Nunca en
 * todos: una plaza porticada por sus cuatro costados es una obra de una sola
 * campaña, y esto es un pueblo que creció.
 */
function arcadesOf(shape: Poly, toward: V, avenues: V[][], maxEdges: number, least = 0): [V, V][] {
  const p = signedArea(shape) < 0 ? [...shape].reverse() : shape;
  const c = centroid(p);
  // En la plaza del mercado "el lado que mira al centro del pueblo" no quiere
  // decir nada: la plaza ES el centro, y el término direccional salía negativo
  // en los cuatro lados — cero soportales en la única plaza que siempre los
  // tiene. Cuando el destino está dentro de la propia plaza sólo cuenta la
  // avenida, y el lado más largo se lleva el pórtico de todas formas.
  const useDir = dist(c, toward) > Math.sqrt(area(p)) * 0.6;
  const scored: { i: number; s: number }[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const L = dist(a, b);
    if (L < 2.5) continue; // un chaflán no lleva soportal
    const mid = lerp(a, b, 0.5);
    const e = sub(b, a);
    const nOut = { x: e.y / L, y: -e.x / L };
    let s = L * 0.02;
    if (useDir) {
      const to = norm(sub(toward, mid));
      s += nOut.x * to.x + nOut.y * to.y;
    }
    for (const av of avenues) {
      if (lineDist(mid, av) < 3) { s += 0.8; break; }
    }
    scored.push({ i, s });
  }
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  const keep = scored.filter((e, k) => e.s > 0.3 || k < least).slice(0, maxEdges);
  return keep.map(({ i }): [V, V] => [p[i], p[(i + 1) % p.length]]);
}

/**
 * Corta una lonja de la manzana por el lado que mira a `toward` y la devuelve
 * junto con lo que queda.
 *
 * Es como se abre de verdad una plaza secundaria: no se reserva una manzana
 * entera para ella, se le quita el frente a una. Y como el resto se construye
 * después por su perímetro, la hilera de casas que da a la plaza sale sola.
 */
function carveSquare(block: Poly, toward: V, depth: number): { square: Poly; rest: Poly } | null {
  if (block.length < 3) return null;
  const c = centroid(block);
  const dir = sub(toward, c);
  if (!dir.x && !dir.y) return null;
  const n = norm(dir);
  let tmin = Infinity, tmax = -Infinity;
  for (const v of block) {
    const t = (v.x - c.x) * n.x + (v.y - c.y) * n.y;
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }
  const d = Math.min(depth, (tmax - tmin) * 0.45);
  if (d < 1.5) return null;
  const planeP = { x: c.x + n.x * (tmax - d), y: c.y + n.y * (tmax - d) };
  const square = clipHalfPlane(block, planeP, { x: -n.x, y: -n.y });
  const rest = clipHalfPlane(block, planeP, n);
  if (square.length < 3 || rest.length < 3) return null;
  if (area(square) < 4 || area(rest) < 4) return null;
  return { square, rest };
}

/**
 * LA FACHADA DE LA PLAZA.
 *
 * Una plaza sin casas alrededor es un claro en el bosque. Los barrios de al
 * lado tienen que PRESENTARLE FACHADA, y en la manzana del mercado eso se
 * consigue construyendo la corona que queda entre el empedrado y el borde de la
 * manzana: una hilera por cada lado de la plaza, con el frente estrecho dando a
 * ella, que es exactamente la parcela más cara del pueblo.
 *
 * Los extremos de cada hilera se recogen `cut` unidades porque dos hileras que
 * doblan la esquina se pisan, y dos casas dentro de la misma casa es lo primero
 * que se ve en la lámina.
 */
function squareFrontage(square: Poly, block: Poly, depth: number, bp: BurgageParams, rng: Rng): Building[] {
  const out: Building[] = [];
  if (square.length < 3 || block.length < 3) return out;
  const p = signedArea(square) < 0 ? [...square].reverse() : square;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const e = sub(b, a);
    const L = Math.hypot(e.x, e.y);
    if (L < bp.frontage * 1.4) continue;
    const nOut = { x: e.y / L, y: -e.x / L };
    const cut = Math.min(L * 0.3, depth * 0.7);
    const a2 = lerp(a, b, cut / L), b2 = lerp(b, a, cut / L);
    const strip = clipToConvex([
      a2, b2,
      { x: b2.x + nOut.x * depth, y: b2.y + nOut.y * depth },
      { x: a2.x + nOut.x * depth, y: a2.y + nOut.y * depth },
    ], block);
    if (strip.length < 3) continue;
    const facing = Math.atan2(e.y, e.x);
    for (const lot of slicePlots(strip, bp.frontage, bp.party)) {
      if (lot.length < 3) continue;
      // Dando a la plaza no hay solares vacíos: es el suelo más caro del pueblo.
      if (rng() < bp.emptyProb * 0.3) continue;
      const built = bp.party > 0 ? lot : shrink(lot, 0.06 * M);
      const f = built.length >= 3 ? built : lot;
      if (area(f) > bp.frontage * bp.frontage * 0.3) out.push(asBuilding(f, 'house', facing));
    }
  }
  return out;
}

/**
 * Reparte los oficios.
 *
 * Convierte en `kind` el edificio más grande (o el más pequeño) de los que
 * siguen siendo casa. Es un pase POSTERIOR al parcelado a propósito: el sitio
 * de una fragua no lo decide el cortador de manzanas, lo decide dónde está la
 * manzana — junto al río, en la puerta, dando al mercado.
 */
function promote(
  list: Building[],
  kind: BuildingKind,
  opts?: { smallest?: boolean; where?: (b: Building) => boolean },
): boolean {
  let best = -1, bestA = opts?.smallest ? Infinity : -Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.kind !== 'house') continue;
    if (opts?.where && !opts.where(b)) continue;
    const a = area(b.shape);
    if (opts?.smallest ? a < bestA : a > bestA) { bestA = a; best = i; }
  }
  if (best < 0) return false;
  list[best] = { ...list[best], kind };
  return true;
}

/**
 * LA LENGUA DEL PUEBLO.
 *
 * `generateCity` recibe una cultura, no una familia de lenguas: el árbol
 * lingüístico del mundo lo construye `buildHumanGeography` y no llega hasta
 * aquí. Así que se deriva una familia por cultura — determinista, porque
 * depende sólo del identificador — y se guarda: todos los pueblos nórdicos
 * acuñan en la misma lengua, que es justo lo que hace que una costa entera
 * suene a la misma gente.
 *
 * Lo IDEAL sería que el puente pasara la lengua viva del mundo (ver el informe:
 * `language?: Language`), y entonces los barrios serían cognados de los nombres
 * de los pueblos vecinos. Mientras no llegue, esto es consistente y no inventa
 * una lengua distinta por semilla.
 */
const TONGUES = new Map<CultureId, { lang: Language; proto: Language }>();
function tongueFor(culture: CultureId): { lang: Language; proto: Language } {
  let hit = TONGUES.get(culture);
  if (!hit) {
    const family = buildLanguageFamily(`tongue:${culture}`, 3);
    hit = { lang: family.living[0], proto: family.proto };
    TONGUES.set(culture, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function generateCity(params: CityParams): CityPlan {
  const p = { ...DEFAULT_CITY, ...params };
  const rng = createRng(p.seed, 'city');
  const nInner = Math.max(4, Math.round(p.size));
  // Generate a generous surplus so the inner set is fully surrounded by outer
  // patches — the wall needs neighbours on every side to have somewhere to go.
  const nTotal = nInner * 8;

  let sites = spiralSites(rng, nTotal);
  const span = Math.max(...sites.map((s) => Math.hypot(s.x, s.y))) * 1.15 + 20;
  const bounds: Poly = [
    { x: -span, y: -span }, { x: span, y: -span }, { x: span, y: span }, { x: -span, y: span },
  ];

  // ---- how far the town reaches, in each direction ------------------------
  //
  // WHY EVERY TOWN USED TO BE A DISC. `spiralSites` emits points at a radius
  // that grows monotonically with the index, so the array IS a sort by
  // distance from the middle — and membership was `i < nInner`, i.e. "the
  // nInner points nearest the centre". The union of the Voronoi cells of the
  // N nearest points of a radially uniform spiral is a circle. Lloyd
  // relaxation evened it further and `smoothPoly(…, 0.32)` rounded off what
  // was left. Nothing anywhere ever asked which way anything was.
  //
  // Membership is now a RACE against a growth field: a site belongs if it is
  // near the centre RELATIVE TO how far the town grows that way. Towns grow
  // along their river and along their shore, they do not grow into the water,
  // they climb a hillside reluctantly, and they are lobed rather than round
  // because land is. That is the whole difference between a plan and a token.
  const R0 = 10 + nInner * 2.5; // the nominal radius the spiral would have given
  const irregularity = Math.max(0, Math.min(1, p.irregularity ?? 0.55));

  const norm = (v: V): V => {
    const m = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / m, y: v.y / m };
  };
  const pickDir = (given: V | null | undefined, fallbackAngle: number): V =>
    given && (given.x || given.y) ? norm(given) : { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };

  // The sea: a half-plane. Everything on the far side of it is water, and the
  // town simply cannot grow there.
  // Angular lobes: three harmonics, so the outline has a big asymmetry, a
  // couple of bays and a fringe — and no axis of symmetry at all. Declared
  // before the water because the WATERLINE has to be placed at the reach the
  // town actually has in that direction: pinned at a flat 0,62·R0 it landed
  // beyond a shrunken lobe, leaving a strip of empty land between the town and
  // its own sea — no waterfront, no quay, no clipped wall, a "port" that never
  // touches the water.
  const lobes = [1, 2, 3].map((w, k) => ({
    w, phase: rng() * Math.PI * 2, amp: [0.5, 0.32, 0.18][k],
  }));
  const lobeAt = (theta: number): number => {
    let g = 1;
    for (const l of lobes) g += irregularity * l.amp * Math.cos(l.w * theta + l.phase);
    return Math.max(0.22, g);
  };

  /**
   * EL LITORAL DE VERDAD MANDA SOBRE EL SEMIPLANO.
   *
   * Cuando el mundo entrega la costa, el semiplano deja de ser un dato y pasa a
   * ser un RESUMEN de ella: la recta se coloca en el punto más tierra adentro
   * que alcanza el agua dentro del alcance del pueblo, así que todo lo que el
   * litoral dibuja como mar queda del lado mojado y no hay una sola casa
   * pintada sobre el agua. Al revés — encajar el litoral en un semiplano ya
   * elegido — es lo que dibujaba la ensenada por dentro de la muralla.
   */
  const givenShore = p.coast && p.shoreLine && p.shoreLine.length >= 2 ? p.shoreLine : null;
  const coastAxis = p.coast
    ? (() => {
      if (givenShore) {
        // El sentido de la normal se decide por el pueblo: el centro tiene que
        // quedar en seco, pase lo que pase con el orden de los puntos.
        const a = givenShore[0], b = givenShore[givenShore.length - 1];
        let n = p.coastDir && (p.coastDir.x || p.coastDir.y)
          ? norm(p.coastDir)
          : norm({ x: b.y - a.y, y: -(b.x - a.x) });
        let projs = givenShore.map((v) => v.x * n.x + v.y * n.y);
        if (Math.min(...projs) < 0) { n = { x: -n.x, y: -n.y }; projs = projs.map((t) => -t); }
        // Sólo el tramo que pasa por delante del pueblo: una ría a tres radios
        // de aquí no tiene por qué estrangular el plano.
        const near = givenShore
          .map((v, i) => ({ t: projs[i], along: Math.abs(-v.x * n.y + v.y * n.x) }))
          .filter((s) => s.along < R0 * 1.4)
          .map((s) => s.t);
        const d = Math.min(...(near.length ? near : projs));
        return { n, d: Math.max(R0 * 0.18, Math.min(R0 * 1.2, d)) };
      }
      const n = pickDir(p.coastDir, rng() * Math.PI * 2);
      const theta = Math.atan2(n.y, n.x);
      // 0,72 of the reach: the sea bites into the plan rather than grazing it.
      return { n, d: R0 * lobeAt(theta) * 0.72 };
    })()
    : null;
  // The river: an axis with an off-centre channel, so it never runs through
  // the market square (the two definitions collided for years — see below).
  //
  // Con un cauce de verdad el eje se MIDE sobre él: la dirección de sus
  // extremos y el desvío medio respecto del centro. Así el campo de crecimiento
  // —que abarata lo que va paralelo al agua y encarece la otra orilla— habla
  // del mismo río que después se dibuja, y no de uno inventado a su lado.
  const givenCourse = p.river && p.riverCourse && p.riverCourse.line.length >= 2 ? p.riverCourse : null;
  const riverAxis = p.river
    ? (() => {
      if (givenCourse) {
        const l = givenCourse.line;
        const dir = norm(sub(l[l.length - 1], l[0]));
        const perp = { x: -dir.y, y: dir.x };
        let off = 0;
        for (const v of l) off += v.x * perp.x + v.y * perp.y;
        return { dir, perp, off: off / l.length };
      }
      const dir = pickDir(
        p.riverDir,
        coastAxis ? Math.atan2(coastAxis.n.y, coastAxis.n.x) + (rng() - 0.5) * 0.7 : rng() * Math.PI,
      );
      const perp = { x: -dir.y, y: dir.x };
      const off = (rng() < 0.5 ? -1 : 1) * R0 * (0.22 + rng() * 0.3);
      return { dir, perp, off };
    })()
    : null;
  const slopeDir = p.slopeDir && (p.slopeDir.x || p.slopeDir.y) ? norm(p.slopeDir) : null;
  const slopeAmount = Math.max(0, Math.min(1, p.slopeAmount ?? 0));

  /** How far the town reaches towards `v`, as a multiple of R0. */
  const growth = (v: V): number => {
    const r = Math.hypot(v.x, v.y);
    if (r < 1e-6) return 1;
    const u = { x: v.x / r, y: v.y / r };
    let g = lobeAt(Math.atan2(u.y, u.x));

    if (coastAxis) {
      // Beyond the waterline there is no town, at any price.
      if (v.x * coastAxis.n.x + v.y * coastAxis.n.y > coastAxis.d) return 0;
      // Along the shore, though, a port sprawls: quays, yards, warehouses.
      const across = Math.abs(u.x * coastAxis.n.x + u.y * coastAxis.n.y);
      g *= 1 + 0.28 * (1 - across);
    }
    if (riverAxis) {
      // Along the water is the cheap direction — that is where the wharves,
      // the mills and the road out both ways already are.
      const along = Math.abs(u.x * riverAxis.dir.x + u.y * riverAxis.dir.y);
      g *= 0.80 + 0.48 * along;
      // The far bank is a bridge away, so it gets a quarter, not a half.
      const side = v.x * riverAxis.perp.x + v.y * riverAxis.perp.y;
      if (Math.sign(side - riverAxis.off) !== Math.sign(-riverAxis.off)) g *= 0.55;
    }
    if (slopeDir) {
      // Uphill is dear: carts, wells and drains all argue against it.
      const up = u.x * slopeDir.x + u.y * slopeDir.y;
      g *= 1 - slopeAmount * 0.5 * Math.max(0, up);
    }
    return Math.max(0.22, g);
  };

  // The race. Site 0 sits on the origin and always wins it.
  const ranked = sites
    .map((v, i) => {
      const g = growth(v);
      return { i, cost: g <= 0 ? Infinity : Math.hypot(v.x, v.y) / (R0 * g) };
    })
    .sort((a, b) => a.cost - b.cost);
  const chosen = new Set<number>();
  for (const { i, cost } of ranked) {
    if (chosen.size >= nInner) break;
    if (!Number.isFinite(cost)) break; // everything left is in the water
    chosen.add(i);
  }
  // A town squeezed hard by its water can run out of dry ground; it is still a
  // town, just a smaller one, and forcing it into the sea would be worse.

  // Relax the CHOSEN sites, not the first nInner·2 by index: with a lobed town
  // those are no longer the same set, and relaxing by index would even out
  // ground the town never took while leaving its own middle ragged.
  for (let k = 0; k < 2; k++) sites = relax(sites, bounds, (i) => chosen.has(i));

  const cells = voronoi(sites, bounds);
  const patches: Patch[] = [];
  const shapes: Poly[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].length < 3) continue;
    shapes.push(cells[i]);
    patches.push({
      shape: cells[i],
      withinCity: chosen.has(i),
      withinWalls: p.walls && chosen.has(i),
      ward: 'outskirts',
      buildings: [],
      courts: [],
    });
  }
  weldVertices(shapes);

  /**
   * LA CIUDAD ES LO QUE PUEDE LLEGAR AL MERCADO. Con mar, la elección de
   * distritos por coste puede quedarse una cuña al otro lado de la
   * desembocadura: suelo seco, coste finito, y ningún camino hasta el resto
   * del pueblo que no cruce el MAR — que las calles nunca cruzan (peso
   * infinito), así que ningún puente la alcanzará jamás. El censo de bolsas
   * la midió: 3 725 m² de suelo urbano sellado en río+costa 20, y una puerta
   * ciega (costa 20#0) abierta hacia esa cuña. Se poda AQUÍ, antes de la
   * muralla, para que ni el lienzo ni las puertas ni los barrios lleguen a
   * contar con ella. La vecindad es por vértices soldados compartidos; un
   * cruce de RÍO se permite — pesa ×3,2 y trae puente, y los pueblos partidos
   * por su río son legítimos y buenos.
   */
  if (coastAxis) {
    const cand = patches.filter((q) => q.withinCity);
    if (cand.length > 1) {
      const seaS = (v: V) => v.x * coastAxis.n.x + v.y * coastAxis.n.y - coastAxis.d;
      const iOf = new Map<Patch, number>(cand.map((q, i) => [q, i]));
      const byVert = new Map<V, number[]>();
      for (const q of cand) {
        for (const v of q.shape) {
          const l = byVert.get(v);
          if (l) l.push(iOf.get(q)!); else byVert.set(v, [iOf.get(q)!]);
        }
      }
      // Un par de distritos conecta si comparte ≥2 vértices soldados y al
      // menos uno de ellos pisa tierra (con 1,2 u de margen): así dos vecinos
      // costeros siguen unidos por su lado seco y nadie conecta POR el agua.
      const touch = new Map<number, number>(); // par (a*n+b) → nº de vértices secos compartidos
      const pares = new Map<number, number>(); // par → nº de vértices compartidos
      const n = cand.length;
      for (const [v, list] of byVert) {
        if (list.length < 2) continue;
        const dry = seaS(v) < -0.3;
        for (let a = 0; a < list.length; a++) {
          for (let b = a + 1; b < list.length; b++) {
            const key = Math.min(list[a], list[b]) * n + Math.max(list[a], list[b]);
            pares.set(key, (pares.get(key) ?? 0) + 1);
            if (dry) touch.set(key, (touch.get(key) ?? 0) + 1);
          }
        }
      }
      // Semilla: el distrito más cercano al origen del crecimiento, que es el
      // centro histórico por construcción.
      let seed = 0, sd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(centroid(cand[i].shape).x, centroid(cand[i].shape).y);
        if (d < sd) { sd = d; seed = i; }
      }
      const seen = new Uint8Array(n);
      const stack = [seed];
      seen[seed] = 1;
      while (stack.length) {
        const a = stack.pop()!;
        for (let b = 0; b < n; b++) {
          if (seen[b] || a === b) continue;
          const key = Math.min(a, b) * n + Math.max(a, b);
          if ((pares.get(key) ?? 0) >= 2 && (touch.get(key) ?? 0) >= 1) {
            seen[b] = 1;
            stack.push(b);
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (!seen[i]) {
          cand[i].withinCity = false;
          cand[i].withinWalls = false;
        }
      }
    }
  }

  const inner = patches.filter((q) => q.withinCity);
  const center = centroid(inner[0]?.shape ?? [{ x: 0, y: 0 }]);

  // ---- curtain wall -------------------------------------------------------
  /**
   * DOS ANILLOS, y la diferencia entre ellos era un fallo.
   *
   * `wallRaw` son los vértices soldados: los MISMOS objetos que están en las
   * manzanas y, por tanto, en el grafo de calles. `wallRing` es el suavizado
   * que se dibuja, y `smoothPoly` devuelve puntos nuevos — un objeto distinto
   * en la misma posición aproximada.
   *
   * Todo lo que necesite preguntar "¿quién más tiene este vértice?" tiene que
   * usar el crudo. Cuando no lo hacía, el barrio 'puerta' no se asignaba nunca
   * (0 de 6 puertas en tres semillas) y cada avenida arrancaba en el nodo más
   * cercano en vez de en la puerta, que es exactamente por qué las avenidas no
   * llegaban a tocarla.
   *
   * `smoothPoly` conserva el índice — un punto de salida por punto de entrada —
   * así que la correspondencia entre los dos anillos es la posición.
   */
  let wallRaw = outerRing(inner.map((q) => q.shape));
  let wallRing = wallRaw.length >= 6 ? smoothPoly(wallRaw, 0.32) : wallRaw;
  const radius = wallRing.length
    ? wallRing.reduce((m, v) => Math.max(m, dist(v, center)), 0)
    : 40;

  // ---- coast and river ----------------------------------------------------
  // Both were decided BEFORE the outline, because the outline grew around
  // them. What is left here is only to express them as geometry, at the radius
  // the town actually reached.
  const coast: CityPlan['coast'] = coastAxis
    ? { p: { x: coastAxis.n.x * coastAxis.d, y: coastAxis.n.y * coastAxis.d }, n: coastAxis.n }
    : null;

  let river: V[] | null = null;
  if (riverAxis) {
    const { dir, perp, off } = riverAxis;
    const L = radius * 2.8;
    let pts: V[];
    if (givenCourse) {
      // El cauce del mundo, remuestreado a un paso fino: los cortes de manzana
      // y el peso del A* siguen preguntando por vértices, y un tramo recto de
      // dos puntos dejaría medio pueblo sin mojar.
      pts = [];
      const step = Math.max(1.5, radius * 0.06);
      const l = givenCourse.line;
      for (let i = 0; i < l.length - 1; i++) {
        const d = dist(l[i], l[i + 1]);
        const n = Math.max(1, Math.round(d / step));
        for (let k = 0; k < n; k++) pts.push(lerp(l[i], l[i + 1], k / n));
      }
      pts.push(l[l.length - 1]);
    } else {
      pts = [];
      for (let t = -1; t <= 1.0001; t += 0.1) {
        const wobbleAmt = off + Math.sin(t * 5 + rng() * 0.4) * radius * 0.12;
        pts.push({
          x: dir.x * L * t * 0.5 + perp.x * wobbleAmt,
          y: dir.y * L * t * 0.5 + perp.y * wobbleAmt,
        });
      }
    }
    river = pts;
    if (coast) {
      // A river runs TO the sea, not across it: cut the channel at the
      // waterline, keeping the inland run plus one vertex so it visibly meets
      // the water.
      const wet = (v: V) => (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y > 0;
      const startsWet = wet(pts[0]);
      const ordered = startsWet ? [...pts].reverse() : pts;
      const cutAt = ordered.findIndex(wet);
      river = cutAt < 0 ? ordered : ordered.slice(0, cutAt + 1);
      if (river.length < 3) river = null;
    }
  }
  /**
   * El ancho nominal del cauce.
   *
   * Sube aquí desde la sección del mercado porque el foso también necesita
   * saber por dónde hay agua, y el foso se traza con la muralla. Cuando el
   * mundo entrega el río, el ancho es el SUYO: un plano que dibuja un arroyo
   * donde el atlas dibuja un río navegable es dos mapas del mismo sitio.
   */
  const riverWidth = givenCourse ? Math.max(1.2, givenCourse.width) : radius * 0.09;

  // A wall does not run into the sea. Clip the ring to the dry arc so it ends at
  // the waterline on both sides, the way a real harbour town's does — the sea
  // wall was the harbour chain, not masonry.
  let wallClosed = true;
  if (coast && wallRing.length >= 6) {
    const dry = (v: V) => (v.x - coast!.p.x) * coast!.n.x + (v.y - coast!.p.y) * coast!.n.y < 0;
    const n = wallRing.length;
    if (wallRing.some((v) => !dry(v)) && wallRing.some(dry)) {
      /**
       * EL TRAMO SECO MÁS LARGO, no el primero.
       *
       * Cogía el primer vértice seco cuyo anterior estaba mojado y se quedaba
       * con ESA racha. Un anillo que cruza la línea de agua dos veces —que es
       * lo normal en cuanto el litoral no pasa exactamente por un vértice—
       * tiene una racha de tres vértices y otra de veintidós, y salía la de
       * tres: por debajo de seis no hay puertas, y sin puertas no hay avenidas
       * ni caminos. Dos de catorce semillas costeras daban un pueblo de
       * veintidós manzanas sin muralla, sin puertas y sin un solo camino.
       */
      let start = -1, best = 0;
      for (let i = 0; i < n; i++) {
        if (!dry(wallRing[i]) || dry(wallRing[(i - 1 + n) % n])) continue;
        let run = 0;
        while (run < n && dry(wallRing[(i + run) % n])) run++;
        if (run > best) { best = run; start = i; }
      }
      if (start >= 0) {
        const arc: V[] = [];
        for (let k = 0; k < n; k++) {
          const v = wallRing[(start + k) % n];
          if (!dry(v)) break;
          arc.push(v);
        }
        if (arc.length >= 3) {
          // El crudo se recorta por los MISMOS índices, o los dos anillos
          // dejan de corresponderse justo en los pueblos con puerto.
          const rawArc: V[] = [];
          for (let k = 0; k < arc.length; k++) rawArc.push(wallRaw[(start + k) % n]);
          wallRing = arc;
          wallRaw = rawArc;
          wallClosed = false;
        }
      }
    }
  }

  // ---- gates --------------------------------------------------------------
  // Gate count follows the reference default, thinned on a coast where part of
  // the perimeter is water.
  const gates: V[] = [];
  /**
   * El mismo hueco de la muralla, dicho dos veces.
   *
   * `gates[i]` es donde se DIBUJA la puerta, sobre la línea suave de la
   * muralla. `gateAnchors[i]` es el vértice soldado que está en esa esquina:
   * el que las manzanas comparten y el que el grafo de calles conoce por
   * identidad. Separar las dos cosas es lo que hace que una avenida pueda
   * arrancar de verdad en la puerta.
   */
  const gateAnchors: V[] = [];
  /**
   * EL RUMBO DE SALIDA DE CADA PUERTA, y de dónde sale.
   *
   * Las puertas se colocaban dando un número aleatorio de vértices desde un
   * vértice aleatorio, y el camino de salida era un paseo al azar de nueve
   * pasos (`ang += (rng()-0.5)*0.35`) que se perdía en campo abierto. El mundo
   * sabía que la calzada entra por el nordeste y nadie se lo preguntaba nunca:
   * la lámina de la comarca dibujaba un camino llegando a un lienzo ciego.
   *
   * `gateRoad[i]` es verdadero cuando esa puerta la abre un camino de verdad —
   * son las que se llevan la barbacana, porque son las que hay que defender.
   */
  const gateBearings: number[] = [];
  const gateIdx: number[] = [];
  const gateRoad: boolean[] = [];
  if (wallRing.length >= 6) {
    const n = wallRing.length;
    const want = Math.max(1, Math.min(6, 2 + Math.floor((nInner / 12) * (p.coast ? 0.75 : 1))));
    /**
     * CON MARGEN Y CON RÍO, no sólo el signo del mar. «Never put a gate on
     * the waterfront» comprobaba el signo del semiplano, y el signo a trece
     * centímetros del agua sigue siendo el correcto: el banco midió una
     * puerta con 0,5 m de tierra por delante (costa 20) y otra a 14,9 m del
     * eje de un río de 38,1 m (río+costa 20) — seca por signo, dentro del
     * cauce DIBUJADO. Una puerta pide 1,5 u (6 m) de tierra hasta el mar y
     * quedar fuera del semiancho del cauce más una unidad; si ese vértice no
     * existe, la vuelta de emplazamiento sigue girando hasta el que sí.
     */
    const dryHere = (v: V) =>
      (!coast || (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y < -1.5)
      && (!river || !river.some((rp) => dist(rp, v) < riverWidth * 0.5 + 1));
    /**
     * Y CON SUELO DE PUEBLO DETRÁS. La puerta se dibuja sobre la línea SUAVE
     * de la muralla, y en una esquina CÓNCAVA el suavizado corta la escotadura
     * por dentro: el punto dibujado cae a 4–7 u del vértice soldado, sobre un
     * distrito de labranza que no es suelo urbano. Medido con la sonda de
     * puertas ciegas: las tres puertas que el mercado no alcanzaba en carro
     * (interior 40#1, río 40#1, costa 40#2) eran exactamente esto — una isla
     * de 315 celdas, el disco de la puerta flotando en tierra de nadie, con el
     * distrito más cercano a 4,1–6,6 u. Una puerta es un agujero entre la
     * ciudad y el campo; si a un lado no hay ciudad, no es sitio para puerta.
     */
    const townFloorBehind = (v: V) =>
      inner.some((q) => q.shape.length >= 3
        && (contains(q.shape, v) || q.shape.some((s0, si) => {
          const s1 = q.shape[(si + 1) % q.shape.length];
          const dx = s1.x - s0.x, dy = s1.y - s0.y;
          const ll = dx * dx + dy * dy || 1e-9;
          let t = ((v.x - s0.x) * dx + (v.y - s0.y) * dy) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = v.x - (s0.x + dx * t), ey = v.y - (s0.y + dy * t);
          return ex * ex + ey * ey < 2.2 * 2.2;
        })));
    // Separación mínima, en vértices del anillo: dos puertas en la misma esquina
    // son un boquete.
    const minSep = Math.max(2, Math.floor((n / (want + 1)) * 0.55));
    const bearingOf = (i: number) => Math.atan2(wallRing[i].y - center.y, wallRing[i].x - center.x);
    const free = (i: number) => gateIdx.every((t) => {
      const d = Math.abs(t - i);
      return (wallClosed ? Math.min(d, n - d) : d) >= minSep;
    });
    const place = (i: number, bearing: number, fromRoad: boolean) => {
      gates.push(wallRing[i]);
      gateAnchors.push(wallRaw[i] ?? wallRing[i]);
      gateBearings.push(bearing);
      gateIdx.push(i);
      gateRoad.push(fromRoad);
    };

    // 1. Las puertas que el mundo pide: el vértice cuyo rumbo desde el centro
    //    mejor apunta al camino que llega.
    for (const b of p.roadBearings ?? []) {
      if (!Number.isFinite(b) || gates.length >= want) break;
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!dryHere(wallRing[i]) || !free(i) || !townFloorBehind(wallRing[i])) continue;
        const s = Math.cos(bearingOf(i) - b);
        if (s > bestScore) { bestScore = s; best = i; }
      }
      // Un camino que llega por donde el pueblo tiene agua no abre puerta: entra
      // por el muelle. A más de 70° del rumbo ya no es la misma carretera.
      if (best >= 0 && bestScore > 0.34) place(best, b, true);
    }

    // 2. El resto, con la regla de espaciado de siempre. Se dan más vueltas que
    //    puertas quedan porque un vértice puede estar mojado o pegado a otra.
    const spacingIdx = Math.max(2, Math.floor(n / (want + 1)));
    let idx = Math.floor(rng() * n);
    for (let g = 0; g < want * 3 && gates.length < want; g++) {
      const at = ((idx % n) + n) % n;
      if (dryHere(wallRing[at]) && free(at) && townFloorBehind(wallRing[at])) place(at, bearingOf(at), false);
      idx += spacingIdx + Math.floor(rng() * 2);
    }
  }

  // ---- la muralla como fábrica --------------------------------------------
  /**
   * TORRES DONDE HACEN FALTA, NO EN CADA VÉRTICE.
   *
   * `towers` era `wallRing.filter(no es puerta)`: veinticuatro torres en un
   * pueblo de cuatro mil quinientas almas, ensartadas a intervalos idénticos
   * porque el relajado de Lloyd había igualado el espaciado de los vértices.
   * Una muralla real se refuerza en las ESQUINAS — donde el lienzo gira y el
   * defensor no ve el pie del muro — y, si el tramo recto se alarga, cada tiro
   * de ballesta para poder batirlo de flanco.
   *
   * `plan.towers` pasa a ser la lista elegida: sigue siendo la lectura barata,
   * pero ahora dice lo mismo que `fort`.
   */
  let fort: Fortification | null = null;
  let towers: V[] = [];
  if (p.walls && wallRing.length >= 6) {
    const n = wallRing.length;
    const prevI = (i: number) => (wallClosed ? (i - 1 + n) % n : Math.max(0, i - 1));
    const nextI = (i: number) => (wallClosed ? (i + 1) % n : Math.min(n - 1, i + 1));
    // Una unidad son cuatro metros: de dos metros de fábrica en una villa a
    // cuatro y medio en una plaza fuerte.
    const thickness = Math.min(1.15, 0.45 + nInner * 0.012);
    const gateSetIdx = new Set(gateIdx);
    /** La normal hacia campo, por la bisectriz de los dos lienzos. */
    const outAt = (i: number): V => {
      const t = norm(sub(wallRing[nextI(i)], wallRing[prevI(i)]));
      let o = { x: t.y, y: -t.x };
      const r = sub(wallRing[i], center);
      if (o.x * r.x + o.y * r.y < 0) o = { x: -o.x, y: -o.y };
      return o;
    };
    /** Cuánto gira el lienzo en este vértice, en radianes. */
    const turnAt = (i: number): number => {
      const a = sub(wallRing[i], wallRing[prevI(i)]);
      const b = sub(wallRing[nextI(i)], wallRing[i]);
      return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
    };

    // Longitud acumulada del lienzo, para medir separaciones POR EL MURO y no
    // en línea recta: dos vértices a diez unidades a vuelo de pájaro pueden
    // estar a sesenta de muralla si entre medias hay un saliente.
    const arc: number[] = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + dist(wallRing[i - 1], wallRing[i]));
    const total = wallClosed ? arc[n - 1] + dist(wallRing[n - 1], wallRing[0]) : arc[n - 1];
    const forward = (a: number, b: number) => ((arc[b] - arc[a]) % total + total) % total;
    const sepAlong = (a: number, b: number) => {
      const d = Math.abs(arc[a] - arc[b]);
      return wallClosed ? Math.min(d, total - d) : d;
    };

    // Una torre cada ~140 m, que es el intervalo con el que se ven las murallas
    // de verdad a esta escala. En la villa de 4.500 almas del informe eso son
    // trece o catorce torres, no veinticuatro.
    // El tope de 55 importa: sin él el intervalo crece con el pueblo y una
    // ciudad grande acababa con MENOS torres que una villa (10 en un perímetro
    // de 939 unidades). Una plaza fuerte tiene más muralla y más torres.
    const spacing = Math.max(26, Math.min(55, radius * 0.34));
    const want = Math.max(4, Math.min(n, Math.round(total / spacing)));
    const minSep = spacing * 0.55;
    const style = rng();
    const chosen: number[] = [];
    const okSep = (i: number) => chosen.every((j) => sepAlong(i, j) >= minSep)
      && gateIdx.every((j) => sepAlong(i, j) >= minSep * 0.8);

    // LAS ESQUINAS PRIMERO. Donde el lienzo gira es donde el defensor no ve el
    // pie de su propio muro, y es donde se pone el cubo; el intervalo regular
    // sólo rellena después lo que quede.
    const corners = [];
    for (let i = 0; i < n; i++) if (!gateSetIdx.has(i)) corners.push({ i, turn: turnAt(i) });
    corners.sort((a, b) => b.turn - a.turn || a.i - b.i);
    for (const c of corners) {
      if (chosen.length >= want) break;
      if (okSep(c.i)) chosen.push(c.i);
    }
    // Un lienzo abierto termina en torre: es el cubo que cierra contra el agua
    // y el que sujeta la cadena del puerto.
    if (!wallClosed) {
      for (const e of [0, n - 1]) {
        if (!gateSetIdx.has(e) && !chosen.includes(e) && chosen.every((j) => sepAlong(e, j) >= minSep * 0.5)) chosen.push(e);
      }
    }
    // Y ningún tramo recto se queda sin batir: donde el hueco pasa de dos
    // intervalos entra una torre en medio, aunque ahí el muro no gire.
    const marks = [...chosen, ...gateIdx].sort((a, b) => a - b);
    for (let m = 0; m < marks.length; m++) {
      const a = marks[m], b = marks[(m + 1) % marks.length];
      if (!wallClosed && m === marks.length - 1) break;
      const gap = forward(a, b);
      if (gap < spacing * 1.9) continue;
      let best = -1, bd = Infinity;
      for (let k = 1; k < n; k++) {
        const i = (a + k) % n;
        if (i === b || gateSetIdx.has(i)) continue;
        const d = Math.abs(forward(a, i) - gap / 2);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) chosen.push(best);
    }

    const list: Fortification['towers'] = chosen.sort((a, b) => a - b).map((i) => {
      const o = outAt(i);
      const at = wallRing[i];
      const r = Math.max(1.1, thickness * 1.9) * (0.88 + rng() * 0.3);
      // Un pueblo levanta sus torres todas iguales — una campaña, un maestro de
      // obras — salvo los baluartes, que son obra posterior y sólo en esquina.
      const kind: 'round' | 'square' | 'bastion' = turnAt(i) > 0.5 && nInner >= 18 && style > 0.72
        ? 'bastion' : style < 0.46 ? 'round' : 'square';
      const c = { x: at.x + o.x * r * 0.35, y: at.y + o.y * r * 0.35 };
      const t = { x: -o.y, y: o.x };
      const pt = (u: number, w: number): V => ({ x: at.x + t.x * u + o.x * w, y: at.y + t.y * u + o.y * w });
      const shape = kind === 'round' ? circle(r, 9, c)
        : kind === 'square' ? rect(r * 1.9, r * 1.7, c, Math.atan2(t.y, t.x))
          // El baluarte apunta a campo: sin esa punta no hay ángulo muerto que
          // resolver y es un cubo cuadrado con otro nombre.
          : [pt(-r * 1.25, -r * 0.3), pt(-r * 0.95, r * 0.7), pt(0, r * 1.65), pt(r * 0.95, r * 0.7), pt(r * 1.25, -r * 0.3)];
      return { at, shape, kind };
    });

    // Las casas-puerta. La barbacana sólo en las que abre un camino de verdad,
    // y como mucho dos: es una obra cara y se hace en la puerta principal.
    let barbicans = 0;
    const fortGates: Fortification['gates'] = gates.map((at, gi) => {
      const i = gateIdx[gi];
      const o = outAt(i);
      const along = Math.max(2.6, thickness * 4.4);
      const across = Math.max(1.9, thickness * 3.0);
      // El eje largo va A LO LARGO del lienzo: la tangente es la normal girada.
      const ang = Math.atan2(o.x, -o.y);
      const c = { x: at.x + o.x * across * 0.1, y: at.y + o.y * across * 0.1 };
      // Sin rumbos del mundo ninguna puerta es "la del camino", y entonces
      // ninguna se llevaba barbacana jamás. La principal es la primera que se
      // colocó, que con la regla de espaciado es tan buena como cualquiera.
      const principal = gateRoad[gi] || (!gateRoad.some(Boolean) && gi === 0);
      const wantBarb = principal && nInner >= 14 && barbicans < 2;
      if (wantBarb) barbicans++;
      return {
        at,
        anchor: gateAnchors[gi] ?? at,
        shape: rect(along, across, c, ang),
        facing: gateBearings[gi] ?? Math.atan2(o.y, o.x),
        barbican: wantBarb
          ? rect(along * 0.66, across * 0.8, {
            x: at.x + o.x * across * 1.75, y: at.y + o.y * across * 1.75,
          }, ang)
          : null,
      };
    });

    /**
     * EL FOSO.
     *
     * Sólo donde el terreno es llano — en una ladera el agua se va sola — y
     * sólo por los lienzos que no tienen ya el agua delante: un pueblo no cava
     * un foso contra su propio puerto.
     *
     * Va como UNA banda: la contraescarpa de ida y la escarpa de vuelta. En una
     * muralla cerrada eso es una corona con una costura en el índice cero, que
     * es la forma de decir un anillo con un solo polígono simple.
     */
    let moat: Poly | null = null;
    if ((p.slopeAmount ?? 0) < 0.55 && nInner >= 10 && rng() < 0.66) {
      const berm = Math.max(2.2, thickness * 3);
      const width = Math.max(3, radius * 0.045 + thickness * 2);
      const dryOut = (v: V) => !(
        (coast && (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y > -1)
        || (river && lineDist(v, river) < riverWidth * 1.6)
      );
      const ok: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const o = outAt(i);
        ok.push(dryOut({ x: wallRing[i].x + o.x * (berm + width), y: wallRing[i].y + o.y * (berm + width) }));
      }
      // El tramo seco contiguo más largo, dando la vuelta si la muralla cierra.
      let bestStart = -1, bestLen = 0;
      if (ok.every(Boolean)) { bestStart = 0; bestLen = n; }
      else {
        for (let s = 0; s < n; s++) {
          if (!ok[s] || (wallClosed ? ok[(s - 1 + n) % n] : s > 0 && ok[s - 1])) continue;
          let l = 0;
          while (l < n && ok[(s + l) % n] && (wallClosed || s + l < n)) l++;
          if (l > bestLen) { bestLen = l; bestStart = s; }
        }
      }
      if (bestStart >= 0 && bestLen >= Math.max(4, n * 0.5)) {
        const scarp: V[] = [], counter: V[] = [];
        for (let k = 0; k < bestLen; k++) {
          const i = (bestStart + k) % n;
          const o = outAt(i);
          const v = wallRing[i];
          scarp.push({ x: v.x + o.x * berm, y: v.y + o.y * berm });
          counter.push({ x: v.x + o.x * (berm + width), y: v.y + o.y * (berm + width) });
        }
        moat = [...counter, ...scarp.reverse()];
      }
    }

    fort = { line: wallRing, closed: wallClosed, thickness, towers: list, gates: fortGates, moat };
    towers = list.map((t) => t.at);
  }

  // ---- market and citadel -------------------------------------------------
  // The market takes the most central district; the castle takes a peripheral
  // one, which is where urban castles actually sat — commanding the town from
  // an edge, with one gate to the fields and one to the streets.
  //
  // "Most central" is the rule, but it is not the only rule: a market square is
  // a dry open place where carts stand, so a district the river runs through or
  // one that is half sea is disqualified outright. It has to be a hard veto and
  // not a penalty — a slightly-less-central square is free, a market under two
  // feet of water is not.
  const inWater = (v: V): boolean => {
    if (coast && (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y > -riverWidth) return true;
    if (river && lineDist(v, river) < riverWidth * 1.5) return true;
    return false;
  };
  const dryPatch = (q: Patch) => !q.shape.some(inWater) && !inWater(centroid(q.shape));

  let market: Patch | null = null;
  let bestD = Infinity;
  for (const q of inner) {
    if (!dryPatch(q)) continue;
    const d = dist(centroid(q.shape), center);
    if (d < bestD) { bestD = d; market = q; }
  }
  // Fall back to plain centrality only if literally every district is wet.
  if (!market) {
    for (const q of inner) {
      const d = dist(centroid(q.shape), center);
      if (d < bestD) { bestD = d; market = q; }
    }
  }
  if (market) market.ward = 'market';

  let citadelPatch: Patch | null = null;
  if (p.citadel && inner.length > 5) {
    /**
     * NUNCA SOBRE UNA PUERTA DEL PUEBLO. Las calles no atraviesan el patio de
     * armas (peso infinito), así que una puerta cuyo vértice soldado pertenece
     * al distrito del castillo no puede enrutar su avenida: TODOS sus arcos
     * salen por la ciudadela. Medido en costa 20: la puerta #0 quedaba con
     * «BFS puro llega, BFS finito no» — grafo conexo, todo camino infinito —
     * y era la única puerta ciega que quedaba en el banco. Un castillo urbano
     * manda desde el borde, pero no se sienta ENCIMA de la puerta de la villa.
     */
    const anchorSet = new Set<V>(gateAnchors);
    let best = -Infinity;
    for (const q of inner) {
      if (q === market || !dryPatch(q)) continue;
      if (q.shape.some((v) => anchorSet.has(v))) continue;
      const c = centroid(q.shape);
      const score = dist(c, center) * compactness(q.shape);
      if (score > best) { best = score; citadelPatch = q; }
    }
    if (citadelPatch) citadelPatch.ward = 'castle';
  }

  // ---- ward assignment ----------------------------------------------------
  // Por IDENTIDAD del vértice, no por coordenadas redondeadas a tres decimales:
  // los vértices están soldados, así que la manzana que toca la puerta tiene
  // literalmente el mismo objeto. La versión con `toFixed(3)` comparaba el
  // anillo suavizado contra los vértices crudos y no acertaba jamás.
  const gateSet = new Set<V>(gateAnchors);
  for (const q of inner) {
    if (q.ward !== 'outskirts') continue;
    const touchesGate = q.shape.some((v) => gateSet.has(v));
    if (touchesGate && rng() < (p.walls ? 0.5 : 0.2)) { q.ward = 'gate'; continue; }
    let ward = pickWard(rng);
    // Suitability: the rich cluster near the middle, the poor near the wall.
    const d = dist(centroid(q.shape), center) / Math.max(1, radius);
    if ((ward === 'patriciate' || ward === 'administration') && d > 0.6 && rng() < 0.7) ward = 'craftsmen';
    if (ward === 'slum' && d < 0.45 && rng() < 0.7) ward = 'craftsmen';
    if (ward === 'military' && d < 0.5 && rng() < 0.6) ward = 'craftsmen';
    q.ward = ward;
  }

  // Enforce the quotas: keep the best-suited district of each rare ward and turn
  // the rest over to the craftsmen, who will take any street in any town.
  const dryEnough = (q: Patch) => dryPatch(q);
  const counted = new Map<WardType, Patch[]>();
  for (const q of inner) {
    if (q.ward === 'market' || q.ward === 'castle' || q.ward === 'gate') continue;
    let l = counted.get(q.ward);
    if (!l) counted.set(q.ward, (l = []));
    l.push(q);
  }
  for (const [ward, list] of counted) {
    const quota = wardQuota(ward, inner.length);
    if (list.length <= quota) continue;
    // A cathedral wants a big dry central block; a park wants whatever is left.
    const ranked = list.slice().sort((a, b) => {
      const score = (q: Patch) => area(q.shape) * (dryEnough(q) ? 1 : 0.15)
        * (ward === 'cathedral' ? 1 / (1 + dist(centroid(q.shape), center) / radius) : 1);
      return score(b) - score(a);
    });
    for (const q of ranked.slice(quota)) q.ward = 'craftsmen';
  }
  // A town of any size has one cathedral, even if the bag never dealt one.
  //
  // And this branch is the ONLY one that ever fires for cathedrals: 'cathedral'
  // is not in WARD_WEIGHTS, so `pickWard` cannot deal it, so the quota ranker
  // above — which does weight centrality — never sees a cathedral bucket. It
  // used to pick purely by area, and the largest block in one of these plans is
  // systematically at the RIM: Lloyd relaxation evens out the middle and leaves
  // the outer cells big. That is why every cathedral ended up against the wall.
  //
  // A cathedral is the second most central thing in a medieval town after the
  // market, and it usually stands ON the market square or one block off it. So:
  // score by centrality first, size second, and give a real bonus for touching
  // the market place.
  if (!inner.some((q) => q.ward === 'cathedral') && wardQuota('cathedral', inner.length) > 0) {
    const marketVerts = new Set(
      (market?.shape ?? []).map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`),
    );
    const candidates = inner.filter((q) => q.ward === 'craftsmen' && dryEnough(q));
    let pick: Patch | null = null;
    let best = -Infinity;
    for (const q of candidates) {
      const d = dist(centroid(q.shape), center) / Math.max(1, radius);
      const onSquare = q.shape.some((v) => marketVerts.has(`${v.x.toFixed(3)},${v.y.toFixed(3)}`));
      // Centrality dominates; area only breaks ties between equally central
      // blocks, so it can no longer drag the church out to the ramparts.
      const score = (1 / (1 + 3 * d)) * Math.pow(Math.max(1, area(q.shape)), 0.25)
        * (onSquare ? 1.6 : 1);
      if (score > best) { best = score; pick = q; }
    }
    if (pick) pick.ward = 'cathedral';
  }
  // Outer ring: farms if requested, otherwise ragged outskirts.
  for (const q of patches) {
    if (q.withinCity) continue;
    const d = dist(centroid(q.shape), center);
    q.ward = p.farms && d < radius * 1.7 ? 'farm' : 'outskirts';
  }

  // ---- streets ------------------------------------------------------------
  // Routed along the gaps between blocks, not drawn across them. See
  // `buildStreetGraph` for why that is the whole trick.
  const streets: V[][] = [];
  const mainStreets: V[][] = [];
  const roads: V[][] = [];
  const marketC = market ? centroid(market.shape) : center;

  const graph = buildStreetGraph(inner.map((q) => q.shape));
  const citadelVerts = new Set(citadelPatch ? citadelPatch.shape : []);
  // Edges already carrying a main street are cheaper, so later routes prefer to
  // join an existing avenue instead of cutting a parallel one two blocks over.
  // That single term is what turns N independent paths into a network.
  const used = new Set<string>();
  const ekey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const weight = (a: number, b: number) => {
    // A street may not run through the castle bailey.
    if (citadelVerts.has(graph.nodes[a]) && citadelVerts.has(graph.nodes[b])) return Infinity;
    let w = used.has(ekey(a, b)) ? 0.45 : 1;
    // Fording is expensive; a bridge is a decision, not an accident. The route
    // will cross where the town is narrow, which is where bridges really go.
    const mid = lerp(graph.nodes[a], graph.nodes[b], 0.5);
    if (river && river.some((rp) => dist(rp, mid) < riverWidth * 1.4)) w *= 3.2;
    if (coast && (mid.x - coast.p.x) * coast.n.x + (mid.y - coast.p.y) * coast.n.y > 0) return Infinity;
    return w;
  };

  const marketNode = nearestNode(graph, marketC);
  for (let gi = 0; gi < gates.length; gi++) {
    const g = gates[gi];
    // Por el ANCLA. Con el punto dibujado esto era `undefined` siempre y la
    // avenida empezaba en el nodo más cercano, que es por qué se quedaba a un
    // par de casas de la puerta.
    const anchor = gateAnchors[gi] ?? g;
    const from = graph.index.get(anchor) ?? nearestNode(graph, anchor);
    if (marketNode < 0 || from < 0) continue;
    const path = routeStreet(graph, from, marketNode, weight);
    if (path && path.length >= 2) {
      for (let i = 0; i < path.length - 1; i++) used.add(ekey(path[i], path[i + 1]));
      // Y la avenida termina EN la puerta dibujada. El grafo vive sobre los
      // vértices crudos; la muralla se dibuja suavizada; sin este último tramo
      // queda medio metro de aire entre la avenida y el arco por el que pasa.
      const line = path.map((i) => graph.nodes[i]);
      if (dist(line[0], g) > 0.01) line.unshift(g);
      mainStreets.push(smoothStreet(line));
    }

    /**
     * EL CAMINO SALE POR SU RUMBO.
     *
     * Era `ang += (rng()-0.5)*0.35` nueve veces: un paseo aleatorio cuyo error
     * se ACUMULA, así que a los nueve pasos el camino apuntaba a cualquier
     * sitio menos a donde iba y moría en campo abierto. Un camino real serpentea
     * ALREDEDOR de su rumbo — lo esquiva un cerro, lo cruza un arroyo — pero
     * vuelve, porque lleva a un sitio concreto.
     *
     * Aquí la desviación se amortigua hacia cero (media móvil de 0,78), lo que
     * deja una serpenteo de unos 11° de desviación típica y ningún camino que se
     * dé la vuelta. Cuando el rumbo lo pone el mundo, es LA MISMA carretera que
     * el atlas dibuja llegando.
     */
    const bearing = gateBearings[gi] ?? Math.atan2(g.y - center.y, g.x - center.x);
    const road: V[] = [g];
    let cur = { ...g };
    let drift = 0;
    for (let s = 0; s < 9; s++) {
      // El primer tramo sale recto: una carretera cruza la puerta de frente.
      if (s > 0) drift = drift * 0.78 + (rng() - 0.5) * 0.42;
      const ang = bearing + drift;
      cur = { x: cur.x + Math.cos(ang) * radius * 0.28, y: cur.y + Math.sin(ang) * radius * 0.28 };
      road.push({ ...cur });
    }
    roads.push(road);
  }

  // Secondary streets: EVERY district joins the network, not only the far 35 %.
  // The old top-35 % rule left middle-ring quarters unstreeted, and the pocket
  // census showed what that costs: whole district interiors sealed (bolsas of
  // 300–7 100 m² in craftsmen and slum wards). Most districts exit on the first
  // check — their nearest node is already on somebody's route — so the extra
  // work is only paid exactly where a quarter was stranded.
  const onNetwork = new Set<number>();
  for (const k of used) for (const part of k.split('|')) onNetwork.add(Number(part));
  const far = [...inner]
    .map((q) => ({ q, d: dist(centroid(q.shape), center) }))
    .sort((a, b) => b.d - a.d);
  for (const { q } of far) {
    const from = nearestNode(graph, centroid(q.shape));
    if (from < 0 || onNetwork.has(from)) continue;
    const to = nearestNode(graph, graph.nodes[from], (i) => onNetwork.has(i));
    if (to < 0) continue;
    const path = routeStreet(graph, from, to, weight);
    if (!path || path.length < 2) {
      /**
       * SIN CALLE NO HAY CIUDAD. El único camino hasta este distrito cruza el
       * MAR (peso infinito): es la cuña al otro lado de la desembocadura que
       * el censo de bolsas pintó de rojo — suelo urbano al que ninguna calle,
       * y por tanto ningún puente, puede llegar jamás. Un barrio amurallado en
       * un espigón sin puente no existe en ningún pueblo real: se queda en
       * campo. (El cruce de RÍO sí se enruta — pesa ×3,2 y trae puente — así
       * que esto no toca a los pueblos partidos por su río, sólo a lo que el
       * mar aísla de verdad.)
       */
      q.withinCity = false;
      q.withinWalls = false;
      q.ward = 'outskirts';
      continue;
    }
    for (let i = 0; i < path.length - 1; i++) {
      used.add(ekey(path[i], path[i + 1]));
      onNetwork.add(path[i]); onNetwork.add(path[i + 1]);
    }
    streets.push(smoothStreet(path.map((i) => graph.nodes[i])));
  }

  if (wallRing.length >= 6) {
    const inner1 = shrink(wallRing, MAIN_STREET * 1.6);
    // On a big town the road just inside the wall is an avenue in its own right:
    // it is how the garrison moves between gates without crossing the market square.
    // On a small one it is a back lane.
    if (inner1.length >= 3) {
      const ringRoad = wallClosed ? [...inner1, inner1[0]] : inner1;
      (nInner >= 24 ? mainStreets : streets).push(ringRoad);
    }
  }

  // ---- bridges ------------------------------------------------------------
  // Wherever a street actually crosses the water there is a bridge, and where it
  // does not there is nothing. Placing bridges independently of the streets is
  // how generated towns end up with a bridge to a blank wall.
  const bridges: Poly[] = [];
  if (river) {
    const seen: V[] = [];
    for (const st of [...mainStreets, ...streets]) {
      for (const x of crossings(st, river)) {
        if (seen.some((s) => dist(s, x.at) < riverWidth * 2)) continue;
        seen.push(x.at);
        const halfLen = riverWidth * 1.9;
        const halfW = MAIN_STREET * 1.5;
        const d = x.dir, n = rot90(d);
        bridges.push([
          { x: x.at.x - d.x * halfLen - n.x * halfW, y: x.at.y - d.y * halfLen - n.y * halfW },
          { x: x.at.x + d.x * halfLen - n.x * halfW, y: x.at.y + d.y * halfLen - n.y * halfW },
          { x: x.at.x + d.x * halfLen + n.x * halfW, y: x.at.y + d.y * halfLen + n.y * halfW },
          { x: x.at.x - d.x * halfLen + n.x * halfW, y: x.at.y - d.y * halfLen + n.y * halfW },
        ]);
      }
    }
  }

  // ---- waterfront ---------------------------------------------------------
  // A quay running along the shore inside the town, with piers off it. A coastal
  // town without them is an inland town that happens to end at some blue.
  // The waterfront is a STREET, not a slab. Modelling it as a filled quay drew a
  // brown bar across the harbour and out the other side of the town; as a ribbon
  // along the shore it reads immediately as the road the warehouses face onto,
  // and it cannot escape the street layer's colours.
  const piers: Poly[] = [];
  /** El muelle, guardado aparte: la plaza del puerto y los almacenes lo buscan. */
  let quayLine: V[] | null = null;
  if (coast) {
    const n = coast.n, t = rot90(n);
    const signed = (v: V) => (v.x - coast.p.x) * n.x + (v.y - coast.p.y) * n.y;
    // Measured on the districts, not the wall: on a town whose wall stops short
    // of the water the wall test produced a quay floating offshore with piers
    // running from nothing to nothing.
    const along: number[] = [];
    for (const q of inner) {
      for (const v of q.shape) {
        if (signed(v) > -radius * 0.3) along.push((v.x - coast.p.x) * t.x + (v.y - coast.p.y) * t.y);
      }
    }
    if (along.length >= 4) {
      // Trim the outliers: one stray district corner reaching along the shore
      // was stretching the quay right out of the town.
      along.sort((x, y) => x - y);
      const a0 = along[Math.floor(along.length * 0.08)];
      const a1 = along[Math.floor(along.length * 0.92)];
      const base = -MAIN_STREET * 1.6;
      const at = (sAlong: number, d: number): V => ({
        x: coast.p.x + t.x * sAlong + n.x * d,
        y: coast.p.y + t.y * sAlong + n.y * d,
      });
      if (a1 - a0 > radius * 0.3) {
        const quay: V[] = [];
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const sAlong = a0 + ((a1 - a0) * i) / steps;
          quay.push(at(sAlong, base - Math.sin((i / steps) * Math.PI) * MAIN_STREET * 0.4));
        }
        mainStreets.push(quay);
        quayLine = quay;

        const pierCount = Math.max(1, Math.round((a1 - a0) / (radius * 0.55)));
        for (let i = 0; i < pierCount; i++) {
          const sAlong = a0 + ((i + 0.5) / pierCount) * (a1 - a0) + (rng() - 0.5) * radius * 0.08;
          // Medidas de muelle de verdad: con 0,6–1,0 × MAIN_STREET de ancho y
          // 0,05–0,11 · r de salida, el embarcadero medía 4 × 14 u y a escala
          // de lámina se leía como una astilla clavada en la orilla. Ancho de
          // calle mayor y salida hasta 0,14 · r — todavía muy lejos del
          // 0,28 · r que convertía esto en escolleras (ver abajo) — y el
          // MISMO número de sorteos, porque un sorteo más baraja todos los
          // planos que vienen detrás (determinismo del contrato).
          const w = MAIN_STREET * (0.85 + rng() * 0.55);
          // A pier is a jetty, not a causeway. At radius*0.28 they reached a third
          // of the way across the bay and read as breakwaters.
          const out = radius * (0.07 + rng() * 0.07);
          piers.push([
            at(sAlong - w, base), at(sAlong + w, base),
            at(sAlong + w * 0.7, base + out), at(sAlong - w * 0.7, base + out),
          ]);
        }
      }
    }
  }

  // ---- clip the land ------------------------------------------------------
  // Only NOW, after the street graph has been routed on the un-clipped shapes:
  // clipping earlier would replace the welded vertex objects the graph is keyed
  // on. From here on a district ends at the waterline, so its ward wash, its
  // courtyards and its blocks all stop there too — previously the wash carried
  // on across the harbour and the cathedral was cut in half with no shoreline to
  // explain why.
  if (coast) {
    for (const q of patches) {
      const clipped = clipHalfPlane(q.shape, coast.p, coast.n);
      if (clipped.length >= 3) q.shape = clipped;
      else if (q.withinCity) { q.shape = []; q.withinCity = false; }
      else q.shape = [];
    }
    /**
     * Y LAS CALLES TAMBIÉN SALEN DEL AGUA. El grafo se enruta sobre las formas
     * SIN recortar (ver arriba: recortar antes rompería la identidad de los
     * vértices soldados), así que un nodo de distrito que caía mar adentro
     * seguía mar adentro como vértice de calle — medido: dos vértices a 13,3 y
     * 9,1 m de la orilla en río+costa 8. El semiplano del recorte es el mismo:
     * todo vértice mojado se proyecta a 0,6 u tierra adentro de la línea de
     * agua. El muelle vive a −3,2 u y no se toca; los embarcaderos no son
     * calles y siguen entrando en el mar, que es su oficio.
     */
    const sSea = (v: V) => (v.x - coast.p.x) * coast.n.x + (v.y - coast.p.y) * coast.n.y;
    const ashore = (v: V): V => {
      const d = sSea(v);
      return d > -0.6 ? { x: v.x - coast.n.x * (d + 0.6), y: v.y - coast.n.y * (d + 0.6) } : v;
    };
    for (const list of [mainStreets, streets, roads]) {
      for (const st of list) for (let i = 0; i < st.length; i++) st[i] = ashore(st[i]);
    }
  }

  // ---- las plazas ---------------------------------------------------------
  /**
   * DÓNDE HAY PLAZA, ANTES DE CONSTRUIR NADA.
   *
   * Un pueblo de Watabou tiene VARIOS espacios públicos: el mercado, el atrio
   * de la iglesia, el ensanche del puerto, el respiro que queda justo dentro de
   * una puerta y el que se hace donde se cruzan dos avenidas. Aquí había uno, y
   * era una manzana entera pintada de nada.
   *
   * Se reparten aquí y se trazan dentro del bucle de construcción, que es donde
   * existe la manzana ya retranqueada de sus calles. El mercado se traza por
   * dentro (empedrado en medio, corona de casas alrededor); las demás le quitan
   * el FRENTE a una manzana, y así la hilera que da a la plaza sale sola al
   * construir el resto por su perímetro.
   */
  const squares: Square[] = [];
  const squarePlans = new Map<Patch, { kind: SquareKind; toward: V; depth: number }>();
  const planSquare = (q: Patch | null | undefined, kind: SquareKind, toward: V, depth: number) => {
    if (!q || q === market || !q.withinCity || q.shape.length < 3 || squarePlans.has(q)) return false;
    if (q.ward === 'castle' || q.ward === 'park' || q.ward === 'farm') return false;
    squarePlans.set(q, { kind, toward, depth });
    return true;
  };
  /** La manzana que tiene ese vértice, por identidad; si no, la más cercana. */
  const hostOf = (at: V): Patch | null => {
    for (const q of inner) if (q.shape.includes(at)) return q;
    let best: Patch | null = null, bd = Infinity;
    for (const q of inner) {
      if (q.shape.length < 3) continue;
      const d = dist(centroid(q.shape), at);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };

  // El atrio: delante de la catedral y mirando al pueblo, que es por donde
  // llega la gente y donde está la portada.
  const cathedralPatch = inner.find((q) => q.ward === 'cathedral');
  if (cathedralPatch) planSquare(cathedralPatch, 'church', center, 3.5 + rng() * 3);

  // La plaza del puerto: donde el muelle se ensancha para descargar.
  if (coast && quayLine && quayLine.length) {
    const mid = quayLine[Math.floor(quayLine.length / 2)];
    let best: Patch | null = null, bd = Infinity;
    for (const q of inner) {
      if (q.shape.length < 3) continue;
      const d = dist(centroid(q.shape), mid);
      if (d < bd) { bd = d; best = q; }
    }
    if (best && bd < radius * 0.7) {
      planSquare(best, 'harbour', { x: mid.x + coast.n.x * radius, y: mid.y + coast.n.y * radius }, 4 + rng() * 4);
    }
  }

  // El ensanche de la puerta: el sitio donde para el carro que acaba de entrar.
  let gateSquares = nInner >= 30 ? 2 : nInner >= 12 ? 1 : 0;
  for (let gi = 0; gi < gates.length && gateSquares > 0; gi++) {
    const anchor = gateAnchors[gi] ?? gates[gi];
    if (planSquare(hostOf(anchor), 'gate', anchor, 2.5 + rng() * 2)) gateSquares--;
  }

  // Y donde se cruzan dos avenidas. Ni pegadas al mercado ni pegadas entre sí:
  // dos ensanches a veinte metros son un descampado.
  const lesserWant = Math.min(4, Math.floor(nInner / 14));
  if (lesserWant > 0) {
    const degree = new Map<number, number>();
    for (const k of used) {
      for (const part of k.split('|')) {
        const i = Number(part);
        degree.set(i, (degree.get(i) ?? 0) + 1);
      }
    }
    const junctions = [...degree.entries()]
      .filter(([, d]) => d >= 3)
      .map(([i]) => graph.nodes[i])
      .sort((a, b) => Math.abs(dist(a, marketC) - radius * 0.55) - Math.abs(dist(b, marketC) - radius * 0.55));
    const taken: V[] = [];
    for (const j of junctions) {
      if (taken.length >= lesserWant) break;
      if (dist(j, marketC) < radius * 0.28) continue;
      if (taken.some((t) => dist(t, j) < radius * 0.45)) continue;
      if (planSquare(hostOf(j), 'lesser', j, 2.2 + rng() * 2)) taken.push(j);
    }
  }

  /**
   * DÓNDE VA A HABER PLAZA, PARA QUE LOS VECINOS LO SEPAN.
   *
   * El trazado de cada plaza ocurre dentro del bucle de construcción, así que
   * un barrio construido antes que su vecino no se enteraría de que tiene una
   * plaza al lado. Estos son los centros aproximados, calculados por adelantado,
   * y lo único que hacen es quitarle el retranqueo a la manzana que da a ellos.
   */
  const squareEdges: { at: V; r: number }[] = [];
  for (const [q, sp] of squarePlans) {
    const c = centroid(q.shape);
    const n = norm(sub(sp.toward, c));
    let tmax = -Infinity;
    for (const v of q.shape) tmax = Math.max(tmax, (v.x - c.x) * n.x + (v.y - c.y) * n.y);
    const at = { x: c.x + n.x * (tmax - sp.depth * 0.5), y: c.y + n.y * (tmax - sp.depth * 0.5) };
    squareEdges.push({ at, r: sp.depth + 3 });
  }
  if (market && market.shape.length >= 3) {
    squareEdges.push({ at: centroid(market.shape), r: Math.sqrt(area(market.shape)) * 0.62 });
  }

  // ---- building geometry --------------------------------------------------
  for (const q of patches) {
    if (q.shape.length < 3) continue;
    const isEdge = !q.withinCity;
    // Un barrio que da a una plaza tampoco deja solares vacíos dando a ella:
    // un descampado en la esquina del mercado no existe en ningún pueblo.
    const onSquare = !isEdge && squareEdges.some(
      (s) => dist(centroid(q.shape), s.at) < s.r + Math.sqrt(area(q.shape)) * 0.6,
    );
    // Pull the block back from its streets. A block facing a main street sits
    // further back than one facing an alley — that differential is most of what
    // makes a street network legible from the footprints alone.
    const inset = q.shape.map((_, i) => {
      const v1 = q.shape[i], v2 = q.shape[(i + 1) % q.shape.length];
      const mid = lerp(v1, v2, 0.5);
      // AL TRAZADO, NO A SUS VÉRTICES.
      //
      // Esto medía la distancia a los PUNTOS de la calle. Una avenida sale de
      // `smoothStreet`, que le pasa dos veces Chaikin: sus vértices quedan
      // separados varias unidades, así que un lindero que cruzaba la calzada
      // justo entre dos de ellos no la veía y la manzana no se retranqueaba.
      // Medido en `city-quality`: 39 de 42 avenidas se estrangulaban por debajo
      // del ancho de un carro, una de ellas a 20 cm, con una mediana sana de
      // 8,2 m — el defecto no estaba en la anchura sino en QUIÉN se apartaba.
      const onAvenue = mainStreets.some((st) => nearPath(st, mid, MAIN_STREET * 1.4));
      const nearStreet = onAvenue || streets.some((st) => nearPath(st, mid, MAIN_STREET * 1.2));
      // An avenue is wider than a street is wider than an alley, and the blocks
      // stepping back by different amounts is most of what makes the hierarchy
      // legible from the footprints alone.
      //
      // The set-back is capped against the block's own size: a small patch with
      // an avenue down two of its sides was being inset until nothing was left,
      // which read on the map as a plaza the size of a district.
      const cap = Math.sqrt(area(q.shape)) * 0.16;
      const want = onAvenue ? MAIN_STREET * 1.15 : nearStreet ? MAIN_STREET : q.withinCity ? REGULAR_STREET : ALLEY;
      // FRENTE A LA PLAZA NO SE RETRANQUEA. Un barrio que da a la plaza y se
      // echa atrás como si diera a un callejón le presenta el corral: la plaza
      // queda rodeada de tapias y tendederos en vez de fachadas.
      const facesSquare = squareEdges.some((s) => dist(mid, s.at) < s.r);
      return Math.min(want, cap * 2) / 2 * (facesSquare ? 0.4 : 1);
    });
    let block = shrinkEdges(q.shape, inset);
    if (block.length < 3) continue;

    /**
     * La plaza le quita el FRENTE a la manzana.
     *
     * Lo que queda se construye como cualquier otra manzana, y como se
     * construye por su perímetro, la hilera que da a la plaza aparece sola —
     * con el lado corto a ella, que es lo que hace fachada.
     */
    const plan = squarePlans.get(q);
    if (plan) {
      const carved = carveSquare(block, plan.toward, plan.depth);
      if (carved) {
        const paved = chamfer(shrink(carved.square, 0.3), rng);
        if (paved.length >= 3) {
          const pc = centroid(paved);
          squares.push({
            kind: plan.kind,
            shape: paved,
            monument: monumentFor(plan.kind, pc, Math.sqrt(area(paved)), rng),
            arcades: arcadesOf(paved, plan.kind === 'harbour' ? center : marketC, mainStreets, 2),
          });
          q.courts.push(paved);
          block = carved.rest;
        }
      }
    }

    switch (q.ward) {
      case 'market': {
        /**
         * LA PLAZA DEL MERCADO, QUE ERA UN RÓTULO SOBRE PAPEL EN BLANCO.
         *
         * Era `courts.push(block)` — la celda de Voronoi entera — más un pozo de
         * dos unidades. Sin contorno propio, sin soportales y, sobre todo, sin
         * una sola casa dándole fachada: en la lámina salía un hueco del tamaño
         * de un barrio con un nombre encima.
         *
         * Ahora el empedrado es un rectángulo ORIENTADO A LA AVENIDA que llega,
         * recortado contra la manzana y achaflanado, y lo que queda entre él y
         * el borde de la manzana se parcela en hileras que miran a la plaza. Eso
         * son las casas del mercado, que en un pueblo real son las mejores.
         */
        const bp = burgageParamsFor('merchant', rng);
        const c = centroid(block);
        let axis = 0, near = Infinity;
        for (const av of mainStreets) {
          for (let i = 0; i < av.length - 1; i++) {
            const d = segDist(c, av[i], av[i + 1]);
            if (d < near) { near = d; axis = Math.atan2(av[i + 1].y - av[i].y, av[i + 1].x - av[i].x); }
          }
        }
        if (near > radius * 0.5) {
          const e = longestEdge(block);
          axis = Math.atan2(block[(e + 1) % block.length].y - block[e].y, block[(e + 1) % block.length].x - block[e].x);
        }
        const u = { x: Math.cos(axis), y: Math.sin(axis) };
        const w = { x: -u.y, y: u.x };
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        for (const pt of block) {
          const a = (pt.x - c.x) * u.x + (pt.y - c.y) * u.y;
          const b = (pt.x - c.x) * w.x + (pt.y - c.y) * w.y;
          if (a < uMin) uMin = a; if (a > uMax) uMax = a;
          if (b < vMin) vMin = b; if (b > vMax) vMax = b;
        }
        // La banda construida es la profundidad de UNA casa más un poco de
        // corral. Con `band*1.45` de margen la manzana central típica — 260 u²,
        // porque el relajado de Lloyd deja pequeñas las celdas del medio — no
        // daba para las dos cosas y el mercado se quedaba SIEMPRE sin corona de
        // casas: cero fachadas en tres semillas de cuatro.
        const band = bp.houseDepth * 1.15;
        const hu = (uMax - uMin) * 0.5 - band * 1.2;
        const hv = (vMax - vMin) * 0.5 - band * 1.2;
        let paved: Poly;
        if (hu > 2.5 && hv > 2.2 && area(block) > band * band * 13 && hu * hv * 4 > area(block) * 0.28) {
          const mu = (uMax + uMin) / 2 + (rng() - 0.5) * hu * 0.24;
          const mv = (vMax + vMin) / 2 + (rng() - 0.5) * hv * 0.24;
          const cc = { x: c.x + u.x * mu + w.x * mv, y: c.y + u.y * mu + w.y * mv };
          paved = clipToConvex(rect(hu * 2, hv * 2, cc, axis), block);
          if (paved.length >= 3) q.buildings.push(...squareFrontage(paved, block, band, bp, rng));
        } else {
          // Una aldea no tiene sitio para las dos cosas: la plaza es la manzana.
          paved = shrink(block, 0.5);
        }
        if (paved.length < 3) paved = block;
        paved = chamfer(paved, rng);
        const pc = centroid(paved);
        squares.push({
          kind: 'market',
          shape: paved,
          monument: monumentFor('market', pc, Math.sqrt(area(paved)), rng),
          // La plaza mayor tiene soportal aunque no llegue ninguna avenida a un
          // lado concreto: es donde se pone el mercado cuando llueve.
          arcades: arcadesOf(paved, center, mainStreets, 3, 1),
        });
        q.courts.push(paved);
        break;
      }
      case 'cathedral': {
        // The precinct: a claustral range around the edge, or a dense chapter
        // block. Either way THE CHURCH ITSELF goes in the middle — the ring
        // branch alone produced a walled enclosure with nothing inside it, which
        // is a monastery that has lost its abbey.
        const { strips, court } = ring(block, 2 + 4 * rng());
        if (rng() < 0.55) {
          q.buildings.push(...strips.map((b) => asBuilding(b, 'chapel')));
          if (court) q.courts.push(court);
        } else {
          q.buildings.push(...createOrthoBuilding(block, 50, 0.8, rng).map((b) => asBuilding(b, 'chapel')));
        }
        const inner2 = court ?? block;
        const c = centroid(inner2);
        const span = Math.sqrt(area(inner2));
        if (span > 6) {
          // A cross on the ground: nave, then transepts across it.
          const ang = rng() * Math.PI;
          const nave = rect(span * 0.28, span * 0.62, c, ang);
          const trans = rect(span * 0.52, span * 0.2, c, ang);
          q.buildings.push(asBuilding(nave, 'church'), asBuilding(trans, 'church'));
        }
        break;
      }
      case 'castle': {
        // A bailey: ranges built against the inside of the wall, a courtyard, and
        // a rectangular keep. Subdividing the raw polygon instead produced two
        // enormous triangles that read as a bowtie, not a castle.
        const bailey = shrink(block, MAIN_STREET * 1.2);
        if (bailey.length < 3) break;
        const { strips, court } = ring(bailey, Math.sqrt(area(bailey)) * 0.17);
        /**
         * LA PUERTA DEL PATIO DE ARMAS. El anillo de crujías cerraba el patio
         * por los cuatro costados y el castillo era la mayor bolsa sellada de
         * TODAS las ciudades grandes (5 000–11 800 m² medidos por el censo de
         * bolsas; fachada del barrio castle 81 %, la peor de los trece).
         * Un castillo real tiene puerta al pueblo: la crujía que mira al
         * mercado se parte en dos con un hueco de carro (1,5 u = 6 m).
         * Sin sorteo — la puerta mira a donde mira el pueblo.
         */
        const bcen = centroid(bailey);
        const toMarket = norm(sub(marketC, bcen));
        let gateI = -1, gateDot = -Infinity;
        for (let i = 0; i < strips.length; i++) {
          if (strips[i].length < 3) continue;
          const d0 = norm(sub(centroid(strips[i]), bcen));
          const s0 = d0.x * toMarket.x + d0.y * toMarket.y;
          if (s0 > gateDot) { gateDot = s0; gateI = i; }
        }
        for (let i = 0; i < strips.length; i++) {
          if (i !== gateI) { q.buildings.push(asBuilding(strips[i], 'barracks')); continue; }
          const st = strips[i];
          const c0 = centroid(st);
          const fe = longestEdge(st);
          const axis = norm(sub(st[(fe + 1) % st.length], st[fe]));
          // El corte va PERPENDICULAR al eje largo de la crujía: la parte en
          // dos rangos y deja el hueco de la puerta entre ambos.
          const perp = rot90(axis);
          const from0 = { x: c0.x - perp.x * 40, y: c0.y - perp.y * 40 };
          const across = { x: c0.x + perp.x * 40, y: c0.y + perp.y * 40 };
          for (const half of cut(st, from0, across, 1.5)) {
            if (half.length >= 3) q.buildings.push(asBuilding(half, 'barracks'));
          }
        }
        const yard = court ?? bailey;
        if (court) q.courts.push(court);
        const c = centroid(yard);
        const span = Math.sqrt(area(yard));
        if (span > 4) {
          const ang = rng() * Math.PI;
          q.buildings.push(asBuilding(rect(span * 0.5, span * 0.42, c, ang), 'keep', ang));
          // A corner tower, offset, so the keep is not a lonely rectangle.
          const v = yard[Math.floor(rng() * yard.length)];
          q.buildings.push(asBuilding(rect(span * 0.2, span * 0.2, lerp(v, c, 0.45), ang), 'tower', ang));
        }
        break;
      }
      case 'park': {
        const slices = compactness(block) >= 0.7 ? radial(block, ALLEY) : semiRadial(block, ALLEY);
        q.courts.push(...slices);
        break;
      }
      case 'farm': {
        q.courts.push(block);
        // Farmsteads sit ON the roads out of the gates. One per field regardless
        // of position turns the countryside into a scatter of debris — the
        // fields themselves, drawn as furrow hatching, carry the farmland.
        const fc = centroid(block);
        const onRoad = roads.some((rd) => rd.some((rp) => dist(rp, fc) < radius * 0.3));
        if (!onRoad || rng() < 0.45) break;
        const v = block[Math.floor(rng() * block.length)];
        const spot = lerp(v, fc, 0.35 + 0.35 * rng());
        const yard = rect(6 + rng() * 4, 6 + rng() * 4, spot, rng() * Math.PI);
        q.buildings.push(...createOrthoBuilding(yard, 9, 0.55, rng).map((b) => asBuilding(b, 'farm')));
        break;
      }
      default: {
        const bp0 = burgageParamsFor(q.ward, rng);
        const bp = onSquare ? { ...bp0, emptyProb: bp0.emptyProb * 0.3 } : bp0;
        if (isEdge) {
          // Hamlets outside the wall gather on the roads. Scattering them evenly
          // over the countryside reads as debris, not as settlement.
          const c = centroid(block);
          const onRoad = roads.some((rd) => rd.some((rp) => dist(rp, c) < radius * 0.35));
          if (!onRoad || rng() < 0.5) break;
          const spot = lerp(c, block[Math.floor(rng() * block.length)], 0.2 + 0.3 * rng());
          const cluster = rect(9 + rng() * 5, 8 + rng() * 5, spot, rng() * Math.PI);
          const ap = alleyParamsFor(q.ward, area(cluster), rng);
          q.buildings.push(...createAlleys(cluster, { ...ap, emptyProb: 0.3 }, rng, true).map((b) => asBuilding(b, 'farm')));
          break;
        }
        /**
         * DISTRITO → MANZANA → PARCELA → CASA.
         *
         * Los cuatro escalones, que antes eran uno. La celda de Voronoi se
         * parte en manzanas separadas por callejones que llegan de calle a
         * calle; cada manzana se construye por su perímetro, con las casas de
         * frente estrecho a la calle y el corral detrás; y lo que queda en
         * medio son los corrales, que se devuelven como patio en vez de
         * tirarse.
         *
         * Es el motivo de que una calle medieval se lea como una hilera: todo
         * el mundo tiene el lado corto en la carretera.
         */
        for (const sub of splitIntoBlocks(block, bp, rng)) {
          const { houses, yard } = burgageBlock(sub, bp, rng);
          q.buildings.push(...houses);
          if (yard) q.courts.push(yard);
        }
      }
    }
  }

  /**
   * LA CALZADA SE TALA SOLA.
   *
   * El retranqueo se decide sobre los LINDEROS del distrito, y la avenida es un
   * trazado suavizado que no tiene por qué seguirlos: `smoothStreet` le pasa dos
   * veces Chaikin, y una curva recortada se mete por dentro de la manzana que
   * bordeaba. Ahí las casas se levantan encima de la calzada.
   *
   * Medido en `city-quality` sobre 12 ciudades: la mediana de ancho libre sobre
   * una avenida es sana — 9,2 m — pero 40 de 42 se estrangulan en ALGÚN punto,
   * una de ellas a 30 cm. No es una avenida estrecha: es una avenida cortada, y
   * el lector la ve morir contra una fachada.
   *
   * Así que lo último que se hace es talar: cualquier casa que invada el ancho
   * de la calzada se cae. Cuesta un puñado de casas por ciudad y garantiza que
   * lo dibujado como calle se pueda recorrer.
   */
  {
    const half = (w: number) => w * 0.5 + MAIN_STREET * 0.12;
    const corredor: { path: V[]; r: number }[] = [
      ...mainStreets.map((st) => ({ path: st, r: half(MAIN_STREET * 1.45) })),
      ...streets.map((st) => ({ path: st, r: half(MAIN_STREET) })),
    ];
    let talados = 0;
    for (const q of patches) {
      const antes = q.buildings.length;
      q.buildings = q.buildings.filter((b) => {
        const c = centroid(b.shape);
        for (const { path, r } of corredor) {
          // La caja envolvente primero: son ~50 trazados de ~30 vértices contra
          // ~2 000 casas, y sin este descarte son tres millones de raíces.
          const alcance = r + 6;
          if (!nearPath(path, c, alcance)) continue;
          /**
           * DOS VARAS, PORQUE SON DOS FALTAS DISTINTAS.
           *
           * Por el CENTRO al ancho completo: la casa está plantada en mitad de
           * la calzada y se cae entera. Por la ESQUINA, sólo al ancho de rodada
           * (55 %): un pico que asoma sobre el arcén es una fachada irregular,
           * que es lo normal en una calle medieval, pero un pico metido en la
           * rodada es la calle cortada.
           *
           * Medido: talando por cualquier esquina al ancho completo la avenida
           * se iba a 27,8 m de mediana y se llevaba el 17 % del caserío — dejaba
           * de estrangularse porque ya no había nada que la estrangulara. Sólo
           * por el centro, la mediana queda en sus 9,2 m sanos pero 17 de 42
           * siguen cortadas. Las dos varas juntas: mediana sana y la calle pasa.
           */
          if (nearPath(path, c, r)) return false;
          for (const v of b.shape) if (nearPath(path, v, r * 0.55)) return false;
        }
        return true;
      });
      talados += antes - q.buildings.length;
    }
    void talados;
  }

  // ---- water clipping -----------------------------------------------------
  if (coast) {
    const wet = (v: V) => (v.x - coast!.p.x) * coast!.n.x + (v.y - coast!.p.y) * coast!.n.y > 0;
    for (const q of patches) {
      q.buildings = q.buildings.filter((b) => !b.shape.some(wet));
      q.courts = q.courts.filter((c) => !c.some(wet));
    }
    // La plaza del puerto SE RECORTA en vez de tirarse: es la única que llega a
    // la orilla a propósito, y filtrarla por "toca el agua" la borraba siempre.
    for (const s of squares) {
      const clipped = clipHalfPlane(s.shape, coast.p, coast.n);
      if (clipped.length < 3) continue;
      if (clipped.length !== s.shape.length) {
        // `arcades` son pares de vértices CONSECUTIVOS del contorno; si el
        // recorte se ha llevado alguno, el par que lo nombraba ya no existe y
        // el dibujante trazaría un soportal en un lado que no está.
        const kept = new Set(clipped);
        s.arcades = s.arcades.filter(([a, b]) => kept.has(a) && kept.has(b));
      }
      s.shape = clipped;
    }
  }
  if (river) {
    const nearRiver = (v: V) => lineDist(v, river!) < riverWidth * 0.8;
    for (const q of patches) {
      q.buildings = q.buildings.filter((b) => !b.shape.some(nearRiver));
      q.courts = q.courts.filter((c) => !c.some(nearRiver));
    }
  }

  // ---- el agua con forma --------------------------------------------------
  /**
   * EL MAR DEJA DE SER UNA RAYA DE REGLA.
   *
   * `coast` es un semiplano infinito, y así se dibujaba: una línea recta
   * cruzando la lámina de lado a lado. Un puerto no es eso. Un puerto es una
   * DÁRSENA que el pueblo abraza, con dos puntas que la cierran y la protegen
   * del temporal, y por eso el pueblo está ahí y no doscientos metros más allá.
   *
   * El litoral sintético se mide HACIA EL MAR desde el semiplano y nunca al
   * revés (`d < 0` se recorta a cero): así el agua muerde hasta la línea justo
   * delante del pueblo — la dársena — y la tierra se adelanta a los lados — las
   * puntas —, y no hay una sola casa pintada sobre el agua, porque la prueba
   * barata de mojado sigue siendo exactamente el mismo semiplano.
   */
  let waters: CityWater | null = null;
  if (coast || river) {
    const shore: V[] = [];
    const water: Poly[] = [];
    if (coast) {
      const n = coast.n, t = rot90(n);
      if (givenShore) {
        // El litoral del mundo, pero SUJETO al semiplano: un punto que quede
        // tierra adentro de la línea de agua se empuja hasta ella. Sin esto el
        // polígono de mar tapaba las granjas allí donde el litoral real entra
        // más que la recta que lo resume — el pueblo entero está recortado por
        // esa recta y el agua no puede contradecirla.
        for (const v of givenShore) {
          const t = v.x * n.x + v.y * n.y;
          shore.push(t >= coastAxis!.d ? v : { x: v.x + n.x * (coastAxis!.d - t), y: v.y + n.y * (coastAxis!.d - t) });
        }
      } else {
        const steps = 56;
        const L = radius * 2.4;
        // LA DÁRSENA SE ABRE DONDE ESTÁ EL MUELLE, no en un punto al azar de la
        // costa: con el desfase aleatorio el agua mordía por detrás de una punta
        // y entre el pueblo y su propio mar quedaba una playa de veinte metros
        // en todo el frente. El muelle ya sabe dónde está el frente marítimo.
        let basin = (rng() - 0.5) * radius * 0.5;
        if (quayLine && quayLine.length) {
          const m = quayLine[Math.floor(quayLine.length / 2)];
          basin = (m.x - coast.p.x) * t.x + (m.y - coast.p.y) * t.y;
        }
        const reach = radius * (0.4 + rng() * 0.3);    // cuánto se adelantan las puntas
        const wide = radius * (0.85 + rng() * 0.5);    // lo ancha que es la dársena
        const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
        const asym = 0.7 + rng() * 0.7;                // una punta más larga que la otra
        for (let i = 0; i <= steps; i++) {
          const s = -L + (2 * L * i) / steps;
          const u = (s - basin) / wide;
          const bell = 1 - Math.exp(-u * u);
          // El rizado también se apaga en la dársena: un metro de más ahí es un
          // metro de playa delante del muelle.
          let d = reach * bell * (s > basin ? asym : 1 / asym)
            + bell * (radius * 0.05 * Math.sin(u * 2.3 + ph1) + radius * 0.028 * Math.sin(u * 5.1 + ph2));
          if (d < 0) d = 0;
          shore.push({ x: coast.p.x + t.x * s + n.x * d, y: coast.p.y + t.y * s + n.y * d });
        }
      }
      if (shore.length >= 2) {
        // El mar, cerrado contra el borde de la lámina: el dibujante rellena un
        // polígono y no tiene que inventarse dónde termina el agua.
        const far = radius * 2.8;
        const a = shore[0], b = shore[shore.length - 1];
        water.push([
          ...shore,
          { x: b.x + n.x * far, y: b.y + n.y * far },
          { x: a.x + n.x * far, y: a.y + n.y * far },
        ]);
      }
    }
    let course: CityWater['river'] = null;
    if (river && river.length >= 2) {
      /**
       * EL RÍO SE ENSANCHA AGUAS ABAJO.
       *
       * `width` en el tipo es UN número, así que el ancho que varía va donde de
       * verdad se ve: en las orillas, como polígono de agua cerrado. El escalar
       * queda como ancho nominal, para quien sólo quiera trazar el eje.
       *
       * Y se estrecha donde cruza el puente, no al revés: el puente está ahí
       * PORQUE ahí el río se estrecha. Es el vado que hizo el pueblo.
       */
      const nR = river.length;
      // Aguas abajo es hacia el mar; sin mar, hacia donde baja el terreno.
      let flip = false;
      if (!coast && slopeDir) {
        const up = (v: V) => v.x * slopeDir.x + v.y * slopeDir.y;
        flip = up(river[0]) < up(river[nR - 1]);
      }
      const phase = rng() * Math.PI * 2;
      const wAt: number[] = [];
      for (let i = 0; i < nR; i++) {
        const t = nR > 1 ? i / (nR - 1) : 0;
        const tt = flip ? 1 - t : t;
        wAt.push(riverWidth * (0.6 + 0.78 * tt) * (1 + 0.1 * Math.sin(i * 0.9 + phase)));
      }
      for (const b of bridges) {
        const bc = centroid(b);
        for (let i = 0; i < nR; i++) if (dist(river[i], bc) < riverWidth * 2.2) wAt[i] *= 0.82;
      }
      const left: V[] = [], right: V[] = [];
      for (let i = 0; i < nR; i++) {
        const tg = norm(sub(river[Math.min(nR - 1, i + 1)], river[Math.max(0, i - 1)]));
        const h = wAt[i] / 2;
        left.push({ x: river[i].x - tg.y * h, y: river[i].y + tg.x * h });
        right.push({ x: river[i].x + tg.y * h, y: river[i].y - tg.x * h });
      }
      water.push([...left, ...right.reverse()]);
      course = { line: river, width: riverWidth };
    }
    waters = { shore, water, river: course };
  }

  const culture: CultureId = p.culture ?? 'imperial';
  const name = p.name ?? generateName(p.seed, 'city', { culture, kind: nInner > 24 ? 'capital' : 'settlement' });

  // ---- los oficios --------------------------------------------------------
  /**
   * QUÉ ES CADA EDIFICIO.
   *
   * Todo lo que no era castillo ni catedral salía con `kind: 'house'`, así que
   * el barrio elegía su oficio y por dentro no quedaba ni un dato que lo
   * reflejara: la fragua, la posada y el molino eran el mismo cuadrilátero.
   *
   * Es un pase POSTERIOR al parcelado a propósito. El sitio de una fragua no lo
   * decide el cortador de manzanas: lo decide dónde está la manzana. La posada,
   * en la puerta, que es por donde llega el que necesita cama; el molino, en el
   * río; los almacenes, en el muelle; la casa del gremio, dando a la plaza. Un
   * puñado por pueblo y cada uno donde tiene sentido — no una siembra al azar.
   */
  {
    let forges = 0, mills = 0, stores = 0, chapels = 0, towerHouses = 0;
    const maxForges = Math.max(1, Math.round(Math.sqrt(nInner) * 0.8));
    const maxMills = Math.min(4, Math.max(1, Math.round(nInner / 18)));
    const maxStores = Math.max(2, Math.round(Math.sqrt(nInner) * 1.3));
    const maxChapels = Math.min(6, Math.max(1, Math.round(nInner / 9)));
    const nearWater = (b: Building, line: V[], d: number) => lineDist(centroid(b.shape), line) < d;

    for (const q of inner) {
      if (!q.buildings.length) continue;
      const c = centroid(q.shape);
      switch (q.ward) {
        case 'market':
          // La casa del gremio y el ayuntamiento, en la mejor parcela de la plaza.
          promote(q.buildings, 'guild');
          if (nInner >= 12) promote(q.buildings, 'hall');
          break;
        case 'gate':
          // La posada y las cuadras. No hay 'stable' en la unión de tipos y un
          // establo es un cobertizo grande: sale como `shed`, que es lo que es.
          promote(q.buildings, 'inn');
          promote(q.buildings, 'shed');
          break;
        case 'military':
          promote(q.buildings, 'barracks');
          promote(q.buildings, 'barracks');
          break;
        case 'patriciate':
          // La casa-torre del linaje: en un pueblo rico hay dos o tres.
          if (towerHouses < 3 && rng() < 0.45) { if (promote(q.buildings, 'tower')) towerHouses++; }
          break;
        case 'craftsmen':
          if (forges < maxForges && rng() < 0.4) { if (promote(q.buildings, 'forge')) forges++; }
          break;
        default:
          break;
      }
      // El molino, donde hay fuerza: pegado al cauce.
      if (river && mills < maxMills && lineDist(c, river) < riverWidth * 5) {
        if (promote(q.buildings, 'mill', { where: (b) => nearWater(b, river!, riverWidth * 2.6) })) mills++;
      }
      // Los almacenes dan al muelle, que es la calle a la que se descarga.
      if (quayLine && stores < maxStores && lineDist(c, quayLine) < radius * 0.32) {
        for (let k = 0; k < 2 && stores < maxStores; k++) {
          if (promote(q.buildings, 'warehouse', { where: (b) => nearWater(b, quayLine!, MAIN_STREET * 3.5) })) stores++;
          else break;
        }
      }
      // Y una capilla de vez en cuando, que es pequeña y está en cualquier
      // barrio: la parroquia del barrio, no la catedral.
      if (chapels < maxChapels && q.ward !== 'cathedral' && q.ward !== 'castle' && rng() < 0.22) {
        if (promote(q.buildings, 'chapel', { smallest: true })) chapels++;
      }
    }

    // La posada de la puerta no puede depender de que el barrio de la puerta
    // haya salido: el sorteo del barrio 'puerta' es una moneda al aire por
    // manzana y en un pueblo de cinco puertas salía UNA posada. Quien llega de
    // noche y encuentra la puerta cerrada duerme fuera, y ahí es donde está la
    // posada — la tenga el barrio que la tenga.
    let inns = 0;
    for (let gi = 0; gi < gates.length && inns < 3; gi++) {
      const host = hostOf(gateAnchors[gi] ?? gates[gi]);
      if (!host || !host.buildings.length) continue;
      if (host.buildings.some((b) => b.kind === 'inn')) continue;
      if (promote(host.buildings, 'inn')) { inns++; promote(host.buildings, 'shed'); }
    }
  }

  // ---- los barrios con nombre propio --------------------------------------
  /**
   * EL BARRIO DE LOS CURTIDORES, NO 'craftsmen'.
   *
   * Un plano de Watabou rotula sus barrios con NOMBRES PROPIOS, no con el tipo
   * de barrio, y ésa es media firma del mapa. Aquí hay una ventaja que él no
   * tiene: una familia de lenguas de verdad, con raíces glosadas y cambios
   * fonéticos regulares, así que el nombre se ACUÑA en la lengua del pueblo y
   * significa algo — «vado del molino», «puerta alta» — y se parece a los
   * nombres de los pueblos vecinos como se parecen dos primos.
   *
   * El sesgo lo pone lo que el barrio ES: los curtidores están junto al agua
   * porque el agua es lo que hace falta para curtir, y el barrio de la puerta
   * se llama por su puerta. No se nombran todos: sólo los que un lector
   * nombraría, unos trece en una villa de quince distritos.
   */
  const districtNames: (string | null)[] = patches.map(() => null);
  {
    const { lang, proto } = p.language ?? tongueFor(culture);
    const taken = new Set<string>([name.toLowerCase()]);
    const coin = (key: string, heads: Gloss[], modifiers: Gloss[]): string => {
      for (let a = 0; a < 8; a++) {
        const t = coinName(lang, proto, `${key}#${a}`, p.seed, { heads, modifiers }).text;
        if (!taken.has(t.toLowerCase())) { taken.add(t.toLowerCase()); return t; }
      }
      return coinName(lang, proto, `${key}#f`, p.seed, { heads, modifiers }).text;
    };

    const cand: { i: number; score: number; heads: Gloss[]; mods: Gloss[] }[] = [];
    for (let i = 0; i < patches.length; i++) {
      const q = patches[i];
      if (!q.withinCity || q.shape.length < 3) continue;
      const c = centroid(q.shape);
      const heads: Gloss[] = [];
      const mods: Gloss[] = [];
      // Los barrios grandes se nombran antes que los rincones; el oficio pesa
      // más que el tamaño.
      let score = Math.min(1.2, area(q.shape) / (radius * radius) * 8);
      switch (q.ward) {
        case 'market': heads.push('market', 'town', 'house'); mods.push('great', 'old', 'gold'); score += 3; break;
        case 'cathedral': heads.push('stone', 'tower', 'grave', 'house'); mods.push('holy', 'white', 'god'); score += 2.6; break;
        case 'castle': heads.push('fort', 'tower', 'wall'); mods.push('king', 'high', 'old'); score += 2.4; break;
        case 'gate': heads.push('gate', 'road', 'wall'); mods.push('new', 'far', 'people'); score += 1.8; break;
        case 'administration': heads.push('house', 'town', 'wall'); mods.push('king', 'great', 'old'); score += 1.2; break;
        case 'merchant': heads.push('market', 'road', 'bridge', 'house'); mods.push('gold', 'new', 'people'); score += 1.1; break;
        case 'patriciate': heads.push('house', 'town', 'spring'); mods.push('high', 'gold', 'great'); score += 1.1; break;
        case 'military': heads.push('fort', 'tower', 'field'); mods.push('battle', 'king', 'grey'); score += 1; break;
        case 'park': heads.push('meadow', 'field', 'forest', 'spring'); mods.push('green', 'quiet', 'oak'); score += 0.9; break;
        case 'slum': heads.push('marsh', 'moor', 'grave', 'house'); mods.push('low', 'dark', 'small', 'black'); score += 0.7; break;
        default: heads.push('house', 'field', 'road', 'stone'); mods.push('old', 'small', 'people'); break;
      }
      if (river && lineDist(c, river) < riverWidth * 3.5) {
        heads.push('river', 'mill', 'ford', 'bridge');
        mods.push('water', 'wild', 'salmon');
        score += 0.9;
      }
      if (coast && (c.x - coast.p.x) * coast.n.x + (c.y - coast.p.y) * coast.n.y > -radius * 0.24) {
        heads.push('harbour', 'bay', 'sea');
        mods.push('salmon', 'white', 'cold');
        score += 1;
      }
      if (slopeDir && ((c.x * slopeDir.x + c.y * slopeDir.y) / Math.max(1, radius)) > 0.3) {
        heads.push('hill', 'rock', 'cliff');
        mods.push('high', 'grey', 'eagle');
        score += 0.6;
      }
      cand.push({ i, score, heads, mods });
    }
    cand.sort((a, b) => b.score - a.score || a.i - b.i);
    const want = Math.min(cand.length, 4 + Math.round(Math.sqrt(nInner) * 2.2));
    for (const c of cand.slice(0, want)) districtNames[c.i] = coin(`d${c.i}`, c.heads, c.mods);

    // Y las plazas, que se nombran por lo que son.
    const SQUARE_BIAS: Record<SquareKind, { heads: Gloss[]; mods: Gloss[] }> = {
      market: { heads: ['market', 'town', 'house'], mods: ['great', 'old', 'gold'] },
      church: { heads: ['stone', 'grave', 'house'], mods: ['holy', 'white'] },
      harbour: { heads: ['harbour', 'bay', 'sea'], mods: ['salmon', 'cold'] },
      gate: { heads: ['gate', 'road', 'wall'], mods: ['new', 'far'] },
      lesser: { heads: ['spring', 'stone', 'road', 'house'], mods: ['small', 'quiet', 'old'] },
    };
    squares.forEach((s, k) => {
      const b = SQUARE_BIAS[s.kind];
      s.name = coin(`sq${k}:${s.kind}`, b.heads, b.mods);
    });
  }

  return {
    name,
    seed: p.seed,
    size: nInner,
    patches,
    wall: p.walls && wallRing.length >= 6 ? wallRing : null,
    wallClosed,
    gates,
    towers: p.walls ? towers : [],
    citadel: citadelPatch ? citadelPatch.shape : null,
    streets,
    mainStreets,
    bridges,
    piers,
    roads,
    river,
    coast,
    center,
    radius,
    squares,
    fort,
    waters,
    districtNames,
    population: p.population ?? Math.round(nInner * 320 * (0.7 + rng() * 0.8)),
  };
}

export { contains };
