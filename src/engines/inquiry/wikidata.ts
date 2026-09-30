// ============================================
// Wikidata — wire types, parsing and field mapping (pure)
// ============================================
//
// The main process (electron/wikidata.ts) fetches and hands back bounded JSON;
// everything that reads it lives here so it can be tested without a network
// and is also imported by the preload/main for the wire types. Must not touch
// `window`.

import type { CodexEntryType } from '@/types';

export type WikidataRequest =
  | { op: 'search'; query: string; language: string }
  | { op: 'entity'; qid: string; language: string }
  | { op: 'labels'; qids: string[]; language: string };

export type WikidataResponse =
  | { ok: true; data: unknown }
  | { ok: false; code: 'bad-request' | 'network' | 'timeout' | 'http' | 'too-large'; error: string };

export interface WikidataCandidate {
  qid: string;
  label: string;
  description: string;
  url: string;
}

export type WikidataValue =
  | { kind: 'item'; qid: string }
  | { kind: 'time'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'quantity'; amount: number }
  | { kind: 'coord'; lat: number; lon: number };

export interface WikidataItem {
  qid: string;
  label: string;
  description: string;
  aliases: string[];
  claims: Record<string, WikidataValue[]>;
}

export const QID_PATTERN = /^Q[1-9]\d{0,12}$/;
const MAX_TEXT = 400;
const MAX_VALUES = 5;

export function wikidataUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}

const bounded = (value: unknown, max = MAX_TEXT): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);

export function parseSearch(data: unknown): WikidataCandidate[] {
  const list = record(data)?.search;
  if (!Array.isArray(list)) return [];
  const out: WikidataCandidate[] = [];
  for (const row of list) {
    const item = record(row);
    const qid = bounded(item?.id, 20);
    if (!item || !QID_PATTERN.test(qid)) continue;
    out.push({ qid, label: bounded(item.label, 200) || qid, description: bounded(item.description), url: wikidataUrl(qid) });
  }
  return out.slice(0, 10);
}

function localized(map: unknown, language: string): string {
  const table = record(map);
  if (!table) return '';
  for (const key of [language, 'en']) {
    const entry = record(table[key]);
    const value = bounded(entry?.value, 300);
    if (value) return value;
  }
  return '';
}

/** Human text of a Wikidata time at the precision it was recorded. */
export function formatWikidataTime(time: string, precision: number): string | null {
  const match = /^([+-])(\d{1,12})-(\d{2})-(\d{2})T/.exec(time);
  if (!match) return null;
  const year = Number(match[2]);
  if (match[1] === '-') return `${year} BC`;
  const y = String(year).padStart(4, '0');
  if (precision >= 11 && match[3] !== '00' && match[4] !== '00') return `${y}-${match[3]}-${match[4]}`;
  if (precision >= 10 && match[3] !== '00') return `${y}-${match[3]}`;
  return y;
}

function parseValue(snak: Record<string, unknown>): WikidataValue | null {
  if (snak.snaktype !== 'value') return null;
  const datavalue = record(snak.datavalue);
  const value = datavalue?.value;
  switch (datavalue?.type) {
    case 'wikibase-entityid': {
      const id = bounded(record(value)?.id, 20);
      return QID_PATTERN.test(id) ? { kind: 'item', qid: id } : null;
    }
    case 'time': {
      const time = record(value);
      const text = typeof time?.time === 'string' && typeof time.precision === 'number' ? formatWikidataTime(time.time, time.precision) : null;
      return text ? { kind: 'time', text } : null;
    }
    case 'string': {
      const text = bounded(value, 300);
      return text ? { kind: 'string', text } : null;
    }
    case 'quantity': {
      const amount = Number(bounded(record(value)?.amount, 40));
      return Number.isFinite(amount) ? { kind: 'quantity', amount } : null;
    }
    case 'globecoordinate': {
      const coord = record(value);
      const lat = Number(coord?.latitude);
      const lon = Number(coord?.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { kind: 'coord', lat, lon } : null;
    }
    default:
      return null;
  }
}

/** `wbgetentities` answer → the item, or null when it is missing or malformed. Deprecated claims are dropped; preferred ones win. */
export function parseEntity(data: unknown, qid: string, language: string): WikidataItem | null {
  const entities = record(record(data)?.entities);
  const entity = record(entities?.[qid]);
  if (!entity || 'missing' in entity || entity.id !== qid) return null;
  const aliasTable = record(entity.aliases);
  const aliasRows = aliasTable ? (aliasTable[language] ?? aliasTable.en) : undefined;
  const aliases = Array.isArray(aliasRows) ? aliasRows.map(row => bounded(record(row)?.value, 120)).filter(Boolean).slice(0, 10) : [];
  const claims: Record<string, WikidataValue[]> = {};
  for (const [property, rows] of Object.entries(record(entity.claims) ?? {})) {
    if (!/^P\d{1,7}$/.test(property) || !Array.isArray(rows)) continue;
    const usable = rows.map(row => record(row)).filter((row): row is Record<string, unknown> => !!row && row.rank !== 'deprecated');
    const preferred = usable.filter(row => row.rank === 'preferred');
    const values = (preferred.length ? preferred : usable)
      .map(row => { const snak = record(row.mainsnak); return snak ? parseValue(snak) : null; })
      .filter((value): value is WikidataValue => value !== null)
      .slice(0, MAX_VALUES);
    if (values.length) claims[property] = values;
  }
  return {
    qid,
    label: localized(entity.labels, language) || qid,
    description: localized(entity.descriptions, language),
    aliases,
    claims,
  };
}

export function parseLabels(data: unknown, language: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, entity] of Object.entries(record(record(data)?.entities) ?? {})) {
    if (!QID_PATTERN.test(id)) continue;
    const label = localized(record(entity)?.labels, language);
    if (label) out.set(id, label);
  }
  return out;
}

export interface WikidataFieldSpec {
  /** Key written into the codex entry's `fields`. */
  field: string;
  property: string;
}

/** Which Wikidata properties feed which codex field, per entry type. The description fills `description` for all. */
export const WIKIDATA_FIELDS: Readonly<Record<CodexEntryType, readonly WikidataFieldSpec[]>> = {
  character: [
    { field: 'born', property: 'P569' }, { field: 'died', property: 'P570' }, { field: 'placeOfBirth', property: 'P19' },
    { field: 'occupation', property: 'P106' }, { field: 'citizenship', property: 'P27' },
  ],
  location: [
    { field: 'country', property: 'P17' }, { field: 'locatedIn', property: 'P131' }, { field: 'coordinates', property: 'P625' },
    { field: 'population', property: 'P1082' }, { field: 'founded', property: 'P571' },
  ],
  faction: [
    { field: 'founded', property: 'P571' }, { field: 'headquarters', property: 'P159' }, { field: 'country', property: 'P17' },
    { field: 'website', property: 'P856' }, { field: 'type', property: 'P31' },
  ],
  item: [{ field: 'type', property: 'P31' }, { field: 'origin', property: 'P495' }],
  concept: [
    { field: 'date', property: 'P585' }, { field: 'start', property: 'P580' }, { field: 'end', property: 'P582' },
    { field: 'location', property: 'P276' }, { field: 'country', property: 'P17' },
  ],
  magic: [],
  custom: [
    { field: 'date', property: 'P585' }, { field: 'start', property: 'P580' }, { field: 'end', property: 'P582' },
    { field: 'location', property: 'P276' }, { field: 'country', property: 'P17' },
  ],
};

/** Item ids among the values the mapping will show, so their labels can be fetched in one call. */
export function itemsToResolve(type: CodexEntryType, item: WikidataItem): string[] {
  const ids = new Set<string>();
  for (const spec of WIKIDATA_FIELDS[type]) {
    for (const value of item.claims[spec.property] ?? []) if (value.kind === 'item') ids.add(value.qid);
  }
  return [...ids].slice(0, 50);
}

export interface PlannedField {
  field: string;
  property: string;
  value: string;
}

function show(value: WikidataValue, labels: ReadonlyMap<string, string>): string {
  switch (value.kind) {
    case 'item': return labels.get(value.qid) ?? value.qid;
    case 'time': return value.text;
    case 'string': return value.text;
    case 'quantity': return String(value.amount);
    case 'coord': return `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}`;
  }
}

/** Every field Wikidata could fill for this type, before deciding which are empty. Always starts with the description. */
export function planFields(type: CodexEntryType, item: WikidataItem, labels: ReadonlyMap<string, string>): PlannedField[] {
  const planned: PlannedField[] = [];
  if (item.description) planned.push({ field: 'description', property: 'description', value: item.description });
  for (const spec of WIKIDATA_FIELDS[type]) {
    const values = item.claims[spec.property];
    if (!values?.length) continue;
    planned.push({ field: spec.field, property: spec.property, value: values.map(value => show(value, labels)).join(', ').slice(0, 300) });
  }
  return planned;
}

/** The excerpt stored with the Wikidata citation: what the item itself says, one fact per line. */
export function evidenceQuote(item: WikidataItem, planned: readonly PlannedField[]): string {
  const lines = [`${item.label} (${item.qid})`];
  if (item.description) lines.push(item.description);
  for (const row of planned) if (row.property !== 'description') lines.push(`${row.property}: ${row.value}`);
  return lines.join('\n');
}
