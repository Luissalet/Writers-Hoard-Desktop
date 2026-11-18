// AI bridge handlers for the world history simulation.
import { db } from '@/db';
import { assertEngineEnabled, BridgeError, optBoolean, optNumber, optString, requireString, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { formatWorldDate } from '@/engines/timeline/worldCalendar';
import { useLocaleStore } from '@/stores/localeStore';
import { openWorldForReading } from '../bridgeAccess';
import type { GeneratedWorld } from '../types';
import { historyInputFrom } from './fromGeography';
import { normalizeHistorySettings, ownerAt, politiesAt, simulateHistory } from './simulate';
import { acceptedKeys, acceptProposals, historyRecordOf, readHistoryWorld, saveHistorySettings, sendHistoryToTimeline } from './store';
import { eventText, historyNames, historyProposals, ruinCauseText, type HistoryLang, type HistoryNames, type ProposalGroup } from './text';
import type { HistoryEvent, HistoryInput, HistoryPin, HistorySettings, WorldHistory } from './types';

async function loadWorld(args: ToolArgs): Promise<GeneratedWorld> {
  const worldId = requireString(args, 'worldId');
  const eraId = optString(args, 'eraId');
  const projectId = optString(args, 'projectId');
  const base = projectId ? undefined : await db.generatedWorlds.get(worldId);
  const owner = projectId ?? base?.projectId;
  if (eraId && !owner) throw new BridgeError('bad-args', 'Pass projectId for a world that exists only in an era.');
  const world = eraId && owner
    ? await readHistoryWorld({ projectId: owner, eraId }, worldId)
    : base ?? await db.generatedWorlds.get(worldId);
  if (!world) throw new BridgeError('not-found', `No generated world with id "${worldId}" in this scope.`);
  if (projectId && world.projectId !== projectId) throw new BridgeError('bad-args', `World "${worldId}" does not belong to project "${projectId}".`);
  return world;
}

/** With a projectId, a switched-off engine refuses before anything else is read or checked. */
async function guardEngines(args: ToolArgs, engines: readonly Parameters<typeof assertEngineEnabled>[1][]): Promise<void> {
  const projectId = optString(args, 'projectId');
  if (projectId) for (const engine of engines) await assertEngineEnabled(projectId, engine);
}

const langOf = (args: ToolArgs): HistoryLang => {
  const l = optString(args, 'lang');
  return l === 'en' || l === 'es' ? l : useLocaleStore.getState().locale === 'en' ? 'en' : 'es';
};

interface Built { world: GeneratedWorld; input: HistoryInput; history: WorldHistory; names: HistoryNames; lang: HistoryLang }

/** The world opened, flattened and simulated with `settings` (stored ones by default). */
async function build(world: GeneratedWorld, args: ToolArgs, settings?: HistorySettings): Promise<Built | { pending: true; worldId: string; code: string; message: string }> {
  const eraId = optString(args, 'eraId');
  const opened = await openWorldForReading(world, 'full', eraId);
  if (!opened.ok) return { pending: true, worldId: world.id, code: opened.code, message: opened.message };
  const input = historyInputFrom(opened.world.data, opened.world.geo);
  if (!input.places.length) throw new BridgeError('bad-args', 'This world has no settlements, so it has no history to simulate.');
  const history = simulateHistory(input, settings ?? historyRecordOf(world, eraId).settings);
  const calendar = (await resolveWorldCalendar(world.projectId, undefined, eraId))?.calendar;
  const lang = langOf(args);
  const year = (y: number) => {
    if (calendar) { try { return formatWorldDate(calendar, { year: y }); } catch { /* outside the calendar */ } }
    return lang === 'es' ? `año ${y}` : `year ${y}`;
  };
  return { world, input, history, lang, names: historyNames(history, [...input.places, ...input.ruins], input.languages, year) };
}

const isPending = (b: Built | { pending: true }): b is { pending: true; worldId: string; code: string; message: string } => 'pending' in b;

function eventOut(e: HistoryEvent, b: Built) {
  return { id: e.id, year: e.year, date: b.names.year(e.year), ...(e.endYear !== undefined && e.endYear !== e.year ? { endYear: e.endYear } : {}), kind: e.kind, text: eventText(e, b.names, b.lang), ...(e.polity ? { realm: e.polity } : {}), ...(e.other ? { other: e.other } : {}), ...(e.place ? { place: e.place } : {}), ...(e.pinned ? { pinned: e.pinned } : {}) };
}

function summary(b: Built) {
  const h = b.history;
  return {
    worldId: b.world.id, settings: h.settings, startYear: h.startYear, endYear: h.endYear,
    span: `${b.names.year(h.startYear)} – ${b.names.year(h.endYear)}`,
    realms: h.polities.map((p) => ({ key: p.key, name: p.name, founded: b.names.year(p.founded), ...(p.fell !== undefined ? { fell: b.names.year(p.fell), ...(p.fellTo ? { fellTo: p.fellTo } : {}) } : { standing: true }), language: b.names.lang(p.langId), seat: b.names.place(p.seat), dynasties: p.dynasties.length, ...(p.migrantsFrom ? { migrantsFrom: p.migrantsFrom } : {}) })),
    ruins: h.ruins.map((r) => ({ key: r.ruin, name: r.name, eventId: r.eventId, founded: b.names.year(r.founded), fell: b.names.year(r.fell), cause: ruinCauseText(r.cause, b.lang), ...(r.by ? { by: r.by } : {}), ...(r.polity ? { realm: r.polity } : {}) })),
    substrateNames: h.toponyms.map((t) => ({ place: t.place, name: t.name, language: b.names.lang(t.langId), rulersLanguage: b.names.lang(t.rulerLangId), since: b.names.year(t.since), ...(t.alternative ? { inRulersLanguage: t.alternative } : {}) })),
    counts: { events: h.events.length, wars: h.events.filter((e) => e.kind === 'war').length, realms: h.polities.length, ruinsExplained: h.ruins.length },
    notes: h.notes,
  };
}

function findRealm(h: WorldHistory, ref: string) {
  const low = ref.toLowerCase();
  return h.polities.find((p) => p.key === ref) ?? h.polities.find((p) => p.name.toLowerCase() === low);
}

function findPlace(b: Built, ref: string): { key: string; name: string } | undefined {
  const low = ref.toLowerCase();
  const all = [...b.input.places, ...b.input.ruins];
  return all.find((p) => p.key === ref) ?? all.find((p) => p.name.toLowerCase() === low);
}

function readPins(args: ToolArgs): HistoryPin[] | undefined {
  if (args.pins === undefined) return undefined;
  if (!Array.isArray(args.pins)) throw new BridgeError('bad-args', 'pins must be an array.');
  const pins = normalizeHistorySettings({ pins: args.pins as HistoryPin[] }).pins;
  if (pins.length !== args.pins.length) throw new BridgeError('bad-args', 'Each pin needs id, kind, year and polity (realm-exists) or place (city-falls).');
  return pins;
}

export const WORLD_HISTORY_HANDLERS = {
  async wh_world_history_simulate(args: ToolArgs) {
    await guardEngines(args, ['worldgen']);
    const world = await loadWorld(args);
    await assertEngineEnabled(world.projectId, 'worldgen');
    const patch: Partial<HistorySettings> = {};
    const seed = optString(args, 'seed'); if (seed !== undefined) patch.seed = seed;
    const centuries = optNumber(args, 'centuries'); if (centuries !== undefined) patch.centuries = centuries;
    const aggression = optNumber(args, 'aggression'); if (aggression !== undefined) patch.aggression = aggression;
    const endYear = optNumber(args, 'endYear'); if (endYear !== undefined) patch.endYear = endYear;
    const pins = readPins(args); if (pins) patch.pins = pins;
    const next = normalizeHistorySettings({ ...historyRecordOf(world, optString(args, 'eraId')).settings, ...patch });
    const built = await build(world, args, next);
    if (isPending(built)) return built;
    const saved = await saveHistorySettings(world.projectId, world.id, patch, optString(args, 'eraId'));
    return withAudit({ simulated: true, revision: saved.record.revision, ...summary(built) }, {
      projectId: world.projectId, entityId: world.id, table: 'generatedWorlds', kind: 'update', summary: 'Simulate the world history',
      before: saved.before ? { history: saved.before } : { __absent: ['history'] },
    });
  },

  async wh_world_history(args: ToolArgs) {
    const world = await loadWorld(args);
    const built = await build(world, args);
    if (isPending(built)) return built;
    const h = built.history;
    const limit = optNumber(args, 'limit') ?? 200;
    const from = optNumber(args, 'fromYear') ?? -Infinity, to = optNumber(args, 'toYear') ?? Infinity;
    const kinds = Array.isArray(args.kinds) ? new Set(args.kinds.map(String)) : null;
    const pick = (keep: (e: HistoryEvent) => boolean) => h.events.filter((e) => keep(e) && e.year >= from && e.year <= to && (!kinds || kinds.has(e.kind))).slice(0, limit).map((e) => eventOut(e, built));
    const year = optNumber(args, 'year');
    const realmRef = optString(args, 'realm'), placeRef = optString(args, 'place');
    if (realmRef) {
      const p = findRealm(h, realmRef);
      if (!p) throw new BridgeError('not-found', `No realm "${realmRef}" in this history. Realms: ${h.polities.map((q) => `${q.name} (${q.key})`).join(', ')}.`);
      const held = Object.entries(h.owners).filter(([, list]) => list.some((o) => o.polity === p.key)).map(([k]) => built.names.place(k));
      return {
        key: p.key, name: p.name, founded: built.names.year(p.founded), ...(p.fell !== undefined ? { fell: built.names.year(p.fell), fellTo: p.fellTo ?? null } : { standing: true }),
        language: built.names.lang(p.langId), seat: built.names.place(p.seat), ...(p.migrantsFrom ? { migrantsFrom: p.migrantsFrom } : {}),
        dynasties: p.dynasties.map((d) => ({ name: d.name, from: built.names.year(d.from), to: built.names.year(d.to), rise: d.rise, rulers: d.rulers.map((r) => ({ name: r.name, from: built.names.year(r.from), to: built.names.year(r.to) })) })),
        placesHeld: held, events: pick((e) => e.polity === p.key || e.other === p.key),
      };
    }
    if (placeRef) {
      const pl = findPlace(built, placeRef);
      if (!pl) throw new BridgeError('not-found', `No settlement or ruin "${placeRef}" on this world.`);
      const ruin = h.ruins.find((r) => r.ruin === pl.key);
      const sub = h.toponyms.find((t) => t.place === pl.key);
      return {
        key: pl.key, name: pl.name, ...(h.founded[pl.key] !== undefined ? { founded: built.names.year(h.founded[pl.key]) } : { founded: `≤ ${built.names.year(h.startYear)}` }),
        holders: (h.owners[pl.key] ?? []).map((o) => ({ realm: o.polity ? built.names.polity(o.polity) : null, key: o.polity || null, from: built.names.year(o.from) })),
        ...(ruin ? { ruin: { eventId: ruin.eventId, realm: ruin.polity ?? null, fell: built.names.year(ruin.fell), cause: ruinCauseText(ruin.cause, built.lang), ...(ruin.by ? { by: built.names.polity(ruin.by) } : {}) } } : {}),
        ...(sub ? { substrate: { language: built.names.lang(sub.langId), rulersLanguage: built.names.lang(sub.rulerLangId), since: built.names.year(sub.since), inRulersLanguage: sub.alternative } } : {}),
        events: pick((e) => e.place === pl.key || e.toPlace === pl.key),
      };
    }
    if (year !== undefined) {
      return {
        year, date: built.names.year(year),
        standing: politiesAt(h, year).map((p) => ({ key: p.key, name: p.name })),
        holders: [...built.input.places, ...built.input.ruins].map((p) => ({ place: p.name, key: p.key, realm: ownerAt(h, p.key, year) ?? null })).filter((x) => x.realm !== null),
        events: pick((e) => e.year === year),
      };
    }
    return { ...summary(built), events: pick(() => true) };
  },

  async wh_world_history_proposals(args: ToolArgs) {
    const world = await loadWorld(args);
    const built = await build(world, args);
    if (isPending(built)) return built;
    const groups = Array.isArray(args.groups) ? new Set(args.groups.map(String)) : null;
    const eraId = optString(args, 'eraId');
    const done = await acceptedKeys(historyRecordOf(world, eraId), { projectId: world.projectId, eraId });
    const only = optBoolean(args, 'onlyOpen');
    const list = historyProposals(built.history, built.names, built.lang).filter((p) => (!groups || groups.has(p.group)) && (!only || !done.has(p.key)));
    return { worldId: world.id, count: list.length, proposals: list.map((p) => ({ key: p.key, group: p.group, type: p.type, title: p.title, fields: p.fields, text: p.paragraphs.join('\n'), accepted: done.has(p.key) })) };
  },

  async wh_world_history_accept(args: ToolArgs) {
    await guardEngines(args, ['worldgen', 'codex']);
    const world = await loadWorld(args);
    await assertEngineEnabled(world.projectId, 'worldgen');
    await assertEngineEnabled(world.projectId, 'codex');
    const built = await build(world, args);
    if (isPending(built)) return built;
    const all = historyProposals(built.history, built.names, built.lang);
    const keys = Array.isArray(args.keys) ? new Set(args.keys.map(String)) : null;
    const groups = Array.isArray(args.groups) ? new Set(args.groups.map(String) as ProposalGroup[]) : null;
    let chosen = keys ? all.filter((p) => keys.has(p.key)) : [];
    if (keys) {
      const unknown = [...keys].filter((k) => !all.some((p) => p.key === k));
      if (unknown.length) throw new BridgeError('bad-args', `No proposal with key ${unknown.slice(0, 5).join(', ')} in the current history; list them with wh_world_history_proposals.`);
    } else if (optBoolean(args, 'all')) chosen = all.filter((p) => !groups || groups.has(p.group));
    else throw new BridgeError('bad-args', 'Pass keys, or all: true (optionally with groups).');
    const result = await acceptProposals(world.projectId, world.id, chosen, optString(args, 'eraId'));
    const ids = result.created.map((c) => c.id);
    const out = { created: result.created.map((c) => ({ entryId: c.id, title: c.title, type: c.type })), skipped: result.skipped };
    if (!ids.length) return withAudit(out, { projectId: world.projectId, summary: 'Accept history cards (all already accepted)', reversible: false });
    return withAudit(out, { projectId: world.projectId, entityId: ids[0], entityIds: ids, table: 'codexEntries', kind: 'create', summary: `Accept ${ids.length} history card(s) into the Codex` });
  },

  async wh_world_history_to_timeline(args: ToolArgs) {
    await guardEngines(args, ['worldgen', 'timeline']);
    const world = await loadWorld(args);
    await assertEngineEnabled(world.projectId, 'worldgen');
    await assertEngineEnabled(world.projectId, 'timeline');
    const built = await build(world, args);
    if (isPending(built)) return built;
    const title = optString(args, 'title')?.trim() || (built.lang === 'es' ? `Historia de ${world.title}` : `History of ${world.title}`);
    const eraId = optString(args, 'eraId');
    const r = await sendHistoryToTimeline(world.projectId, world.id, built.history, built.names, built.lang, title, eraId);
    const ids = r.createdTimeline ? [r.timelineId] : r.created;
    const out = { timelineId: r.timelineId, createdTimeline: r.createdTimeline, eventsAdded: r.created.length };
    if (!ids.length) return withAudit(out, { projectId: world.projectId, summary: 'Send history to the timeline (nothing new)', reversible: false });
    return withAudit(out, { projectId: world.projectId, entityId: ids[0], entityIds: ids, table: r.createdTimeline ? 'timelines' : 'timelineEvents', kind: 'create', summary: `Send ${r.created.length} history event(s) to the timeline` });
  },
};
