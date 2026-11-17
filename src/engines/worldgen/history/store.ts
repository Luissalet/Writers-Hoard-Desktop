// ============================================
// World history — what is kept
// ============================================
// Only the author's settings and pins are stored on the world row: the history
// itself is rebuilt from them. Accepted Codex cards and timeline events are
// ordinary rows; the world remembers which proposal each one came from, so a
// new simulation shows them as accepted and never writes them twice. Nothing
// here deletes an accepted card or event.

import { db } from '@/db';
import { listEraRows, mutateEraRows, readWorldDocument, type EraRowMutation } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry, Relation, Timeline, TimelineEvent } from '@/types';
import { worldgenScopeOperations } from '../era';
import type { GeneratedWorld } from '../types';
import { normalizeHistorySettings } from './simulate';
import { eventText, type HistoryLang, type HistoryNames, type HistoryProposal } from './text';
import type { HistoryEvent, HistorySettings, WorldHistory } from './types';

export interface WorldHistoryRecord {
  settings: HistorySettings;
  /** Proposal key → Codex entry id. */
  accepted: Record<string, string>;
  /** The timeline the history was sent to, and event id → timeline event id. */
  timelineId?: string;
  timelineEvents?: Record<string, string>;
  revision: number;
  eraId?: string;
}

export function historyRecordOf(world: Pick<GeneratedWorld, 'history' | 'params'>, eraId?: string): WorldHistoryRecord {
  const h = world.history;
  // An inherited world can share its settings while each era publishes independently.
  const local = h?.eraId === eraId ? h : undefined;
  return {
    settings: normalizeHistorySettings(h?.settings ?? { seed: String(world.params.seed) }),
    accepted: { ...(local?.accepted ?? {}) },
    ...(local?.timelineId ? { timelineId: local.timelineId, timelineEvents: { ...(local.timelineEvents ?? {}) } } : {}),
    revision: local?.revision ?? 0,
    ...(eraId ? { eraId } : {}),
  };
}

async function worldIn(scope: WorldEraScope, worldId: string): Promise<GeneratedWorld> {
  const world = await worldgenScopeOperations(scope).worlds.getOne(worldId);
  if (!world || world.projectId !== scope.projectId) throw new Error(`No world "${worldId}" in this project.`);
  return world;
}

/** Store new settings; returns what was there before, for Undo. */
export async function saveHistorySettings(projectId: string, worldId: string, settings: Partial<HistorySettings>, eraId?: string): Promise<{ before: GeneratedWorld['history']; record: WorldHistoryRecord }> {
  const scope = { projectId, eraId };
  return db.transaction('rw', eraId ? db.tables : [db.generatedWorlds], async () => {
    const world = await worldIn(scope, worldId);
    const prev = historyRecordOf(world, eraId);
    const record: WorldHistoryRecord = { ...prev, settings: normalizeHistorySettings({ ...prev.settings, ...settings }), revision: prev.revision + 1 };
    await worldgenScopeOperations(scope).worlds.update(worldId, { history: record, updatedAt: Date.now() });
    return { before: world.history, record };
  });
}

/** Put the history record back as it was (Undo of saveHistorySettings). */
export async function restoreHistoryRecord(projectId: string, worldId: string, before: GeneratedWorld['history'], eraId?: string): Promise<void> {
  const scope = { projectId, eraId };
  await worldIn(scope, worldId);
  await worldgenScopeOperations(scope).worlds.update(worldId, { history: before, updatedAt: Date.now() });
}

async function acceptedCards(record: WorldHistoryRecord, scope?: WorldEraScope): Promise<Map<string, CodexEntry>> {
  const ids = new Set(Object.values(record.accepted));
  const cards = new Map<string, CodexEntry>();
  if (!ids.size) return cards;
  const rows = scope?.eraId ? await listEraRows<CodexEntry>(scope, 'codexEntries') : await db.codexEntries.bulkGet([...ids]);
  const byId = new Map(rows.filter((row): row is CodexEntry => !!row && ids.has(row.id)).map((row) => [row.id, row]));
  for (const [key, id] of Object.entries(record.accepted)) {
    const row = byId.get(id);
    if (row) cards.set(key, row);
  }
  return cards;
}

/** Proposals whose card still exists in this scope. */
export async function acceptedKeys(record: WorldHistoryRecord, scope?: WorldEraScope): Promise<Set<string>> {
  return new Set((await acceptedCards(record, scope)).keys());
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Write accepted proposals as Codex cards, tied to each other where the
 * history ties them (a house to its realm, a ruler to their house). Proposals
 * already accepted, with their card still there, are skipped.
 */
export async function acceptProposals(projectId: string, worldId: string, proposals: HistoryProposal[], eraId?: string): Promise<{ created: CodexEntry[]; skipped: string[] }> {
  const scope = { projectId, eraId };
  return db.transaction('rw', eraId ? db.tables : [db.generatedWorlds, db.codexEntries], async () => {
    const world = await worldIn(scope, worldId);
    const record = historyRecordOf(world, eraId);
    const done = await acceptedCards(record, scope);
    const fresh = proposals.filter((p) => !done.has(p.key));
    const now = Date.now();
    const ids = new Map([...done].map(([key, card]) => [key, card.id]));
    for (const p of fresh) ids.set(p.key, crypto.randomUUID());
    const titles = new Map<string, string>(fresh.map((p) => [p.key, p.title]));
    for (const [key, card] of done) titles.set(key, card.title);
    const created: CodexEntry[] = fresh.map((p) => ({
      id: ids.get(p.key)!, projectId, type: p.type, title: p.title,
      fields: { ...p.fields }, content: p.paragraphs.map((x) => `<p>${esc(x)}</p>`).join(''), tags: [...p.tags],
      relations: p.related.filter((k) => ids.has(k)).map((k): Relation => ({ targetId: ids.get(k)!, targetTitle: titles.get(k) ?? '', type: 'related' })),
      createdAt: now, updatedAt: now,
    }));
    if (created.length) {
      const accepted = { ...record.accepted };
      for (const c of fresh) accepted[c.key] = ids.get(c.key)!;
      const changes = { history: { ...record, accepted }, updatedAt: now };
      if (eraId) {
        await mutateEraRows(scope, [
          ...created.map((card) => ({ table: 'codexEntries', id: card.id, row: card as unknown as EraRow })),
          { table: 'generatedWorlds', id: worldId, changes },
        ]);
      } else {
        await db.codexEntries.bulkAdd(created);
        await db.generatedWorlds.update(worldId, changes);
      }
    }
    return { created, skipped: proposals.filter((p) => done.has(p.key)).map((p) => p.key) };
  });
}

const ICON: Partial<Record<HistoryEvent['kind'], TimelineEvent['icon']>> = {
  war: 'swords', conquest: 'swords', sack: 'swords', 'polity-founded': 'crown', dynasty: 'crown', collapse: 'flag',
  peace: 'book', cession: 'book', migration: 'ship', 'city-founded': 'star', flood: 'moon', abandoned: 'mountain', annexed: 'flag',
};

/** The events worth a line on a timeline (not every village annexed). */
export function timelineWorthy(e: HistoryEvent): boolean {
  return (e.kind !== 'annexed' && e.kind !== 'city-founded') || !!e.pinned;
}

/**
 * Send the history to a timeline dated in the world calendar: a new one the
 * first time, then the same one, adding only events it does not have yet.
 */
export async function sendHistoryToTimeline(projectId: string, worldId: string, history: WorldHistory, names: HistoryNames, lang: HistoryLang, title: string, eraId?: string): Promise<{ timelineId: string; createdTimeline: boolean; created: string[] }> {
  const scope = { projectId, eraId };
  return db.transaction('rw', eraId ? db.tables : [db.generatedWorlds, db.timelines, db.timelineEvents], async () => {
    const world = await worldIn(scope, worldId);
    const record = historyRecordOf(world, eraId);
    const now = Date.now();
    let timelineId = record.timelineId;
    const eraTimeline = eraId && timelineId ? await readWorldDocument(scope, 'timeline', timelineId) : undefined;
    const found = timelineId && (eraId ? eraTimeline : await db.timelines.get(timelineId));
    let newTimeline: Timeline | undefined;
    if (!timelineId || !found) {
      timelineId = crypto.randomUUID();
      newTimeline = { id: timelineId, projectId, title, color: '#8a5a2b', description: '', yearRange: { start: history.startYear, end: history.endYear }, displayPrecision: 'year', createdAt: now, updatedAt: now };
      record.timelineEvents = {};
    }
    const sent = record.timelineEvents ?? {};
    const existing = new Set(eraId
      ? (eraTimeline?.document.children.timelineEvents ?? []).map((row) => row.id)
      : (await db.timelineEvents.where('timelineId').equals(timelineId).primaryKeys()).map(String));
    const accepted = record.accepted;
    const rows: TimelineEvent[] = [];
    let order = existing.size;
    for (const e of history.events) {
      if (!timelineWorthy(e) || (sent[e.id] && existing.has(sent[e.id]))) continue;
      const id = crypto.randomUUID();
      const links = [e.polity && accepted[`realm:${e.polity}`], e.other && accepted[`realm:${e.other}`], e.war && accepted[`war:${e.war}`]].filter((x): x is string => !!x);
      rows.push({
        id, projectId, timelineId, title: eventText(e, names, lang), description: '', date: names.year(e.year), dateMode: 'world',
        worldDate: { year: e.year }, ...(e.endYear !== undefined && e.endYear > e.year ? { worldDateEnd: { year: e.endYear } } : {}),
        eventType: e.endYear !== undefined && e.endYear > e.year ? 'range' : 'point', order: order++, lane: '', color: '#8a5a2b',
        ...(ICON[e.kind] ? { icon: ICON[e.kind] } : {}), ...(links.length ? { linkedEntryId: links[0], linkedEntryIds: links } : {}),
        tags: [lang === 'es' ? 'historia' : 'history'], createdAt: now, updatedAt: now,
      });
      sent[e.id] = id;
    }
    if (newTimeline || rows.length) {
      const changes = { history: { ...record, timelineId, timelineEvents: sent }, updatedAt: now };
      if (eraId) {
        const mutations: EraRowMutation[] = [];
        if (newTimeline) mutations.push({ table: 'timelines', id: timelineId, row: newTimeline as unknown as EraRow });
        for (const row of rows) mutations.push({ table: 'timelineEvents', id: row.id, row: row as unknown as EraRow });
        mutations.push({ table: 'generatedWorlds', id: worldId, changes });
        await mutateEraRows(scope, mutations);
      } else {
        if (newTimeline) await db.timelines.add(newTimeline);
        if (rows.length) await db.timelineEvents.bulkAdd(rows);
        await db.generatedWorlds.update(worldId, changes);
      }
    }
    return { timelineId, createdTimeline: !!newTimeline, created: rows.map((r) => r.id) };
  });
}
