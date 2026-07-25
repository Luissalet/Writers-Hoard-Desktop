// ============================================
// World Generator — Language families
// ============================================
// Place names generated independently are the fastest way to make a world feel
// assembled rather than inhabited. Real toponyms are not decoration: they are
// fossils. "Kaldvik" and "Chaldwich" look unrelated until you know both descend
// from the same *kalda-wīk, "cold bay", and that one branch turned /k/ before a
// front vowel into /tʃ/ while the other did not. A reader who never learns the
// rule still feels the relatedness — that is what makes a map read as a place
// with a past.
//
// So instead of one name generator per culture, this builds a FAMILY TREE:
//
//   a proto-language      an inventory plus ~60 root morphemes with meanings
//   sound changes         ordered, regular rules applied along each branch
//   daughter languages    each a different accumulated set of those rules
//
// Every name is therefore a compound of roots with a real gloss, and cognates
// between neighbouring realms fall out for free. The gazetteer can then print
// the etymology, which is the single most useful thing this engine can hand a
// writer.

import { createRng, rngInt, type Rng } from './rng';

// ---------------------------------------------------------------------------
// The proto-lexicon
// ---------------------------------------------------------------------------

export type Gloss =
  | 'water' | 'river' | 'lake' | 'sea' | 'spring' | 'ford' | 'bay' | 'island'
  | 'mountain' | 'hill' | 'rock' | 'stone' | 'cliff' | 'valley' | 'pass' | 'field'
  | 'forest' | 'tree' | 'oak' | 'pine' | 'meadow' | 'marsh' | 'moor' | 'sand'
  | 'high' | 'low' | 'great' | 'small' | 'old' | 'new' | 'far' | 'holy'
  | 'black' | 'white' | 'red' | 'green' | 'grey' | 'gold'
  | 'cold' | 'warm' | 'dark' | 'bright' | 'quiet' | 'wild'
  | 'fort' | 'wall' | 'gate' | 'tower' | 'bridge' | 'market' | 'harbour' | 'mill'
  | 'house' | 'town' | 'people' | 'king' | 'god' | 'grave' | 'battle' | 'road'
  | 'bear' | 'wolf' | 'raven' | 'horse' | 'eagle' | 'salmon' | 'boar' | 'serpent';

/** Rough English gloss, for the etymology line in the gazetteer. */
export const GLOSS_ES: Record<Gloss, string> = {
  water: 'agua', river: 'río', lake: 'lago', sea: 'mar', spring: 'fuente',
  ford: 'vado', bay: 'bahía', island: 'isla', mountain: 'monte', hill: 'colina',
  rock: 'roca', stone: 'piedra', cliff: 'risco', valley: 'valle', pass: 'paso',
  field: 'campo', forest: 'bosque', tree: 'árbol', oak: 'roble', pine: 'pino',
  meadow: 'prado', marsh: 'marisma', moor: 'páramo', sand: 'arena',
  high: 'alto', low: 'bajo', great: 'grande', small: 'pequeño', old: 'viejo',
  new: 'nuevo', far: 'lejano', holy: 'sagrado', black: 'negro', white: 'blanco',
  red: 'rojo', green: 'verde', grey: 'gris', gold: 'dorado', cold: 'frío',
  warm: 'cálido', dark: 'oscuro', bright: 'luminoso', quiet: 'silencioso',
  wild: 'salvaje', fort: 'fuerte', wall: 'muralla', gate: 'puerta', tower: 'torre',
  bridge: 'puente', market: 'mercado', harbour: 'puerto', mill: 'molino',
  house: 'casa', town: 'villa', people: 'gente', king: 'rey', god: 'dios',
  grave: 'tumba', battle: 'batalla', road: 'camino', bear: 'oso', wolf: 'lobo',
  raven: 'cuervo', horse: 'caballo', eagle: 'águila', salmon: 'salmón',
  boar: 'jabalí', serpent: 'serpiente',
};

const ALL_GLOSSES = Object.keys(GLOSS_ES) as Gloss[];

/** Which glosses can head a place name (the thing itself) versus modify one. */
const HEADS: Gloss[] = [
  'river', 'lake', 'sea', 'spring', 'ford', 'bay', 'island', 'mountain', 'hill',
  'rock', 'cliff', 'valley', 'pass', 'field', 'forest', 'meadow', 'marsh', 'moor',
  'fort', 'wall', 'gate', 'tower', 'bridge', 'market', 'harbour', 'mill', 'house',
  'town', 'grave', 'road', 'stone',
];
const MODIFIERS: Gloss[] = [
  'high', 'low', 'great', 'small', 'old', 'new', 'far', 'holy', 'black', 'white',
  'red', 'green', 'grey', 'gold', 'cold', 'warm', 'dark', 'bright', 'quiet',
  'wild', 'bear', 'wolf', 'raven', 'horse', 'eagle', 'salmon', 'boar', 'serpent',
  'king', 'god', 'people', 'oak', 'pine', 'tree', 'sand', 'water', 'stone', 'battle',
];

// ---------------------------------------------------------------------------
// Sound changes
// ---------------------------------------------------------------------------

interface SoundChange {
  name: string;
  apply: (w: string) => string;
}

/** The rule inventory. Each is a real, attested type of regular change. */
const CHANGES: SoundChange[] = [
  { name: 'lenición de oclusivas sordas', apply: (w) => w.replace(/([aeiouáéíóú])p([aeiouáéíóú])/g, '$1b$2').replace(/([aeiou])t([aeiou])/g, '$1d$2').replace(/([aeiou])k([aeiou])/g, '$1g$2') },
  { name: 'espirantización', apply: (w) => w.replace(/([aeiou])b([aeiou])/g, '$1v$2').replace(/([aeiou])g([aeiou])/g, '$1gh$2') },
  { name: 'palatalización de velares', apply: (w) => w.replace(/k([ei])/g, 'ch$1').replace(/g([ei])/g, 'j$1') },
  { name: 'pérdida de vocal final', apply: (w) => w.replace(/([^aeiou])[aeiou]$/, '$1') },
  { name: 'apócope de nasal final', apply: (w) => w.replace(/[nm]$/, '') },
  { name: 'rotacismo', apply: (w) => w.replace(/([aeiou])s([aeiou])/g, '$1r$2') },
  { name: 'gran cambio vocálico', apply: (w) => w.replace(/a/g, 'e').replace(/o/g, 'u').replace(/e(?=[^aeiou]*$)/g, 'i') },
  // Rules that always find an environment. Without a few of these the daughters
  // of a branch come out nearly identical, because most conditioned changes
  // simply never fire on a sixty-word lexicon.
  { name: 'cierre vocálico', apply: (w) => w.replace(/e/g, 'i').replace(/o/g, 'u') },
  { name: 'apertura vocálica', apply: (w) => w.replace(/i/g, 'e').replace(/u/g, 'o') },
  { name: 'sonorización general', apply: (w) => w.replace(/p/g, 'b').replace(/t/g, 'd').replace(/k/g, 'g') },
  { name: 'ensordecimiento general', apply: (w) => w.replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k') },
  { name: 'th → s', apply: (w) => w.replace(/th/g, 's') },
  { name: 'th → f', apply: (w) => w.replace(/th/g, 'f') },
  { name: 's → h', apply: (w) => w.replace(/^s(?=[aeiou])/, 'h').replace(/([aeiou])s([aeiou])/g, '$1h$2') },
  { name: 'l → r', apply: (w) => w.replace(/l/g, 'r') },
  { name: 'r → l', apply: (w) => w.replace(/r/g, 'l') },
  { name: 'm → n final', apply: (w) => w.replace(/m$/, 'n') },
  { name: 'w → v', apply: (w) => w.replace(/w/g, 'v') },
  { name: 'k → h inicial', apply: (w) => w.replace(/^k/, 'h') },
  { name: 'diptongación de tónicas', apply: (w) => w.replace(/^([^aeiou]*)e/, '$1ie').replace(/^([^aeiou]*)o/, '$1ue') },
  { name: 'umlaut', apply: (w) => (/i|e/.test(w.slice(-2)) ? w.replace(/a([^aeiou]*[ie])/, 'ä$1').replace(/u([^aeiou]*[ie])/, 'y$1') : w) },
  { name: 'simplificación de grupos', apply: (w) => w.replace(/([^aeiou])\1/g, '$1').replace(/kt/g, 'ch').replace(/pt/g, 't').replace(/ns/g, 's') },
  { name: 'pérdida de /h/', apply: (w) => w.replace(/h(?![aeiou]$)/g, '') },
  { name: 'prótesis vocálica', apply: (w) => w.replace(/^s([^aeiou])/, 'es$1') },
  { name: 'vocalización de /l/', apply: (w) => w.replace(/l([^aeiou])/g, 'u$1') },
  { name: 'metátesis de /r/', apply: (w) => w.replace(/([^aeiou])r([aeiou])/, '$1$2r') },
  { name: 'ensordecimiento final', apply: (w) => w.replace(/b$/, 'p').replace(/d$/, 't').replace(/g$/, 'k').replace(/v$/, 'f') },
  { name: 'nasalización', apply: (w) => w.replace(/([aeiou])[nm]([^aeiou])/g, '$1n$2') },
  { name: 'asibilación de /t/', apply: (w) => w.replace(/ti([aeiou])/g, 'ci$1').replace(/t([ij])/g, 'ts$1') },
  { name: 'fortalecimiento de /w/', apply: (w) => w.replace(/^w/, 'gu').replace(/([aeiou])w/g, '$1v') },
  { name: 'síncopa de vocal interior', apply: (w) => w.replace(/([aeiou][^aeiou])[aeiou]([^aeiou][aeiou])/, '$1$2') },
  { name: 'geminación', apply: (w) => w.replace(/([aeiou])([kptmnlr])([aeiou])/, '$1$2$2$3') },
];

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export interface Language {
  id: string;
  name: string;
  /** The parent language's id, or null for the proto-language. */
  parent: string | null;
  /** Names of the sound changes that separate this from its parent. */
  innovations: string[];
  /** Depth in the tree: 0 = proto. */
  depth: number;
  /** The derived form of every proto-root. */
  lexicon: Record<Gloss, string>;
  /** Endings this language uses to turn a compound into a place name. */
  suffixes: string[];
  /** Genitive/linking element between two roots ("-s-", "-en-", ""). */
  linker: string[];
  /** Orthographic flavour applied last: accents, digraphs, doubled letters. */
  orthography: (w: string) => string;
}

export interface LanguageFamily {
  proto: Language;
  /** Every language including the proto and the intermediate branches. */
  all: Language[];
  /** The living languages actually spoken by cultures on the map. */
  living: Language[];
  byId: Map<string, Language>;
}

const ONSETS = ['b', 'br', 'd', 'dr', 'g', 'gr', 'h', 'k', 'kr', 'kl', 'l', 'm', 'n', 'p', 'pr', 'r', 's', 'sk', 'sl', 'sn', 'st', 't', 'tr', 'v', 'w', 'th', 'f', 'fl'];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ai', 'au', 'ei', 'ou', 'ia'];
const CODAS = ['', '', 'l', 'n', 'r', 's', 'th', 'k', 't', 'm', 'nd', 'rk', 'st', 'ld', 'ng'];

function pick<T>(rng: Rng, a: T[]): T {
  return a[Math.min(a.length - 1, Math.floor(rng() * a.length))];
}

/** Build the proto-language: one invented root per gloss. */
function buildProto(rng: Rng): Language {
  const lexicon = {} as Record<Gloss, string>;
  const used = new Set<string>();
  for (const gl of ALL_GLOSSES) {
    let root = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      // Mostly monosyllables: a proto-root is a morpheme, and compounds of two
      // disyllables are already at the edge of what a reader will attempt.
      const syll = rng() < 0.78 ? 1 : 2;
      root = '';
      for (let s = 0; s < syll; s++) root += pick(rng, ONSETS) + pick(rng, NUCLEI) + pick(rng, CODAS);
      root = tidy(root);
      if (root.length >= 2 && root.length <= 6 && !used.has(root)) break;
    }
    used.add(root);
    lexicon[gl] = root;
  }
  return {
    id: 'proto',
    name: 'protolengua',
    parent: null,
    innovations: [],
    depth: 0,
    lexicon,
    suffixes: ['', 'a', 'on'],
    linker: ['', 'a'],
    orthography: (w) => w,
  };
}

/** Orthographic conventions — how a language is WRITTEN, independent of how it
 *  changed. Two sisters can share a sound and spell it differently, which is
 *  exactly what makes real cognate pairs look more distant than they are. */
function makeOrthography(rng: Rng): { fn: (w: string) => string; label: string } {
  const style = rngInt(rng, 0, 5);
  switch (style) {
    case 0: return { label: 'nórdica', fn: (w) => w.replace(/th/g, 'th').replace(/a(?=[^aeiou]*$)/, 'å').replace(/o/, 'ø') };
    case 1: return { label: 'insular', fn: (w) => w.replace(/k/g, 'c').replace(/v/g, 'f').replace(/gh/g, 'gh') };
    // Only word-initial, and only once: a blanket k→qu turned 'snukkok' into
    // 'esnuququoqu'.
    case 2: return { label: 'romance', fn: (w) => w.replace(/^k/, 'qu').replace(/th/g, 't').replace(/^w/, 'gu') };
    case 3: return { label: 'oriental', fn: (w) => w.replace(/ch/g, 'kh').replace(/j/g, 'zh').replace(/u/, 'ü') };
    case 4: return { label: 'arcaica', fn: (w) => w.replace(/v/g, 'w').replace(/i(?=[aeiou])/g, 'y') };
    default: return { label: 'llana', fn: (w) => w };
  }
}

const LANG_NAME_PARTS = [
  'vethr', 'kald', 'muron', 'sarn', 'ilth', 'brann', 'okk', 'dael', 'tyrn',
  'faun', 'gorm', 'sil', 'ashk', 'ruvan', 'thess', 'nold', 'yar', 'quel',
];
const LANG_SUFFIX = ['ic', 'ian', 'ish', 'ese', 'an', 'aic'];

/**
 * Grow a family tree. Depth 1 gives the branches, depth 2 the living languages —
 * enough for sisters that are clearly related and cousins that are not obviously
 * so, which is the range a reader can actually perceive.
 */
export function buildLanguageFamily(seed: string, livingCount: number): LanguageFamily {
  const rng = createRng(seed, 'language');
  const proto = buildProto(rng);
  const all: Language[] = [proto];
  const byId = new Map<string, Language>([[proto.id, proto]]);

  const derive = (parent: Language, id: string, ruleCount: number): Language => {
    const rules: SoundChange[] = [];
    const pool = CHANGES.slice();
    for (let k = 0; k < ruleCount && pool.length; k++) {
      rules.push(pool.splice(rngInt(rng, 0, pool.length - 1), 1)[0]);
    }
    const lexicon = {} as Record<Gloss, string>;
    for (const gl of ALL_GLOSSES) {
      let w = parent.lexicon[gl];
      // Rules apply in order, as they do historically: an earlier change can
      // create the environment a later one needs.
      for (const r of rules) w = r.apply(w);
      w = tidy(w);
      // A root must remain pronounceable. Chained deletions can strip every
      // vowel — 'klu' became 'hl' — and a vowelless root poisons every compound
      // built on it, so it reverts to the parent form rather than being kept.
      if (w.length < 2 || !/[aeiouäöüy]/.test(w) || syllables(w) < 1) w = parent.lexicon[gl];
      lexicon[gl] = w;
    }
    const orth = makeOrthography(rng);
    const stem = pick(rng, LANG_NAME_PARTS);
    return {
      id,
      name: (stem + pick(rng, LANG_SUFFIX)).replace(/^./, (c) => c.toUpperCase()),
      parent: parent.id,
      innovations: rules.map((r) => r.name),
      depth: parent.depth + 1,
      lexicon,
      suffixes: Array.from({ length: 4 }, () => (rng() < 0.25 ? '' : pick(rng, NUCLEI).slice(0, 1) + pick(rng, CODAS))),
      linker: ['', '', pick(rng, ['s', 'en', 'a', 'i', 'o'])],
      orthography: orth.fn,
    };
  };

  // Branches: two or three, each with several daughters.
  const branchCount = Math.max(2, Math.min(3, Math.round(livingCount / 3)));
  const living: Language[] = [];
  for (let b = 0; b < branchCount; b++) {
    const branch = derive(proto, `b${b}`, rngInt(rng, 3, 5));
    all.push(branch);
    byId.set(branch.id, branch);
    const daughters = Math.max(1, Math.ceil(livingCount / branchCount));
    for (let d = 0; d < daughters && living.length < livingCount; d++) {
      const lang = derive(branch, `b${b}d${d}`, rngInt(rng, 2, 4));
      all.push(lang);
      byId.set(lang.id, lang);
      living.push(lang);
    }
  }
  return { proto, all, living, byId };
}

// ---------------------------------------------------------------------------
// Name construction
// ---------------------------------------------------------------------------

export interface CoinedName {
  /** The name as written on the map. */
  text: string;
  /** The glosses it is built from, in order. */
  parts: Gloss[];
  /** The reconstructed proto form, conventionally starred. */
  proto: string;
  /** Which language coined it. */
  langId: string;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Phonotactic repair. Sound changes and compounding both happily produce
 * clusters no language would tolerate — 'Esnuququoqu', 'Prsroutald'. Real
 * languages repair such sequences the moment they arise, by deleting, inserting
 * or assimilating, so doing the same here is not a cheat.
 */
function tidy(s: string): string {
  let w = s.toLowerCase();
  // Treat digraphs as single units so they survive the cluster rules.
  w = w.replace(/th/g, 'Θ').replace(/ch/g, 'Ç').replace(/gh/g, 'Ğ').replace(/qu/g, 'Q');
  for (let pass = 0; pass < 3; pass++) {
    w = w
      .replace(/(.)\1\1+/g, '$1$1')                       // no triples
      .replace(/([^aeiouáéíóúäöüy])\1/g, '$1')            // no geminates across a seam
      .replace(/([aeiouäöüy]){3,}/g, '$1$1')               // no vowel pileups
      // Three or more consonants in a row: drop the middle one.
      .replace(/([^aeiouäöüy])([^aeiouäöüy])([^aeiouäöüy])/g, '$1$3')
      .replace(/^([^aeiouäöüy]{3,})/, (m) => m.slice(-2));
  }
  w = w.replace(/Θ/g, 'th').replace(/Ç/g, 'ch').replace(/Ğ/g, 'gh').replace(/Q/g, 'qu');
  return w.replace(/^-+|-+$/g, '');
}

/** Rough syllable count, to keep names sayable. */
function syllables(w: string): number {
  return (w.match(/[aeiouäöüy]+/g) ?? []).length;
}

/** Clip a root to its first syllable plus a closing consonant — what really
 *  happens to the first element of a long compound. */
function clipRoot(w: string): string {
  const m = w.match(/^[^aeiouäöüy]*[aeiouäöüy]+[^aeiouäöüy]?/);
  return m ? m[0] : w;
}

/**
 * Coin a place name in `lang`. `bias` nudges the choice of head root toward
 * glosses that fit the site — a port should tend to be called a harbour.
 */
export function coinName(
  lang: Language,
  proto: Language,
  key: string,
  seed: string,
  bias?: { heads?: Gloss[]; modifiers?: Gloss[] },
): CoinedName {
  const rng = createRng(seed, `coin:${lang.id}:${key}`);
  const headPool = bias?.heads && bias.heads.length && rng() < 0.75 ? bias.heads : HEADS;
  const modPool = bias?.modifiers && bias.modifiers.length && rng() < 0.5 ? bias.modifiers : MODIFIERS;

  const head = pick(rng, headPool);
  const compound = rng() < 0.78;
  const parts: Gloss[] = compound ? [pick(rng, modPool), head] : [head];

  const join = (lex: Record<Gloss, string>, linkers: string[]) => {
    let out = lex[parts[0]];
    for (let k = 1; k < parts.length; k++) {
      const next = lex[parts[k]];
      // Clip the first element when the compound would run long, the way
      // Ox-ford and Stras-bourg reduce theirs.
      if (syllables(out) + syllables(next) > 2) out = clipRoot(out);
      out += pick(rng, linkers) + next;
    }
    return out;
  };

  let text = tidy(join(lang.lexicon, lang.linker));
  if (syllables(text) <= 2 && rng() < 0.5) text += pick(rng, lang.suffixes);
  text = tidy(lang.orthography(text));
  // Last resort: a name past three syllables gets its head only.
  if (syllables(text) > 3 || text.length > 13) {
    text = tidy(lang.orthography(lang.lexicon[parts[parts.length - 1]]));
  }
  const protoForm = tidy(join(proto.lexicon, proto.linker));

  return {
    text: capitalize(text),
    parts,
    proto: `*${protoForm}`,
    langId: lang.id,
  };
}

/** Human-readable etymology: "Kaldvik — 'bahía fría' (< *kalda-wik)". */
export function etymology(n: CoinedName): string {
  const gloss = n.parts.map((p) => GLOSS_ES[p]).join(' ');
  return `«${gloss}» (< ${n.proto})`;
}

/**
 * Cognates of a name across the family: the same roots run through every living
 * language. This is what lets the gazetteer say "compare X in the neighbouring
 * realm", and it is the payoff of the whole module.
 */
export function cognates(n: CoinedName, family: LanguageFamily, seed: string, key: string): { langId: string; text: string }[] {
  const out: { langId: string; text: string }[] = [];
  for (const lang of family.living) {
    if (lang.id === n.langId) continue;
    const rng = createRng(seed, `cog:${lang.id}:${key}`);
    let text = n.parts.map((p, k) => {
      const w = lang.lexicon[p];
      return k === 0 && n.parts.length > 1 && syllables(w) > 1 ? clipRoot(w) : w;
    }).join(pick(rng, lang.linker));
    text = tidy(lang.orthography(text));
    out.push({ langId: lang.id, text: capitalize(text) });
  }
  return out;
}

/** Site-appropriate root bias for a settlement, from what the map says about it. */
export function settlementBias(opts: {
  port: boolean; river: boolean; capital: boolean; mountainous: boolean;
  forested: boolean; arid: boolean; cold: boolean; marshy: boolean;
}): { heads: Gloss[]; modifiers: Gloss[] } {
  const heads: Gloss[] = [];
  const modifiers: Gloss[] = [];
  if (opts.port) heads.push('harbour', 'bay', 'island', 'sea');
  if (opts.river) heads.push('ford', 'bridge', 'river', 'mill');
  if (opts.capital) heads.push('fort', 'tower', 'wall', 'gate', 'market', 'town');
  if (opts.mountainous) { heads.push('pass', 'rock', 'cliff', 'valley'); modifiers.push('high', 'grey'); }
  if (opts.forested) { heads.push('forest', 'field', 'meadow'); modifiers.push('oak', 'pine', 'green'); }
  if (opts.arid) { heads.push('spring', 'stone', 'road'); modifiers.push('white', 'gold', 'warm'); }
  if (opts.cold) modifiers.push('cold', 'grey', 'white', 'bear', 'wolf');
  if (opts.marshy) heads.push('marsh', 'moor');
  if (!heads.length) heads.push('town', 'field', 'house');
  return { heads, modifiers };
}
