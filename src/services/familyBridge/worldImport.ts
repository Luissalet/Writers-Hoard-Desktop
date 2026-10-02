// ============================================================================
// Importing a hoard.world/1 document into a project (wh_world_from_scheherazade)
// ============================================================================
//
// The same rules Scheherazade applies to a document Writers Hoard sends it
// (docs/WORLD_SCHEMA.md), so a world can go back and forth without
// duplicating or clobbering anything:
//
//   created          new ref, free name: a codex entry / relationship / event is made
//   unchanged        imported before at the same revision
//   updated          the source changed and the record has not been edited here since
//   local_modified   the source changed but the record was edited here: left alone, reported
//   linked_existing  a record of the same name and kind already exists: linked, not duplicated, not changed
//   name_collision   the name exists as another kind: nothing is written
//   own              the ref is one of this app's own (the document came back): nothing to do
//   skipped          unusable (bad_ref, no_name, no_summary, invalid, endpoint_missing, engine_disabled)
//                    or deleted here (deleted_locally, never brought back)
//
// Nothing is ever deleted, and a document that lacks a record does not remove
// it. Every imported record carries a `familySource` receipt (ref, revision and
// a hash of the record as it was right after the import); a different hash on
// the next import means the writer edited it, and it is not touched.
//
// The whole import is one Dexie transaction: it lands entirely or not at all.

import { db } from '@/db';
import { getSetting, PROJECT_SETTING_PREFIXES, setSetting } from '@/db/operations';
import type { CodexEntry, FamilySource, Timeline, TimelineEvent } from '@/types';
import type { Relationship } from '@/engines/relationships/types';
import { generateId } from '@/utils/idGenerator';
import {
  clip, digest, ownId, refOk, sameRefs, validateWorldDoc,
  type WorldEntity, type WorldEvent, type WorldRelation,
} from './worldSchema';
import {
  entryHash, eventHash, htmlFromDescription, incomingEntity, incomingEvent, incomingRelation,
  relationHash, sectionOf, type WorldSection,
} from './worldMap';

export type ImportState =
  | 'created' | 'unchanged' | 'updated' | 'local_modified' | 'linked_existing' | 'name_collision' | 'own' | 'skipped';

export interface ImportItem {
  section: string;
  ref: string | null;
  name: string;
  state: ImportState;
  /** The local row, when there is one. */
  id?: string;
  reason?: string;
}

export interface ImportResult {
  projectId: string;
  world: { ref: string; name: string };
  counts: Partial<Record<ImportState, number>>;
  items: ImportItem[];
  /** Rows this import made, by table — what undo removes. */
  created: { codex: string[]; relationships: string[]; events: string[]; timelines: string[] };
  /** Rows this import changed because the source had a newer revision. */
  updatedIds: string[];
  notes: string[];
}

export interface ImportOptions {
  /** False when the relationships engine is switched off in the project: those records are skipped, said so. */
  relationships?: boolean;
  /** Same for the timeline engine. */
  timeline?: boolean;
}

const TABLES = () => [db.codexEntries, db.relationships, db.timelines, db.timelineEvents, db.settings] as const;
const DEFAULT_TIMELINE_COLOR = '#c4973b';
const LEDGER_VERSION = 1;

type RowKind = 'codex' | 'relation' | 'event';
interface Ledger { v: number; refs: Record<string, RowKind> }

const ledgerKey = (projectId: string): string => `${PROJECT_SETTING_PREFIXES.familyWorld}${projectId}`;

function parseLedger(raw: string | undefined): Ledger {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Ledger>) : {};
    if (parsed && typeof parsed === 'object' && parsed.refs && typeof parsed.refs === 'object') {
      return { v: LEDGER_VERSION, refs: { ...parsed.refs } };
    }
  } catch {
    // An unreadable ledger is an empty one: the receipts on the rows still protect them.
  }
  return { v: LEDGER_VERSION, refs: {} };
}

function indexBySource<T extends { familySource?: FamilySource }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const source = row.familySource;
    if (!source) continue;
    for (const ref of [source.ref, ...(source.sameAs ?? [])]) if (!map.has(ref)) map.set(ref, row);
  }
  return map;
}

function firstOf<T>(refs: string[], map: Map<string, T>): T | undefined {
  for (const ref of refs) {
    const hit = map.get(ref);
    if (hit) return hit;
  }
  return undefined;
}

function countStates(items: ImportItem[]): Partial<Record<ImportState, number>> {
  const out: Partial<Record<ImportState, number>> = {};
  for (const item of items) out[item.state] = (out[item.state] ?? 0) + 1;
  return out;
}

const SECTIONS: ReadonlyArray<{ key: 'characters' | 'places' | 'factions' | 'things'; section: WorldSection }> = [
  { key: 'characters', section: 'characters' },
  { key: 'places', section: 'places' },
  { key: 'factions', section: 'factions' },
  { key: 'things', section: 'things' },
];

/** Merge a world document into a project. Throws WorldDocumentError for a document that is not one. */
export async function importWorldDoc(projectId: string, raw: unknown, options: ImportOptions = {}): Promise<ImportResult> {
  const doc = validateWorldDoc(raw);
  const source = doc.source && typeof doc.source === 'object' ? doc.source : {};
  const worldRef = refOk(source.ref) ? source.ref : '';
  const worldName = clip(doc.world?.name, 'name') || 'Imported world';
  const allowRelations = options.relationships !== false;
  const allowEvents = options.timeline !== false;

  return db.transaction('rw', [...TABLES()], async () => {
    const now = Date.now();
    const [entries, relationships, events, timelines, ledgerRaw] = await Promise.all([
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.relationships.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
      db.timelines.where('projectId').equals(projectId).toArray(),
      getSetting(ledgerKey(projectId)),
    ]);
    const ledger = parseLedger(ledgerRaw);
    const entryByRef = indexBySource(entries);
    const relationByRef = indexBySource(relationships);
    const eventByRef = indexBySource(events);
    const entriesById = new Map(entries.map(entry => [entry.id, entry]));
    const relationsById = new Map(relationships.map(rel => [rel.id, rel]));
    const eventsById = new Map(events.map(event => [event.id, event]));

    const items: ImportItem[] = [];
    const created = { codex: [] as string[], relationships: [] as string[], events: [] as string[], timelines: [] as string[] };
    const updatedIds: string[] = [];
    const notes: string[] = [];
    /** Every ref the document used for a record → the local codex id, for relations and events. */
    const refMap = new Map<string, string>();
    const remember = (refs: string[], kind: RowKind) => { for (const ref of refs) ledger.refs[ref] = kind; };

    const receipt = (ref: string, item: { same_as?: unknown; revision?: unknown }, localHash: string, fallbackRevision: string): FamilySource => {
      const same = sameRefs(item).filter(other => other !== ref);
      return {
        app: 'scheherazade', ref, ...(same.length ? { sameAs: same } : {}), revision: String(item.revision || fallbackRevision).slice(0, 200),
        localHash, worldRef, importedAt: now,
      };
    };

    // ---- Entities -------------------------------------------------------------------------------
    const importEntity = async (section: WorldSection, sectionName: string, item: WorldEntity): Promise<void> => {
      const report = (state: ImportState, id?: string, reason?: string): void =>
        void items.push({ section: sectionName, ref: typeof item.ref === 'string' ? item.ref : null, name: clip(item.name, 'name').slice(0, 80), state, ...(id ? { id } : {}), ...(reason ? { reason } : {}) });
      if (!refOk(item.ref)) return report('skipped', undefined, 'bad_ref');
      const incoming = incomingEntity(section, item);
      if (!incoming) return report('skipped', undefined, 'no_name');
      const html = htmlFromDescription(incoming.description);
      const asEntry = { type: incoming.type, title: incoming.title, fields: incoming.fields, content: html, tags: incoming.tags };
      const incomingHash = entryHash(asEntry);
      const revision = String(item.revision || incomingHash).slice(0, 200);
      const refs = [item.ref, ...sameRefs(item)];

      // A document that carries this app's own refs is one of ours coming back: nothing to do.
      const echoId = ownId(item.ref, 'codex');
      let own: CodexEntry | undefined = echoId ? entriesById.get(echoId) : undefined;
      const linked = own ? undefined : firstOf(refs, entryByRef);
      if (!linked && !own) {
        for (const ref of refs) {
          const id = ownId(ref, 'codex');
          if (!id) continue;
          const row = entriesById.get(id);
          if (row) own = row;
        }
      }
      if (linked) {
        for (const ref of refs) refMap.set(ref, linked.id);
        const link = linked.familySource!;
        if (link.revision === revision && link.ref === item.ref) return report('unchanged', linked.id);
        if (entryHash(linked) !== link.localHash) return report('local_modified', linked.id, 'edited here after it was imported; compare before changing it');
        const changes = { title: incoming.title, fields: incoming.fields, content: html, tags: incoming.tags, updatedAt: now };
        const next: CodexEntry = { ...linked, ...changes, familySource: receipt(item.ref, item, entryHash({ ...linked, ...changes }), revision) };
        await db.codexEntries.put(next);
        entriesById.set(next.id, next);
        updatedIds.push(next.id);
        return report('updated', next.id);
      }
      if (own) {
        for (const ref of refs) refMap.set(ref, own.id);
        return report('own', own.id);
      }
      if (refs.some(ref => ledger.refs[ref])) return report('skipped', undefined, 'deleted_locally');

      const sameName = entries.find(entry => entry.title.trim().toLowerCase() === incoming.title.toLowerCase());
      if (sameName?.familySource) {
        return report('name_collision', sameName.id, `"${sameName.title}" was already imported from another record of the document`);
      }
      if (sameName) {
        if (sectionOf(sameName.type, sameName.fields ?? {}).kind !== sectionOf(incoming.type, incoming.fields).kind) {
          return report('name_collision', sameName.id, `"${sameName.title}" already exists here as a ${sameName.type}`);
        }
        // Hash of what the source sent, not of our row: if they differ, ours counts as edited and is never overwritten.
        const next: CodexEntry = { ...sameName, familySource: receipt(item.ref, item, incomingHash, revision) };
        await db.codexEntries.put(next);
        entriesById.set(next.id, next);
        for (const ref of refs) refMap.set(ref, next.id);
        remember(refs, 'codex');
        return report('linked_existing', next.id);
      }

      const entry: CodexEntry = {
        id: generateId('codex'), projectId, type: incoming.type, title: incoming.title, fields: incoming.fields, content: html,
        tags: incoming.tags, relations: [], createdAt: now, updatedAt: now,
      };
      entry.familySource = receipt(item.ref, item, entryHash(entry), revision);
      await db.codexEntries.add(entry);
      entries.push(entry);
      entriesById.set(entry.id, entry);
      created.codex.push(entry.id);
      for (const ref of refs) refMap.set(ref, entry.id);
      remember(refs, 'codex');
      report('created', entry.id);
    };

    for (const { key, section } of SECTIONS) {
      for (const item of doc[key] ?? []) if (item && typeof item === 'object') await importEntity(section, key, item);
    }

    const resolveEntry = (ref: unknown): string | undefined => {
      if (!refOk(ref)) return undefined;
      const mapped = refMap.get(ref) ?? entryByRef.get(ref)?.id;
      if (mapped && entriesById.has(mapped)) return mapped;
      const own = ownId(ref, 'codex');
      return own && entriesById.has(own) ? own : undefined;
    };

    // ---- Relationships --------------------------------------------------------------------------
    const importRelation = async (item: WorldRelation): Promise<void> => {
      const report = (state: ImportState, id?: string, reason?: string): void =>
        void items.push({ section: 'relations', ref: typeof item.ref === 'string' ? item.ref : null, name: clip(item.type, 'type').slice(0, 80), state, ...(id ? { id } : {}), ...(reason ? { reason } : {}) });
      if (!allowRelations) return report('skipped', undefined, 'engine_disabled');
      if (!refOk(item.ref)) return report('skipped', undefined, 'bad_ref');
      const a = resolveEntry(item.from);
      const b = resolveEntry(item.to);
      const type = clip(item.type, 'type');
      if (!a || !b || a === b || !type) return report('skipped', undefined, !(a && b) ? 'endpoint_missing' : 'invalid');
      const incoming = incomingRelation(type, item.note, item.since);
      const incomingHash = relationHash(incoming);
      const revision = String(item.revision || incomingHash).slice(0, 200);
      const refs = [item.ref, ...sameRefs(item)];

      // A document that carries this app's own refs is one of ours coming back: nothing to do.
      const echoId = ownId(item.ref, 'relation');
      let own: Relationship | undefined = echoId ? relationsById.get(echoId) : undefined;
      const linked = own ? undefined : firstOf(refs, relationByRef);
      if (!linked && !own) {
        for (const ref of refs) {
          const id = ownId(ref, 'relation');
          if (!id) continue;
          const row = relationsById.get(id);
          if (row) own = row;
        }
      }
      if (linked) {
        const link = linked.familySource!;
        if (link.revision === revision && link.ref === item.ref) return report('unchanged', linked.id);
        if (relationHash(linked) !== link.localHash) return report('local_modified', linked.id, 'edited here after it was imported');
        const changes = { kind: incoming.kind, label: incoming.label, notes: incoming.notes, directional: incoming.directional, updatedAt: now };
        const next: Relationship = { ...linked, ...changes, familySource: receipt(item.ref, item, relationHash({ ...linked, ...changes }), revision) };
        await db.relationships.put(next);
        relationsById.set(next.id, next);
        updatedIds.push(next.id);
        return report('updated', next.id);
      }
      if (own) return report('own', own.id);
      if (refs.some(ref => ledger.refs[ref])) return report('skipped', undefined, 'deleted_locally');

      const twin = relationships.find(rel => !rel.familySource && rel.entityAId === a && rel.entityBId === b && rel.kind === incoming.kind && (rel.label ?? '') === incoming.label);
      if (twin) {
        const next: Relationship = { ...twin, familySource: receipt(item.ref, item, incomingHash, revision) };
        await db.relationships.put(next);
        relationsById.set(next.id, next);
        remember(refs, 'relation');
        return report('linked_existing', next.id);
      }
      const rel: Relationship = {
        id: generateId('rel'), projectId, entityAId: a, entityAType: 'codex-entry', entityAName: entriesById.get(a)!.title,
        entityBId: b, entityBType: 'codex-entry', entityBName: entriesById.get(b)!.title,
        kind: incoming.kind, intensity: 0, label: incoming.label, notes: incoming.notes, state: 'current', directional: incoming.directional,
        createdAt: now, updatedAt: now,
      };
      rel.familySource = receipt(item.ref, item, relationHash(rel), revision);
      await db.relationships.add(rel);
      relationships.push(rel);
      relationsById.set(rel.id, rel);
      created.relationships.push(rel.id);
      remember(refs, 'relation');
      report('created', rel.id);
    };
    for (const item of doc.relations ?? []) if (item && typeof item === 'object') await importRelation(item);
    if (!allowRelations && (doc.relations ?? []).length) notes.push('The relationships engine is switched off in this project, so the relations were skipped. Switch it on and import again.');

    // ---- Timeline events ------------------------------------------------------------------------
    let timeline: Timeline | undefined = timelines.find(row => row.familySource && row.familySource.worldRef === worldRef && row.familySource.ref === worldRef);
    const ensureTimeline = async (): Promise<Timeline> => {
      if (timeline) return timeline;
      const row: Timeline = {
        id: generateId('timeline'), projectId, title: `${worldName} (Scheherazade)`.slice(0, 200), color: DEFAULT_TIMELINE_COLOR,
        description: worldRef ? `Imported from ${worldRef}` : 'Imported from a story world',
        familySource: { app: 'scheherazade', ref: worldRef, revision: '', localHash: '', worldRef, importedAt: now },
        createdAt: now, updatedAt: now,
      };
      await db.timelines.add(row);
      created.timelines.push(row.id);
      timeline = row;
      return row;
    };
    const importEvent = async (item: WorldEvent): Promise<void> => {
      const report = (state: ImportState, id?: string, reason?: string): void =>
        void items.push({ section: 'events', ref: typeof item.ref === 'string' ? item.ref : null, name: clip(item.summary, 'summary').slice(0, 80), state, ...(id ? { id } : {}), ...(reason ? { reason } : {}) });
      if (!allowEvents) return report('skipped', undefined, 'engine_disabled');
      if (!refOk(item.ref)) return report('skipped', undefined, 'bad_ref');
      const summary = clip(item.summary, 'summary');
      if (!summary) return report('skipped', undefined, 'no_summary');
      const text = incomingEvent(summary);
      const date = clip(item.date, 'date');
      const linkedEntryId = (Array.isArray(item.entities) ? item.entities : []).map(resolveEntry).find(Boolean);
      const probe = { title: text.title, description: text.description, date, linkedEntryId };
      const incomingHash = eventHash(probe);
      const revision = String(item.revision || digest({ date, summary })).slice(0, 200);
      const refs = [item.ref, ...sameRefs(item)];

      // A document that carries this app's own refs is one of ours coming back: nothing to do.
      const echoId = ownId(item.ref, 'event');
      let own: TimelineEvent | undefined = echoId ? eventsById.get(echoId) : undefined;
      const linked = own ? undefined : firstOf(refs, eventByRef);
      if (!linked && !own) {
        for (const ref of refs) {
          const id = ownId(ref, 'event');
          if (!id) continue;
          const row = eventsById.get(id);
          if (row) own = row;
        }
      }
      if (linked) {
        const link = linked.familySource!;
        if (link.revision === revision && link.ref === item.ref) return report('unchanged', linked.id);
        if (eventHash(linked) !== link.localHash) return report('local_modified', linked.id, 'edited here after it was imported');
        const changes = { title: text.title, description: text.description, date, linkedEntryId, updatedAt: now };
        const next: TimelineEvent = { ...linked, ...changes, familySource: receipt(item.ref, item, eventHash({ ...linked, ...changes }), revision) };
        await db.timelineEvents.put(next);
        eventsById.set(next.id, next);
        updatedIds.push(next.id);
        return report('updated', next.id);
      }
      if (own) return report('own', own.id);
      if (refs.some(ref => ledger.refs[ref])) return report('skipped', undefined, 'deleted_locally');

      const twin = events.find(event => !event.familySource && eventHash(event) === incomingHash);
      if (twin) {
        const next: TimelineEvent = { ...twin, familySource: receipt(item.ref, item, incomingHash, revision) };
        await db.timelineEvents.put(next);
        eventsById.set(next.id, next);
        remember(refs, 'event');
        return report('linked_existing', next.id);
      }
      const lane = await ensureTimeline();
      const siblings = events.filter(event => event.timelineId === lane.id);
      const event: TimelineEvent = {
        id: generateId('event'), projectId, timelineId: lane.id, title: text.title, description: text.description, date, dateMode: 'text',
        eventType: 'point', order: siblings.reduce((max, row) => Math.max(max, row.order), -1) + 1, lane: '', color: lane.color,
        ...(linkedEntryId ? { linkedEntryId } : {}), createdAt: now, updatedAt: now,
      };
      event.familySource = receipt(item.ref, item, eventHash(event), revision);
      await db.timelineEvents.add(event);
      events.push(event);
      eventsById.set(event.id, event);
      created.events.push(event.id);
      remember(refs, 'event');
      report('created', event.id);
    };
    for (const item of doc.events ?? []) if (item && typeof item === 'object') await importEvent(item);
    if (!allowEvents && (doc.events ?? []).length) notes.push('The timeline engine is switched off in this project, so the events were skipped. Switch it on and import again.');

    if (Object.keys(ledger.refs).length) {
      await setSetting(ledgerKey(projectId), JSON.stringify(ledger));
    }
    return { projectId, world: { ref: worldRef, name: worldName }, counts: countStates(items), items, created, updatedIds, notes };
  });
}

/**
 * Take an import back: remove the rows it created (and the timeline it made,
 * if nothing else lives in it) and forget their refs, so importing the same
 * document again brings them back instead of reporting "deleted_locally".
 * Records the import only updated stay as they are — the caller says so.
 */
export async function undoWorldImport(projectId: string, ids: string[]): Promise<{ removed: number }> {
  return db.transaction('rw', [...TABLES()], async () => {
    const wanted = new Set(ids);
    const [entries, relationships, events, timelines] = await Promise.all([
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.relationships.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
      db.timelines.where('projectId').equals(projectId).toArray(),
    ]);
    const gone = {
      codex: entries.filter(row => wanted.has(row.id)),
      relationships: relationships.filter(row => wanted.has(row.id)),
      events: events.filter(row => wanted.has(row.id)),
      timelines: timelines.filter(row => wanted.has(row.id)),
    };
    const ledger = parseLedger(await getSetting(ledgerKey(projectId)));
    for (const row of [...gone.codex, ...gone.relationships, ...gone.events]) {
      const source = row.familySource;
      if (source) for (const ref of [source.ref, ...(source.sameAs ?? [])]) delete ledger.refs[ref];
    }
    await db.codexEntries.bulkDelete(gone.codex.map(row => row.id));
    await db.relationships.bulkDelete(gone.relationships.map(row => row.id));
    await db.timelineEvents.bulkDelete(gone.events.map(row => row.id));
    for (const timeline of gone.timelines) {
      // A timeline the writer has since put their own events into stays.
      const left = events.filter(row => row.timelineId === timeline.id && !wanted.has(row.id)).length;
      if (!left) await db.timelines.delete(timeline.id);
    }
    await setSetting(ledgerKey(projectId), JSON.stringify(ledger));
    return { removed: gone.codex.length + gone.relationships.length + gone.events.length + gone.timelines.length };
  });
}


/**
 * Remember that these refs have gone out to (or come in from) another app, so a
 * record the writer deletes here is not brought back by the next import.
 * Used after a world is sent: its records come home as `same_as` refs.
 */
export async function rememberFamilyRefs(projectId: string, refs: string[], kind: 'codex' | 'relation' | 'event'): Promise<void> {
  if (!refs.length) return;
  await db.transaction('rw', db.settings, async () => {
    const ledger = parseLedger(await getSetting(ledgerKey(projectId)));
    for (const ref of refs) ledger.refs[ref] = kind;
    await setSetting(ledgerKey(projectId), JSON.stringify(ledger));
  });
}
