// ============================================
// World Generator — Roll a name for a label
// ============================================
// The label tool's dice: a fresh name coined in one of the world's own
// languages, with roots that suit the kind of label (a range is called after
// rock and height, a sea after water), never one the world already uses. With
// a spot it speaks the language of the nearest town; without one each roll
// walks through the world's languages.

import { coinName, etymology, type Gloss } from './language';
import type { HumanGeography } from './settlements';

export const ROLL_STYLES = ['region', 'water', 'range', 'settlement'] as const;
export type RollStyle = typeof ROLL_STYLES[number];

const ROLL: Record<RollStyle, { prefixes: string[]; heads: Gloss[]; modifiers: Gloss[] }> = {
  region: { prefixes: ['Tierras de', 'Reino de', ''], heads: ['people', 'field', 'king', 'town', 'meadow'], modifiers: ['great', 'old', 'far', 'green', 'wild'] },
  water: { prefixes: ['Mar de', 'Lago', 'Bahía de'], heads: ['sea', 'water', 'bay', 'lake'], modifiers: ['quiet', 'dark', 'bright', 'cold', 'great'] },
  range: { prefixes: ['Montes', 'Sierra de', 'Picos de'], heads: ['mountain', 'rock', 'cliff', 'wall', 'stone'], modifiers: ['high', 'grey', 'cold', 'black', 'white'] },
  settlement: { prefixes: [''], heads: ['town', 'house', 'ford', 'bridge', 'harbour', 'mill', 'market'], modifiers: ['old', 'new', 'high', 'low', 'green'] },
};

export interface RolledName {
  /** The name as it goes on the label. */
  text: string;
  /** The coined word alone, without "Mar de" and the like. */
  word: string;
  /** Which language it is in, by name (two languages of a family can share one). */
  language: string;
  languageId: string;
  /** «gloss» (< *proto), as the gazetteer prints it. */
  etymology: string;
}

/** The names the author has written on a world: painted labels, stamps and placed towns. */
export function paintedNames(painted: { labels?: { text: string }[]; stamps?: { name?: string }[]; markers?: { name?: string }[] } | undefined): string[] {
  if (!painted) return [];
  return [
    ...(painted.labels ?? []).map((l) => l.text),
    ...(painted.stamps ?? []).flatMap((s) => (s.name ? [s.name] : [])),
    ...(painted.markers ?? []).flatMap((m) => (m.name ? [m.name] : [])),
  ];
}

type Geo = Pick<HumanGeography, 'languages' | 'languageOf' | 'settlements' | 'features' | 'realms'>;

/**
 * Roll number `roll` (0, 1, 2…) of a name for a label of `style`. Deterministic
 * for the same world, style, roll and spot, so rolling again gives a new name
 * and the same roll gives the same one.
 */
export function rollLabelName(
  geo: Geo, seed: string, style: RollStyle, roll: number,
  at?: { x: number; y: number },
  /** Names the author has written on the map (labels, stamps, towns), never rolled again; and the map's width, for the wrap. */
  options: { painted?: readonly string[]; width?: number } = {},
): RolledName {
  const family = geo.languages;
  let lang = family.living[((roll % family.living.length) + family.living.length) % family.living.length] ?? family.living[0];
  if (at && geo.settlements.length) {
    let best = geo.settlements[0], bestD = Infinity;
    const W = options.width ?? 0;
    for (const s of geo.settlements) {
      // The map wraps east to west: a town just across the seam is a neighbour.
      let dx = Math.abs(s.x - at.x);
      if (W > 0 && dx > W / 2) dx = W - dx;
      const d = dx * dx + (s.y - at.y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    lang = family.byId.get(geo.languageOf[best.culture]) ?? lang;
  }
  const used = new Set<string>([
    ...geo.settlements.map((s) => s.name.toLowerCase()),
    ...geo.features.map((f) => f.name.toLowerCase()),
    ...geo.realms.map((r) => r.name.toLowerCase()),
    ...(options.painted ?? []).map((n) => n.toLowerCase()),
  ]);
  const spec = ROLL[style];
  const spot = at ? `${Math.floor(at.x)},${Math.floor(at.y)}` : 'any';
  for (let attempt = 0; attempt < 48; attempt++) {
    const key = `roll:${style}:${spot}:${roll}:${attempt}`;
    const coined = coinName(lang, family.proto, key, seed, { heads: spec.heads, modifiers: spec.modifiers });
    const prefix = spec.prefixes[(roll + attempt) % spec.prefixes.length];
    const text = prefix ? `${prefix} ${coined.text}` : coined.text;
    if (used.has(text.toLowerCase()) || used.has(coined.text.toLowerCase())) continue;
    return { text, word: coined.text, language: lang.name, languageId: lang.id, etymology: etymology(coined) };
  }
  const coined = coinName(lang, family.proto, `roll:${style}:${spot}:${roll}:last`, seed, { heads: spec.heads, modifiers: spec.modifiers });
  return { text: coined.text, word: coined.text, language: lang.name, languageId: lang.id, etymology: etymology(coined) };
}
