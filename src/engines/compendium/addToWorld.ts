// ============================================
// Compendium → world: a Codex card (and a stat block) from an SRD entry
// ============================================
// "Añadir al mundo" copies an entry into the project as the writer's own: a
// Codex card whose properties carry the rules facts under the names a rules
// card and the codex understand (Nivel, Escuela, CA, PG, FUE…), the text as
// its body with the SRD attribution, and for a monster a 5e stat block sheet
// linked to the card. The copy is then the writer's to change.

import type { CodexEntry } from '@/types';
import { createCodexEntry } from '@/db/operations';
import { saveSheet } from '@/engines/character-sheets/operations';
import { generateId } from '@/utils/idGenerator';
import { createSheet, type CharacterSheet, type SheetRow } from '@/engines/character-sheets/types';
import { SRD_CREDIT, crLabel, type CompendiumEntry, type SrdMonster } from './srd';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** SRD text: **bold** runs and line breaks, as paragraphs. */
export function srdTextHtml(text: string): string {
  return text.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => `<p>${escape(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>')}</p>`).join('');
}
const section = (title: string, pairs: [string, string][]) => pairs.length ? `<h3>${escape(title)}</h3>${pairs.map(([name, text]) => `<p><strong><em>${escape(name)}.</em></strong> ${escape(text).replace(/\n+/g, ' ')}</p>`).join('')}` : '';
const credit = `<p><em>${escape(SRD_CREDIT)}</em></p>`;

type Lang = 'es' | 'en';
const L = (lang: Lang, es: string, en: string) => (lang === 'es' ? es : en);

/** The card's type, title, properties and body for an entry. */
export function compendiumCard(hit: CompendiumEntry, locale: string): { type: CodexEntry['type']; title: string; fields: Record<string, string>; content: string } {
  const lang: Lang = locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  if (hit.kind === 'monster') {
    const m = hit.entry;
    const [str, dex, con, int, wis, cha] = m.ab;
    const fields: Record<string, string> = {
      [L(lang, 'Tamaño', 'Size')]: m.s, [L(lang, 'Tipo', 'Type')]: m.t, [L(lang, 'Alineamiento', 'Alignment')]: m.al,
      [L(lang, 'CA', 'AC')]: `${m.ac}${m.acn ? ` (${m.acn})` : ''}`, [L(lang, 'PG', 'HP')]: `${m.hp} (${m.hd})`, [L(lang, 'Velocidad', 'Speed')]: m.sp,
      [L(lang, 'FUE', 'STR')]: String(str), [L(lang, 'DES', 'DEX')]: String(dex), [L(lang, 'CON', 'CON')]: String(con), [L(lang, 'INT', 'INT')]: String(int), [L(lang, 'SAB', 'WIS')]: String(wis), [L(lang, 'CAR', 'CHA')]: String(cha),
      [L(lang, 'Sentidos', 'Senses')]: m.se, [L(lang, 'Idiomas', 'Languages')]: m.la ?? '—', [L(lang, 'Desafío', 'Challenge')]: `${crLabel(m.cr)} (${m.xp} XP)`,
    };
    if (m.sv) fields[L(lang, 'Salvaciones', 'Saving throws')] = m.sv;
    if (m.sk) fields[L(lang, 'Habilidades', 'Skills')] = m.sk;
    if (m.dr) fields[L(lang, 'Resistencias', 'Resistances')] = m.dr;
    if (m.di) fields[L(lang, 'Inmunidades', 'Immunities')] = m.di;
    if (m.ci) fields[L(lang, 'Inmune a condiciones', 'Condition immunities')] = m.ci;
    if (m.dv) fields[L(lang, 'Vulnerabilidades', 'Vulnerabilities')] = m.dv;
    if (m.gear) fields[L(lang, 'Equipo', 'Gear')] = m.gear;
    const content = section(L(lang, 'Rasgos', 'Traits'), m.tr) + section(L(lang, 'Acciones', 'Actions'), m.act) + section(L(lang, 'Acciones adicionales', 'Bonus actions'), m.bon) + section(L(lang, 'Reacciones', 'Reactions'), m.rea) + section(L(lang, 'Acciones legendarias', 'Legendary actions'), m.leg) + credit;
    return { type: 'character', title: m.n, fields, content };
  }
  if (hit.kind === 'spell') {
    const s = hit.entry;
    const fields: Record<string, string> = {
      [L(lang, 'Nivel', 'Level')]: s.lv === 0 ? L(lang, 'Truco', 'Cantrip') : String(s.lv), [L(lang, 'Escuela', 'School')]: s.sc,
      [L(lang, 'Tiempo de lanzamiento', 'Casting time')]: `${s.ct}${s.ri ? L(lang, ' o ritual', ' or ritual') : ''}`, [L(lang, 'Alcance', 'Range')]: s.ra,
      [L(lang, 'Componentes', 'Components')]: `${s.co}${s.ma ? ` (${s.ma})` : ''}`, [L(lang, 'Duración', 'Duration')]: `${s.cn ? L(lang, 'Concentración, ', 'Concentration, ') : ''}${s.du}`,
    };
    if (s.cl) fields[L(lang, 'Clases', 'Classes')] = s.cl;
    return { type: 'magic', title: s.n, fields, content: srdTextHtml(s.d) + (s.hl ? `<p><strong>${L(lang, 'A niveles superiores', 'Using a higher-level spell slot')}.</strong> ${escape(s.hl)}</p>` : '') + credit };
  }
  if (hit.kind === 'item') {
    const i = hit.entry;
    const fields: Record<string, string> = { [L(lang, 'Tipo', 'Type')]: i.ca ?? '', [L(lang, 'Rareza', 'Rarity')]: i.ra ?? '' };
    if (i.at) fields[L(lang, 'Sintonización', 'Attunement')] = typeof i.at === 'string' ? i.at : L(lang, 'Requiere sintonización', 'Requires attunement');
    return { type: 'item', title: i.n, fields, content: srdTextHtml(i.d) + credit };
  }
  return { type: 'concept', title: hit.entry.n, fields: { [L(lang, 'Tipo', 'Type')]: L(lang, 'Condición', 'Condition') }, content: srdTextHtml(hit.entry.d) + credit };
}

const DICE = /(\d+)d(\d+)\s*([+\-−]\s*\d+)?/;
/** The first dice expression in a line ("13 (2d8 + 4)" → "2d8+4"), or ''. */
export function firstDice(text: string): string {
  const match = DICE.exec(text);
  return match ? `${match[1]}d${match[2]}${match[3] ? match[3].replace(/\s+/g, '').replace('−', '-') : ''}` : '';
}

/** A 5e stat block sheet for a monster, linked to its card. */
export function monsterStatBlock(m: SrdMonster, entryId: string | undefined): CharacterSheet {
  const sheet = createSheet('5e-stat-block', m.n);
  sheet.linkedEntryId = entryId;
  sheet.traits.forEach((trait, index) => { trait.value = m.ab[index] ?? 10; });
  const speed = Number(/(\d+)/.exec(m.sp)?.[1] ?? 30);
  sheet.numbers = { ...sheet.numbers, armorClass: m.ac, challenge: m.cr, speed, initiativeBonus: Math.floor(((m.ab[1] ?? 10) - 10) / 2) };
  sheet.details = { ...sheet.details, size: m.s, type: m.t, alignment: m.al, senses: m.se, languages: m.la ?? '', resistances: m.dr ?? '', immunities: [m.di, m.ci].filter(Boolean).join('; '), vulnerabilities: m.dv ?? '', hitDice: m.hd, notes: SRD_CREDIT };
  const hp = sheet.resources.find(resource => resource.id === 'hp'); if (hp) { hp.max = m.hp; hp.current = m.hp; }
  // Saves and skills the monster is proficient in: their printed bonus over the ability modifier.
  for (const [list, suffix] of [[m.sv, ' save'], [m.sk, '']] as const) for (const part of (list ?? '').split(/,\s*/).filter(Boolean)) {
    const match = /^(.+?)\s*([+-]\d+)$/.exec(part); if (!match) continue;
    const name = match[1].trim().toLowerCase(), bonus = Number(match[2]);
    const skill = sheet.skills.find(item => suffix ? item.label.toLowerCase() === `${({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' } as Record<string, string>)[name] ?? name}${suffix}` : item.label.toLowerCase() === name);
    const trait = skill && sheet.traits.find(item => item.id === skill.traitId);
    if (skill && trait) { skill.training = 1; skill.bonus = bonus - Math.floor((trait.value - 10) / 2) - m.pb; }
  }
  const rows: SheetRow[] = [];
  const add = (section: string, pairs: [string, string][]) => { for (const [name, detail] of pairs) rows.push({ id: crypto.randomUUID(), section, name, detail, expression: firstDice(detail), quantity: 1 }); };
  add('Traits', m.tr); add('Actions', m.act); add('Bonus actions', m.bon); add('Reactions', m.rea); add('Legendary actions', m.leg);
  sheet.rows = rows;
  return sheet;
}


/** Add an entry to the project: a Codex card, and for a monster a linked stat block. */
export async function addCompendiumEntryToWorld(projectId: string, hit: CompendiumEntry, locale: string): Promise<{ entry: CodexEntry; sheetId?: string }> {
  const card = compendiumCard(hit, locale), now = Date.now();
  const entry = { id: generateId(), projectId, type: card.type, title: card.title, content: card.content, fields: card.fields, tags: ['SRD 5.2'], relations: [], createdAt: now, updatedAt: now } as unknown as CodexEntry;
  await createCodexEntry(entry);
  if (hit.kind !== 'monster') return { entry };
  const sheet = await saveSheet(projectId, monsterStatBlock(hit.entry, entry.id), null);
  return { entry, sheetId: sheet.id };
}
