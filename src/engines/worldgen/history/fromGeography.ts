// ============================================
// World history — reading a generated world
// ============================================
// Flattens the world and its human geography into what the simulation needs,
// and names houses, rulers and new realms in the world's own languages.

import { createRng } from '../core/rng';
import { coinName, settlementBias, type Language } from '../core/language';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import type { HistoryInput, HistoryNamer } from './types';

const ENDINGS: Record<'house' | 'ruler' | 'realm', string[]> = {
  house: ['', 'en', 'ar', 'ing', 'id'],
  ruler: ['', 'a', 'o', 'is', 'an', 'ric', 'mir'],
  realm: ['', 'ia', 'and', 'or', 'ent'],
};

function cleanName(w: string): string {
  const s = w.toLowerCase()
    .replace(/(.)\1\1+/g, '$1$1')
    .replace(/([^aeiouyåøü])([^aeiouyåøü])([^aeiouyåøü])/g, '$1$3')
    .replace(/[^a-záéíóúäöüåøñ'-]/g, '');
  const cut = s.length > 11 ? s.slice(0, 11) : s;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Proper names from a language's own roots and endings. */
export function makeNamer(languages: { byId: Map<string, Language>; living: Language[]; proto: Language }, seed: string): HistoryNamer {
  return (langId, key, kind) => {
    const lang = languages.byId.get(langId) ?? languages.living[0] ?? languages.proto;
    if (kind === 'place') {
      return coinName(lang, languages.proto, `hist:${key}`, seed, settlementBias({ port: false, river: false, capital: false, mountainous: false, forested: false, arid: false, cold: false, marshy: false })).text;
    }
    const rng = createRng(seed, `history-name:${lang.id}:${kind}:${key}`);
    const roots = Object.values(lang.lexicon);
    const pick = () => roots[Math.floor(rng() * roots.length)] ?? 'an';
    const parts = rng() < 0.55 ? [pick(), pick()] : [pick()];
    const ending = ENDINGS[kind][Math.floor(rng() * ENDINGS[kind].length)];
    return cleanName(lang.orthography(parts.join('') + ending));
  };
}

export function historyInputFrom(data: WorldData, geo: HumanGeography): HistoryInput {
  const lang = (culture: string) => geo.languageOf[culture] ?? '';
  return {
    world: { width: data.width, height: data.height, wrapX: data.domain?.topology !== 'finite', elevation: data.elevation },
    places: geo.settlements.map((s) => ({
      key: s.sourceKey ?? `s:${s.id}`, id: s.id, name: s.name, x: s.x, y: s.y, rank: s.rank, population: s.population,
      port: s.port, langId: s.etym?.langId ?? lang(s.culture), realm: s.realm,
    })),
    realms: geo.realms.map((r) => ({ id: r.id, name: r.name, capital: r.capital, langId: lang(r.culture), hue: r.hue })),
    ruins: geo.ruins.map((r) => ({ key: r.sourceKey ?? `r:${r.id}`, id: r.id, name: r.name, x: r.x, y: r.y, kind: r.kind, condition: r.condition, importance: r.importance })),
    languages: geo.languages.living.map((l) => ({ id: l.id, name: l.name, parent: l.parent })),
    nameIn: makeNamer(geo.languages, String(data.params.seed)),
  };
}
