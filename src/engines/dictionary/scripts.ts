import { parseScriptMapping } from './types';
/** Editable visual substitutions, not linguistic transliterations. Unicode letters
 * are referenced from the Unicode Tifinagh, Ogham, Runic and Glagolitic charts. */
export const scriptPresets = [
  { id: 'tifinagh', name: 'Tifinagh', glyphs: 'ⴰⴱⵛⴷⴻⴼⴳⵀⵉⵊⴽⵍⵎⵏⵓⵒⵇⵔⵙⵜⵓⵠⵡⵅⵢⵣ' },
  { id: 'ogham', name: 'Ogham', glyphs: 'ᚐᚁᚉᚇᚓᚃᚌᚆᚔᚔᚊᚂᚋᚅᚑᚚᚊᚏᚄᚈᚒᚃᚃᚕᚔᚎ' },
  { id: 'runic', name: 'Runes · Elder Futhark', glyphs: 'ᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈᚲᚱᛊᛏᚢᚹᚹᛉᛇᛉ' },
  { id: 'glagolitic', name: 'Glagolitic', glyphs: 'ⰀⰁⰜⰄⰅⰗⰃⰘⰋⰊⰍⰎⰏⰐⰑⰒⰍⰓⰔⰕⰖⰂⰂⰝⰟⰈ' },
] as const;

export function presetMapping(id: string): string | undefined {
  const preset = scriptPresets.find(item => item.id === id);
  if (!preset) return undefined;
  return [...'abcdefghijklmnopqrstuvwxyz'].map((letter, index) => `${letter}=${[...preset.glyphs][index]}`).join('\n');
}

/** Declared local subsets, not whole Unicode blocks. Character values only:
 * https://www.unicode.org/charts/PDF/U16A0.pdf and U2D30.pdf.
 * No chart font, extracted PDF glyph or reference artwork is bundled. */
const characters = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, index) => String.fromCodePoint(first + index)).join('');
export const scriptGlyphCatalogs = [
  { id: 'tifinagh', name: 'Tifinagh', glyphs: characters(0x2d30, 0x2d67), scope: 'U+2D30–U+2D67' },
  { id: 'runic', name: 'Runic', glyphs: characters(0x16a0, 0x16ea), scope: 'U+16A0–U+16EA' },
] as const;

/** Keep custom mapping destinations available, including complete graphemes. */
export function mappingGlyphs(mapping: string): string[] {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...new Set([...parseScriptMapping(mapping).values()].flatMap(value => [...segments.segment(value)].map(item => item.segment)))].filter(glyph => glyph.trim());
}

/** Change only the last effective association; every other authored byte stays.
 * Captured delimiters retain CRLF, LF, blank and ignored lines verbatim. */
export function setScriptAssociation(source: string, sound: string, glyph: string): string {
  const key = sound.trim().normalize('NFC').toLowerCase();
  if (!key) return source;
  const parts = source.split(/(\r?\n)/);
  let found = -1;
  for (let index = 0; index < parts.length; index += 2) {
    const separator = parts[index].indexOf('=');
    if (separator > 0 && parts[index].slice(0, separator).trim().normalize('NFC').toLowerCase() === key) found = index;
  }
  if (found >= 0) {
    const separator = parts[found].indexOf('=');
    parts[found] = parts[found].slice(0, separator + 1) + glyph;
    return parts.join('');
  }
  const newline = source.match(/\r?\n/)?.[0] ?? '\n';
  return source + (source && !/\n$/.test(source) ? newline : '') + key + '=' + glyph;
}
