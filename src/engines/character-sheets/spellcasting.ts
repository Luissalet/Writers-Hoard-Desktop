// A stat block's spellcasting, kept in the sheet's details as plain text
// (spellAbility: int | wis | cha; spellsAtWill: "Light, Mage Hand";
// spellsPerDay: "1: Fireball, Fly; 3: Shield") so old sheets and the portable
// format stay valid. The sentence is written from the ability, the
// proficiency bonus and the lists, as stat blocks print it.
import type { CharacterSheet } from './types';
import { abilityModifier, sheetProficiency } from './mechanics';

export const SPELL_ABILITIES = { int: 'intelligence', wis: 'wisdom', cha: 'charisma' } as const;
export type SpellAbility = keyof typeof SPELL_ABILITIES;
export const SPELLCASTING_KEYS = ['spellAbility', 'spellsAtWill', 'spellsPerDay'] as const;

export function parsePerDay(text: string): { uses: number; spells: string[] }[] {
  return text.split(';').map(part => /^\s*(\d+)\s*(?:\/\s*(?:day|d[ií]a))?\s*:\s*(.+)$/i.exec(part)).flatMap(match => match ? [{ uses: Math.max(1, Math.min(9, Number(match[1]))), spells: match[2].split(',').map(item => item.trim()).filter(Boolean) }] : []).filter(group => group.spells.length).sort((a, b) => b.uses - a.uses);
}

export function spellcasting(sheet: CharacterSheet): { ability: SpellAbility; dc: number; toHit: number; atWill: string[]; perDay: { uses: number; spells: string[] }[] } | null {
  const ability = sheet.details.spellAbility as SpellAbility | undefined;
  if (!ability || !(ability in SPELL_ABILITIES)) return null;
  const atWill = (sheet.details.spellsAtWill ?? '').split(',').map(item => item.trim()).filter(Boolean), perDay = parsePerDay(sheet.details.spellsPerDay ?? '');
  if (!atWill.length && !perDay.length) return null;
  const score = sheet.traits.find(trait => trait.id === SPELL_ABILITIES[ability])?.value ?? 10, pb = sheetProficiency(sheet), mod = abilityModifier(score);
  return { ability, dc: 8 + pb + mod, toHit: pb + mod, atWill, perDay };
}

const ABILITY_NAMES = { es: { int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' }, en: { int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } };
/** "The goblin shaman casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 12, +4 to hit with spell attacks):" and the lists. */
export function spellcastingText(sheet: CharacterSheet, locale: 'es' | 'en'): { intro: string; lines: string[] } | null {
  const block = spellcasting(sheet); if (!block) return null;
  const name = sheet.title || (locale === 'es' ? 'La criatura' : 'The creature'), sign = block.toHit >= 0 ? '+' : '';
  const intro = locale === 'es'
    ? `${name} lanza uno de los siguientes conjuros, usando ${ABILITY_NAMES.es[block.ability]} como aptitud mágica (CD de salvación de conjuros ${block.dc}, ${sign}${block.toHit} para impactar con ataques de conjuro):`
    : `${name} casts one of the following spells, using ${ABILITY_NAMES.en[block.ability]} as the spellcasting ability (spell save DC ${block.dc}, ${sign}${block.toHit} to hit with spell attacks):`;
  const lines = [
    ...(block.atWill.length ? [`${locale === 'es' ? 'A voluntad' : 'At will'}: ${block.atWill.join(', ')}`] : []),
    ...block.perDay.map(group => `${group.uses}/${locale === 'es' ? 'día' : 'day'}${group.spells.length > 1 ? (locale === 'es' ? ' cada uno' : ' each') : ''}: ${group.spells.join(', ')}`),
  ];
  return { intro, lines };
}
