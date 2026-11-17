// The state ledger: what each character carries, knows, where they are and
// whether they live, chapter by chapter. Pure: no database, no DOM.
import {
  LEDGER_KINDS, LEDGER_TEXT_MAX,
  type ChapterRef, type LedgerEntry, type LedgerKind, type LedgerPlace,
} from './types';

const text = (value: unknown, max = LEDGER_TEXT_MAX): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= 120 ? value.trim() : undefined;

/** Validate and tidy one ledger line; throws with a readable message. */
export function normalizeLedgerEntry(input: unknown): LedgerEntry {
  if (!input || typeof input !== 'object') throw new Error('A ledger line must be an object.');
  const raw = input as Record<string, unknown>;
  const entryId = id(raw.id), writingId = id(raw.writingId);
  if (!entryId) throw new Error('id must be a short non-empty string.');
  if (!writingId) throw new Error('writingId must be the id of a manuscript chapter.');
  if (!LEDGER_KINDS.includes(raw.kind as LedgerKind)) throw new Error(`kind must be one of ${LEDGER_KINDS.join(', ')}.`);
  const kind = raw.kind as LedgerKind;
  if (raw.order !== undefined && !(Number.isInteger(raw.order) && (raw.order as number) >= 0 && (raw.order as number) < 10000)) throw new Error('order must be a whole number from 0 to 9999.');
  const out: LedgerEntry = { id: entryId, writingId, kind, createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now() };
  if (typeof raw.order === 'number') out.order = raw.order;
  if (kind === 'location') {
    const place = raw.place as Record<string, unknown> | undefined;
    const label = text(place?.label, 200);
    if (!label) throw new Error('A location needs place.label.');
    const p: LedgerPlace = { label };
    if (id(place?.worldId)) p.worldId = id(place?.worldId);
    if (typeof place?.x === 'number' && typeof place?.y === 'number' && Number.isFinite(place.x) && Number.isFinite(place.y)) { p.x = Math.round(place.x * 256) / 256; p.y = Math.round(place.y * 256) / 256; }
    if ((p.x === undefined) !== (p.worldId === undefined)) throw new Error('A point on the map needs worldId, x and y together.');
    if (id(place?.entryId)) p.entryId = id(place?.entryId);
    out.place = p;
  }
  if (kind === 'learns' || kind === 'actsOn') {
    out.fact = text(raw.fact);
    if (id(raw.seedId)) out.seedId = id(raw.seedId);
    if (id(raw.entryId)) out.entryId = id(raw.entryId);
    if (!out.fact && !out.seedId && !out.entryId) throw new Error('A fact needs fact text, a seedId or an entryId.');
  }
  if (kind === 'gains' || kind === 'loses' || kind === 'uses') {
    if (id(raw.itemId)) out.itemId = id(raw.itemId);
    out.item = text(raw.item, 200);
    if (!out.itemId && !out.item) throw new Error('An object needs itemId (a Codex card) or item text.');
    if (!out.item) delete out.item;
    if (kind === 'loses' && id(raw.toId)) out.toId = id(raw.toId);
  }
  if (kind === 'condition') {
    out.text = text(raw.text);
    if (!out.text) throw new Error('A condition needs text.');
  } else if (text(raw.text)) out.text = text(raw.text);
  if (!out.fact) delete out.fact;
  if (raw.source === 'judge' || raw.source === 'author') out.source = raw.source;
  return out;
}

/** The key two lines share when they are about the same fact. */
export function factKey(entry: Pick<LedgerEntry, 'fact' | 'seedId' | 'entryId'>): string {
  if (entry.seedId) return `seed:${entry.seedId}`;
  if (entry.entryId) return `entry:${entry.entryId}`;
  return `text:${fold(entry.fact ?? '')}`;
}

/** The key two lines share when they are about the same object. */
export function itemKey(entry: Pick<LedgerEntry, 'itemId' | 'item'>): string {
  return entry.itemId ? `entry:${entry.itemId}` : `text:${fold(entry.item ?? '')}`;
}

export function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A ledger line with its owner and its place in the story; gifts appear on the receiver as `gains`. */
export interface PlacedLine { characterId: string; entry: LedgerEntry; chapter: number; rank: number; fromId?: string }

/**
 * Every line of every character that can be put in story order (its chapter
 * has a number), sorted by chapter, then order within the chapter, then when
 * it was written. A `loses` with `toId` adds a `gains` line to the receiver.
 */
export function placeLedger(ledgers: Readonly<Record<string, readonly LedgerEntry[]>>, chapters: readonly ChapterRef[]): PlacedLine[] {
  const byWriting = new Map(chapters.map((c) => [c.writingId, c]));
  const out: PlacedLine[] = [];
  for (const [characterId, entries] of Object.entries(ledgers)) {
    for (const entry of entries) {
      const chapter = byWriting.get(entry.writingId)?.chapter;
      if (chapter === null || chapter === undefined) continue;
      const rank = entry.order ?? 1e6 + entry.createdAt / 1e13;
      out.push({ characterId, entry, chapter, rank });
      if (entry.kind === 'loses' && entry.toId && entry.toId !== characterId) {
        out.push({ characterId: entry.toId, entry: { ...entry, id: `${entry.id}>gift`, kind: 'gains', toId: undefined }, chapter, rank: rank + 1e-9, fromId: characterId });
      }
    }
  }
  return out.sort((a, b) => a.chapter - b.chapter || a.rank - b.rank || a.entry.createdAt - b.entry.createdAt);
}

export interface CarriedItem { key: string; itemId?: string; item?: string; since: string }
export interface KnownFact { key: string; fact?: string; seedId?: string; entryId?: string; since: string }
export interface CharacterState {
  characterId: string;
  chapter: number;
  location: (LedgerPlace & { since: string }) | null;
  knows: KnownFact[];
  carries: CarriedItem[];
  condition: { text: string; since: string } | null;
  alive: boolean;
  /** Writing id of the chapter where they died, while dead. */
  diedIn: string | null;
}

/** The state of one character at the end of chapter `chapter`, accumulating every change up to it. */
export function stateAt(placed: readonly PlacedLine[], characterId: string, chapter: number): CharacterState {
  const state: CharacterState = { characterId, chapter, location: null, knows: [], carries: [], condition: null, alive: true, diedIn: null };
  const knows = new Map<string, KnownFact>(), carries = new Map<string, CarriedItem>();
  for (const line of placed) {
    if (line.characterId !== characterId || line.chapter > chapter) continue;
    const e = line.entry;
    if (e.kind === 'location' && e.place) state.location = { ...e.place, since: e.writingId };
    else if (e.kind === 'learns') { const key = factKey(e); if (!knows.has(key)) knows.set(key, { key, ...(e.fact ? { fact: e.fact } : {}), ...(e.seedId ? { seedId: e.seedId } : {}), ...(e.entryId ? { entryId: e.entryId } : {}), since: e.writingId }); }
    else if (e.kind === 'gains') { const key = itemKey(e); carries.set(key, { key, ...(e.itemId ? { itemId: e.itemId } : {}), ...(e.item ? { item: e.item } : {}), since: e.writingId }); }
    else if (e.kind === 'loses') carries.delete(itemKey(e));
    else if (e.kind === 'condition' && e.text) state.condition = { text: e.text, since: e.writingId };
    else if (e.kind === 'dies') { state.alive = false; state.diedIn = e.writingId; }
    else if (e.kind === 'revives') { state.alive = true; state.diedIn = null; }
  }
  state.knows = [...knows.values()];
  state.carries = [...carries.values()];
  return state;
}

export type StateFindingKind = 'item-not-carried' | 'after-death' | 'knows-before-learning' | 'two-places';
export interface StateFinding {
  /** Stable while the lines it is about stay the same; the key an "intended" mark is kept under. */
  id: string;
  kind: StateFindingKind;
  characterId: string;
  writingId: string;
  chapter: number;
  /** The ledger line (or story event) the finding is about. */
  lineId: string;
  /** Another line it is measured against (the death, the learning, the other place). */
  otherLineId?: string;
  otherWritingId?: string;
  detail: string;
}

/** Someone present in a chapter outside the ledger (a story event on the map naming them). */
export interface Presence { characterId: string; chapter: number; writingId: string; lineId: string; label: string }

/**
 * Deterministic checks over the ledger: using or handing over an object not
 * carried, appearing after death, acting on a fact before learning it, and two
 * places in one chapter with nothing to order them.
 */
export function checkLedger(placed: readonly PlacedLine[], presences: readonly Presence[] = []): StateFinding[] {
  const findings: StateFinding[] = [];
  const byCharacter = new Map<string, PlacedLine[]>();
  for (const line of placed) byCharacter.set(line.characterId, [...(byCharacter.get(line.characterId) ?? []), line]);
  for (const [characterId, lines] of byCharacter) {
    const carries = new Set<string>();
    let dead: PlacedLine | null = null;
    const learnt = new Map<string, PlacedLine[]>();
    const lifeChanges: PlacedLine[] = [];
    for (const line of lines) {
      if (line.entry.kind === 'learns') {
        const key = factKey(line.entry);
        const learningLines = learnt.get(key) ?? [];
        learningLines.push(line);
        learnt.set(key, learningLines);
      }
      if (line.entry.kind === 'dies' || line.entry.kind === 'revives') lifeChanges.push(line);
    }
    for (const line of lines) {
      const e = line.entry;
      if (dead && e.kind !== 'revives' && e.kind !== 'dies' && !line.fromId) {
        findings.push({ id: `after-death:${characterId}:${e.id}`, kind: 'after-death', characterId, writingId: e.writingId, chapter: line.chapter, lineId: e.id, otherLineId: dead.entry.id, otherWritingId: dead.entry.writingId, detail: e.kind });
      }
      if (e.kind === 'dies') dead = line;
      if (e.kind === 'revives') dead = null;
      if (e.kind === 'gains') carries.add(itemKey(e));
      if ((e.kind === 'uses' || e.kind === 'loses') && !carries.has(itemKey(e))) {
        findings.push({ id: `item-not-carried:${characterId}:${e.id}`, kind: 'item-not-carried', characterId, writingId: e.writingId, chapter: line.chapter, lineId: e.id, detail: e.item ?? e.itemId ?? '' });
      }
      if (e.kind === 'loses') carries.delete(itemKey(e));
      if (e.kind === 'actsOn') {
        const learningLines = learnt.get(factKey(e)) ?? [];
        const learning = learningLines[0];
        const order = e.order;
        // Without two explicit positions in the same writing, the order within a chapter is uncertain.
        if (learning && learningLines.every(({ chapter, entry }) => chapter > line.chapter
          || (chapter === line.chapter && entry.writingId === e.writingId
            && order !== undefined && entry.order !== undefined && entry.order > order))) {
          findings.push({ id: `knows-before-learning:${characterId}:${e.id}`, kind: 'knows-before-learning', characterId, writingId: e.writingId, chapter: line.chapter, lineId: e.id, otherLineId: learning.entry.id, otherWritingId: learning.entry.writingId, detail: e.fact ?? '' });
        }
      }
    }
    // Two places in one chapter: two location lines with the same position in it.
    const seen = new Map<string, PlacedLine>();
    for (const line of lines) {
      const e = line.entry;
      if (e.kind !== 'location' || !e.place || line.fromId) continue;
      const slot = `${line.chapter}|${e.order ?? 'none'}`;
      const prior = seen.get(slot);
      if (prior && prior.entry.place && fold(prior.entry.place.label) !== fold(e.place.label)) {
        findings.push({ id: `two-places:${characterId}:${prior.entry.id}:${e.id}`, kind: 'two-places', characterId, writingId: e.writingId, chapter: line.chapter, lineId: e.id, otherLineId: prior.entry.id, otherWritingId: prior.entry.writingId, detail: `${prior.entry.place.label} / ${e.place.label}` });
      } else if (!prior) seen.set(slot, line);
    }
    // Map events do not share an exact ledger position. A revival in the event's
    // chapter can explain a presence; a death there alone cannot rule it out.
    for (const presence of presences) {
      if (presence.characterId !== characterId) continue;
      let death: PlacedLine | null = null;
      for (const line of lifeChanges) {
        if (line.chapter > presence.chapter) break;
        if (line.entry.kind === 'revives') death = null;
        else if (line.chapter < presence.chapter) death = line;
      }
      if (!death) continue;
      findings.push({ id: `after-death:${characterId}:${presence.lineId}`, kind: 'after-death', characterId, writingId: presence.writingId, chapter: presence.chapter, lineId: presence.lineId, otherLineId: death.entry.id, otherWritingId: death.entry.writingId, detail: presence.label });
    }
  }
  return findings.sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id));
}
