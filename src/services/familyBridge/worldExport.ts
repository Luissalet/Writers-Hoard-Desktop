// ============================================================================
// A project's world as a hoard.world/1 document (what wh_world_to_scheherazade sends)
// ============================================================================
//
// The codex (characters, places, factions, items, concepts, magic, custom), the
// relationships between codex entries and the timeline events of ONE project.
// Never the manuscript, pictures, diary, notes, research or investigation: a
// world is what the story is about, not what has been written about it.
//
// `buildWorldDoc` is pure so the tests can prove the document without a
// database; `loadWorldDoc` reads one project from Dexie.

import { db } from '@/db';
import type { CodexEntry, Timeline, TimelineEvent } from '@/types';
import type { Relationship } from '@/engines/relationships/types';
import { useLocaleStore } from '@/stores/localeStore';
import {
  MAX_WORLD_ITEMS, WORLD_SCHEMA, WorldDocumentError, digest, refCodex, refEvent, refProject, refRelation,
  type WorldDoc, type WorldEntity, type WorldEvent, type WorldRelation,
} from './worldSchema';
import { entityBody, entryContent, eventContent, relationContent, sectionOf } from './worldMap';

export interface WorldExportInput {
  project: { id: string; title: string; description?: string };
  entries: CodexEntry[];
  relationships: Relationship[];
  events: TimelineEvent[];
  timelines?: Timeline[];
  language?: 'es' | 'en';
  /** Secret relationships stay with the author unless this is set. */
  includeSecret?: boolean;
  /** Seconds since the epoch; the tests pin it. */
  exportedAt?: number;
}

export interface WorldExportResult {
  doc: WorldDoc;
  counts: Record<'characters' | 'places' | 'factions' | 'things' | 'relations' | 'events', number>;
  skipped: { unnamedEntries: number; secretRelations: number; danglingRelations: number; emptyEvents: number };
}

/** The refs an imported record is also known by elsewhere — never our own namespace. */
function foreignRefs(source: { ref: string; sameAs?: string[] } | undefined): string[] {
  if (!source) return [];
  return [source.ref, ...(source.sameAs ?? [])].filter(ref => !ref.startsWith('hoard://writer/'));
}

export function buildWorldDoc(input: WorldExportInput): WorldExportResult {
  const skipped = { unnamedEntries: 0, secretRelations: 0, danglingRelations: 0, emptyEvents: 0 };
  const doc: Required<Pick<WorldDoc, 'characters' | 'places' | 'factions' | 'things' | 'relations' | 'events'>> = {
    characters: [], places: [], factions: [], things: [], relations: [], events: [],
  };
  const exported = new Set<string>();

  for (const entry of [...input.entries].sort((a, b) => a.createdAt - b.createdAt)) {
    const content = entryContent(entry);
    if (!content.name) {
      skipped.unnamedEntries += 1;
      continue;
    }
    const body = entityBody(content);
    const same = foreignRefs(entry.familySource);
    const item: WorldEntity = { ref: refCodex(entry.id), ...body, ...(same.length ? { same_as: same } : {}), revision: digest(body) };
    doc[sectionOf(entry.type, entry.fields ?? {}).section].push(item);
    exported.add(entry.id);
  }

  for (const rel of [...input.relationships].sort((a, b) => a.createdAt - b.createdAt)) {
    if (rel.state === 'secret' && !input.includeSecret) {
      skipped.secretRelations += 1;
      continue;
    }
    if (!exported.has(rel.entityAId) || !exported.has(rel.entityBId) || rel.entityAId === rel.entityBId) {
      skipped.danglingRelations += 1;
      continue;
    }
    const { type, note } = relationContent(rel);
    const body = { from: refCodex(rel.entityAId), to: refCodex(rel.entityBId), type, note, since: '' };
    const same = foreignRefs(rel.familySource);
    const item: WorldRelation = { ref: refRelation(rel.id), ...body, ...(same.length ? { same_as: same } : {}), revision: digest(body) };
    doc.relations.push(item);
  }

  // Timeline order: lane by lane as the writer arranged them, then by position.
  const timelineRank = new Map((input.timelines ?? []).map((timeline, index) => [timeline.id, index]));
  const events = [...input.events].sort((a, b) => (timelineRank.get(a.timelineId) ?? 0) - (timelineRank.get(b.timelineId) ?? 0) || a.order - b.order);
  for (const event of events) {
    const content = eventContent(event);
    if (!content.summary) {
      skipped.emptyEvents += 1;
      continue;
    }
    const body = { date: content.date, summary: content.summary, entities: content.entities.filter(id => exported.has(id)).map(refCodex) };
    const same = foreignRefs(event.familySource);
    const item: WorldEvent = { ref: refEvent(event.id), ...body, ...(same.length ? { same_as: same } : {}), revision: digest(body) };
    doc.events.push(item);
  }

  const total = doc.characters.length + doc.places.length + doc.factions.length + doc.things.length + doc.relations.length + doc.events.length;
  if (total > MAX_WORLD_ITEMS) {
    throw new WorldDocumentError(`This project has ${total} world records; at most ${MAX_WORLD_ITEMS} go in one document.`);
  }

  const world = {
    name: input.project.title.trim().slice(0, 200) || 'Untitled',
    genre: '',
    tone: '',
    premise: (input.project.description ?? '').trim().slice(0, 20000),
    language: input.language ?? 'es',
  };
  const body = { world, ...doc };
  const result: WorldDoc = {
    schema: WORLD_SCHEMA,
    source: { app: 'writer', ref: refProject(input.project.id), revision: digest(body), exported_at: input.exportedAt ?? Date.now() / 1000 },
    ...body,
  };
  return {
    doc: result,
    counts: {
      characters: doc.characters.length, places: doc.places.length, factions: doc.factions.length, things: doc.things.length,
      relations: doc.relations.length, events: doc.events.length,
    },
    skipped,
  };
}

/** Read one project from the database and build its world document. */
export async function loadWorldDoc(projectId: string, options: { includeSecret?: boolean } = {}): Promise<WorldExportResult & { projectTitle: string }> {
  const project = await db.projects.get(projectId);
  if (!project) throw new WorldDocumentError(`No project with id "${projectId}".`);
  const [entries, relationships, events, timelines] = await Promise.all([
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.relationships.where('projectId').equals(projectId).toArray(),
    db.timelineEvents.where('projectId').equals(projectId).toArray(),
    db.timelines.where('projectId').equals(projectId).sortBy('createdAt'),
  ]);
  const result = buildWorldDoc({
    project, entries, relationships, events, timelines,
    language: useLocaleStore.getState().locale,
    includeSecret: options.includeSecret,
  });
  return { ...result, projectTitle: project.title };
}
