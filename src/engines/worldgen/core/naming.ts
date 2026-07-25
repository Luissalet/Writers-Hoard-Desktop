// ============================================
// World Generator — Toponymy
// ============================================
// Place names that sound like they come from somewhere. Each culture is a tiny
// phonology — an inventory of onsets, nuclei and codas plus syllable rules and
// a morphology of affixes — rather than a bag of pre-written names, so a world
// can produce thousands of names that are all recognisably from the same
// language family and clearly different from the neighbouring one.
//
// Everything is deterministic: (seed, kind, index) → the same name forever.

import { createRng, rngInt, type Rng } from './rng';

export type CultureId = 'nordic' | 'latin' | 'celtic' | 'desert' | 'sylvan' | 'orcish' | 'imperial';

interface Culture {
  id: CultureId;
  name: string;
  onset: string[];
  nucleus: string[];
  coda: string[];
  /** Endings appended to a stem to make a settlement name. */
  townSuffix: string[];
  /** Endings that make a region/realm name. */
  landSuffix: string[];
  /** Optional particles: "of", "the" equivalents used in compound names. */
  particles: string[];
  /** Probability a syllable takes a coda. */
  codaChance: number;
  /** Syllable count weights for a 1/2/3-syllable stem. */
  syllables: [number, number, number];
  /** Applied after assembly to fix illegal clusters and add orthography. */
  polish?: (s: string) => string;
}

const CULTURES: Record<CultureId, Culture> = {
  nordic: {
    id: 'nordic',
    name: 'Nórdica',
    onset: ['sk', 'st', 'thr', 'hv', 'br', 'gr', 'kn', 'sv', 'fj', 'v', 'h', 'b', 'd', 'g', 'r', 'th', 'n', 'm', 'k', 'l'],
    nucleus: ['a', 'e', 'i', 'o', 'u', 'y', 'au', 'ei', 'ja', 'ø', 'å'],
    coda: ['rn', 'ld', 'lf', 'rk', 'st', 'nd', 'ng', 'r', 'k', 'l', 'm', 'n', 'ft', 'ss'],
    townSuffix: ['heim', 'by', 'vik', 'stad', 'holm', 'fjord', 'nes', 'borg', 'gard', 'dal', 'havn', 'skar'],
    landSuffix: ['land', 'mark', 'heim', 'rike', 'vold', 'strand'],
    particles: ['av', 'i'],
    codaChance: 0.62,
    syllables: [0.3, 0.55, 0.15],
  },
  latin: {
    id: 'latin',
    name: 'Latina',
    onset: ['v', 'c', 'l', 'm', 'r', 't', 'p', 'f', 'n', 'br', 'cl', 'gr', 'tr', 'pr', 's', 'd', 'alb', 'aur'],
    nucleus: ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'io', 'ua'],
    coda: ['n', 'r', 's', 'l', 'nt', 'st', 'rt', 'lm'],
    townSuffix: ['ium', 'ia', 'anum', 'ona', 'ara', 'entum', 'aris', 'olis', 'ino', 'ella'],
    landSuffix: ['ia', 'ania', 'oria', 'atia', 'ium'],
    particles: ['de', 'della'],
    codaChance: 0.34,
    syllables: [0.18, 0.5, 0.32],
  },
  celtic: {
    id: 'celtic',
    name: 'Céltica',
    onset: ['c', 'd', 'g', 'l', 'm', 'br', 'gl', 'cr', 'dr', 'll', 'rh', 'tr', 'k', 'b', 'f', 'n', 'ae'],
    nucleus: ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'y', 'wy', 'ui'],
    coda: ['n', 'r', 'll', 'nn', 'th', 'ch', 'dd', 'rn', 'gh', 'm'],
    townSuffix: ['dun', 'more', 'gara', 'wyn', 'lyn', 'nach', 'ford', 'mere', 'keth', 'ross'],
    landSuffix: ['ia', 'wall', 'gard', 'mere', 'shire', 'ness'],
    particles: ['ap', 'na'],
    codaChance: 0.5,
    syllables: [0.24, 0.54, 0.22],
  },
  desert: {
    id: 'desert',
    name: 'Del desierto',
    onset: ['h', 'k', 'kh', 'm', 'n', 'q', 'r', 's', 'sh', 't', 'z', 'j', 'b', 'd', 'f', 'gh'],
    nucleus: ['a', 'i', 'u', 'aa', 'ii', 'ay', 'ou'],
    coda: ['r', 'n', 'm', 'd', 'z', 'sh', 'q', 'rr', 'l'],
    townSuffix: ['abad', 'ara', 'iyya', 'ir', 'an', 'ah', 'un', 'assa', 'kar'],
    landSuffix: ['istan', 'iyya', 'ara', 'ad'],
    particles: ['al', 'el', 'bin'],
    codaChance: 0.55,
    syllables: [0.24, 0.52, 0.24],
  },
  sylvan: {
    id: 'sylvan',
    name: 'Sylvana',
    onset: ['ael', 'c', 'el', 'f', 'g', 'l', 'm', 'n', 's', 'th', 'v', 'y', 'gl', 'sil', 'lor', 'ith'],
    nucleus: ['a', 'e', 'i', 'o', 'ae', 'ea', 'ia', 'io', 'ui', 'ee'],
    coda: ['l', 'n', 'r', 's', 'th', 'nd', 'ss', 'll'],
    townSuffix: ['ith', 'iel', 'ael', 'orin', 'wen', 'las', 'dor', 'ara', 'ion', 'eth'],
    landSuffix: ['dor', 'ion', 'wen', 'las', 'thil'],
    particles: ['en', 'a'],
    codaChance: 0.4,
    syllables: [0.16, 0.46, 0.38],
  },
  orcish: {
    id: 'orcish',
    name: 'Órquica',
    onset: ['g', 'gr', 'k', 'kr', 'm', 'n', 'r', 'sh', 'th', 'ur', 'z', 'zg', 'b', 'dr', 'skr'],
    nucleus: ['a', 'o', 'u', 'aa', 'uu', 'ai'],
    coda: ['g', 'k', 'kh', 'r', 'rk', 'sh', 'z', 'zg', 'gh', 'm', 'nk'],
    townSuffix: ['ak', 'urg', 'mar', 'ghul', 'nak', 'oth', 'zar', 'dur', 'kaz'],
    landSuffix: ['ak', 'dur', 'oth', 'gar'],
    particles: ['uk', 'ka'],
    codaChance: 0.78,
    syllables: [0.42, 0.46, 0.12],
  },
  imperial: {
    id: 'imperial',
    name: 'Imperial',
    onset: ['b', 'd', 'f', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'w', 'br', 'st', 'gr', 'wh', 'kn'],
    nucleus: ['a', 'e', 'i', 'o', 'u', 'ea', 'ou', 'ai', 'oo'],
    coda: ['ck', 'ld', 'll', 'ng', 'nt', 'rd', 'rk', 'sh', 'st', 'th', 'n', 'r', 'm'],
    townSuffix: ['ford', 'ton', 'bury', 'hold', 'gate', 'mouth', 'wick', 'field', 'stead', 'watch', 'crest', 'reach'],
    landSuffix: ['land', 'shire', 'march', 'reach', 'hold', 'wold'],
    particles: ['of', 'upon'],
    codaChance: 0.6,
    syllables: [0.34, 0.5, 0.16],
  },
};

export const CULTURE_IDS = Object.keys(CULTURES) as CultureId[];
export function cultureName(id: CultureId): string {
  return CULTURES[id].name;
}

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Collapse triples, kill impossible clusters, tidy doubled vowels. */
function clean(s: string): string {
  return s
    .replace(/(.)\1\1+/g, '$1$1')
    .replace(/([aeiouy])\1{2,}/g, '$1$1')
    .replace(/([^aeiouy])\1(?=[^aeiouy])/g, '$1')
    .replace(/^-+|-+$/g, '');
}

/** Build a bare stem in a culture's phonology. */
export function makeStem(rng: Rng, cultureId: CultureId): string {
  const c = CULTURES[cultureId];
  // Cultures with multi-letter onsets ('sil-', 'thr-') can stack into stems no
  // reader will attempt. Re-roll anything past a comfortable length; after a
  // few tries fall back to a two-syllable build.
  for (let attempt = 0; attempt < 6; attempt++) {
    const roll = rng();
    const n = attempt >= 4 ? 2 : roll < c.syllables[0] ? 1 : roll < c.syllables[0] + c.syllables[1] ? 2 : 3;
    let out = '';
    for (let i = 0; i < n; i++) {
      out += pick(rng, c.onset) + pick(rng, c.nucleus);
      if (rng() < c.codaChance && (i === n - 1 || rng() < 0.5)) out += pick(rng, c.coda);
    }
    out = clean(out);
    if (out.length >= 3 && out.length <= 10) return out;
  }
  return clean(pick(rng, c.onset) + pick(rng, c.nucleus) + pick(rng, c.coda));
}

export type FeatureKind =
  | 'settlement' | 'capital' | 'realm' | 'continent' | 'ocean' | 'sea' | 'bay' | 'strait'
  | 'isle' | 'range' | 'peak' | 'forest' | 'desert' | 'river' | 'lake' | 'marsh' | 'cape'
  | 'valley' | 'plain' | 'volcano' | 'cave' | 'waterfall' | 'gorge' | 'hotspring';

/** Descriptive templates per feature class. `{n}` is the generated stem. */
const TEMPLATES: Record<FeatureKind, string[]> = {
  settlement: ['{n}', '{n}', '{n}', '{n}{ts}', '{n}{ts}', 'Puerto {n}', 'Alto {n}', '{n} del Vado'],
  capital: ['{n}', '{n}{ts}', 'Gran {n}', '{n} Real', 'Corona de {n}'],
  realm: ['{n}{ls}', 'Reino de {n}', '{n}{ls}', 'Ducado de {n}', 'Confederación de {n}{ls}', 'Dominio de {n}'],
  continent: ['{n}{ls}', '{n}', 'Gran {n}{ls}'],
  ocean: ['Océano {n}', 'Mar Sin Fin de {n}', 'Océano {n}', 'Aguas de {n}'],
  sea: ['Mar de {n}', 'Mar {n}', 'Golfo de {n}'],
  bay: ['Bahía de {n}', 'Ensenada de {n}', 'Golfo de {n}'],
  strait: ['Estrecho de {n}', 'Paso de {n}', 'Canal de {n}'],
  isle: ['Isla de {n}', 'Isla {n}', '{n}', 'Islas {n}'],
  range: ['Montes {n}', 'Sierra de {n}', 'Cordillera {n}', 'Picos de {n}', 'Espinazo de {n}', 'Montañas {n}'],
  peak: ['Monte {n}', 'Pico {n}', 'Cima de {n}', 'Aguja de {n}'],
  forest: ['Bosque de {n}', 'Selva {n}', 'Espesura de {n}', 'Bosque {n}', 'Fronda de {n}'],
  desert: ['Desierto de {n}', 'Yermos de {n}', 'Arenas de {n}', 'Erial {n}'],
  river: ['Río {n}', '{n}', 'Río {n}', 'Corriente {n}'],
  lake: ['Lago {n}', 'Lago de {n}', 'Laguna {n}', 'Espejo de {n}'],
  marsh: ['Marismas de {n}', 'Ciénaga {n}', 'Pantanos de {n}'],
  cape: ['Cabo {n}', 'Punta {n}', 'Cabo de {n}'],
  valley: ['Valle de {n}', 'Cañada {n}', 'Hondonada de {n}'],
  plain: ['Llanura de {n}', 'Estepa {n}', 'Praderas de {n}', 'Campos de {n}'],
  volcano: ['Monte {n}', 'Fragua de {n}', 'Caldera {n}'],
  cave: ['Cuevas de {n}', 'Cavernas {n}', 'Sima de {n}'],
  waterfall: ['Cataratas de {n}', 'Salto de {n}', 'Velo de {n}'],
  gorge: ['Garganta de {n}', 'Desfiladero {n}', 'Tajo de {n}'],
  hotspring: ['Fuentes de {n}', 'Termas de {n}', 'Aguas de {n}'],
};

/** Evocative adjectives occasionally appended, cartographer-style. */
const EPITHETS = [
  'Antiguo', 'Roto', 'Oculto', 'Helado', 'Ardiente', 'Sombrío', 'Dorado', 'Perdido',
  'Silencioso', 'Errante', 'Blanco', 'Negro', 'Rojo', 'Postrero', 'Sagrado', 'Maldito',
];

export interface NameOptions {
  culture: CultureId;
  kind: FeatureKind;
  /** Chance of an appended epithet ("… Roto"). */
  epithetChance?: number;
}

/** Generate one name. `key` makes it stable across regenerations. */
export function generateName(seed: string, key: string, opts: NameOptions): string {
  const rng = createRng(seed, `name:${opts.kind}:${key}`);
  const c = CULTURES[opts.culture];
  const stem = capitalize(makeStem(rng, opts.culture));
  const templates = TEMPLATES[opts.kind] ?? TEMPLATES.settlement;
  let out = pick(rng, templates)
    .replace('{n}', stem)
    .replace('{ts}', pick(rng, c.townSuffix))
    .replace('{ls}', pick(rng, c.landSuffix));
  out = clean(out);
  const ep = opts.epithetChance ?? (opts.kind === 'settlement' ? 0.03 : 0.12);
  if (rng() < ep) out += ` ${pick(rng, EPITHETS)}`;
  return out;
}

/** A pool that refuses to hand out the same name twice in one world. */
export class NameRegistry {
  private used = new Set<string>();
  private seed: string;

  // Assigned in the body rather than declared as a constructor parameter
  // property: the project builds with `erasableSyntaxOnly`, which forbids the
  // shorthand because it emits code rather than only erasing types.
  constructor(seed: string) {
    this.seed = seed;
  }

  /** Reserve an externally-coined name. False if it is already taken. */
  claim(name: string): boolean {
    const norm = name.toLowerCase();
    if (this.used.has(norm)) return false;
    this.used.add(norm);
    return true;
  }

  take(key: string, opts: NameOptions): string {
    for (let attempt = 0; attempt < 24; attempt++) {
      const n = generateName(this.seed, `${key}#${attempt}`, opts);
      const norm = n.toLowerCase();
      if (!this.used.has(norm)) {
        this.used.add(norm);
        return n;
      }
    }
    return generateName(this.seed, `${key}#fallback${this.used.size}`, opts);
  }
}

/**
 * Assign a culture to every point on the map. Cultures cluster: a handful of
 * seeds spread over the world and each location takes the nearest one, so a
 * coastline's towns share a language instead of each rolling independently.
 */
export function cultureMap(seed: string, W: number, H: number, count = 6): {
  cultureAt: (x: number, y: number) => CultureId;
  seeds: { x: number; y: number; culture: CultureId }[];
} {
  const rng = createRng(seed, 'cultures');
  const pool = CULTURE_IDS.slice();
  const seeds: { x: number; y: number; culture: CultureId }[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: rng() * W,
      y: H * 0.12 + rng() * H * 0.76,
      culture: pool[rngInt(rng, 0, pool.length - 1)],
    });
  }
  const cultureAt = (x: number, y: number): CultureId => {
    let best = seeds[0], bestD = Infinity;
    for (const s of seeds) {
      let dx = Math.abs(s.x - x);
      if (dx > W / 2) dx = W - dx;
      const dy = s.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best.culture;
  };
  return { cultureAt, seeds };
}
