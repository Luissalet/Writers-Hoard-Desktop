// ============================================
// Compendium — the System Reference Document 5.2, offline
// ============================================
// Monsters, spells, magic items and conditions of the SRD 5.2 (the rules of
// the 2024 game), searchable and readable with no connection. The data is
// built by scripts/build-srd-compendium.mjs and loaded only when asked for.
// Licence: the SRD 5.2 by Wizards of the Coast LLC is released under the
// Creative Commons Attribution 4.0 International licence; every page and every
// card made from it carries the attribution below.

export const SRD_CREDIT = 'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.';
export const SRD_CREDIT_SHORT = 'SRD 5.2 · Wizards of the Coast · CC BY 4.0';

export const COMPENDIUM_KINDS = ['monster', 'spell', 'item', 'condition'] as const;
export type CompendiumKind = typeof COMPENDIUM_KINDS[number];
export const COMPENDIUM_KIND_LABELS: Record<CompendiumKind, { es: string; en: string }> = {
  monster: { es: 'Monstruos', en: 'Monsters' }, spell: { es: 'Conjuros', en: 'Spells' }, item: { es: 'Objetos mágicos', en: 'Magic items' }, condition: { es: 'Condiciones', en: 'Conditions' },
};

type Pair = [string, string];
export interface SrdMonster { id: string; n: string; s: string; t: string; al: string; ac: number; acn?: string; hp: number; hd: string; sp: string; ab: number[]; sv?: string; sk?: string; dv?: string; dr?: string; di?: string; ci?: string; se: string; la?: string; cr: number; xp: number; xpl?: number; pb: number; gear?: string; tr: Pair[]; act: Pair[]; bon: Pair[]; rea: Pair[]; leg: Pair[] }
export interface SrdSpell { id: string; n: string; lv: number; sc: string; ct: string; ra: string; co: string; ma?: string; du: string; cn?: boolean; ri?: boolean; cl?: string; d: string; hl?: string }
export interface SrdItem { id: string; n: string; ca?: string; ra?: string; at?: boolean | string; d: string }
export interface SrdCondition { id: string; n: string; d: string }
export type CompendiumEntry = { kind: 'monster'; entry: SrdMonster } | { kind: 'spell'; entry: SrdSpell } | { kind: 'item'; entry: SrdItem } | { kind: 'condition'; entry: SrdCondition };

let cache: Promise<{ monster: SrdMonster[]; spell: SrdSpell[]; item: SrdItem[]; condition: SrdCondition[] }> | null = null;

/** Every entry, loaded once on first use. */
export function loadCompendium() {
  cache ??= Promise.all([import('./data/srd52-monsters.json'), import('./data/srd52-spells.json'), import('./data/srd52-items.json'), import('./data/srd52-conditions.json')])
    .then(([monsters, spells, items, conditions]) => ({ monster: monsters.default as unknown as SrdMonster[], spell: spells.default as unknown as SrdSpell[], item: items.default as unknown as SrdItem[], condition: conditions.default as unknown as SrdCondition[] }));
  return cache;
}

export async function compendiumEntry(kind: CompendiumKind, id: string): Promise<CompendiumEntry | null> {
  const data = await loadCompendium();
  const entry = (data[kind] as { id: string }[]).find(item => item.id === id);
  return entry ? ({ kind, entry } as CompendiumEntry) : null;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A challenge rating as printed: ½, ¼, ⅛ or a whole number. */
export function crLabel(cr: number): string {
  return cr === 0.5 ? '1/2' : cr === 0.25 ? '1/4' : cr === 0.125 ? '1/8' : String(cr);
}

export interface CompendiumFilter { kind?: CompendiumKind; crMin?: number; crMax?: number; type?: string; level?: number; school?: string; className?: string; rarity?: string }
export interface CompendiumHit { kind: CompendiumKind; id: string; name: string; summary: string; score: number }

function summary(hit: CompendiumEntry): string {
  switch (hit.kind) {
    case 'monster': return `${hit.entry.s} ${hit.entry.t} · CR ${crLabel(hit.entry.cr)}`;
    case 'spell': return `${hit.entry.lv === 0 ? 'Cantrip' : `Level ${hit.entry.lv}`} ${hit.entry.sc}${hit.entry.cn ? ' · C' : ''}${hit.entry.ri ? ' · R' : ''}`;
    case 'item': return `${hit.entry.ca ?? 'Item'} · ${hit.entry.ra ?? ''}${hit.entry.at ? ' · attunement' : ''}`;
    case 'condition': return 'Condition';
  }
}

/** Search names first (a name that starts with the words ranks above one that contains them), then the text; filters narrow each shelf. */
export async function searchCompendium(query: string, filter: CompendiumFilter = {}, limit = 50): Promise<{ hits: CompendiumHit[]; total: number }> {
  const data = await loadCompendium();
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits: CompendiumHit[] = [];
  for (const kind of COMPENDIUM_KINDS) {
    if (filter.kind && filter.kind !== kind) continue;
    for (const entry of data[kind] as (SrdMonster | SrdSpell | SrdItem | SrdCondition)[]) {
      const hit = { kind, entry } as CompendiumEntry;
      if (kind === 'monster') { const m = entry as SrdMonster; if (filter.crMin !== undefined && m.cr < filter.crMin || filter.crMax !== undefined && m.cr > filter.crMax || filter.type && fold(m.t) !== fold(filter.type)) continue; }
      if (kind === 'spell') { const sp = entry as SrdSpell; if (filter.level !== undefined && sp.lv !== filter.level || filter.school && fold(sp.sc) !== fold(filter.school) || filter.className && !fold(sp.cl ?? '').split(/,\s*/).includes(fold(filter.className))) continue; }
      if (kind === 'item' && filter.rarity && fold((entry as SrdItem).ra ?? '') !== fold(filter.rarity)) continue;
      let score = 1;
      if (words.length) {
        const name = fold(entry.n), text = fold('d' in entry ? entry.d : [...(entry as SrdMonster).tr, ...(entry as SrdMonster).act].map(pair => pair.join(' ')).join(' '));
        if (!words.every(word => name.includes(word) || text.includes(word))) continue;
        score = name === words.join(' ') ? 100 : name.startsWith(words.join(' ')) ? 60 : words.every(word => name.includes(word)) ? 30 : 5;
      }
      hits.push({ kind, id: entry.id, name: entry.n, summary: summary(hit), score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { hits: hits.slice(0, limit), total: hits.length };
}

export async function compendiumCounts(): Promise<Record<CompendiumKind, number>> {
  const data = await loadCompendium();
  return { monster: data.monster.length, spell: data.spell.length, item: data.item.length, condition: data.condition.length };
}

/** An ability score's modifier, "+3" or "−1". */
export const abilityMod = (score: number) => { const mod = Math.floor((score - 10) / 2); return `${mod >= 0 ? '+' : '−'}${Math.abs(mod)}`; };
