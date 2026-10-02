// ============================================================================
// hoard.world/1 — the neutral story-world document (pure, no DOM, no Dexie)
// ============================================================================
//
// The cast, places, factions, relations and timeline of a story, as plain JSON,
// so Writers Hoard and Scheherazade's Hoard can hand a world to each other. The
// format is Scheherazade's: docs/WORLD_SCHEMA.md in that repository is the
// reference, and this file is the TypeScript side of it — the same limits, the
// same clipping, and above all the same `revision`: `sha256:` plus the SHA-256
// of the record's content as compact, key-sorted JSON, so a record that
// travels A → B → A hashes the same on both sides.
//
// It carries no secrets, no pictures and nothing from the manuscript.

import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';

export const WORLD_SCHEMA = 'hoard.world/1';
/** This app's namespace. Refs here are `hoard://writer/<kind>/<id>`. */
export const WRITER_NS = 'hoard://writer/';
export const MAX_WORLD_ITEMS = 5000;

export const WORLD_STATUSES = ['alive', 'dead', 'missing', 'destroyed', 'active', 'unknown'] as const;
export type WorldStatus = typeof WORLD_STATUSES[number];

export const THING_KINDS = ['item', 'lore', 'creature'] as const;
export type ThingKind = typeof THING_KINDS[number];

/** What other apps call things that are filed here as lore or items. Mirrors Scheherazade's own table. */
const THING_ALIASES: Readonly<Record<string, ThingKind>> = { concept: 'lore', magic: 'lore', custom: 'lore', object: 'item', monster: 'creature' };

/** The clipping every receiver applies; sending less than this loses nothing. */
export const CLIP = {
  name: 200, summary: 2000, description: 20000, type: 120, note: 2000, since: 200, date: 200,
  alias: 200, tag: 80, fieldKey: 120, fieldValue: 4000,
} as const;
type ClipKey = keyof typeof CLIP;

export interface WorldEntity {
  ref: string;
  revision?: string;
  same_as?: string[];
  /** Only on `things`. */
  kind?: string;
  name: string;
  aliases?: string[];
  summary?: string;
  description?: string;
  status?: string;
  tags?: string[];
  fields?: Record<string, string>;
  parent_ref?: string;
}

export interface WorldRelation {
  ref: string;
  revision?: string;
  same_as?: string[];
  from: string;
  to: string;
  type: string;
  note?: string;
  since?: string;
}

export interface WorldEvent {
  ref: string;
  revision?: string;
  same_as?: string[];
  date?: string;
  summary: string;
  entities?: string[];
}

export interface WorldDoc {
  schema: typeof WORLD_SCHEMA;
  source?: { app?: string; ref?: string; revision?: string; exported_at?: number };
  world?: { name?: string; genre?: string; tone?: string; premise?: string; language?: string };
  characters?: WorldEntity[];
  places?: WorldEntity[];
  factions?: WorldEntity[];
  things?: WorldEntity[];
  relations?: WorldRelation[];
  events?: WorldEvent[];
}

export const WORLD_SECTIONS = ['characters', 'places', 'factions', 'things', 'relations', 'events'] as const;

export class WorldDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldDocumentError';
  }
}

// ---------------------------------------------------------------------------
// Refs and revisions
// ---------------------------------------------------------------------------

export const refCodex = (id: string): string => `${WRITER_NS}codex/${id}`;
export const refRelation = (id: string): string => `${WRITER_NS}relation/${id}`;
export const refEvent = (id: string): string => `${WRITER_NS}event/${id}`;
export const refProject = (id: string): string => `${WRITER_NS}project/${id}`;
export const refStoryboard = (id: string): string => `${WRITER_NS}storyboard/${id}`;

/** The local id a `hoard://writer/<kind>/<id>` ref names, or null when it is not one of ours. */
export function ownId(ref: string, kind: 'codex' | 'relation' | 'event'): string | null {
  const prefix = `${WRITER_NS}${kind}/`;
  return ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : null;
}

/** Same test Scheherazade applies: a hoard:// ref of sane length with a kind and an id. */
export function refOk(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('hoard://') && value.length <= 300 && (value.match(/\//g) ?? []).length >= 3;
}

/** A stable `sha256:` revision of any JSON-able value. */
export function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

// ---------------------------------------------------------------------------
// Clipping and flattening (what a receiver does to whatever it is sent)
// ---------------------------------------------------------------------------

export function clip(value: unknown, key: ClipKey): string {
  return String(value ?? '').trim().slice(0, CLIP[key]);
}

/** A map of text to text: scalars as text, nested values as compact JSON. */
export function textFields(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = clip(key, 'fieldKey');
    if (!name || value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
    out[name] = text.slice(0, CLIP.fieldValue);
  }
  return out;
}

export function strings(raw: unknown, key: 'alias' | 'tag'): string[] {
  const out: string[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const text = clip(item, key);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

export function normalizeStatus(value: unknown): WorldStatus {
  const text = String(value ?? '').trim().toLowerCase();
  return (WORLD_STATUSES as readonly string[]).includes(text) ? (text as WorldStatus) : 'unknown';
}

export function thingKind(value: unknown): ThingKind {
  const text = String(value ?? '').trim().toLowerCase();
  const mapped = THING_ALIASES[text] ?? text;
  return (THING_KINDS as readonly string[]).includes(mapped) ? (mapped as ThingKind) : 'lore';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The document, or a WorldDocumentError saying what is wrong with it. */
export function validateWorldDoc(data: unknown): WorldDoc {
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { schema?: unknown }).schema !== WORLD_SCHEMA) {
    throw new WorldDocumentError(`Not a ${WORLD_SCHEMA} document: expected an object with schema "${WORLD_SCHEMA}".`);
  }
  const doc = data as Record<string, unknown>;
  let total = 0;
  for (const section of WORLD_SECTIONS) {
    const value = doc[section] ?? [];
    if (!Array.isArray(value)) throw new WorldDocumentError(`"${section}" must be a list.`);
    total += value.length;
  }
  if (total > MAX_WORLD_ITEMS) throw new WorldDocumentError(`Too many records (${total}); at most ${MAX_WORLD_ITEMS} per document.`);
  if (doc.world !== undefined && (doc.world === null || typeof doc.world !== 'object' || Array.isArray(doc.world))) {
    throw new WorldDocumentError('"world" must be an object.');
  }
  return data as WorldDoc;
}

/** The `same_as` refs of a record that are usable, own or foreign. */
export function sameRefs(item: { same_as?: unknown }): string[] {
  return Array.isArray(item.same_as) ? item.same_as.filter(refOk) : [];
}
