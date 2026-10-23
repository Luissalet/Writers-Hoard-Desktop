import type { WikiColors } from './appearance';

/**
 * Named colour palettes for the exported wiki. Every palette fills the same five
 * colour tokens the appearance editor already has (background, accent, secondary
 * surface, text, border). Text on background is at least 7:1 and accent on
 * background at least 4.5:1, so any palette is readable as it stands.
 */
export type WikiPaletteGroup = 'light' | 'dark' | 'book' | 'contrast';
export interface WikiPalette { id: string; group: WikiPaletteGroup; name: { es: string; en: string }; colors: WikiColors }
export interface WikiCustomPalette { id: string; name: string; colors: WikiColors }

export const WIKI_PALETTE_GROUPS: Record<WikiPaletteGroup, { es: string; en: string }> = {
  light: { es: 'Claras', en: 'Light' },
  dark: { es: 'Oscuras', en: 'Dark' },
  book: { es: 'De libro (serif)', en: 'Book (serif-friendly)' },
  contrast: { es: 'Alto contraste', en: 'High contrast' },
};

const palette = (id: string, group: WikiPaletteGroup, es: string, en: string, background: string, accent: string, secondary: string, text: string, border: string): WikiPalette => ({ id, group, name: { es, en }, colors: { background, accent, secondary, text, border } });

export const WIKI_PALETTES: readonly WikiPalette[] = [
  palette('marfil', 'light', 'Marfil', 'Ivory', '#fbf9f4', '#7a4f12', '#f1ede2', '#262524', '#d6d0c0'),
  palette('nieve', 'light', 'Nieve', 'Snow', '#ffffff', '#1d5fa6', '#f1f4f8', '#1e2328', '#cfd6de'),
  palette('lavanda', 'light', 'Lavanda', 'Lavender', '#f6f3fb', '#5b3a9d', '#ebe5f6', '#25212e', '#d3c9e6'),
  palette('menta', 'light', 'Menta', 'Mint', '#f1f8f4', '#17653f', '#e1efe7', '#1d2a23', '#bcd5c6'),
  palette('cielo', 'light', 'Cielo', 'Sky', '#f2f8fc', '#0b5f8a', '#e1eef7', '#1b2630', '#bdd3e3'),
  palette('tinta', 'dark', 'Tinta', 'Ink', '#111827', '#7cb7ff', '#1c2638', '#e6ebf5', '#34425c'),
  palette('carbon', 'dark', 'Carbón', 'Charcoal', '#1b1c1e', '#e0b25a', '#26282b', '#e9e6df', '#44474c'),
  palette('musgo', 'dark', 'Musgo', 'Moss', '#14201a', '#8fd19e', '#1d2d24', '#e1ece4', '#35513f'),
  palette('vino', 'dark', 'Vino', 'Wine', '#22121a', '#f0a3b8', '#301b25', '#f3e6ea', '#5a3243'),
  palette('medianoche', 'dark', 'Medianoche', 'Midnight', '#0b0f1a', '#b79cff', '#141a2b', '#e4e6f2', '#2b3452'),
  palette('pergamino', 'book', 'Pergamino', 'Parchment', '#f4ead5', '#7b4a12', '#eadcbc', '#2d2416', '#cdb98f'),
  palette('sepia', 'book', 'Sepia', 'Sepia', '#efe3cf', '#8a3b12', '#e3d3b8', '#33261a', '#c4ab86'),
  palette('biblioteca', 'book', 'Biblioteca', 'Library', '#ede6d6', '#2f5a3a', '#e0d6bf', '#2a2a22', '#bfb396'),
  palette('te', 'book', 'Té', 'Tea', '#f3eee3', '#8a4b2a', '#e8e0cf', '#2c2823', '#cfc4ad'),
  palette('manuscrito', 'book', 'Manuscrito', 'Manuscript', '#f8f1e0', '#2b4a7a', '#eee3c9', '#2b2418', '#d2c29a'),
  palette('lampara', 'book', 'Lámpara', 'Lamplight', '#2a2118', '#f0c070', '#372c20', '#f0e4cc', '#5a4a36'),
  palette('alto-claro', 'contrast', 'Alto contraste claro', 'High contrast light', '#ffffff', '#0033cc', '#f0f0f0', '#000000', '#000000'),
  palette('alto-oscuro', 'contrast', 'Alto contraste oscuro', 'High contrast dark', '#000000', '#ffe14d', '#141414', '#ffffff', '#ffffff'),
  palette('amarillo-negro', 'contrast', 'Amarillo sobre negro', 'Yellow on black', '#000000', '#ffff00', '#111100', '#ffff66', '#ffff00'),
  palette('azul-crema', 'contrast', 'Azul sobre crema', 'Blue on cream', '#fff8e1', '#0a2a8a', '#f5ecc9', '#0a1a4a', '#0a1a4a'),
];

export const WIKI_MAX_CUSTOM_PALETTES = 24;
export const WIKI_PALETTE_NAME_MAX = 40;
const COLOR_KEYS = ['background', 'accent', 'secondary', 'text', 'border'] as const;
const HEX = /^#[\da-f]{6}$/i;

/** Fills the colours a partial override leaves out, so a saved palette always has all five. */
export function completeWikiColors(colors: Partial<WikiColors> | undefined): WikiColors {
  return { background: colors?.background ?? '#faf8f2', accent: colors?.accent ?? '#755516', secondary: colors?.secondary ?? '#faf8f2', text: colors?.text ?? '#272b2b', border: colors?.border ?? '#d8d5cb' };
}
const sameColors = (a: Partial<WikiColors> | undefined, b: WikiColors) => !!a && COLOR_KEYS.every(key => a[key]?.toLowerCase() === b[key].toLowerCase());
/** The id of the catalogue or saved palette whose five colours equal these, if any. */
export function matchingWikiPalette(colors: Partial<WikiColors> | undefined, custom: readonly WikiCustomPalette[] = []): string {
  return WIKI_PALETTES.find(item => sameColors(colors, item.colors))?.id ?? custom.find(item => sameColors(colors, item.colors))?.id ?? '';
}
export function wikiPaletteColors(id: string, custom: readonly WikiCustomPalette[] = []): WikiColors | undefined {
  const found = WIKI_PALETTES.find(item => item.id === id)?.colors ?? custom.find(item => item.id === id)?.colors;
  return found ? { ...found } : undefined;
}

const cleanName = (value: string) => {
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > WIKI_PALETTE_NAME_MAX) throw Error('wiki_palette_name_invalid');
  return name;
};
/** Saved palettes are plain data on the options; these helpers return a new list and never mutate. */
export function addCustomWikiPalette(list: readonly WikiCustomPalette[] | undefined, name: string, colors: Partial<WikiColors> | undefined, id: string = crypto.randomUUID()): WikiCustomPalette[] {
  const current = list ?? [];
  if (current.length >= WIKI_MAX_CUSTOM_PALETTES) throw Error('wiki_palette_limit');
  const clean = cleanName(name);
  if (current.some(item => item.name.toLowerCase() === clean.toLowerCase())) throw Error('wiki_palette_name_taken');
  return [...current, { id, name: clean, colors: completeWikiColors(colors) }];
}
export function renameCustomWikiPalette(list: readonly WikiCustomPalette[] | undefined, id: string, name: string): WikiCustomPalette[] {
  const current = list ?? [], clean = cleanName(name);
  if (!current.some(item => item.id === id)) throw Error('wiki_palette_missing');
  if (current.some(item => item.id !== id && item.name.toLowerCase() === clean.toLowerCase())) throw Error('wiki_palette_name_taken');
  return current.map(item => item.id === id ? { ...item, name: clean } : item);
}
export function deleteCustomWikiPalette(list: readonly WikiCustomPalette[] | undefined, id: string): WikiCustomPalette[] {
  const current = list ?? [];
  if (!current.some(item => item.id === id)) throw Error('wiki_palette_missing');
  return current.filter(item => item.id !== id);
}

export function validateCustomWikiPalettes(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > WIKI_MAX_CUSTOM_PALETTES) throw Error('wiki_palettes_invalid');
  const ids = new Set<string>(), names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('wiki_palettes_invalid');
    const { id, name, colors, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length || typeof id !== 'string' || !id.trim() || ids.has(id) || typeof name !== 'string' || !name.trim() || name.length > WIKI_PALETTE_NAME_MAX || names.has(name.toLowerCase())) throw Error('wiki_palettes_invalid');
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw Error('wiki_palettes_invalid');
    const entries = Object.entries(colors);
    if (entries.length !== COLOR_KEYS.length || entries.some(([key, color]) => !COLOR_KEYS.includes(key as typeof COLOR_KEYS[number]) || typeof color !== 'string' || !HEX.test(color))) throw Error('wiki_palettes_invalid');
    ids.add(id); names.add(name.toLowerCase());
  }
}
