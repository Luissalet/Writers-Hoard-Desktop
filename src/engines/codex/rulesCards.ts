// ============================================
// Rules cards — a spell, a magic item or a creature set from a Codex card
// ============================================
// A game sourcebook prints its spells, items and creatures as boxed cards
// with fixed slots (level and school, rarity, armour and hit points…). The
// writer keeps those facts on Codex cards under whatever property names they
// chose; a rules card maps each slot to one of the card's properties (guessed
// from the names, changeable by hand) and writes the box into the manuscript
// as ordinary text, so every export prints it. The card id and the mapping
// travel with the box, so it can be filled again after the card changes.

import type { CodexEntry } from '@/types';
import { isAliasField } from '@/services/codexReference/aliases';

export const RULES_LAYOUTS = ['spell', 'item', 'creature'] as const;
export type RulesLayout = typeof RULES_LAYOUTS[number];

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/** The slots of each layout, in the order the box prints them. */
export const RULES_SLOTS: Record<RulesLayout, readonly string[]> = {
  spell: ['level', 'school', 'castingTime', 'range', 'components', 'duration', 'classes'],
  item: ['kind', 'rarity', 'attunement', 'value'],
  creature: ['size', 'kind', 'alignment', 'armor', 'hp', 'speed', ...ABILITIES, 'senses', 'languages', 'challenge'],
};

type Labels = Record<string, { es: string; en: string }>;
export const RULES_SLOT_LABELS: Labels = {
  level: { es: 'Nivel', en: 'Level' }, school: { es: 'Escuela', en: 'School' }, castingTime: { es: 'Tiempo de lanzamiento', en: 'Casting time' },
  range: { es: 'Alcance', en: 'Range' }, components: { es: 'Componentes', en: 'Components' }, duration: { es: 'Duración', en: 'Duration' },
  classes: { es: 'Clases', en: 'Classes' }, kind: { es: 'Tipo', en: 'Type' }, rarity: { es: 'Rareza', en: 'Rarity' },
  attunement: { es: 'Sintonización', en: 'Attunement' }, value: { es: 'Valor', en: 'Value' }, size: { es: 'Tamaño', en: 'Size' },
  alignment: { es: 'Alineamiento', en: 'Alignment' }, armor: { es: 'Clase de armadura', en: 'Armor class' }, hp: { es: 'Puntos de golpe', en: 'Hit points' },
  speed: { es: 'Velocidad', en: 'Speed' }, str: { es: 'FUE', en: 'STR' }, dex: { es: 'DES', en: 'DEX' }, con: { es: 'CON', en: 'CON' },
  int: { es: 'INT', en: 'INT' }, wis: { es: 'SAB', en: 'WIS' }, cha: { es: 'CAR', en: 'CHA' }, senses: { es: 'Sentidos', en: 'Senses' },
  languages: { es: 'Idiomas', en: 'Languages' }, challenge: { es: 'Desafío', en: 'Challenge' },
};
export const RULES_LAYOUT_LABELS: Labels = { spell: { es: 'Hechizo', en: 'Spell' }, item: { es: 'Objeto mágico', en: 'Magic item' }, creature: { es: 'Criatura', en: 'Creature' } };

/** The property names each slot is guessed from (compared without case, accents or punctuation). */
const SYNONYMS: Record<string, readonly string[]> = {
  level: ['nivel', 'level', 'lvl', 'circulo', 'spell level'],
  school: ['escuela', 'school', 'escuela de magia'],
  castingTime: ['tiempo de lanzamiento', 'lanzamiento', 'casting time', 'tiempo de conjuro'],
  range: ['alcance', 'range', 'distancia'],
  components: ['componentes', 'components', 'comp'],
  duration: ['duracion', 'duration'],
  classes: ['clases', 'classes', 'clase', 'class'],
  kind: ['tipo', 'type', 'categoria', 'category', 'clase de objeto'],
  rarity: ['rareza', 'rarity'],
  attunement: ['sintonizacion', 'attunement', 'requiere sintonizacion', 'vinculo'],
  value: ['valor', 'value', 'precio', 'price', 'coste', 'cost'],
  size: ['tamano', 'size'],
  alignment: ['alineamiento', 'alignment'],
  armor: ['ca', 'ac', 'clase de armadura', 'armor class', 'armour class', 'armadura', 'armor'],
  hp: ['pg', 'hp', 'puntos de golpe', 'hit points', 'vida', 'salud'],
  speed: ['velocidad', 'speed', 'movimiento'],
  str: ['fue', 'fuerza', 'str', 'strength'], dex: ['des', 'destreza', 'dex', 'dexterity'], con: ['con', 'constitucion', 'constitution'],
  int: ['int', 'inteligencia', 'intelligence'], wis: ['sab', 'sabiduria', 'wis', 'wisdom'], cha: ['car', 'carisma', 'cha', 'charisma'],
  senses: ['sentidos', 'senses'],
  languages: ['idiomas', 'languages', 'lenguas'],
  challenge: ['desafio', 'challenge', 'cr', 'vd', 'valor de desafio', 'challenge rating'],
};

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The card's properties that can fill a slot: those with a value, aliases left out. */
export function rulesFieldNames(entry: Pick<CodexEntry, 'fields'>): string[] {
  return Object.entries(entry.fields ?? {}).filter(([key, value]) => !isAliasField(key) && typeof value === 'string' && value.trim()).map(([key]) => key);
}

/** Which property fills each slot, guessed from the property names. Unmatched slots are left out. */
export function guessRulesSlots(layout: RulesLayout, fieldNames: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const slot of RULES_SLOTS[layout]) {
    const wanted = new Set(SYNONYMS[slot] ?? []);
    const found = fieldNames.find(name => !used.has(name) && wanted.has(fold(name)));
    if (found) { result[slot] = found; used.add(found); }
  }
  return result;
}

/** A mapping made safe: only this layout's slots, only properties the card has. */
export function normalizeRulesSlots(layout: RulesLayout, raw: unknown, fieldNames: readonly string[]): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const names = new Set(fieldNames), slots = new Set(RULES_SLOTS[layout]);
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([slot, name]) => slots.has(slot) && typeof name === 'string' && names.has(name)) as [string, string][]);
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The modifier a 5e-style ability score gives, "+2" or "−1"; '' for a value that is not a plain score. */
function modifier(value: string): string {
  if (!/^\s*\d{1,2}\s*$/.test(value)) return '';
  const mod = Math.floor((Number(value) - 10) / 2);
  return ` (${mod >= 0 ? '+' : '−'}${Math.abs(mod)})`;
}

export interface RulesCardResult { html: string; filled: string[]; missing: string[] }

/**
 * The box as manuscript HTML. `description` is the card's body (rich text);
 * slots with no property or an empty one are left out of the box and listed
 * as missing.
 */
export function rulesCardHtml(layout: RulesLayout, entry: Pick<CodexEntry, 'id' | 'title' | 'fields' | 'content'>, slots: Record<string, string>, locale: string, options: { description?: boolean } = {}): RulesCardResult {
  const lang = locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  const label = (slot: string) => RULES_SLOT_LABELS[slot]?.[lang] ?? slot;
  const value = (slot: string) => { const name = slots[slot]; return name ? String(entry.fields?.[name] ?? '').trim() : ''; };
  const filled = RULES_SLOTS[layout].filter(slot => value(slot)), missing = RULES_SLOTS[layout].filter(slot => !value(slot));
  const parts: string[] = [`<h3>${escape(entry.title)}</h3>`];
  const subtitle = layout === 'spell'
    ? [value('level') && `${label('level')} ${value('level')}`, value('school')].filter(Boolean).join(' · ')
    : layout === 'item'
      ? [value('kind'), value('rarity'), value('attunement') && `${label('attunement')}: ${value('attunement')}`].filter(Boolean).join(', ')
      : [[value('size'), value('kind')].filter(Boolean).join(' '), value('alignment')].filter(Boolean).join(', ');
  if (subtitle) parts.push(`<p><em>${escape(subtitle)}</em></p>`);
  const shownInSubtitle = new Set(layout === 'spell' ? ['level', 'school'] : layout === 'item' ? ['kind', 'rarity', 'attunement'] : ['size', 'kind', 'alignment']);
  const line = (slot: string) => `<p><strong>${escape(label(slot))}:</strong> ${escape(value(slot))}</p>`;
  for (const slot of RULES_SLOTS[layout]) {
    if (shownInSubtitle.has(slot) || (ABILITIES as readonly string[]).includes(slot) || !value(slot)) continue;
    if (layout === 'creature' && ['senses', 'languages', 'challenge'].includes(slot)) continue;
    parts.push(line(slot));
  }
  if (layout === 'creature') {
    const scores = ABILITIES.filter(slot => value(slot));
    if (scores.length) parts.push(`<table><tbody><tr>${scores.map(slot => `<th>${escape(label(slot))}</th>`).join('')}</tr><tr>${scores.map(slot => `<td>${escape(value(slot))}${modifier(value(slot))}</td>`).join('')}</tr></tbody></table>`);
    for (const slot of ['senses', 'languages', 'challenge']) if (value(slot)) parts.push(line(slot));
  }
  if (options.description !== false && entry.content?.trim()) parts.push(entry.content);
  const attributes = `data-wh-rules-card="${layout}" data-wh-entry="${escape(entry.id)}" data-wh-slots="${escape(JSON.stringify(slots))}"`;
  return { html: `<div ${attributes}>${parts.join('')}</div>`, filled, missing };
}
