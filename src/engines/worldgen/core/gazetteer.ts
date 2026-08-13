// ============================================
// World Generator — Gazetteer
// ============================================
// A map is a picture; a gazetteer is a place you can write in. This turns the
// generated world into a document: what the realms are, who lives in them, what
// language they speak and how it is related to their neighbours', what every name
// means, which coasts are wet and which are dead, and where the interesting
// trouble is.
//
// Everything here is READ from the simulation. Nothing is invented at this
// layer — if the document says a border follows a mountain range, the border
// follows a mountain range. That is the difference between a generated document
// and a plausible-sounding one, and it is why this is worth building on top of a
// physical model rather than instead of one.

import { Biome, type WorldData } from './types';
import { createRng, rngInt } from './rng';
import { cognates, etymology, GLOSS_ES, type Gloss, type Language } from './language';
import type { HumanGeography, NamedFeature, Realm, Settlement } from './settlements';
import { cultureName } from './naming';
import type { RuinCondition, RuinSite } from './ruins';
import type { RuinKind } from './types';

export interface GazetteerOptions {
  title: string;
  /** Planet radius in km, for distances and areas. */
  planetRadiusKm?: number;
  /** Include the etymology of every name (long but the most useful part). */
  etymologies?: boolean;
}

interface Ctx {
  world: WorldData;
  geo: HumanGeography;
  opts: GazetteerOptions;
  W: number;
  H: number;
  kmPerCell: number;
}

const nf = (n: number) => n.toLocaleString('es-ES');

// ---------------------------------------------------------------------------
// Prosa de ruinas — DE ESTE DOCUMENTO, no del motor.
// ---------------------------------------------------------------------------
// El gazetteer es castellano por diseño (como los nombres que acuña
// `naming.ts`); estas tablas vivían en `core/ruins.ts` como `_ES` y eran las
// últimas etiquetas a fuego del motor. La UI usa `RUIN_*_KEY` + t(); la prosa
// de este pliego usa esto.

const RUIN_KIND_PROSE: Record<RuinKind, string> = {
  city: 'ciudad en ruinas', fort: 'fortaleza', tower: 'torre', temple: 'templo',
  stones: 'círculo de piedras', bridge: 'puente', mine: 'mina', wall: 'muralla',
};

const RUIN_SITE_PROSE: Record<RuinSite, string> = {
  harbour: 'puerto natural', pass: 'paso de montaña', confluence: 'confluencia de ríos',
  summit: 'cumbre con vistas', island: 'isla apartada', oasis: 'oasis', ford: 'vado',
  mineral: 'veta mineral', holy: 'lugar sagrado', strait: 'estrecho', cape: 'cabo',
};

const RUIN_CONDITION_PROSE: Record<RuinCondition, string> = {
  overgrown: 'cubierto de vegetación', buried: 'sepultado por la arena', flooded: 'inundado',
  burnt: 'calcinado', standing: 'aún en pie', drowned: 'bajo las aguas',
};

/** Femeninos: «una fortaleza cubierto de vegetación» es como la prosa generada
 *  se delata, y el castellano hace barato el arreglo. */
const RUIN_CONDITION_PROSE_F: Record<RuinCondition, string> = {
  overgrown: 'cubierta de vegetación', buried: 'sepultada por la arena', flooded: 'inundada',
  burnt: 'calcinada', standing: 'aún en pie', drowned: 'bajo las aguas',
};

const RUIN_FEMININE = new Set<RuinKind>(['city', 'fort', 'tower', 'mine', 'wall']);

/** Condición concordada con el género del sustantivo de la ruina. */
function ruinConditionProse(kind: RuinKind, condition: RuinCondition): string {
  return (RUIN_FEMININE.has(kind) ? RUIN_CONDITION_PROSE_F : RUIN_CONDITION_PROSE)[condition];
}

function latitudeName(lat: number): string {
  const a = Math.abs(lat);
  const hemi = lat >= 0 ? 'norte' : 'sur';
  if (a < 10) return 'el ecuador';
  if (a < 24) return `los trópicos del ${hemi}`;
  if (a < 40) return `las latitudes subtropicales del ${hemi}`;
  if (a < 58) return `las latitudes medias del ${hemi}`;
  if (a < 70) return `las latitudes altas del ${hemi}`;
  return `el ${hemi} polar`;
}

export function biomeName(b: number): string {
  switch (b) {
    case Biome.IceCap: return 'casquete polar';
    case Biome.Glacier: return 'glaciar';
    case Biome.Tundra: return 'tundra';
    case Biome.BorealForest: return 'bosque boreal';
    case Biome.TemperateForest: return 'bosque templado';
    case Biome.TemperateRainforest: return 'selva templada';
    case Biome.Grassland: return 'pradera';
    case Biome.Shrubland: return 'matorral';
    case Biome.Savanna: return 'sabana';
    case Biome.TropicalForest: return 'bosque tropical';
    case Biome.TropicalRainforest: return 'selva tropical';
    case Biome.Desert: return 'desierto';
    case Biome.ColdDesert: return 'desierto frío';
    case Biome.Alpine: return 'alta montaña';
    case Biome.Beach: return 'litoral';
    case Biome.SaltFlat: return 'salar';
    case Biome.Mangrove: return 'manglar';
    case Biome.SaltMarsh: return 'marisma salada';
    case Biome.Marsh: return 'humedal';
    case Biome.PeatBog: return 'turbera';
    case Biome.Steppe: return 'estepa';
    case Biome.Chaparral: return 'matorral mediterráneo';
    case Biome.MonsoonForest: return 'bosque monzónico';
    case Biome.CloudForest: return 'bosque nuboso';
    case Biome.MontaneForest: return 'bosque montano';
    case Biome.AlpineMeadow: return 'pradera alpina';
    case Biome.Erg: return 'erg (mar de arena)';
    case Biome.Reg: return 'reg (desierto pedregoso)';
    case Biome.Badlands: return 'cárcavas';
    case Biome.RiparianForest: return 'bosque de ribera';
    default: return 'llano';
  }
  if (b === 32) return 'karst';
  if (b === 33) return 'bambusal';
  if (b === 34) return 'desierto de niebla';
  if (b === 35) return 'espinar';
  if (b === 36) return 'páramo';
  if (b === 37) return 'puna';
  if (b === 38) return 'malpaís volcánico';
  if (b === 39) return 'llanura de ceniza';
  if (b === 40) return 'bosque petrificado';
  if (b === 41) return 'bosque fúngico';
  if (b === 42) return 'llanos de cristal';
  if (b === 43) return 'marisma luminosa';
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function overview(c: Ctx): string {
  const { world: w, geo } = c;
  const N = c.W * c.H;
  let land = 0, ice = 0, tSum = 0, pSum = 0, maxE = -99, minE = 99;
  const biomeCount = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (w.elevation[i] > 0) {
      land++;
      tSum += w.temperature[i];
      pSum += w.precipitation[i];
      if (w.elevation[i] > maxE) maxE = w.elevation[i];
      biomeCount.set(w.biome[i], (biomeCount.get(w.biome[i]) ?? 0) + 1);
      if (w.ice[i] > 0.15) ice++;
    }
    if (w.elevation[i] < minE) minE = w.elevation[i];
  }
  const surfaceKm2 = 4 * Math.PI * Math.pow(c.opts.planetRadiusKm ?? 6371, 2);
  const landKm2 = surfaceKm2 * (land / N);
  const topBiomes = [...biomeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([b, n]) => `${biomeName(b)} (${Math.round((100 * n) / land)} %)`);
  const pop = geo.settlements.reduce((s, x) => s + x.population, 0);

  const highest = geo.features.filter((f) => f.kind === 'peak')
    .sort((a, b) => w.elevation[b.y * c.W + b.x] - w.elevation[a.y * c.W + a.x])[0];

  return [
    `## El mundo`,
    ``,
    `${nf(Math.round(landKm2))} km² de tierra firme, un ${(100 * land / N).toFixed(1)} % de la superficie`,
    `del planeta, repartidos entre ${geo.realms.length} estados y ${nf(geo.settlements.length)} asentamientos`,
    `de los que se tiene registro, con unos ${nf(Math.round(pop))} habitantes censados.`,
    ``,
    `El techo del mundo está a ${(maxE * 1000).toFixed(0)} m sobre el nivel del mar${
      highest ? ` — ${highest.name}` : ''}; la fosa más honda desciende ${(-minE * 1000).toFixed(0)} m bajo él.`,
    `La temperatura media en tierra es de ${(tSum / land).toFixed(1)} °C y la precipitación media`,
    `de ${(pSum / land).toFixed(0)} mm anuales.`,
    ice > land * 0.02
      ? `Un ${(100 * ice / land).toFixed(0)} % de la tierra estuvo bajo el hielo en el último máximo glacial, y sus costas lo llevan escrito.`
      : `El mundo no ha conocido glaciación reciente de importancia.`,
    ``,
    `Dominan: ${topBiomes.join(', ')}.`,
  ].join('\n');
}

function languageSection(c: Ctx): string {
  const fam = c.geo.languages;
  const lines: string[] = ['## Las lenguas', ''];
  lines.push(
    `Todas las lenguas del mundo descienden de una sola, que nadie habló nunca tal`,
    `como se reconstruye aquí: las formas marcadas con asterisco son deducciones a`,
    `partir de las correspondencias regulares entre sus hijas.`,
    '',
    '```',
  );
  // The connector for THIS node and the continuation prefix for its children are
  // different strings; reusing one for both is what produces the classic
  // mangled tree with stray branch characters under the last child.
  const draw = (lang: Language, pad: string, connector: string, last: boolean) => {
    lines.push(`${pad}${connector}${lang.name}${lang.parent === null ? '  (reconstruida)' : ''}`);
    const kids = fam.all.filter((l) => l.parent === lang.id);
    const childPad = pad + (connector === '' ? '' : last ? '    ' : '│   ');
    kids.forEach((k, i) => draw(k, childPad, i === kids.length - 1 ? '└── ' : '├── ', i === kids.length - 1));
  };
  draw(fam.proto, '', '', true);
  lines.push('```', '');

  // Which culture speaks what.
  const spoken = Object.entries(c.geo.languageOf);
  if (spoken.length) {
    lines.push('| Pueblo | Lengua | Innovaciones que la separan |', '|---|---|---|');
    for (const [cult, langId] of spoken) {
      const l = fam.byId.get(langId);
      if (!l) continue;
      lines.push(`| ${cultureName(cult as never)} | ${l.name} | ${l.innovations.join(', ') || '—'} |`);
    }
    lines.push('');
  }

  // The comparative table: this is the section that shows the family is real.
  const roots: Gloss[] = ['water', 'stone', 'mountain', 'cold', 'fort', 'sea', 'forest', 'king'];
  lines.push('### Tabla comparativa', '');
  lines.push(`| | ${roots.map((r) => GLOSS_ES[r]).join(' | ')} |`);
  lines.push(`|---|${roots.map(() => '---').join('|')}|`);
  lines.push(`| *protolengua* | ${roots.map((r) => `*${fam.proto.lexicon[r]}*`).join(' | ')} |`);
  for (const l of fam.living) {
    lines.push(`| ${l.name} | ${roots.map((r) => l.lexicon[r]).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function realmSection(c: Ctx): string {
  const { geo, world: w } = c;
  const lines: string[] = ['## Los estados', ''];
  const byRealm = new Map<number, Settlement[]>();
  for (const s of geo.settlements) {
    if (s.realm < 0) continue;
    let arr = byRealm.get(s.realm);
    if (!arr) byRealm.set(s.realm, (arr = []));
    arr.push(s);
  }

  // Who borders whom, read off the realm map.
  const neighbours = new Map<number, Set<number>>();
  for (let y = 0; y < c.H - 1; y++) {
    for (let x = 0; x < c.W; x++) {
      const a = geo.realmOf[y * c.W + x];
      if (a < 0) continue;
      for (const b of [geo.realmOf[y * c.W + ((x + 1) % c.W)], geo.realmOf[(y + 1) * c.W + x]]) {
        if (b < 0 || b === a) continue;
        if (!neighbours.has(a)) neighbours.set(a, new Set());
        if (!neighbours.has(b)) neighbours.set(b, new Set());
        neighbours.get(a)!.add(b);
        neighbours.get(b)!.add(a);
      }
    }
  }

  const sorted = [...geo.realms].sort((a, b) => b.cellCount - a.cellCount);
  for (const r of sorted) {
    const cap = geo.settlements[r.capital];
    const towns = (byRealm.get(r.id) ?? []).sort((a, b) => b.population - a.population);
    const areaKm2 = r.cellCount * c.kmPerCell * c.kmPerCell;
    const pop = towns.reduce((s, x) => s + x.population, 0);
    const lang = geo.languages.byId.get(geo.languageOf[r.culture]);
    const nb = [...(neighbours.get(r.id) ?? [])].map((i) => geo.realms[i]?.name).filter(Boolean);

    // What kind of country is it?
    let coastCells = 0, mountainCells = 0, aridCells = 0, forestCells = 0, total = 0;
    for (let i = 0; i < c.W * c.H; i++) {
      if (geo.realmOf[i] !== r.id) continue;
      total++;
      if (w.elevation[i] > 1.1) mountainCells++;
      const b = w.biome[i];
      if (b === Biome.Desert || b === Biome.SaltFlat || b === Biome.ColdDesert) aridCells++;
      if (b === Biome.TemperateForest || b === Biome.BorealForest || b === Biome.TropicalForest) forestCells++;
    }
    for (const s of towns) if (s.port) coastCells++;
    const traits: string[] = [];
    if (mountainCells / Math.max(1, total) > 0.25) traits.push('montañoso');
    if (aridCells / Math.max(1, total) > 0.3) traits.push('árido');
    if (forestCells / Math.max(1, total) > 0.35) traits.push('boscoso');
    if (coastCells > towns.length * 0.5) traits.push('marítimo');
    if (!traits.length) traits.push('de tierras abiertas');

    lines.push(`### ${r.name}`, '');
    lines.push(
      `Capital **${cap?.name ?? '—'}**${cap?.etym ? ` — ${etymology(cap.etym)}` : ''}. `
      + `Pueblo ${cultureName(r.culture)}, lengua ${lang?.name ?? '—'}. `
      + `Unos ${nf(Math.round(areaKm2))} km² y ${nf(Math.round(pop))} habitantes en ${towns.length} plazas registradas. `
      + `País ${traits.join(', ')}.`,
    );
    if (nb.length) lines.push('', `Limita con ${nb.join(', ')}.`);
    if (towns.length > 1) {
      lines.push('', '| Plaza | Rango | Habitantes | Nombre |', '|---|---|---|---|');
      for (const s of towns.slice(0, 8)) {
        const rank = s.rank === 'capital' ? 'capital' : s.rank === 'city' ? 'ciudad' : s.rank === 'town' ? 'villa' : 'aldea';
        const tags = [s.port ? 'puerto' : '', s.river ? 'sobre río' : ''].filter(Boolean).join(', ');
        lines.push(`| ${s.name} | ${rank}${tags ? ` (${tags})` : ''} | ${nf(s.population)} | ${s.etym ? etymology(s.etym) : '—'} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function geographySection(c: Ctx): string {
  const { geo } = c;
  const lines: string[] = ['## La geografía', ''];
  const groups: [string, NamedFeature['kind'][]][] = [
    ['Continentes', ['continent']],
    ['Mares y océanos', ['ocean', 'sea']],
    ['Cordilleras', ['range']],
    ['Cumbres', ['peak']],
    ['Bosques', ['forest']],
    ['Desiertos', ['desert']],
    ['Llanuras', ['plain']],
    ['Ríos', ['river']],
    ['Lagos', ['lake']],
    ['Islas', ['isle']],
    ['Cabos, penínsulas e istmos', ['cape']],
    ['Bahías y golfos', ['bay']],
    ['Estrechos y pasos de mar', ['strait']],
    ['Valles, gargantas y pasos', ['valley', 'gorge']],
    ['Marismas y deltas', ['marsh']],
  ];
  for (const [heading, kinds] of groups) {
    const fs = geo.features.filter((f) => kinds.includes(f.kind))
      .sort((a, b) => b.importance - a.importance).slice(0, 10);
    if (!fs.length) continue;
    lines.push(`### ${heading}`, '');
    for (const f of fs) {
      const lat = (0.5 - f.y / c.H) * 180;
      lines.push(`- **${f.name}**${f.etym ? ` — ${etymology(f.etym)}` : ''}, en ${latitudeName(lat)}.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The ruins.
 *
 * Grouped by WHY the site was worth holding rather than by what stands there,
 * because that grouping is the only one that reads as history instead of as a
 * list of props: five forts scattered down a page mean nothing, five forts all
 * on mountain passes mean somebody once had a frontier.
 */
function ruinSection(c: Ctx): string {
  const { geo } = c;
  if (!geo.ruins.length) return '';
  const lines: string[] = [
    '## Lo que quedó atrás',
    '',
    'Cada ruina está donde el mundo hizo valioso un emplazamiento y hoy no lo usa',
    'nadie: un puerto natural sin puerto, un paso sin guarnición, una confluencia',
    'sin puente. Ninguna se colocó al azar.',
    '',
  ];
  const bySite = new Map<RuinSite, typeof geo.ruins>();
  for (const r of geo.ruins) {
    let l = bySite.get(r.site);
    if (!l) bySite.set(r.site, (l = []));
    l.push(r);
  }
  const order = [...bySite.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [site, list] of order) {
    lines.push(`### ${capitalizeFirst(RUIN_SITE_PROSE[site])}`, '');
    for (const r of list.sort((a, b) => b.importance - a.importance)) {
      const lat = (0.5 - r.y / c.H) * 180;
      lines.push(
        `- **${r.name}** — ${RUIN_KIND_PROSE[r.kind]}, ${ruinConditionProse(r.kind, r.condition)}, `
        + `en ${latitudeName(lat)}${r.painted ? ' (puesta a mano)' : ''}.`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function coastSection(c: Ctx): string {
  const { world: w, geo } = c;
  // Which ports sit on a warm current and which on a cold one — the fact that
  // decides whether a harbour is a granary or a fishing station.
  const rows: string[] = [];
  const ports = geo.settlements.filter((s) => s.port)
    .sort((a, b) => b.population - a.population).slice(0, 12);
  for (const s of ports) {
    const i = s.y * c.W + s.x;
    const anom = w.sst[i];
    const kind = anom > 1.5 ? 'corriente cálida' : anom < -1.5 ? 'corriente fría' : 'aguas neutras';
    const rain = w.precipitation[i];
    const note = anom < -1.5 && rain < 500 ? 'costa desértica, niebla y pesca'
      : anom > 1.5 ? 'inviernos suaves para su latitud'
        : rain > 1600 ? 'lluviosa todo el año' : 'clima moderado';
    rows.push(`| ${s.name} | ${((0.5 - s.y / c.H) * 180).toFixed(0)}° | ${kind} (${anom >= 0 ? '+' : ''}${anom.toFixed(1)} °C) | ${rain.toFixed(0)} mm | ${note} |`);
  }
  if (!rows.length) return '';
  return [
    '## Las costas y el mar',
    '',
    'Dos puertos a la misma latitud pueden tener climas distintos según la',
    'corriente que los baña. Las corrientes frías traen niebla, pesca y sequía;',
    'las cálidas, inviernos suaves y puertos libres de hielo.',
    '',
    '| Puerto | Latitud | Corriente | Lluvia | Carácter |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function hooksSection(c: Ctx): string {
  const { world: w, geo, opts } = c;
  const rng = createRng(w.params.seed, 'hooks');
  const hooks: string[] = [];

  // A border that follows a mountain range.
  const ranges = geo.features.filter((f) => f.kind === 'range');
  for (const r of ranges.slice(0, 4)) {
    const i = r.y * c.W + r.x;
    const here = geo.realmOf[i];
    let other = -1;
    for (let d = 3; d < 14 && other < 0; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as [number, number][]) {
        const yy = Math.min(c.H - 1, Math.max(0, r.y + dy));
        const j = yy * c.W + ((r.x + dx + c.W) % c.W);
        const o = geo.realmOf[j];
        if (o >= 0 && o !== here) { other = o; break; }
      }
    }
    if (here >= 0 && other >= 0) {
      hooks.push(`**${r.name}** separa ${geo.realms[here].name} de ${geo.realms[other].name}. `
        + `Quien controle sus pasos controla el comercio entre ambos — y ninguna de las dos cortes lo ha conseguido durante mucho tiempo.`);
      break;
    }
  }

  // The most isolated significant settlement.
  const majors = geo.settlements.filter((s) => s.rank !== 'village');
  let lonely: Settlement | null = null, lonelyD = -1;
  for (const s of majors) {
    let best = Infinity;
    for (const o of majors) {
      if (o === s) continue;
      let dx = Math.abs(o.x - s.x);
      if (dx > c.W / 2) dx = c.W - dx;
      const d = Math.hypot(dx, o.y - s.y);
      if (d < best) best = d;
    }
    if (best > lonelyD) { lonelyD = best; lonely = s; }
  }
  if (lonely) {
    hooks.push(`**${lonely.name}** es la plaza más aislada del mundo conocido: `
      + `${Math.round(lonelyD * c.kmPerCell)} km la separan de la siguiente ciudad. `
      + `${lonely.port ? 'Todo lo que entra o sale lo hace por mar.' : 'No hay puerto: todo llega por camino, cuando llega.'}`);
  }

  // A glaciated frontier.
  let iceRealm = -1, iceFrac = 0;
  for (const r of geo.realms) {
    let n = 0, ic = 0;
    for (let i = 0; i < c.W * c.H; i++) {
      if (geo.realmOf[i] !== r.id) continue;
      n++;
      if (w.ice[i] > 0.2) ic++;
    }
    if (n > 0 && ic / n > iceFrac) { iceFrac = ic / n; iceRealm = r.id; }
  }
  if (iceRealm >= 0 && iceFrac > 0.25) {
    hooks.push(`Un ${(100 * iceFrac).toFixed(0)} % de ${geo.realms[iceRealm].name} estuvo bajo el hielo, `
      + `y sus fiordos son a la vez su defensa y su cárcel: excelentes puertos, ninguna llanura que alimente un ejército.`);
  }

  // A desert coast.
  const dryPort = geo.settlements
    .filter((s) => s.port && w.precipitation[s.y * c.W + s.x] < 420 && w.sst[s.y * c.W + s.x] < -1)
    .sort((a, b) => b.population - a.population)[0];
  if (dryPort) {
    hooks.push(`**${dryPort.name}** vive de espaldas a un desierto: la corriente fría que llena sus redes `
      + `es la misma que impide que llueva. El agua dulce es un asunto de estado.`);
  }

  // A capital that is not the largest city.
  for (const r of geo.realms) {
    const inRealm = geo.settlements.filter((s) => s.realm === r.id);
    if (inRealm.length < 3) continue;
    const cap = geo.settlements[r.capital];
    const biggest = inRealm.sort((a, b) => b.population - a.population)[0];
    if (cap && biggest && biggest.id !== cap.id && biggest.population > cap.population * 1.15) {
      hooks.push(`En ${r.name} la corte está en **${cap.name}** pero el dinero está en **${biggest.name}**, `
        + `que la supera en ${nf(biggest.population - cap.population)} habitantes. Esa clase de desajuste no dura para siempre.`);
      break;
    }
  }

  // A cognate pair across a border — the language layer paying off.
  const fam = geo.languages;
  const withEtym = geo.settlements.filter((s) => s.etym && s.realm >= 0);
  if (withEtym.length > 2) {
    const s = withEtym[rngInt(rng, 0, withEtym.length - 1)];
    const cg = cognates(s.etym!, fam, w.params.seed, `hook${s.id}`);
    const other = cg[rngInt(rng, 0, Math.max(0, cg.length - 1))];
    if (other) {
      const lang = fam.byId.get(other.langId);
      hooks.push(`**${s.name}** y **${other.text}** son el mismo nombre: ambos significan `
        + `${s.etym!.parts.map((p) => GLOSS_ES[p]).join(' ')}, uno en ${fam.byId.get(s.etym!.langId)?.name}, `
        + `el otro en ${lang?.name}. Los dos pueblos niegan el parentesco.`);
    }
  }

  if (!hooks.length) return '';
  return ['## Hilos de los que tirar', '', ...hooks.map((h) => `- ${h}`), '',
    `_Todo lo anterior se lee del mapa de ${opts.title}: no hay nada inventado en esta sección._`, ''].join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildGazetteer(
  world: WorldData,
  geo: HumanGeography,
  opts: GazetteerOptions,
): string {
  const W = world.width, H = world.height;
  const radius = opts.planetRadiusKm ?? 6371;
  const c: Ctx = { world, geo, opts, W, H, kmPerCell: (2 * Math.PI * radius) / W };

  return [
    `# ${opts.title}`,
    '',
    `_Compendio generado a partir de la semilla \`${world.params.seed}\`. `
    + `El mismo mundo, con las mismas ciudades y los mismos nombres, se reconstruye siempre desde ella._`,
    '',
    overview(c),
    '',
    languageSection(c),
    realmSection(c),
    geographySection(c),
    ruinSection(c),
    coastSection(c),
    hooksSection(c),
  ].join('\n');
}

/** Realm helper re-export, so callers do not need to import the whole module. */
export type { Realm };
