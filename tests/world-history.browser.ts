import { simulateHistory, ownerAt, politiesAt } from '@/engines/worldgen/history/simulate';
import { territoryAt } from '@/engines/worldgen/history/territory';
import { historyNames, historyProposals, eventText } from '@/engines/worldgen/history/text';
import type { HistoryInput, HistoryPlace, HistoryRuin } from '@/engines/worldgen/history/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const W = 160, H = 80;

/** Two continents split by a strait, three realms today, a handful of ruins. */
function makeInput(): HistoryInput {
  const elevation = new Float32Array(W * H).fill(0.3);
  for (let y = 0; y < H; y++) for (let x = 76; x <= 82; x++) elevation[y * W + x] = -1; // the strait
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y < 3 || y > H - 4) elevation[y * W + x] = -1;
  for (let y = 20; y < 60; y++) for (let x = 30; x <= 33; x++) elevation[y * W + x] = 2.2; // a range
  const places: HistoryPlace[] = [];
  let id = 0;
  const add = (x: number, y: number, rank: HistoryPlace['rank'], realm: number, langId: string, port = false) => {
    places.push({ key: `s:${id}`, id, name: `P${id}`, x, y, rank, population: rank === 'capital' ? 40000 : rank === 'city' ? 12000 : rank === 'town' ? 3000 : 400, port, langId, realm });
    id++;
  };
  add(15, 40, 'capital', 0, 'L1'); add(50, 40, 'capital', 1, 'L2'); add(120, 40, 'capital', 2, 'L3');
  for (let k = 0; k < 30; k++) {
    const x = 6 + ((k * 37) % 148), y = 8 + ((k * 23) % 64);
    if (x >= 74 && x <= 84) continue;
    const realm = x < 31 ? 0 : x < 76 ? 1 : 2;
    add(x, y, k % 5 === 0 ? 'city' : k % 2 ? 'village' : 'town', realm, realm === 1 && k % 3 === 0 ? 'L1' : `L${realm + 1}`, x === 74 || x === 85);
  }
  const ruins: HistoryRuin[] = [
    { key: 'r:0', id: 0, name: 'R0', x: 60, y: 20, kind: 'fort', condition: 'burnt', importance: 0.9 },
    { key: 'r:1', id: 1, name: 'R1', x: 100, y: 60, kind: 'temple', condition: 'overgrown', importance: 0.6 },
    { key: 'r:2', id: 2, name: 'R2', x: 140, y: 15, kind: 'town', condition: 'flooded', importance: 0.4 },
    { key: 'r:3', id: 3, name: 'R3', x: 22, y: 65, kind: 'tower', condition: 'buried', importance: 0.3 },
  ];
  return {
    world: { width: W, height: H, wrapX: true, elevation },
    places, ruins,
    realms: [
      { id: 0, name: 'Westmark', capital: 0, langId: 'L1', hue: 10 },
      { id: 1, name: 'Midreach', capital: 1, langId: 'L2', hue: 120 },
      { id: 2, name: 'Eastholm', capital: 2, langId: 'L3', hue: 240 },
    ],
    languages: [{ id: 'L1', name: 'Lone', parent: null }, { id: 'L2', name: 'Ltwo', parent: null }, { id: 'L3', name: 'Lthree', parent: null }],
    nameIn: (langId, key, kind) => `${kind}-${langId}-${key}`,
  };
}

export async function testWorldHistory(): Promise<string[]> {
  const out: string[] = [];
  const input = makeInput();
  const settings = { seed: 'alpha', centuries: 8, aggression: 0.6, endYear: 1200, pins: [] };
  const a = simulateHistory(input, settings);
  const b = simulateHistory(input, settings);
  assert(JSON.stringify(a) === JSON.stringify(b), 'Same seed, same history');
  const c = simulateHistory(input, { ...settings, seed: 'beta' });
  assert(JSON.stringify(a.events) !== JSON.stringify(c.events), 'Another seed, another history');
  out.push(`deterministic: ${a.events.length} events, ${a.polities.length} realms`);

  assert(a.startYear === 400 && a.endYear === 1200, `Span ${a.startYear}–${a.endYear}`);
  // Today's realms stand at the end and hold exactly today's places.
  for (const r of input.realms) {
    const p = a.polities.find((q) => q.key === `realm:${r.id}`);
    assert(p && p.fell === undefined, `${r.name} stands today`);
  }
  for (const pl of input.places) {
    const want = pl.realm >= 0 ? `realm:${pl.realm}` : '';
    assert(ownerAt(a, pl.key, 1200) === want, `${pl.key} ends in ${want}, not ${ownerAt(a, pl.key, 1200)}`);
  }
  // Every ruin has a cause and a date inside the span; lost realms are gone.
  for (const r of input.ruins) {
    const story = a.ruins.find((s) => s.ruin === r.key);
    assert(story && story.fell > a.startYear && story.fell <= a.endYear && story.founded < story.fell, `${r.key} explained: ${JSON.stringify(story)}`);
    assert(ownerAt(a, r.key, a.endYear) === undefined, `${r.key} is a ruin today`);
  }
  assert(a.ruins.some((s) => s.ruin === 'r:2' && s.cause === 'flood') || a.ruins.find((s) => s.ruin === 'r:2')?.by, 'A flooded ruin drowned unless someone took it');
  for (const p of a.polities.filter((q) => q.realm === undefined)) assert(p.fell !== undefined && p.fell < a.endYear, `${p.key} has fallen`);
  // Dynasties and reigns tile each realm's life.
  for (const p of a.polities) {
    assert(p.dynasties.length >= 1 && p.dynasties[0].from === p.founded, `${p.key} has a founding house`);
    for (const d of p.dynasties) for (const r of d.rulers) assert(r.from <= r.to, `${r.name} reigns forwards`);
  }
  // War: some at this aggression; peace with zero.
  const wars = a.events.filter((e) => e.kind === 'war').length;
  const calm = simulateHistory(input, { ...settings, aggression: 0 });
  const calmWars = calm.events.filter((e) => e.kind === 'war' && e.endYear !== e.year).length;
  assert(wars > 0 && calmWars === 0, `Aggression drives war: ${wars} at 0.6, ${calmWars} spontaneous at 0`);
  out.push(`wars ${wars} (calm ${calmWars}); ruins explained ${a.ruins.length}`);

  // Pins: a realm that must stand, a city that must fall.
  const lost = a.polities.find((p) => p.realm === undefined && !p.migrantsFrom)!;
  const pinned = simulateHistory(input, {
    ...settings,
    pins: [
      { id: 'p1', kind: 'realm-exists', polity: lost.key, year: 1100 },
      { id: 'p2', kind: 'city-falls', place: 's:5', year: 900, by: 'realm:2' },
    ],
  });
  const lost2 = pinned.polities.find((p) => p.key === lost.key)!;
  assert(lost2.founded <= 1100 && (lost2.fell ?? Infinity) > 1100, `${lost.key} stands in 1100: ${lost2.founded}–${lost2.fell}`);
  const fall = pinned.events.find((e) => e.pinned === 'p2');
  assert(fall && fall.year === 900 && fall.place === 's:5', `s:5 falls in 900: ${JSON.stringify(pinned.notes)} owner ${ownerAt(pinned, 's:5', 895)}`);
  assert(ownerAt(pinned, 's:5', 900) === 'realm:2' || fall.polity !== 'realm:2', 'Taken by the realm named, when it can');
  out.push(`pins honoured; notes ${JSON.stringify(pinned.notes)}`);

  // Borders: an older year shows the lost realms; today's year shows today's realms only.
  const mid = Math.round((a.startYear + a.endYear) / 2 / 5) * 5;
  const then = territoryAt(input, a, mid);
  const now = territoryAt(input, a, a.endYear);
  assert(now.polities.every((k) => k.startsWith('realm:')), `Today only today's realms: ${now.polities}`);
  let claimed = 0;
  for (let i = 0; i < now.owner.length; i++) if (now.owner[i] >= 0) claimed++;
  assert(claimed > now.owner.length * 0.2, `Today's borders cover the land (${claimed} cells)`);
  const standing = politiesAt(a, mid).map((p) => p.key);
  assert(then.polities.every((k) => standing.includes(k)), 'Borders only for realms standing that year');
  // The strait stays water.
  const g = then.gw;
  assert(then.owner[Math.floor(40 / then.cell) * g + Math.floor(79 / then.cell)] === -1, 'No claim on the strait');
  out.push(`borders ${mid}: ${then.polities.length} realms; today ${now.polities.length}`);

  // Words and proposals.
  const names = historyNames(a, [...input.places, ...input.ruins], input.languages, (y) => `Y${y}`);
  for (const lang of ['es', 'en'] as const) {
    for (const e of a.events) { const s = eventText(e, names, lang); assert(s && !s.includes('undefined'), `Text for ${e.kind}: ${s}`); }
    const props = historyProposals(a, names, lang);
    const keys = new Set(props.map((p) => p.key));
    assert(keys.size === props.length, 'Proposal keys are unique');
    assert(props.some((p) => p.group === 'realm') && props.some((p) => p.group === 'dynasty') && props.some((p) => p.group === 'ruin'), 'Realms, houses and ruins proposed');
    assert(props.every((p) => p.title && p.paragraphs.every((x) => !x.includes('undefined'))), 'No hole in a proposal');
  }
  // Same seed, same proposal keys: how accepted cards are recognised after re-simulating.
  const k1 = historyProposals(a, names, 'es').map((p) => p.key).join();
  const k2 = historyProposals(simulateHistory(input, settings), names, 'es').map((p) => p.key).join();
  assert(k1 === k2, 'Stable proposal keys');
  // Substrate names: places ruled today by a realm of another language.
  assert(a.toponyms.length > 0 && a.toponyms.every((t) => t.langId !== t.rulerLangId), `Substrate toponyms: ${a.toponyms.length}`);
  out.push(`proposals ${historyProposals(a, names, 'es').length}; substrate names ${a.toponyms.length}`);

  // Thirty centuries on a bigger graph stays quick.
  const t0 = performance.now();
  simulateHistory(input, { ...settings, centuries: 30 });
  const ms = performance.now() - t0;
  assert(ms < 4000, `30 centuries in ${ms.toFixed(0)} ms`);
  out.push(`30 centuries in ${ms.toFixed(0)} ms`);
  return out;
}

/** Settings on the world row, accepted cards that survive a new simulation, a timeline that only grows. */
export async function testWorldHistoryStore(): Promise<string[]> {
  const { db } = await import('@/db');
  const store = await import('@/engines/worldgen/history/store');
  const out: string[] = [];
  const projectId = `hist-${crypto.randomUUID()}`, worldId = crypto.randomUUID();
  const now = Date.now();
  await db.generatedWorlds.add({ id: worldId, projectId, title: 'W', params: { seed: 'w' } as never, createdAt: now, updatedAt: now });
  try {
    const input = makeInput();
    const saved = await store.saveHistorySettings(projectId, worldId, { seed: 'alpha', centuries: 8, aggression: 0.6, endYear: 1200 });
    assert(saved.before === undefined && saved.record.revision === 1 && saved.record.settings.seed === 'alpha', 'Settings stored');
    const history = simulateHistory(input, saved.record.settings);
    const names = historyNames(history, [...input.places, ...input.ruins], input.languages, (y) => `Y${y}`);
    const props = historyProposals(history, names, 'es').filter((p) => p.group === 'realm' || p.group === 'dynasty');
    const first = await store.acceptProposals(projectId, worldId, props.slice(0, 3));
    assert(first.created.length === 3, 'Three cards written');
    const tied = first.created.find((c) => c.relations.length);
    assert(tied, 'Cards accepted together are tied to each other');
    // Re-simulating with new settings keeps what was accepted and does not write it twice.
    await store.saveHistorySettings(projectId, worldId, { aggression: 0.2 });
    const again = await store.acceptProposals(projectId, worldId, props.slice(0, 5));
    assert(again.created.length === 2 && again.skipped.length === 3, `Accepted cards are recognised: ${again.created.length}/${again.skipped.length}`);
    assert((await db.codexEntries.where('projectId').equals(projectId).count()) === 5, 'Five cards in the Codex');
    // A deleted card can be accepted again.
    await db.codexEntries.delete(first.created[0].id);
    const record = store.historyRecordOf((await db.generatedWorlds.get(worldId))!);
    assert(!(await store.acceptedKeys(record)).has(props[0].key), 'A deleted card is no longer accepted');
    // Timeline: the first send creates it, the second only adds what is missing.
    const t1 = await store.sendHistoryToTimeline(projectId, worldId, history, names, 'es', 'Historia');
    assert(t1.createdTimeline && t1.created.length > 0, 'Timeline created');
    const ev = await db.timelineEvents.get(t1.created[0]);
    assert(ev?.dateMode === 'world' && typeof ev.worldDate?.year === 'number', 'Events dated in the world calendar');
    const t2 = await store.sendHistoryToTimeline(projectId, worldId, history, names, 'es', 'Historia');
    assert(!t2.createdTimeline && t2.timelineId === t1.timelineId && t2.created.length === 0, 'Nothing sent twice');
    await store.restoreHistoryRecord(projectId, worldId, saved.before);
    assert((await db.generatedWorlds.get(worldId))!.history === undefined, 'Undo puts the row back');
    out.push(`cards 5, timeline events ${t1.created.length}`);
  } finally {
    await db.generatedWorlds.delete(worldId);
    await db.codexEntries.where('projectId').equals(projectId).delete();
    await db.timelineEvents.where('projectId').equals(projectId).delete();
    await db.timelines.where('projectId').equals(projectId).delete();
  }
  return out;
}

/** The bridge tools over a real generated world: simulate, read a realm and a place, propose, accept, send to the timeline. */
export async function testWorldHistoryBridge(): Promise<string[]> {
  const { db } = await import('@/db');
  const { normalizeParams } = await import('@/engines/worldgen/core/types');
  const { WORLD_HISTORY_HANDLERS: H } = await import('@/engines/worldgen/history/bridge');
  const { WORLD_HISTORY_TOOLS } = await import('@/engines/worldgen/history/bridgeManifest');
  const out: string[] = [];
  for (const tool of WORLD_HISTORY_TOOLS) {
    const first = tool.description.split('\n')[0];
    assert(first.length <= 110 && first.includes(' · '), `${tool.name}: first line in EN · ES within 110 (${first.length})`);
  }
  const projectId = `hist-${crypto.randomUUID()}`, worldId = crypto.randomUUID(), now = Date.now();
  const engines = ['worldgen', 'codex', 'timeline'];
  await db.projects.add({ id: projectId, title: 'H', mode: 'custom', type: 'standalone', color: '#888', description: '', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: now, updatedAt: now });
  const params = normalizeParams({ seed: 'bridge-history', width: 512 });
  await db.generatedWorlds.add({ id: worldId, projectId, title: 'W', params, createdAt: now, updatedAt: now });
  // Bridge reads never forge a world: they read its snapshot, as the app leaves it.
  const { generateWorld } = await import('@/engines/worldgen/core/pipeline');
  const { paramsKey } = await import('@/engines/worldgen/useWorldGeneration');
  const { saveSnapshot } = await import('@/engines/worldgen/snapshots');
  await saveSnapshot(worldId, paramsKey(params), generateWorld(params));
  type R = Record<string, unknown> & { pending?: boolean };
  const call = async (name: keyof typeof H, args: Record<string, unknown>): Promise<R> => {
    for (let i = 0; i < 120; i++) {
      const r = await (H[name] as (a: Record<string, unknown>) => Promise<R>)({ projectId, worldId, lang: 'en', ...args });
      if (!r.pending) return r;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    throw Error(`${name} stayed pending: ${JSON.stringify(await (H[name] as (a: Record<string, unknown>) => Promise<R>)({ projectId, worldId, ...args }))}`);
  };
  try {
    const sim = await call('wh_world_history_simulate', { seed: 'one', centuries: 5, aggression: 0.7, endYear: 900 });
    const realms = sim.realms as { key: string; name: string }[];
    assert(sim.simulated && realms.length > 0 && (sim.counts as { events: number }).events > 0, 'Simulated');
    const audit = sim.__audit as { before: unknown; kind: string };
    assert(audit.kind === 'update' && JSON.stringify(audit.before) === '{"__absent":["history"]}', 'Undo restores the world row');
    assert((await db.generatedWorlds.get(worldId))!.history!.settings.seed === 'one', 'Settings stored');
    const again = await call('wh_world_history', {});
    assert(JSON.stringify(again.realms) === JSON.stringify(sim.realms), 'Reading gives the same history');
    const realm = await call('wh_world_history', { realm: realms[0].name });
    assert(realm.key === realms[0].key && Array.isArray(realm.dynasties), 'A realm by name');
    const ruins = sim.ruins as { key: string }[];
    if (ruins.length) {
      const place = await call('wh_world_history', { place: ruins[0].key });
      assert(place.ruin && Array.isArray(place.holders), 'A ruin has its fall');
    }
    const yearView = await call('wh_world_history', { year: 700 });
    assert(Array.isArray(yearView.standing), 'Realms standing in a year');
    const props = await call('wh_world_history_proposals', { groups: ['realm'] });
    const list = props.proposals as { key: string; accepted: boolean }[];
    assert(list.length === realms.length && list.every((p) => !p.accepted), 'One open card per realm');
    const acc = await call('wh_world_history_accept', { keys: [list[0].key] });
    const accAudit = acc.__audit as { kind: string; entityIds: string[]; table: string };
    assert(accAudit.kind === 'create' && accAudit.entityIds.length === 1 && accAudit.table === 'codexEntries', 'Accepting is an undoable create');
    // Re-simulating with another aggression keeps the accepted card.
    await call('wh_world_history_simulate', { aggression: 0.2 });
    const after = await call('wh_world_history_proposals', { groups: ['realm'] });
    assert((after.proposals as { key: string; accepted: boolean }[]).find((p) => p.key === list[0].key)?.accepted, 'Still accepted after re-simulating');
    const tl = await call('wh_world_history_to_timeline', {});
    assert(tl.createdTimeline && (tl.eventsAdded as number) > 0, 'Sent to a new timeline');
    const tl2 = await call('wh_world_history_to_timeline', {});
    assert(!tl2.createdTimeline && tl2.eventsAdded === 0, 'Nothing sent twice');
    // Engine off: writes refuse.
    await db.projects.update(projectId, { enabledEngines: ['worldgen'] });
    let refused = false;
    try { await call('wh_world_history_accept', { all: true }); } catch { refused = true; }
    assert(refused, 'Accepting refuses with the Codex off');
    out.push(`realms ${realms.length}, events ${(sim.counts as { events: number }).events}, ruins ${ruins.length}, timeline ${tl.eventsAdded}`);
  } finally {
    await db.codexEntries.where('projectId').equals(projectId).delete();
    await db.timelineEvents.where('projectId').equals(projectId).delete();
    await db.timelines.where('projectId').equals(projectId).delete();
    await db.generatedWorlds.delete(worldId);
    await db.worldSnapshots.where('worldId').equals(worldId).delete().catch(() => undefined);
    await db.projects.delete(projectId);
  }
  return out;
}
