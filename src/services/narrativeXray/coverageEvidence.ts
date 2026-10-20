/**
 * Character×chapter coverage and timeline narrative evidence.
 *
 * Honesty rules:
 * - Mention = name/alias found in that chapter's prose. It never upgrades to
 *   presence or POV by itself.
 * - Entity links and outline/planning links are `planned*` flags only; they do
 *   not prove the character is present or narrating.
 * - POV is inferred only from explicit prose markers (`pov:Name`), else manual.
 * - Presence is never auto-inferred from planning data; set it manually when
 *   the chapter actually stages the character. Manual cells store a content
 *   hash and fall back to inference when the chapter prose changes.
 * - Timeline: a linked character appearing somewhere is not "narrated". An
 *   event is narrated only when enough distinctive title words appear as whole
 *   words in one non-empty chapter, outside epistemic/avoidance frames, with
 *   an anchored excerpt. A single title token never certifies narration.
 * - Empty linked writings never contribute witnesses.
 * - A content-hash / manuscript-hash mismatch always degrades effective status
 *   to unverified (stale stays visible), even if a manual override was stored.
 */

import { db } from '@/db';
import { eventEntryIds } from '@/engines/timeline/eventDetails';
import { getSetting, updateSetting } from '@/db/operations';
import {
  buildAppearanceCandidates,
  findAppearances,
  type ProofreaderCodexRow,
} from '@/services/proofreader';
import { indexNameCandidates } from '@/engines/_shared/nameAppearances';
import { stripHtml } from '@/utils/text';
import type { CodexEntry, TimelineEvent, Writing } from '@/types';
import type { EntityLink } from '@/types/projectTools';
import type { OutlineBeat } from '@/engines/outline/types';

export type CoverageRole = 'absent' | 'mention' | 'presence' | 'pov';
export type EvidenceStatus = 'narrated' | 'not_narrated' | 'contradiction' | 'unverified';

const COVERAGE_KEY = (projectId: string) => `narrativeCoverage:${projectId}`;
const EVIDENCE_KEY = (projectId: string) => `timelineEvidence:${projectId}`;

const ROLE_RANK: Record<CoverageRole, number> = {
  absent: 0,
  mention: 1,
  presence: 2,
  pov: 3,
};

const EPISTEMIC =
  /\b(think|thought|thinking|remember|remembered|recalls?|wonder(?:ed|ing)?|avoid(?:s|ed|ing)?|imagines?|dream(?:s|ed|t|ing)?|pensar|pens[oó]|pensando|recordar|recuerd[ao]|evitar|evit[oó]|imaginar|sueña|soñ[oó])\b/i;

export interface CoverageCell {
  characterId: string;
  characterName: string;
  writingId: string;
  writingTitle: string;
  chapter?: number;
  role: CoverageRole;
  inferred: CoverageRole;
  manual?: CoverageRole;
  /** True when a stored manual role no longer matches the chapter hash. */
  overrideStale: boolean;
  /** Planning/entity-link hint only — not evidence of prose presence. */
  plannedPresence: boolean;
  /** Planning/entity-link hint only — not evidence of POV. */
  plannedPov: boolean;
  aliases: string[];
}

export interface EmptyLinkedBeat {
  beatId: string;
  title: string;
  linkedWritingId: string;
  writingTitle: string;
  wordCount: number;
}

export interface CoverageMatrix {
  projectId: string;
  characters: Array<{ id: string; name: string; aliases: string[] }>;
  writings: Array<{ id: string; title: string; chapter?: number; status: string }>;
  cells: CoverageCell[];
  emptyLinkedBeats: EmptyLinkedBeat[];
}

export interface EventWitness {
  writingId: string;
  writingTitle: string;
  chapter?: number;
  excerpt: string;
}

export interface TimelineEvidenceRow {
  eventId: string;
  title: string;
  linkedEntryId?: string;
  linkedEntryIds?: string[];
  status: EvidenceStatus;
  inferred: EvidenceStatus;
  manual?: EvidenceStatus;
  writingId?: string;
  contentHash?: string;
  manuscriptHash?: string;
  stale: boolean;
  note?: string;
  /** Anchored chapter witness when inferred narrated (or last known). */
  witness?: EventWitness;
}

export interface TimelineEvidenceReport {
  projectId: string;
  rows: TimelineEvidenceRow[];
}

interface CoverageCellOverride {
  role: CoverageRole;
  contentHash: string;
}

interface CoverageOverrides {
  cells: Record<string, CoverageCellOverride>;
}

interface EvidenceOverrides {
  rows: Record<
    string,
    {
      status: EvidenceStatus;
      writingId?: string;
      contentHash?: string;
      manuscriptHash?: string;
      note?: string;
    }
  >;
}

export function cellKey(characterId: string, writingId: string): string {
  return `${characterId}::${writingId}`;
}

export function strongerRole(a: CoverageRole, b: CoverageRole): CoverageRole {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export function hashText(text: string): string {
  // FNV-1a 32-bit — stable enough to detect edits without crypto in the renderer.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function manuscriptHashFromWritingHashes(writingHashes: Map<string, string>): string {
  const parts = [...writingHashes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, hash]) => `${id}:${hash}`);
  return hashText(parts.join('|'));
}

export function aliasesOf(entry: Pick<CodexEntry, 'title' | 'fields'>): string[] {
  const fields = entry.fields ?? {};
  const raw = [fields.alias, fields.aliases, fields.aka, fields.también, fields.tambien]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ');
  const parts = raw
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function inferCoverageRole(input: {
  mentioned: boolean;
  /** Explicit prose marker only — planning links must not set this. */
  povTagged: boolean;
}): CoverageRole {
  if (input.povTagged) return 'pov';
  if (input.mentioned) return 'mention';
  return 'absent';
}

export function effectiveCoverageRole(
  inferred: CoverageRole,
  manual: CoverageRole | undefined,
  overrideStale: boolean,
): CoverageRole {
  if (overrideStale) return inferred;
  return manual ?? inferred;
}

/**
 * Distinctive title tokens that can witness narration (drop tiny/stop words).
 */
export function eventTitleWitnessTokens(title: string): string[] {
  const stop = new Set([
    'a', 'al', 'the', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'o', 'en', 'un', 'una',
    'and', 'or', 'of', 'to', 'in', 'on', 'at', 'por', 'para', 'con', 'sin',
  ]);
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function wordBoundMatch(hay: string, token: string): number {
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(token)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  const match = re.exec(hay);
  return match ? match.index + (match[0].length - token.length) : -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inEpistemicFrame(hay: string, at: number): boolean {
  const start = Math.max(0, at - 48);
  const window = hay.slice(start, at);
  return EPISTEMIC.test(window);
}

/**
 * Locate an anchored chapter witness for an event title.
 * A lone distinctive token never certifies narration; need ≥2 token hits or
 * the full multi-word title phrase as whole words, outside epistemic frames.
 */
export function findEventWitness(
  writings: Array<{ id: string; title: string; chapter?: number; content: string }>,
  eventTitle: string,
): EventWitness | null {
  const tokens = eventTitleWitnessTokens(eventTitle);
  if (tokens.length < 2) return null;
  const need = Math.max(2, Math.ceil(tokens.length / 2));
  const phrase = fold(eventTitle.trim());

  for (const writing of writings) {
    const plain = stripHtml(writing.content).trim();
    if (!plain) continue;
    const hay = fold(plain);

    const phraseAt = phrase.length >= 5 ? hay.indexOf(phrase) : -1;
    if (phraseAt >= 0 && !inEpistemicFrame(hay, phraseAt)) {
      return {
        writingId: writing.id,
        writingTitle: writing.title,
        chapter: writing.chapter,
        excerpt: excerptAround(plain, phraseAt, phrase.length),
      };
    }

    const hits: number[] = [];
    for (const token of tokens) {
      const at = wordBoundMatch(hay, token);
      if (at < 0) continue;
      if (inEpistemicFrame(hay, at)) continue;
      hits.push(at);
    }
    if (hits.length < need) continue;
    const first = Math.min(...hits);
    return {
      writingId: writing.id,
      writingTitle: writing.title,
      chapter: writing.chapter,
      excerpt: excerptAround(plain, first, tokens[0]?.length ?? 8),
    };
  }
  return null;
}

function excerptAround(plain: string, at: number, span: number): string {
  const start = Math.max(0, at - 40);
  const end = Math.min(plain.length, at + Math.max(span, 8) + 40);
  const slice = plain.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${slice}${end < plain.length ? '…' : ''}`;
}

/** @deprecated Prefer findEventWitness — kept for unit callers. */
export function proseWitnessesEvent(prose: string, title: string): boolean {
  return Boolean(
    findEventWitness([{ id: 'w', title: 'w', content: `<p>${prose}</p>` }], title),
  );
}

export function inferTimelineEvidence(input: {
  eventTitle: string;
  eventWitnessedInProse: boolean;
  linkedEntryId?: string;
  characterMentionedInAnyWriting: boolean;
}): EvidenceStatus {
  if (input.eventWitnessedInProse) return 'narrated';
  // Linked character on the page without the event's own words ≠ narrated.
  if (input.linkedEntryId && input.characterMentionedInAnyWriting) return 'not_narrated';
  return 'unverified';
}

export function effectiveEvidenceStatus(
  inferred: EvidenceStatus,
  manual: EvidenceStatus | undefined,
  stale: boolean,
): EvidenceStatus {
  // Content change always wins over a stored judgment — otherwise edits hide
  // outdated "contradiction"/"narrated" labels.
  if (stale) return 'unverified';
  return manual ?? inferred;
}

export function buildCoverageMatrixFromParts(input: {
  projectId: string;
  characters: Array<{ id: string; name: string; aliases: string[] }>;
  writings: Array<{ id: string; title: string; chapter?: number; status: string; content: string }>;
  mentionByWriting: Map<string, Set<string>>;
  presenceLinks: Array<{ characterId: string; writingId: string }>;
  povLinks: Array<{ characterId: string; writingId: string }>;
  overrides: CoverageOverrides;
  beats: Array<{ id: string; title: string; linkedWritingId?: string }>;
}): CoverageMatrix {
  const presence = new Set(input.presenceLinks.map((l) => cellKey(l.characterId, l.writingId)));
  const pov = new Set(input.povLinks.map((l) => cellKey(l.characterId, l.writingId)));
  const writingHash = new Map(
    input.writings.map((w) => [w.id, hashText(stripHtml(w.content))]),
  );
  const cells: CoverageCell[] = [];

  for (const character of input.characters) {
    for (const writing of input.writings) {
      const key = cellKey(character.id, writing.id);
      const mentioned = input.mentionByWriting.get(writing.id)?.has(character.id) ?? false;
      const povTagged = writingHasPovTag(writing.content, character.name, character.aliases);
      const inferred = inferCoverageRole({ mentioned, povTagged });
      const stored = input.overrides.cells[key];
      const overrideStale = Boolean(
        stored && stored.contentHash !== writingHash.get(writing.id),
      );
      cells.push({
        characterId: character.id,
        characterName: character.name,
        writingId: writing.id,
        writingTitle: writing.title,
        chapter: writing.chapter,
        inferred,
        manual: stored?.role,
        overrideStale,
        plannedPresence: presence.has(key),
        plannedPov: pov.has(key),
        role: effectiveCoverageRole(inferred, stored?.role, overrideStale),
        aliases: character.aliases,
      });
    }
  }

  const writingById = new Map(input.writings.map((w) => [w.id, w]));
  const emptyLinkedBeats: EmptyLinkedBeat[] = [];
  for (const beat of input.beats) {
    if (!beat.linkedWritingId) continue;
    const writing = writingById.get(beat.linkedWritingId);
    if (!writing) continue;
    const plain = stripHtml(writing.content).trim();
    if (plain.length > 0) continue;
    emptyLinkedBeats.push({
      beatId: beat.id,
      title: beat.title,
      linkedWritingId: writing.id,
      writingTitle: writing.title,
      wordCount: 0,
    });
  }

  return {
    projectId: input.projectId,
    characters: input.characters,
    writings: input.writings.map(({ id, title, chapter, status }) => ({ id, title, chapter, status })),
    cells,
    emptyLinkedBeats,
  };
}

export function writingHasPovTag(content: string, name: string, aliases: string[]): boolean {
  const hay = stripHtml(content).toLowerCase();
  const names = [name, ...aliases].map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of names) {
    if (hay.includes(`pov:${n}`) || hay.includes(`#pov-${n.replace(/\s+/g, '-')}`)) return true;
  }
  return false;
}

export function buildTimelineEvidenceFromParts(input: {
  projectId: string;
  events: Array<{ id: string; title: string; linkedEntryId?: string; linkedEntryIds?: string[] }>;
  mentionedEntryIds: Set<string>;
  writings: Array<{ id: string; title: string; chapter?: number; content: string }>;
  writingHashes: Map<string, string>;
  overrides: EvidenceOverrides;
}): TimelineEvidenceReport {
  const manuscriptHash = manuscriptHashFromWritingHashes(input.writingHashes);
  const rows: TimelineEvidenceRow[] = [];
  for (const event of input.events) {
    const links = eventEntryIds(event);
    const witness = findEventWitness(input.writings, event.title);
    const inferred = inferTimelineEvidence({
      eventTitle: event.title,
      eventWitnessedInProse: Boolean(witness),
      linkedEntryId: links[0],
      characterMentionedInAnyWriting: Boolean(
        links.some(id => input.mentionedEntryIds.has(id)),
      ),
    });
    const override = input.overrides.rows[event.id];
    let stale = false;
    if (override) {
      if (override.writingId && override.contentHash) {
        const current = input.writingHashes.get(override.writingId);
        if (current !== undefined && current !== override.contentHash) stale = true;
      }
      if (override.manuscriptHash && override.manuscriptHash !== manuscriptHash) stale = true;
      // Legacy overrides without any hash never stay trusted after load.
      if (!override.contentHash && !override.manuscriptHash) stale = true;
    }
    rows.push({
      eventId: event.id,
      title: event.title,
      linkedEntryId: links[0],
      linkedEntryIds: links,
      inferred,
      manual: override?.status,
      writingId: override?.writingId ?? witness?.writingId,
      contentHash: override?.contentHash,
      manuscriptHash: override?.manuscriptHash,
      stale,
      note: override?.note,
      witness: witness ?? undefined,
      status: effectiveEvidenceStatus(inferred, override?.status, stale),
    });
  }
  return { projectId: input.projectId, rows };
}

function parseCoverageOverrides(raw: string | undefined): CoverageOverrides {
  if (!raw) return { cells: {} };
  try {
    const parsed = JSON.parse(raw) as {
      cells?: Record<string, CoverageRole | CoverageCellOverride>;
    };
    const cells: Record<string, CoverageCellOverride> = {};
    if (parsed.cells && typeof parsed.cells === 'object') {
      for (const [key, value] of Object.entries(parsed.cells)) {
        if (typeof value === 'string') {
          // Legacy role-only overrides cannot prove freshness — mark empty hash.
          cells[key] = { role: value, contentHash: '' };
        } else if (
          value &&
          typeof value === 'object' &&
          typeof value.role === 'string' &&
          typeof value.contentHash === 'string'
        ) {
          cells[key] = { role: value.role, contentHash: value.contentHash };
        }
      }
    }
    return { cells };
  } catch {
    return { cells: {} };
  }
}

function parseEvidenceOverrides(raw: string | undefined): EvidenceOverrides {
  if (!raw) return { rows: {} };
  try {
    const parsed = JSON.parse(raw) as EvidenceOverrides;
    return { rows: parsed.rows && typeof parsed.rows === 'object' ? parsed.rows : {} };
  } catch {
    return { rows: {} };
  }
}

async function scanMentions(
  writings: Writing[],
  characters: CodexEntry[],
): Promise<Map<string, Set<string>>> {
  const rows: ProofreaderCodexRow[] = characters.map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
  }));
  const candidates = buildAppearanceCandidates(rows);
  const byFirstToken = indexNameCandidates(candidates);
  const byWriting = new Map<string, Set<string>>();
  for (const writing of writings) {
    const ids = findAppearances(stripHtml(writing.content), byFirstToken);
    byWriting.set(writing.id, ids);
  }
  return byWriting;
}

function linksForCoverage(links: EntityLink[]): {
  presence: Array<{ characterId: string; writingId: string }>;
  pov: Array<{ characterId: string; writingId: string }>;
} {
  const presence: Array<{ characterId: string; writingId: string }> = [];
  const pov: Array<{ characterId: string; writingId: string }> = [];
  for (const link of links) {
    const relation = link.relation.trim().toLowerCase();
    let characterId: string | undefined;
    let writingId: string | undefined;
    const isCodex = (type: string) => type === 'codex' || type === 'codex-entry';
    if (link.sourceEntityType === 'writing' && isCodex(link.targetEntityType)) {
      writingId = link.sourceEntityId;
      characterId = link.targetEntityId;
    } else if (isCodex(link.sourceEntityType) && link.targetEntityType === 'writing') {
      characterId = link.sourceEntityId;
      writingId = link.targetEntityId;
    }
    if (!characterId || !writingId) continue;
    if (relation === 'pov' || relation === 'viewpoint' || relation === 'point_of_view') {
      pov.push({ characterId, writingId });
    } else if (
      relation === 'presence' ||
      relation === 'appears' ||
      relation === 'present' ||
      relation === 'on_page'
    ) {
      presence.push({ characterId, writingId });
    }
  }
  return { presence, pov };
}

function pruneCoverageOverrides(
  overrides: CoverageOverrides,
  characterIds: Set<string>,
  writingIds: Set<string>,
): CoverageOverrides {
  const cells: Record<string, CoverageCellOverride> = {};
  for (const [key, value] of Object.entries(overrides.cells)) {
    const [characterId, writingId] = key.split('::');
    if (!characterIds.has(characterId) || !writingIds.has(writingId)) continue;
    cells[key] = value;
  }
  return { cells };
}

function pruneEvidenceOverrides(
  overrides: EvidenceOverrides,
  eventIds: Set<string>,
): EvidenceOverrides {
  const rows: EvidenceOverrides['rows'] = {};
  for (const [eventId, value] of Object.entries(overrides.rows)) {
    if (!eventIds.has(eventId)) continue;
    rows[eventId] = value;
  }
  return { rows };
}

export async function loadCoverageMatrix(projectId: string): Promise<CoverageMatrix> {
  const [writings, codex, links, beats, overrideRaw] = await Promise.all([
    db.writings.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.entityLinks.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray() as Promise<OutlineBeat[]>,
    getSetting(COVERAGE_KEY(projectId)),
  ]);
  const characters = codex
    .filter((row) => row.type === 'character')
    .map((row) => ({ id: row.id, name: row.title, aliases: aliasesOf(row) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const orderedWritings = writings
    .slice()
    .sort(
      (a, b) =>
        (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
  const mentionByWriting = await scanMentions(
    orderedWritings,
    codex.filter((c) => c.type === 'character'),
  );
  const { presence, pov } = linksForCoverage(links);
  const overrides = pruneCoverageOverrides(
    parseCoverageOverrides(overrideRaw),
    new Set(characters.map((c) => c.id)),
    new Set(orderedWritings.map((w) => w.id)),
  );
  return buildCoverageMatrixFromParts({
    projectId,
    characters,
    writings: orderedWritings.map((w) => ({
      id: w.id,
      title: w.title,
      chapter: w.chapter,
      status: w.status,
      content: w.content,
    })),
    mentionByWriting,
    presenceLinks: presence,
    povLinks: pov,
    overrides,
    beats: beats.map((b) => ({ id: b.id, title: b.title, linkedWritingId: b.linkedWritingId })),
  });
}

export async function setCoverageCell(input: {
  projectId: string;
  characterId: string;
  writingId: string;
  role: CoverageRole | null;
}): Promise<CoverageCell> {
  const [character, writing] = await Promise.all([
    db.codexEntries.get(input.characterId),
    db.writings.get(input.writingId),
  ]);
  if (!character || character.projectId !== input.projectId || character.type !== 'character') {
    throw new Error('characterId is not a character in this project.');
  }
  if (!writing || writing.projectId !== input.projectId) {
    throw new Error('writingId is not in this project.');
  }
  const key = cellKey(input.characterId, input.writingId);
  const contentHash = hashText(stripHtml(writing.content));
  await updateSetting(COVERAGE_KEY(input.projectId), (current) => {
    const overrides = parseCoverageOverrides(current);
    if (input.role === null) delete overrides.cells[key];
    else overrides.cells[key] = { role: input.role, contentHash };
    return JSON.stringify(overrides);
  });
  const matrix = await loadCoverageMatrix(input.projectId);
  const cell = matrix.cells.find(
    (row) => row.characterId === input.characterId && row.writingId === input.writingId,
  );
  if (!cell) throw new Error('Unknown character or writing for this project.');
  return cell;
}

export async function loadTimelineEvidence(projectId: string): Promise<TimelineEvidenceReport> {
  const [events, writings, codex, overrideRaw] = await Promise.all([
    db.timelineEvents.where('projectId').equals(projectId).toArray() as Promise<TimelineEvent[]>,
    db.writings.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).filter((c) => c.type === 'character').toArray(),
    getSetting(EVIDENCE_KEY(projectId)),
  ]);
  const mentionByWriting = await scanMentions(writings, codex);
  const mentionedEntryIds = new Set<string>();
  for (const ids of mentionByWriting.values()) {
    for (const id of ids) mentionedEntryIds.add(id);
  }
  const writingHashes = new Map(writings.map((w) => [w.id, hashText(stripHtml(w.content))]));
  const overrides = pruneEvidenceOverrides(
    parseEvidenceOverrides(overrideRaw),
    new Set(events.map((e) => e.id)),
  );
  return buildTimelineEvidenceFromParts({
    projectId,
    events: events.map((e) => ({ id: e.id, title: e.title, linkedEntryId: e.linkedEntryId, linkedEntryIds: e.linkedEntryIds })),
    mentionedEntryIds,
    writings: writings.map((w) => ({
      id: w.id,
      title: w.title,
      chapter: w.chapter,
      content: w.content,
    })),
    writingHashes,
    overrides,
  });
}

export async function setTimelineEvidence(input: {
  projectId: string;
  eventId: string;
  status: EvidenceStatus | null;
  writingId?: string;
  note?: string;
}): Promise<TimelineEvidenceRow> {
  const event = await db.timelineEvents.get(input.eventId);
  if (!event || event.projectId !== input.projectId) {
    throw new Error('eventId is not in this project.');
  }
  const writings = await db.writings.where('projectId').equals(input.projectId).toArray();
  const writingHashes = new Map(writings.map((w) => [w.id, hashText(stripHtml(w.content))]));
  const manuscriptHash = manuscriptHashFromWritingHashes(writingHashes);
  let contentHash: string | undefined;
  if (input.writingId) {
    const writing = writings.find((w) => w.id === input.writingId);
    if (!writing) throw new Error('writingId is not in this project.');
    contentHash = writingHashes.get(writing.id);
  }
  await updateSetting(EVIDENCE_KEY(input.projectId), (current) => {
    const overrides = parseEvidenceOverrides(current);
    if (input.status === null) {
      delete overrides.rows[input.eventId];
    } else {
      overrides.rows[input.eventId] = {
        status: input.status,
        writingId: input.writingId,
        contentHash,
        manuscriptHash,
        note: input.note,
      };
    }
    return JSON.stringify(overrides);
  });
  const report = await loadTimelineEvidence(input.projectId);
  const row = report.rows.find((r) => r.eventId === input.eventId);
  if (!row) throw new Error('Unknown timeline event for this project.');
  return row;
}
