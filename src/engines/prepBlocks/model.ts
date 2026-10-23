// Game-prep blocks for a note or a chapter: a check ("Prueba"), an encounter
// ("Encuentro") and player material ("Material para jugadores"). Each one is
// stored as plain semantic HTML: a wrapper marked data-wh-prep="check|
// encounter|handout" that carries the block's data as one JSON attribute and,
// inside, the same facts as ordinary text, so Word, ePub, the reader, the wiki
// and Markdown all say what the block says without reading any attribute.
import type { DiceMode } from '@/engines/dice/dice';

export const PREP_KINDS = ['check', 'encounter', 'handout'] as const;
export type PrepKind = typeof PREP_KINDS[number];
export type PrepLang = 'es' | 'en';
export const isPrepKind = (value: unknown): value is PrepKind => (PREP_KINDS as readonly unknown[]).includes(value);

export const PREP_LIMITS = { text: 300, rows: 30, count: 50, dc: 40, bonus: 30 } as const;

export interface CheckResult { total: number; detail: string; outcome: 'pass' | 'miss' | null; natural: 20 | 1 | null; at: number }
export interface CheckData { skill: string; dc: number | null; bonus: number; mode: DiceMode; note: string; result: CheckResult | null; lang: PrepLang }
export interface EncounterLink { kind: 'monster' | 'card'; id: string; label: string }
export interface EncounterRow { name: string; count: number; link: EncounterLink | null }
export interface EncounterData { title: string; rows: EncounterRow[]; encounterId: string; lang: PrepLang }
export interface HandoutData { imageId: string; label: string; when: string; lang: PrepLang }
export type PrepData = CheckData | EncounterData | HandoutData;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Text as stored: one line, single spaces, trimmed. `live` leaves spaces alone, for a field still being typed. */
let live = false;
const clean = (value: unknown, max: number = PREP_LIMITS.text): string => {
  if (typeof value !== 'string') return '';
  const line = Array.from(value, char => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  return (live ? line : line.replace(/\s+/g, ' ').trim()).slice(0, max);
};
/** Run a normaliser in "live" mode: what the block's own fields show while the author types. */
export function whileTyping<T>(read: () => T): T { live = true; try { return read(); } finally { live = false; } }
const identifier = (value: unknown): string => (typeof value === 'string' && value.length <= 200 && !Array.from(value).some(char => char.charCodeAt(0) < 32) ? value : '');
const whole = (value: unknown, min: number, max: number): number | null => { const number = typeof value === 'string' && value.trim() ? Number(value) : value; return typeof number === 'number' && Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : null; };
const language = (value: unknown): PrepLang => (value === 'en' ? 'en' : 'es');

export function normalizeCheck(raw: unknown): CheckData {
  const value = record(raw) ? raw : {};
  const mode: DiceMode = value.mode === 'advantage' || value.mode === 'disadvantage' ? value.mode : 'normal';
  const found = record(value.result) ? value.result : null;
  const total = found ? whole(found.total, -999, 9999) : null;
  const result: CheckResult | null = found && total !== null ? { total, detail: clean(found.detail, 400), outcome: found.outcome === 'pass' || found.outcome === 'miss' ? found.outcome : null, natural: found.natural === 20 || found.natural === 1 ? found.natural : null, at: whole(found.at, 0, Number.MAX_SAFE_INTEGER) ?? 0 } : null;
  return { skill: clean(value.skill, 80), dc: whole(value.dc, 1, PREP_LIMITS.dc), bonus: whole(value.bonus, -PREP_LIMITS.bonus, PREP_LIMITS.bonus) ?? 0, mode, note: clean(value.note), result, lang: language(value.lang) };
}

/** `keepBlank` lets a row still being typed stay in the editor; stored and exported blocks leave it out. */
export function normalizeEncounterRow(raw: unknown, keepBlank = false): EncounterRow | null {
  const value = record(raw) ? raw : null; if (!value) return null;
  const name = clean(value.name, 120); if (!name && !keepBlank) return null;
  const found = record(value.link) ? value.link : null;
  const link: EncounterLink | null = found && (found.kind === 'monster' || found.kind === 'card') && identifier(found.id) ? { kind: found.kind, id: identifier(found.id), label: clean(found.label, 120) } : null;
  return { name, count: whole(value.count, 1, PREP_LIMITS.count) ?? 1, link };
}
export function normalizeEncounter(raw: unknown, keepBlank = false): EncounterData {
  const value = record(raw) ? raw : {};
  const rows = (Array.isArray(value.rows) ? value.rows : []).map(row => normalizeEncounterRow(row, keepBlank)).filter((row): row is EncounterRow => !!row).slice(0, PREP_LIMITS.rows);
  return { title: clean(value.title, 120), rows, encounterId: identifier(value.encounterId), lang: language(value.lang) };
}
export function normalizeHandout(raw: unknown): HandoutData {
  const value = record(raw) ? raw : {};
  return { imageId: identifier(value.imageId), label: clean(value.label, 160), when: clean(value.when), lang: language(value.lang) };
}
export function normalizePrep(kind: PrepKind, raw: unknown): PrepData { return kind === 'check' ? normalizeCheck(raw) : kind === 'encounter' ? normalizeEncounter(raw) : normalizeHandout(raw); }

/** The data attribute as stored; anything that does not read becomes an empty block of that kind. */
export function parsePrepData(kind: PrepKind, attribute: string | null | undefined): PrepData {
  if (!attribute || attribute.length > 12000) return normalizePrep(kind, {});
  try { return normalizePrep(kind, JSON.parse(attribute)); } catch { return normalizePrep(kind, {}); }
}
export function serializePrepData(kind: PrepKind, data: unknown): string { return JSON.stringify(normalizePrep(kind, data)); }

const WORDS = {
  es: { check: 'Prueba', checkOf: 'Prueba de', dc: 'CD', roll: 'Tirada', pass: 'superada', miss: 'fallada', natural20: '20 natural', natural1: '1 natural', encounter: 'Encuentro', handout: 'Material para jugadores', when: 'se entrega', unnamed: 'Sin título', noImage: 'sin imagen' },
  en: { check: 'Check', checkOf: 'check', dc: 'DC', roll: 'Roll', pass: 'passed', miss: 'failed', natural20: 'natural 20', natural1: 'natural 1', encounter: 'Encounter', handout: 'Player handout', when: 'hand out', unnamed: 'Untitled', noImage: 'no image' },
} as const;
export const prepWords = (lang: PrepLang) => WORDS[lang];

export function checkHeadline(data: CheckData): string {
  const w = WORDS[data.lang];
  const subject = data.lang === 'es' ? (data.skill ? `${w.checkOf} ${data.skill}` : w.check) : (data.skill ? `${data.skill} ${w.checkOf}` : w.check);
  return `${subject}${data.dc !== null ? ` ${w.dc} ${data.dc}` : ''}`;
}
export function checkRollText(data: CheckData): string {
  const result = data.result; if (!result) return '';
  const w = WORDS[data.lang];
  const parts = [`${w.roll}: ${result.total}`];
  if (result.natural) parts.push(result.natural === 20 ? w.natural20 : w.natural1);
  if (result.outcome) parts.push(result.outcome === 'pass' ? w.pass : w.miss);
  return `${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join(', ')})` : ''}`;
}
/** "Prueba de Percepción CD 15 — hay huellas en el barro. Tirada: 17 (superada)". */
export function checkText(data: CheckData): string {
  const roll = checkRollText(data);
  return `${checkHeadline(data)}${data.note ? ` — ${data.note}` : ''}${roll ? `${data.note ? '. ' : ' — '}${roll}` : ''}`;
}
export const encounterRowText = (row: EncounterRow): string => `${row.count > 1 ? `${row.count}× ` : ''}${row.name}`;
export function encounterHeadline(data: EncounterData): string { const w = WORDS[data.lang]; return `${w.encounter}: ${data.title || w.unnamed}`; }
export function handoutText(data: HandoutData): string {
  const w = WORDS[data.lang];
  return `${w.handout}: ${data.label || w.unnamed}${data.when ? ` — ${w.when}: ${data.when}` : ''}`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
/** The block as stored: wrapper, data attribute and the readable text. */
export function prepBlockHtml(kind: PrepKind, raw: unknown, extra: Record<string, string> = {}): string {
  const data = normalizePrep(kind, raw);
  const { class: extraClass, ...others } = extra;
  const attributes = ` data-wh-prep="${kind}" data-wh-prep-data="${escapeHtml(JSON.stringify(data))}"${Object.entries(others).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')} class="wh-prep wh-prep-${kind}${extraClass ? ` ${escapeHtml(extraClass)}` : ''}"`;
  if (kind === 'check') return `<div${attributes}><p>${escapeHtml(checkText(data as CheckData))}</p></div>`;
  if (kind === 'encounter') {
    const encounter = data as EncounterData;
    return `<div${attributes}><p><strong>${escapeHtml(encounterHeadline(encounter))}</strong></p>${encounter.rows.length ? `<ul>${encounter.rows.map(row => `<li>${escapeHtml(encounterRowText(row))}</li>`).join('')}</ul>` : ''}</div>`;
  }
  return `<figure${attributes}><p class="wh-prep-caption">${escapeHtml(handoutText(data as HandoutData))}</p></figure>`;
}
export function prepBlockElement(kind: PrepKind, raw: unknown, extra: Record<string, string> = {}): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = prepBlockHtml(kind, raw, extra);
  return template.content.firstElementChild as HTMLElement;
}
