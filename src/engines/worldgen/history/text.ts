// ============================================
// World history — in words
// ============================================
// Sentences for events and the Codex cards the author may accept, in Spanish
// or English. Years go through `year`, which formats them in the world's own
// calendar when the project has one.

import type { HistoryEvent, Polity, RuinCause, WorldHistory } from './types';

export type HistoryLang = 'es' | 'en';

export interface HistoryNames {
  polity: (key: string | undefined) => string;
  place: (key: string | undefined) => string;
  lang: (id: string | undefined) => string;
  year: (year: number) => string;
}

/** Names out of a history and the input it was simulated from. */
export function historyNames(history: WorldHistory, places: { key: string; name: string }[], languages: { id: string; name: string }[], year: (y: number) => string): HistoryNames {
  const pol = new Map(history.polities.map((p) => [p.key, p.name]));
  const pl = new Map(places.map((p) => [p.key, p.name]));
  const lg = new Map(languages.map((l) => [l.id, l.name]));
  return {
    polity: (k) => (k ? pol.get(k) ?? k : ''),
    place: (k) => (k ? pl.get(k) ?? k : ''),
    lang: (id) => (id ? lg.get(id) ?? id : ''),
    year,
  };
}

const CAUSE: Record<HistoryLang, Record<RuinCause, string>> = {
  es: { sack: 'saqueada', conquest: 'tomada y abandonada', flood: 'anegada', abandoned: 'abandonada', collapse: 'abandonada al caer su reino' },
  en: { sack: 'sacked', conquest: 'taken and abandoned', flood: 'flooded', abandoned: 'abandoned', collapse: 'abandoned when its realm fell' },
};

export function ruinCauseText(cause: RuinCause, lang: HistoryLang): string { return CAUSE[lang][cause]; }

export function eventText(e: HistoryEvent, n: HistoryNames, lang: HistoryLang): string {
  const P = n.polity(e.polity), O = n.polity(e.other), L = n.place(e.place);
  const es = lang === 'es';
  switch (e.kind) {
    case 'polity-founded': return e.langId
      ? (es ? `Emigrantes fundan ${P} en ${L}` : `Migrants found ${P} at ${L}`)
      : (es ? `Nace ${P} en ${L}` : `${P} rises at ${L}`);
    case 'city-founded': return es ? `Fundación de ${L}` : `${L} is founded`;
    case 'annexed': return es ? `${P} incorpora ${L}` : `${P} takes in ${L}`;
    case 'war': return es ? `Guerra entre ${P} y ${O}` : `War between ${P} and ${O}`;
    case 'peace': return es ? `Paz entre ${P} y ${O}` : `Peace between ${P} and ${O}`;
    case 'conquest': return O ? (es ? `${P} toma ${L} a ${O}` : `${P} takes ${L} from ${O}`) : (es ? `${P} toma ${L}` : `${P} takes ${L}`);
    case 'sack': return es ? `${P} arrasa ${L}` : `${P} razes ${L}`;
    case 'abandoned': return es ? `${L} queda abandonada` : `${L} is abandoned`;
    case 'flood': return es ? `Las aguas anegan ${L}` : `The waters drown ${L}`;
    case 'collapse': return O ? (es ? `Cae ${P} ante ${O}` : `${P} falls to ${O}`) : (es ? `${P} se desmorona` : `${P} falls apart`);
    case 'dynasty': return es ? `Nueva dinastía en ${P}` : `A new dynasty in ${P}`;
    case 'migration': return es ? `El pueblo de ${P} emigra de ${L} a ${n.place(e.toPlace)}` : `The people of ${P} leave ${L} for ${n.place(e.toPlace)}`;
    case 'cession': return es ? `${P} cede ${L} a ${O}` : `${P} cedes ${L} to ${O}`;
  }
}

export type ProposalGroup = 'realm' | 'dynasty' | 'ruler' | 'war' | 'treaty' | 'ruin';

/** A Codex card the history suggests. Nothing is written until the author accepts it. */
export interface HistoryProposal {
  /** Stable for a given seed and settings: how an accepted card is recognised after re-simulating. */
  key: string;
  group: ProposalGroup;
  type: 'faction' | 'character' | 'concept' | 'location';
  title: string;
  fields: Record<string, string>;
  /** Plain paragraphs; the writer turns them into the card's HTML. */
  paragraphs: string[];
  tags: string[];
  year: number;
  /** Keys of the proposals this one is tied to (a dynasty to its realm, a ruler to their dynasty). */
  related: string[];
}

const T = {
  es: {
    realm: 'Reino', dynasty: 'Dinastía', ruler: 'Gobernante', war: 'Guerra', treaty: 'Tratado', ruin: 'Ruina',
    founded: 'Fundación', fell: 'Caída', seat: 'Sede', language: 'Lengua', reign: 'Reinado', house: 'Casa', of: 'de',
    sides: 'Bandos', dates: 'Fechas', winner: 'Resultado', cause: 'Causa', standing: 'sigue en pie', history: 'historia',
    warOf: (a: string, b: string) => `Guerra de ${a} y ${b}`, peaceOf: (p: string) => `Paz de ${p}`, houseOf: (h: string) => `Casa de ${h}`,
    ruinOf: (p: string) => `Caída de ${p}`,
  },
  en: {
    realm: 'Realm', dynasty: 'Dynasty', ruler: 'Ruler', war: 'War', treaty: 'Treaty', ruin: 'Ruin',
    founded: 'Founded', fell: 'Fell', seat: 'Seat', language: 'Language', reign: 'Reign', house: 'House', of: 'of',
    sides: 'Sides', dates: 'Dates', winner: 'Outcome', cause: 'Cause', standing: 'still stands', history: 'history',
    warOf: (a: string, b: string) => `War of ${a} and ${b}`, peaceOf: (p: string) => `Peace of ${p}`, houseOf: (h: string) => `House of ${h}`,
    ruinOf: (p: string) => `Fall of ${p}`,
  },
};

const RISE: Record<HistoryLang, Record<string, string>> = {
  es: { founding: 'fundó el reino', usurpation: 'llegó al trono por usurpación', marriage: 'heredó el trono por matrimonio', extinction: 'heredó el trono al extinguirse la casa anterior', conquest: 'llegó con la conquista' },
  en: { founding: 'founded the realm', usurpation: 'took the throne by usurpation', marriage: 'inherited the throne by marriage', extinction: 'inherited when the previous house died out', conquest: 'came with the conquest' },
};

/** Every card the history can propose, realms first. */
export function historyProposals(history: WorldHistory, n: HistoryNames, lang: HistoryLang): HistoryProposal[] {
  const t = T[lang];
  const out: HistoryProposal[] = [];
  const span = (from: number, to?: number) => (to === undefined ? `${n.year(from)} – ` : `${n.year(from)} – ${n.year(to)}`);
  const tags = (group: string) => [t.history, group.toLowerCase()];
  const realmKey = (p: Polity) => `realm:${p.key}`;
  for (const p of history.polities) {
    const evs = history.events.filter((e) => e.polity === p.key || e.other === p.key);
    const wars = evs.filter((e) => e.kind === 'war').length;
    const paragraphs = [
      lang === 'es'
        ? `${p.name} nació en ${n.place(p.seat)} en ${n.year(p.founded)}${p.migrantsFrom ? `, fundado por emigrantes de ${n.polity(p.migrantsFrom)}` : ''}. Hablaba ${n.lang(p.langId)}.`
        : `${p.name} rose at ${n.place(p.seat)} in ${n.year(p.founded)}${p.migrantsFrom ? `, founded by migrants from ${n.polity(p.migrantsFrom)}` : ''}. It spoke ${n.lang(p.langId)}.`,
      p.fell === undefined
        ? (lang === 'es' ? `Sigue en pie. Libró ${wars} guerras y tuvo ${p.dynasties.length} dinastías.` : `It still stands. It fought ${wars} wars and had ${p.dynasties.length} dynasties.`)
        : (lang === 'es' ? `Cayó en ${n.year(p.fell)}${p.fellTo ? ` ante ${n.polity(p.fellTo)}` : ''}, tras ${wars} guerras y ${p.dynasties.length} dinastías.` : `It fell in ${n.year(p.fell)}${p.fellTo ? ` to ${n.polity(p.fellTo)}` : ''}, after ${wars} wars and ${p.dynasties.length} dynasties.`),
    ];
    out.push({
      key: realmKey(p), group: 'realm', type: 'faction', title: p.name, year: p.founded,
      fields: { [t.founded]: n.year(p.founded), [t.fell]: p.fell === undefined ? t.standing : n.year(p.fell), [t.seat]: n.place(p.seat), [t.language]: n.lang(p.langId) },
      paragraphs, tags: tags(t.realm), related: p.dynasties.map((d) => `dynasty:${d.key}`),
    });
    for (const d of p.dynasties) {
      out.push({
        key: `dynasty:${d.key}`, group: 'dynasty', type: 'faction', title: t.houseOf(d.name), year: d.from,
        fields: { [t.realm]: p.name, [t.dates]: span(d.from, d.to) },
        paragraphs: [
          lang === 'es' ? `Reinó en ${p.name} de ${n.year(d.from)} a ${n.year(d.to)}; ${RISE.es[d.rise]}.` : `Ruled ${p.name} from ${n.year(d.from)} to ${n.year(d.to)}; it ${RISE.en[d.rise]}.`,
          d.rulers.map((r) => `${r.name} (${span(r.from, r.to)})`).join(', '),
        ],
        tags: tags(t.dynasty), related: [realmKey(p), ...d.rulers.map((_, i) => `ruler:${d.key}:${i}`)],
      });
      d.rulers.forEach((r, i) => out.push({
        key: `ruler:${d.key}:${i}`, group: 'ruler', type: 'character', title: r.name, year: r.from,
        fields: { [t.realm]: p.name, [t.house]: d.name, [t.reign]: span(r.from, r.to) },
        paragraphs: [lang === 'es' ? `Reinó en ${p.name} de ${n.year(r.from)} a ${n.year(r.to)}, de la casa de ${d.name}.` : `Reigned over ${p.name} from ${n.year(r.from)} to ${n.year(r.to)}, of the house of ${d.name}.`],
        tags: tags(t.ruler), related: [`dynasty:${d.key}`],
      }));
    }
  }
  for (const w of history.events.filter((e) => e.kind === 'war')) {
    const fights = history.events.filter((e) => e.war === w.war && (e.kind === 'conquest' || e.kind === 'sack'));
    out.push({
      key: `war:${w.war}`, group: 'war', type: 'concept', title: t.warOf(n.polity(w.polity), n.polity(w.other)), year: w.year,
      fields: { [t.sides]: `${n.polity(w.polity)} / ${n.polity(w.other)}`, [t.dates]: span(w.year, w.endYear ?? w.year) },
      paragraphs: [fights.length ? fights.map((e) => eventText(e, n, lang)).join('. ') + '.' : (lang === 'es' ? 'Ninguna plaza cambió de manos.' : 'No place changed hands.')],
      tags: tags(t.war), related: [`realm:${w.polity}`, `realm:${w.other}`],
    });
  }
  for (const p of history.events.filter((e) => e.kind === 'peace' || e.kind === 'cession')) {
    out.push({
      key: `treaty:${p.id}`, group: 'treaty', type: 'concept', title: t.peaceOf(n.place(p.place)), year: p.year,
      fields: { [t.sides]: `${n.polity(p.polity)} / ${n.polity(p.other)}`, [t.dates]: n.year(p.year) },
      paragraphs: [eventText(p, n, lang) + '.'],
      tags: tags(t.treaty), related: [`realm:${p.polity}`, `realm:${p.other}`, ...(p.war ? [`war:${p.war}`] : [])],
    });
  }
  for (const r of history.ruins) {
    out.push({
      key: `ruin:${r.ruin}`, group: 'ruin', type: 'location', title: r.name, year: r.fell,
      fields: { [t.founded]: n.year(r.founded), [t.fell]: n.year(r.fell), [t.cause]: ruinCauseText(r.cause, lang), ...(r.polity ? { [t.realm]: n.polity(r.polity) } : {}) },
      paragraphs: [lang === 'es'
        ? `Fundada en ${n.year(r.founded)}${r.polity ? `, perteneció a ${n.polity(r.polity)}` : ''}; ${ruinCauseText(r.cause, lang)} en ${n.year(r.fell)}${r.by ? ` por ${n.polity(r.by)}` : ''}.`
        : `Founded in ${n.year(r.founded)}${r.polity ? `, it belonged to ${n.polity(r.polity)}` : ''}; ${ruinCauseText(r.cause, lang)} in ${n.year(r.fell)}${r.by ? ` by ${n.polity(r.by)}` : ''}.`],
      tags: tags(t.ruin), related: r.polity ? [`realm:${r.polity}`] : [],
    });
  }
  return out;
}
