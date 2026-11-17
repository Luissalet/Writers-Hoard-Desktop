// ============================================
// World history — what is kept
// ============================================
// Only the author's settings and pins are stored on the world row: the history
// itself is rebuilt from them. Accepted Codex cards and timeline events are
// ordinary rows; the world remembers which proposal each one came from, so a
// new simulation shows them as accepted and never writes them twice. Nothing
// here deletes an accepted card or event.

import { db } from '@/db';
import type { CodexEntry, Relation, Timeline, TimelineEvent } from '@/types';
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
}

export function historyRecordOf(world: Pick<GeneratedWorld, 'history' | 'params'>): WorldHistoryRecord {
  const h = world.history;
  return {
    settings: normalizeHistorySettings(h?.settings ?? { seed: String(world.params.seed) }),
    accepted: { ...(h?.accepted ?? {}) },
    ...(h?.timelineId ? { timelineId: h.timelineId, timelineEvents: { ...(h.timelineEvents ?? {}) } } : {}),
    revision: h?.revision ?? 0,
  };
}

async function worldIn(projectId: string, worldId: string): Promise<GeneratedWorld> {
  const world = await db.generatedWorlds.get(worldId);
  if (!world || world.projectId !== projectId) throw new Error(`No world "${worldId}" in this project.`);
  return world;
}

/** Store new settings; returns what was there before, for Undo. */
export async function saveHistorySettings(projectId: string, worldId: string, settings: Partial<HistorySettings>): Promise<{ before: GeneratedWorld['history']; record: WorldHistoryRecord }> {
  return db.transaction('rw', db.generatedWorlds, async () => {
    const world = await worldIn(projectId, worldId);
    const prev = historyRecordOf(world);
    const record: WorldHistoryRecord = { ...prev, settings: normalizeHistorySettings({ ...prev.settings, ...settings }), revision: prev.revision + 1 };
    await db.generatedWorlds.update(worldId, { history: record, updatedAt: Date.now() });
    return { before: world.history, record };
  });
}

/** Put the history record back as it was (Undo of saveHistorySettings). */
export async function restoreHistoryRecord(projectId: string, worldId: string, before: GeneratedWorld['history']): Promise<void> {
  await worldIn(projectId, worldId);
  await db.generatedWorlds.update(worldId, { history: before, updatedAt: Date.now() });
}

/** Proposals whose card still exists. */
export async function acceptedKeys(record: WorldHistoryRecord): Promise<Set<string>> {
  const ids = Object.values(record.accepted);
  if (!ids.length) return new Set();
  const rows = await db.codexEntries.bulkGet(ids);
  const alive = new Set(rows.filter(Boolean).map((r) => r!.id));
  return new Set(Object.entries(record.accepted).filter(([, id]) => alive.has(id)).map(([k]) => k));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Write accepted proposals as Codex cards, tied to each other where the
 * history ties them (a house to its realm, a ruler to their house). Proposals
 * already accepted, with their card still there, are skipped.
 */
export async function acceptProposals(projectId: string, worldId: string, proposals: HistoryProposal[]): Promise<{ created: CodexEntry[]; skipped: string[] }> {
  return db.transaction('rw', db.generatedWorlds, db.codexEntries, async () => {
    const world = await worldIn(projectId, worldId);
    const record = historyRecordOf(world);
    const done = await acceptedKeys(record);
    const fresh = proposals.filter((p) => !done.has(p.key));
    const now = Date.now();
    const ids = new Map<string, string>(Object.entries(record.accepted).filter(([k]) => done.has(k)));
    for (const p of fresh) ids.set(p.key, crypto.randomUUID());
    const titles = new Map<string, string>(fresh.map((p) => [p.key, p.title]));
    for (const [k, id] of ids) if (!titles.has(k)) titles.set(k, (await db.codexEntries.get(id))?.title ?? '');
    const created: CodexEntry[] = fresh.map((p) => ({
      id: ids.get(p.key)!, projectId, type: p.type, title: p.title,
      fields: { ...p.fields }, content: p.paragraphs.map((x) => `<p>${esc(x)}</p>`).join(''), tags: [...p.tags],
      relations: p.related.filter((k) => ids.has(k)).map((k): Relation => ({ targetId: ids.get(k)!, targetTitle: titles.get(k) ?? '', type: 'related' })),
      createdAt: now, updatedAt: now,
    }));
    if (created.length) await db.codexEntries.bulkAdd(created);
    const accepted = { ...record.accepted };
    for (const c of fresh) accepted[c.key] = ids.get(c.key)!;
    await db.generatedWorlds.update(worldId, { history: { ...record, accepted }, updatedAt: now });
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
export async function sendHistoryToTimeline(projectId: string, worldId: string, history: WorldHistory, names: HistoryNames, lang: HistoryLang, title: string): Promise<{ timelineId: string; createdTimeline: boolean; created: string[] }> {
  return db.transaction('rw', db.generatedWorlds, db.timelines, db.timelineEvents, async () => {
    const world = await worldIn(projectId, worldId);
    const record = historyRecordOf(world);
    const now = Date.now();
    let timelineId = record.timelineId;
    let createdTimeline = false;
    if (!timelineId || !(await db.timelines.get(timelineId))) {
      timelineId = crypto.randomUUID();
      const timeline: Timeline = { id: timelineId, projectId, title, color: '#8a5a2b', description: '', yearRange: { start: history.startYear, end: history.endYear }, displayPrecision: 'year', createdAt: now, updatedAt: now };
      await db.timelines.add(timeline);
      createdTimeline = true;
      record.timelineEvents = {};
    }
    const sent = record.timelineEvents ?? {};
    const existing = new Set((await db.timelineEvents.where('timelineId').equals(timelineId).primaryKeys()).map(String));
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
    if (rows.length) await db.timelineEvents.bulkAdd(rows);
    await db.generatedWorlds.update(worldId, { history: { ...record, timelineId, timelineEvents: sent }, updatedAt: now });
    return { timelineId, createdTimeline, created: rows.map((r) => r.id) };
  });
}
