// ============================================================================
// Story world ⇄ codex: how a codex entry, a relationship and a timeline event
// read as hoard.world/1 records, and back
// ============================================================================
//
// One place decides what a record "is" in the exchange, because three things
// must agree on it: the export (what is sent), the import (what is written) and
// the local-edit check (a hash of that same content, taken right after an
// import and compared on the next one). If the three read the record
// differently, an untouched record would look edited, or an edited one would be
// overwritten.

import type { CodexEntry, CodexEntryType, TimelineEvent } from '@/types';
import type { Relationship, RelationshipKind } from '@/engines/relationships/types';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import {
  CLIP, clip, digest, normalizeStatus, strings, textFields, thingKind,
  type ThingKind, type WorldEntity, type WorldStatus,
} from './worldSchema';

export type EntityKind = 'character' | 'location' | 'faction' | ThingKind;
export type WorldSection = 'characters' | 'places' | 'factions' | 'things';

/** The part of an entity that is exchanged (and hashed): never a picture, never the manuscript. */
export interface EntityContent {
  kind: EntityKind;
  name: string;
  aliases: string[];
  summary: string;
  description: string;
  status: WorldStatus;
  tags: string[];
  fields: Record<string, string>;
}

/** Field keys that are lifted into their own slot of the exchange, so they are not repeated in `fields`. */
const LIFTED = new Set(['name', 'aliases', 'alias', 'status', 'summary']);
const SUMMARY_FROM_BODY = 280;

export function sectionOf(type: CodexEntryType, fields: Record<string, string>): { section: WorldSection; kind: EntityKind } {
  switch (type) {
    case 'character': return { section: 'characters', kind: 'character' };
    case 'location': return { section: 'places', kind: 'location' };
    case 'faction': return { section: 'factions', kind: 'faction' };
    case 'item': return { section: 'things', kind: 'item' };
    case 'custom': return { section: 'things', kind: fields.kind?.trim().toLowerCase() === 'creature' ? 'creature' : 'lore' };
    default: return { section: 'things', kind: 'lore' }; // concept, magic
  }
}

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(/[,;\n]/).map(part => part.trim()).filter(Boolean);
}

function firstParagraph(markdown: string): string {
  const paragraph = markdown.split(/\n\s*\n/).map(part => part.trim()).find(part => part && !/^#{1,6}\s/.test(part)) ?? '';
  const flat = paragraph.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_FROM_BODY) return flat;
  const cut = flat.slice(0, SUMMARY_FROM_BODY);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 80))}…`;
}

/** What the exchange sees of a codex entry. Pure given the entry. */
export function entryContent(entry: Pick<CodexEntry, 'type' | 'title' | 'fields' | 'content' | 'tags'>): EntityContent {
  const fields = entry.fields ?? {};
  const { kind } = sectionOf(entry.type, fields);
  const description = clip(entry.content ? htmlToMarkdown(entry.content) : '', 'description');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.trim() || LIFTED.has(key)) continue;
    if (key === 'kind' && kind === 'creature') continue; // carried by the section instead
    out[key] = value;
  }
  return {
    kind,
    name: clip(entry.title, 'name'),
    aliases: strings(splitList(fields.aliases ?? fields.alias), 'alias'),
    summary: clip(fields.summary?.trim() || firstParagraph(description), 'summary'),
    description,
    status: normalizeStatus(fields.status),
    tags: strings(entry.tags, 'tag'),
    fields: textFields(out),
  };
}

export const entryHash = (entry: Parameters<typeof entryContent>[0]): string => digest(entryContent(entry));

/** The exchanged record for an entry (without `ref`, `revision` and `same_as`, which the caller adds). */
export function entityBody(content: EntityContent): Omit<WorldEntity, 'ref'> {
  const body: Omit<WorldEntity, 'ref'> = {
    name: content.name, aliases: content.aliases, summary: content.summary, description: content.description,
    status: content.status, tags: content.tags, fields: content.fields,
  };
  if (content.kind !== 'character' && content.kind !== 'location' && content.kind !== 'faction') body.kind = content.kind;
  return body;
}

/** What an incoming entity becomes in the codex. */
export interface IncomingEntry {
  type: CodexEntryType;
  title: string;
  fields: Record<string, string>;
  /** Markdown; the caller converts it. */
  description: string;
  tags: string[];
}

export function incomingEntity(section: WorldSection, item: WorldEntity): IncomingEntry | null {
  const title = clip(item.name, 'name');
  if (!title) return null;
  let type: CodexEntryType;
  const extra: Record<string, string> = {};
  if (section === 'characters') type = 'character';
  else if (section === 'places') type = 'location';
  else if (section === 'factions') type = 'faction';
  else {
    const kind = thingKind(item.kind);
    type = kind === 'item' ? 'item' : kind === 'creature' ? 'custom' : 'concept';
    if (kind === 'creature') extra.kind = 'creature';
  }
  const fields: Record<string, string> = { ...textFields(item.fields), ...extra };
  const summary = clip(item.summary, 'summary');
  if (summary) fields.summary = summary;
  const aliases = strings(item.aliases, 'alias');
  if (aliases.length) fields.aliases = aliases.join(', ');
  const status = normalizeStatus(item.status);
  if (status !== 'unknown') fields.status = status;
  return { type, title, fields, description: clip(item.description, 'description'), tags: strings(item.tags, 'tag') };
}

export function htmlFromDescription(markdown: string): string {
  return markdown.trim() ? sanitizeRichHtml(markdownToTiptapHtml(markdown)) : '';
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

const KINDS: readonly RelationshipKind[] = [
  'ally', 'friend', 'family', 'romantic', 'rival', 'enemy', 'mentor', 'subordinate', 'colleague', 'acquaintance', 'other',
];
/** Only these run one way: A is the mentor of B, not the other way round. */
const ONE_WAY: ReadonlySet<RelationshipKind> = new Set(['mentor', 'subordinate', 'other']);

export interface RelationContent {
  type: string;
  note: string;
}

/** What the exchange sees of a relationship: a free-text type and a note. */
export function relationContent(rel: Pick<Relationship, 'kind' | 'label' | 'notes'>): RelationContent {
  const label = (rel.label ?? '').trim();
  const type = rel.kind !== 'other' ? rel.kind : label || 'other';
  const note = [rel.kind !== 'other' ? label : '', (rel.notes ?? '').trim()].filter(Boolean).join('\n');
  return { type: clip(type, 'type'), note: clip(note, 'note') };
}

export const relationHash = (rel: Pick<Relationship, 'kind' | 'label' | 'notes'>): string => digest(relationContent(rel));

export function incomingRelation(typeText: unknown, noteText: unknown, since: unknown): Pick<Relationship, 'kind' | 'label' | 'notes' | 'directional'> {
  const type = clip(typeText, 'type');
  const match = KINDS.find(kind => kind === type.toLowerCase());
  const kind: RelationshipKind = match ?? 'other';
  const when = clip(since, 'since');
  const notes = [clip(noteText, 'note'), when ? `(${when})` : ''].filter(Boolean).join('\n');
  return { kind, label: match ? '' : type, notes, directional: ONE_WAY.has(kind) };
}

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

export interface EventContent {
  date: string;
  summary: string;
  entities: string[];
}

/** What the exchange sees of an event: its date, one line of what happened, and who it touches. */
export function eventContent(event: Pick<TimelineEvent, 'title' | 'description' | 'date' | 'linkedEntryId'>): EventContent {
  const title = (event.title ?? '').trim();
  const body = (event.description ?? '').trim();
  const text = title && body && !body.toLowerCase().startsWith(title.toLowerCase()) ? `${title} — ${body}` : body || title;
  return { date: clip(event.date, 'date'), summary: clip(text, 'summary'), entities: event.linkedEntryId ? [event.linkedEntryId] : [] };
}

export const eventHash = (event: Parameters<typeof eventContent>[0]): string => digest(eventContent(event));

const TITLE_LIMIT = 100;

/** A short title and the full text for an incoming event summary. */
export function incomingEvent(summary: unknown): { title: string; description: string } {
  const text = clip(summary, 'summary');
  if (text.length <= TITLE_LIMIT) return { title: text, description: '' };
  const cut = text.slice(0, TITLE_LIMIT);
  return { title: `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`, description: text };
}

export { CLIP };
