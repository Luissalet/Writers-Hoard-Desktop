import Dexie, { type Table } from 'dexie';
import { db } from '@/db';
import { stripHtml } from '@/utils/text';
import { getAllEngines } from '@/engines/_registry';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { t } from '@/i18n/useTranslation';
import {
  findRequiredMatch,
  foldSearchText,
  hasExcludedText,
  matchesFacets,
  parseSearchQuery,
  resolveEngineFilter,
  scoreSearchMatch,
  searchToday,
  selectRankedMatches,
  type ParsedSearchQuery,
  type QueryTextMatch,
  type ResolvedEngineFilter,
  type SearchFacets,
} from '@/services/searchQuery';

export interface ContentSearchHit {
  id: string;
  engineId: string;
  projectId: string;
  title: string;
  subtitle: string;
  snippet: string;
}

export interface ProjectSearchOutcome {
  /** The best `limit` matches, strongest first. */
  hits: ContentSearchHit[];
  /** engineId → documents that matched, counting the ones past `limit`. */
  totals: Record<string, number>;
  total: number;
}

/** Free text shorter than this is noise; the palette fires on every keystroke. */
const MIN_QUERY_LENGTH = 3;

const EMPTY_OUTCOME: ProjectSearchOutcome = { hits: [], totals: {}, total: 0 };
const NO_TAGS: readonly string[] = [];

/** What a slice hands over: plain values, no folding, no dates resolved. */
interface SourceDocument {
  id: string;
  engineId: string;
  projectId: string;
  title: string;
  subtitle: string;
  body: string;
  tags?: readonly string[];
  /** Single-valued kind: codex type, note kind, beat level, snapshot source… */
  type?: string;
  /** Single-valued state: draft, planted, confirmed, current… */
  status?: string;
  /** Last change, epoch ms. Absent for rows that carry no timestamp at all. */
  updatedAt?: number;
}

/**
 * An indexed document. `haystack` is the folded (accent- and case-free) text
 * that every query is matched against; `body` is kept in its original form
 * purely so the snippet reads the way the writer wrote it.
 *
 * Keeping both costs roughly half again the memory of the body alone — the
 * folded copy is pure ASCII for Latin text, so V8 stores it one byte per
 * character. The alternative, folding on demand, would mean re-walking every
 * chapter in the project on every keystroke.
 */
interface SearchDocument extends SearchFacets {
  id: string;
  projectId: string;
  title: string;
  subtitle: string;
  body: string;
  haystack: string;
  /** Where the body starts inside `haystack` (the title occupies the head). */
  bodyOffset: number;
  /** Last change as epoch ms, or 0 when undated. `day` cannot rank; this can. */
  updatedAt: number;
}

/** One table (or tight group of tables) worth of indexable prose. */
interface IndexSlice {
  /** Dexie tables whose mutation makes this slice stale. */
  tables: readonly string[];
  /** Engines this slice can produce hits for — lets `engine:` skip whole tables. */
  engines: readonly string[];
  build: (projectId?: string) => Promise<SourceDocument[]>;
}

/**
 * projectId → slice key → documents. Project-scoped searches only: an unscoped
 * one reads every project's prose and is answered without ever being retained
 * (see `searchProjectDocuments`), so nothing outside one open project is held.
 */
const caches = new Map<string, Map<string, SearchDocument[]>>();
/**
 * How many projects may sit in the cache at once. Every entry holds a whole
 * project's prose twice over — the body for the snippet, the folded haystack
 * for the matching — so this is the open project plus the one a search just
 * left; the least recently searched project goes first.
 */
const MAX_CACHED_PROJECTS = 2;
const pending = new Map<string, Promise<SearchDocument[]>>();
/** Bumped whenever a slice is invalidated, so an in-flight build is discarded. */
const stamps = new Map<string, number>();

function excerpt(plain: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(plain.length, index + length + 40);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

/**
 * Stream one table and keep only the projected fields. The rows themselves are
 * never retained, so the base64 columns some of these tables carry (`avatar`,
 * `avatarOriginal`, `thumbnail`, `screenshotBase64`, `htmlContent`) never reach
 * the cache — only the text that is actually matched does.
 */
async function projectRows<T, D>(
  table: Table<T>,
  projectId: string | undefined,
  select: (row: T) => D,
): Promise<D[]> {
  const projected: D[] = [];
  const collection = projectId
    ? table.where('projectId').equals(projectId)
    : table.toCollection();
  await collection.each((row) => {
    projected.push(select(row));
  });
  return projected;
}

/**
 * The body index, one slice per source table.
 *
 * Deliberately absent: `boardNodes`, `inspirationImages`, `storyboardPanels`
 * and `videoSegments`. All four store base64 images inline, and loading them
 * here would deserialise every picture in the project on the first keystroke —
 * the exact regression `engines/board/index.ts` records having already been
 * fixed once. Their titles remain searchable through the entity resolvers.
 */
const SLICES: Record<string, IndexSlice> = {
  writings: {
    tables: ['writings'],
    engines: ['writings'],
    build: projectId => projectRows(db.writings, projectId, writing => ({
      id: writing.id,
      engineId: 'writings',
      projectId: writing.projectId,
      title: writing.title,
      subtitle: writing.status,
      body: stripHtml(writing.content ?? ''),
      tags: writing.tags,
      status: writing.status,
      updatedAt: writing.updatedAt,
    })),
  },
  codexEntries: {
    tables: ['codexEntries'],
    engines: ['codex'],
    build: projectId => projectRows(db.codexEntries, projectId, entry => ({
      id: entry.id,
      engineId: 'codex',
      projectId: entry.projectId,
      title: entry.title,
      subtitle: entry.type,
      body: stripHtml(entry.content ?? ''),
      tags: entry.tags,
      type: entry.type,
      updatedAt: entry.updatedAt,
    })),
  },
  diaryEntries: {
    tables: ['diaryEntries'],
    engines: ['diary'],
    build: projectId => projectRows(db.diaryEntries, projectId, entry => ({
      id: entry.id,
      engineId: 'diary',
      projectId: entry.projectId,
      title: entry.title || entry.entryDate,
      subtitle: 'diary',
      body: stripHtml(entry.content ?? ''),
      tags: entry.tags,
      type: entry.mood,
      updatedAt: entry.updatedAt,
    })),
  },
  dialogBlocks: {
    tables: ['dialogBlocks', 'scenes'],
    engines: ['dialog-scene'],
    async build(projectId) {
      const scenes = await projectRows(db.scenes, projectId, scene => ({
        id: scene.id,
        projectId: scene.projectId,
        title: scene.title,
        tags: scene.tags,
        updatedAt: scene.updatedAt,
      }));
      const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
      const blocks = await projectRows(db.dialogBlocks, projectId, block => ({
        sceneId: block.sceneId,
        subtitle: block.characterName || block.type,
        type: block.type,
        body: stripHtml(block.content ?? ''),
      }));
      return blocks.flatMap((block) => {
        const scene = sceneById.get(block.sceneId);
        if (!scene) return [];
        return [{
          id: scene.id,
          engineId: 'dialog-scene',
          projectId: scene.projectId,
          title: scene.title,
          subtitle: block.subtitle,
          body: block.body,
          tags: scene.tags,
          type: block.type,
          updatedAt: scene.updatedAt,
        }];
      });
    },
  },
  snapshots: {
    tables: ['snapshots'],
    engines: ['scrapper'],
    build: projectId => projectRows(db.snapshots, projectId, snapshot => ({
      id: snapshot.id,
      engineId: 'scrapper',
      projectId: snapshot.projectId,
      title: snapshot.title || snapshot.url,
      subtitle: snapshot.source,
      body: stripHtml([
        snapshot.description,
        snapshot.notes,
        snapshot.extractedText,
        snapshot.author,
        snapshot.tags.join(' '),
      ].filter(Boolean).join('\n')),
      tags: snapshot.tags,
      type: snapshot.source,
      status: snapshot.status,
      // A snapshot is preserved, never edited: `createdAt` is its only date.
      updatedAt: snapshot.createdAt,
    })),
  },
  notes: {
    tables: ['notes'],
    engines: ['notes'],
    build: projectId => projectRows(db.notes, projectId, note => ({
      id: note.id,
      engineId: 'notes',
      projectId: note.projectId,
      title: note.text.split('\n')[0]?.slice(0, 80) ?? '',
      subtitle: note.kind,
      body: [note.text, note.source, note.tags.join(' ')].filter(Boolean).join('\n'),
      tags: note.tags,
      type: note.kind,
      updatedAt: note.updatedAt,
    })),
  },
  outlineBeats: {
    tables: ['outlineBeats'],
    engines: ['outline'],
    build: projectId => projectRows(db.outlineBeats, projectId, beat => ({
      id: beat.id,
      engineId: 'outline',
      projectId: beat.projectId,
      title: beat.title,
      subtitle: beat.level,
      body: [beat.title, beat.description].filter(Boolean).join('\n'),
      type: beat.level,
      status: beat.status,
      updatedAt: beat.updatedAt,
    })),
  },
  seeds: {
    tables: ['seeds'],
    engines: ['seeds'],
    build: projectId => projectRows(db.seeds, projectId, seed => ({
      id: seed.id,
      engineId: 'seeds',
      projectId: seed.projectId,
      title: seed.title,
      subtitle: seed.kind,
      body: [seed.title, seed.description, seed.locationLabel, seed.tags.join(' ')]
        .filter(Boolean).join('\n'),
      tags: seed.tags,
      type: seed.kind,
      status: seed.status,
      updatedAt: seed.updatedAt,
    })),
  },
  payoffs: {
    tables: ['payoffs'],
    engines: ['seeds'],
    build: projectId => projectRows(db.payoffs, projectId, payoff => ({
      id: payoff.seedId,
      engineId: 'seeds',
      projectId: payoff.projectId,
      title: payoff.title,
      subtitle: 'payoff',
      body: [payoff.title, payoff.description, payoff.locationLabel].filter(Boolean).join('\n'),
      type: 'payoff',
      updatedAt: payoff.updatedAt,
    })),
  },
  characterArcs: {
    tables: ['characterArcs'],
    engines: ['character-arc'],
    build: projectId => projectRows(db.characterArcs, projectId, arc => ({
      id: arc.id,
      engineId: 'character-arc',
      projectId: arc.projectId,
      title: arc.title,
      subtitle: arc.characterName ?? arc.status,
      // The five spine fields are the arc: without them it is just a title.
      body: [arc.title, arc.summary, arc.ghost, arc.lie, arc.truth, arc.want, arc.need]
        .filter(Boolean).join('\n'),
      status: arc.status,
      updatedAt: arc.updatedAt,
    })),
  },
  arcBeats: {
    tables: ['arcBeats'],
    engines: ['character-arc'],
    build: projectId => projectRows(db.arcBeats, projectId, beat => ({
      id: beat.arcId,
      engineId: 'character-arc',
      projectId: beat.projectId,
      title: beat.title,
      subtitle: beat.stage,
      body: [beat.title, beat.description, beat.emotion].filter(Boolean).join('\n'),
      type: beat.stage,
      status: beat.status,
      updatedAt: beat.updatedAt,
    })),
  },
  relationships: {
    tables: ['relationships'],
    engines: ['relationships'],
    build: projectId => projectRows(db.relationships, projectId, relationship => ({
      id: relationship.id,
      engineId: 'relationships',
      projectId: relationship.projectId,
      title: `${relationship.entityAName} – ${relationship.entityBName}`,
      subtitle: relationship.kind,
      body: [relationship.label, relationship.notes, relationship.entityAName, relationship.entityBName]
        .filter(Boolean).join('\n'),
      type: relationship.kind,
      status: relationship.state,
      updatedAt: relationship.updatedAt,
    })),
  },
  biographyFacts: {
    tables: ['biographyFacts'],
    engines: ['biography'],
    build: projectId => projectRows(db.biographyFacts, projectId, fact => ({
      id: fact.biographyId,
      engineId: 'biography',
      projectId: fact.projectId,
      title: fact.title,
      subtitle: fact.category,
      body: [fact.title, stripHtml(fact.content ?? ''), fact.date, fact.tags.join(' ')]
        .filter(Boolean).join('\n'),
      tags: fact.tags,
      type: fact.category,
      status: fact.confidence,
      updatedAt: fact.updatedAt,
    })),
  },
  timelineEvents: {
    tables: ['timelineEvents'],
    engines: ['timeline'],
    build: projectId => projectRows(db.timelineEvents, projectId, event => ({
      id: event.id,
      engineId: 'timeline',
      projectId: event.projectId,
      title: event.title,
      subtitle: event.date || event.eventType,
      body: [event.title, event.description, event.date, event.lane].filter(Boolean).join('\n'),
      type: event.eventType,
      updatedAt: event.updatedAt,
    })),
  },
  mapPins: {
    tables: ['mapPins'],
    engines: ['maps'],
    build: projectId => projectRows(db.mapPins, projectId, pin => ({
      id: pin.id,
      engineId: 'maps',
      projectId: pin.projectId,
      title: pin.name,
      subtitle: pin.icon,
      body: [pin.name, pin.description].filter(Boolean).join('\n'),
      type: pin.icon,
      // Map pins carry no timestamp at all, so `updated:` cannot reach them.
    })),
  },
  atlasPlaces: {
    tables: ['atlasPlaces'],
    engines: ['real-atlas'],
    build: projectId => projectRows(db.atlasPlaces, projectId, place => ({
      id: place.id,
      engineId: 'real-atlas',
      projectId: place.projectId,
      title: place.name,
      subtitle: place.kind,
      body: [place.name, ...place.aliases, place.address, place.era, place.description, place.realNotes, ...place.tags]
        .filter(Boolean)
        .join('\n'),
      tags: place.tags,
      type: place.kind,
      status: place.fictional ? 'fictional' : 'real',
      updatedAt: place.updatedAt,
    })),
  },
  atlasDivergences: {
    tables: ['atlasDivergences'],
    engines: ['real-atlas'],
    build: projectId => projectRows(db.atlasDivergences, projectId, divergence => ({
      id: divergence.id,
      engineId: 'real-atlas',
      projectId: divergence.projectId,
      title: divergence.title,
      subtitle: divergence.category,
      body: [divergence.title, divergence.reality, divergence.fiction, divergence.reason, ...divergence.tags]
        .filter(Boolean)
        .join('\n'),
      tags: divergence.tags,
      type: divergence.category,
      updatedAt: divergence.updatedAt,
    })),
  },
  annotations: {
    tables: ['annotations'],
    engines: ['annotations'],
    build: projectId => projectRows(db.annotations, projectId, annotation => ({
      id: annotation.id,
      engineId: 'annotations',
      projectId: annotation.projectId,
      title: annotation.anchor.selectedText || annotation.sourceEngineId,
      subtitle: annotation.sourceEngineId,
      // noteImageUrl may be a data URL — never indexed.
      body: [annotation.noteBody, annotation.anchor.selectedText].filter(Boolean).join('\n'),
      type: annotation.noteType,
      status: annotation.isOrphaned ? 'orphaned' : 'anchored',
      updatedAt: annotation.updatedAt,
    })),
  },
};

/**
 * Fold once, at index time. Every query then costs an `indexOf` per needle
 * instead of a fresh normalization pass over the project's whole prose.
 */
function finalizeDocument(source: SourceDocument): SearchDocument {
  const title = foldSearchText(source.title);
  const body = foldSearchText(source.body);
  return {
    id: source.id,
    engineId: source.engineId,
    projectId: source.projectId,
    title: source.title,
    subtitle: source.subtitle,
    body: source.body,
    haystack: `${title}\n${body}`,
    bodyOffset: title.length + 1,
    tags: source.tags && source.tags.length > 0
      ? source.tags.map(foldSearchText)
      : NO_TAGS,
    type: source.type ? foldSearchText(source.type) : '',
    status: source.status ? foldSearchText(source.status) : '',
    day: source.updatedAt ? toLocalDateKey(new Date(source.updatedAt)) : '',
    updatedAt: source.updatedAt ?? 0,
  };
}

/** Read and fold one slice. Retaining the result is the caller's decision. */
async function buildSliceDocuments(
  slice: IndexSlice,
  projectId: string | undefined,
): Promise<SearchDocument[]> {
  const documents = await slice.build(projectId);
  return documents
    .map(finalizeDocument)
    // A title with no body is still findable — an untouched chapter is
    // exactly the kind of row `is:untagged` and `engine:` are asked for.
    .filter(document => /\S/.test(document.haystack));
}

/**
 * This project's slice cache, promoted to most-recently-used and the whole map
 * trimmed to `MAX_CACHED_PROJECTS`. A Map iterates in insertion order, so
 * re-inserting on every touch is all an LRU needs here.
 */
function projectCache(projectId: string): Map<string, SearchDocument[]> {
  const existing = caches.get(projectId);
  if (existing) caches.delete(projectId);
  const cache = existing ?? new Map<string, SearchDocument[]>();
  caches.set(projectId, cache);
  for (const key of caches.keys()) {
    if (caches.size <= MAX_CACHED_PROJECTS) break;
    caches.delete(key);
  }
  return cache;
}

async function sliceDocuments(
  projectId: string,
  sliceKey: string,
  slice: IndexSlice,
): Promise<SearchDocument[]> {
  const cached = projectCache(projectId).get(sliceKey);
  if (cached) return cached;

  const pendingKey = `${projectId}/${sliceKey}`;
  const inFlight = pending.get(pendingKey);
  if (inFlight) return inFlight;

  const stamp = stamps.get(sliceKey) ?? 0;
  const build = buildSliceDocuments(slice, projectId).then(
    (kept) => {
      pending.delete(pendingKey);
      // Drop the result on the floor if the slice was invalidated, or the
      // project evicted, while it was building.
      if ((stamps.get(sliceKey) ?? 0) === stamp) caches.get(projectId)?.set(sliceKey, kept);
      return kept;
    },
    (error: unknown) => {
      pending.delete(pendingKey);
      throw error;
    },
  );
  pending.set(pendingKey, build);
  return build;
}

/** Engine ids and their localized names, so `engine:` accepts either. */
function engineCandidates(): Array<{ id: string; name: string }> {
  return getAllEngines().map(engine => ({
    id: engine.id,
    name: t(`engines.${engine.id}.name`),
  }));
}

/** Resolve the query's `engine:` tokens to engine ids — once per search, not per document. */
export function resolveSearchEngineFilter(query: ParsedSearchQuery): ResolvedEngineFilter | null {
  return resolveEngineFilter(query, engineCandidates());
}

function sliceAllowed(slice: IndexSlice, engines: ResolvedEngineFilter | null): boolean {
  if (!engines) return true;
  const include = engines.include;
  if (include && !slice.engines.some(engineId => include.has(engineId))) return false;
  return slice.engines.some(engineId => !engines.exclude.has(engineId));
}

/**
 * Map an offset in the folded body back onto the original body.
 *
 * Folding is length-preserving for text in composed form, which is what every
 * editor in this app writes, so the common path is a single comparison. Text
 * that arrived already decomposed ("cafe" + combining acute) folds shorter, and
 * then the offset is walked out — at most once per returned hit, never per
 * document.
 */
function originalBodyIndex(document: SearchDocument, foldedIndex: number): number {
  const foldedLength = document.haystack.length - document.bodyOffset;
  if (foldedLength === document.body.length) return foldedIndex;

  let folded = 0;
  for (let index = 0; index < document.body.length; index += 1) {
    if (folded >= foldedIndex) return index;
    folded += foldSearchText(document.body[index]).length;
  }
  return document.body.length;
}

function buildSnippet(document: SearchDocument, match: QueryTextMatch): string {
  if (!document.body) return '';
  const bodyIndex = match.index - document.bodyOffset;
  // The match landed in the title (or the query was filters only): open the
  // snippet at the top of the body rather than pointing at nothing.
  if (bodyIndex < 0) return excerpt(document.body, 0, match.length);
  return excerpt(document.body, originalBodyIndex(document, bodyIndex), match.length);
}

/** A document that matched, held only long enough to be ranked against the rest. */
interface RankedDocument {
  engineId: string;
  score: number;
  document: SearchDocument;
  match: QueryTextMatch;
}

/**
 * Run a parsed query over the index.
 *
 * Per document the work is ordered cheapest-first and bails at the first
 * failure: facets (integer and small-array tests), then the exclusions the
 * writer typed, and only then the required needles — longest first, because the
 * longest word is the most selective one available without term statistics.
 * Nothing here compiles a regular expression, and the folded text it scans was
 * built once when the slice was loaded.
 *
 * The scan does not stop at `limit`, for two reasons. The per-engine totals are
 * what let the palette say "Writings 34" instead of "Writings 8, and who knows"
 * — and the first eight documents a table happens to iterate past are not the
 * eight the writer wants. Every match is scored, and only then are `limit` of
 * them chosen; a match that loses costs one small object and no snippet, which
 * is why ranking the whole set is cheaper than the old code that built a
 * snippet for every row it kept.
 */
export async function searchProjectDocuments(
  query: ParsedSearchQuery,
  projectId?: string,
  limit = 8,
): Promise<ProjectSearchOutcome> {
  if (query.isEmpty) return EMPTY_OUTCOME;
  if (!query.hasFilters && query.textLength < MIN_QUERY_LENGTH) return EMPTY_OUTCOME;

  const engines = resolveSearchEngineFilter(query);
  const today = searchToday();
  const now = Date.now();
  const matched = new Map<string, RankedDocument>();
  const candidates: RankedDocument[] = [];
  const totals: Record<string, number> = {};
  let total = 0;

  for (const [sliceKey, slice] of Object.entries(SLICES)) {
    if (!sliceAllowed(slice, engines)) continue;
    // An unscoped search reads every project's prose, and is answered in full
    // and then dropped. Caching it is what turned one three-character query on
    // the dashboard into a permanent copy — body and folded haystack — of
    // everything the writer owns.
    const documents = projectId
      ? await sliceDocuments(projectId, sliceKey, slice)
      : await buildSliceDocuments(slice, undefined);
    for (const document of documents) {
      if (projectId && document.projectId !== projectId) continue;
      if (!matchesFacets(query, document, engines, today)) continue;
      if (hasExcludedText(query, document.haystack)) continue;
      const match = findRequiredMatch(query, document.haystack);
      if (!match) continue;

      const key = `${document.engineId}:${document.id}`;
      const score = scoreSearchMatch(query, document, now);
      const existing = matched.get(key);
      if (existing) {
        // Several rows can stand for one navigable thing — a scene's dialogue
        // blocks, an arc's beats, a seed's payoff. They are one result, and it
        // should be the strongest of them rather than whichever row the scan
        // reached first.
        if (score > existing.score) {
          existing.score = score;
          existing.document = document;
          existing.match = match;
        }
        continue;
      }

      const candidate: RankedDocument = { engineId: document.engineId, score, document, match };
      matched.set(key, candidate);
      candidates.push(candidate);
      total += 1;
      totals[document.engineId] = (totals[document.engineId] ?? 0) + 1;
    }
  }

  // Candidates point at documents the cache already holds, so holding every
  // match costs four fields apiece and no copied prose.
  const hits = selectRankedMatches(candidates, limit).map(ranked => ({
    id: ranked.document.id,
    engineId: ranked.engineId,
    projectId: ranked.document.projectId,
    title: ranked.document.title,
    subtitle: ranked.document.subtitle,
    snippet: buildSnippet(ranked.document, ranked.match),
  }));

  return { hits, totals, total };
}

/**
 * Search prose from an invalidation-aware index instead of rescanning tables
 * per keypress. The raw string is read with the full query grammar, so every
 * caller — the palette, the AI bridge, grounded answers — understands
 * `"phrases"`, `-exclusions` and `field:` filters alike.
 */
export async function searchProjectContent(
  query: string,
  projectId?: string,
  limit = 8,
): Promise<ContentSearchHit[]> {
  const outcome = await searchProjectDocuments(parseSearchQuery(query), projectId, limit);
  return outcome.hits;
}

function invalidateSlices(sliceKeys: Iterable<string>): void {
  for (const sliceKey of sliceKeys) {
    stamps.set(sliceKey, (stamps.get(sliceKey) ?? 0) + 1);
    for (const cache of caches.values()) cache.delete(sliceKey);
  }
}

/**
 * Drop every cached project except this one.
 *
 * The index only exists to make the NEXT keystroke cheap, so a project the
 * writer has left has no claim on the heap: this is called when the palette
 * closes and when the route's project changes. Passing nothing — the dashboard,
 * where nothing is scoped — releases all of it.
 */
export function releaseProjectSearchIndex(projectId?: string): void {
  for (const key of caches.keys()) {
    if (key !== projectId) caches.delete(key);
  }
}

export function invalidateProjectSearchIndex(): void {
  invalidateSlices(Object.keys(SLICES));
  caches.clear();
  pending.clear();
}

/**
 * `storagemutated` names the parts that changed as `idb://<db>/<table>/<index>`.
 * Only the slices fed by those tables are dropped, so an autosave in Writings
 * no longer forces every other engine to be read again on the next keystroke.
 * Anything we cannot parse falls back to dropping the whole index.
 */
function mutatedTables(parts?: Record<string, unknown>): Set<string> | null {
  if (!parts) return null;
  const tables = new Set<string>();
  for (const part of Object.keys(parts)) {
    const table = /^idb:\/\/[^/]+\/([^/]+)/.exec(part)?.[1];
    if (!table || table === '*') return null;
    tables.add(table);
  }
  return tables.size > 0 ? tables : null;
}

function onStorageMutated(parts?: Record<string, unknown>): void {
  const tables = mutatedTables(parts);
  if (!tables) {
    invalidateProjectSearchIndex();
    return;
  }
  invalidateSlices(
    Object.keys(SLICES).filter(key => SLICES[key].tables.some(table => tables.has(table))),
  );
}

// Cross-window writes (including quick capture) invalidate the same cache.
Dexie.on('storagemutated', onStorageMutated);
