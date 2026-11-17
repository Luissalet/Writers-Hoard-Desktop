// ============================================
// World history — the simulation
// ============================================
// Same input, same settings, same history: every draw comes from the seed.
//
// The span runs `centuries` back from the year of today's map, in steps of
// five years. Today's realms are founded at their capitals and grow; older
// realms rise at the sites today's ruins mark and must be gone by the end,
// which is what turns each ruin into a fall with a date and a cause. Places
// are founded through the span; realms take in the unclaimed ones next to
// theirs, go to war with their neighbours, take, sack and lose places, change
// dynasty and collapse. A fallen people may migrate and found a realm
// elsewhere. In the last years the borders settle into today's map, by
// treaty where a place changes hands.

import { createRng, type Rng } from '../core/rng';
import { buildPlaceGraph, type GraphNode } from './ground';
import {
  HISTORY_LIMITS, type Dynasty, type HistoryEvent, type HistoryInput, type HistoryPin, type HistorySettings,
  type Polity, type RuinCause, type RuinStory, type Toponym, type WorldHistory,
} from './types';

export const HISTORY_STEP = 5;

/** Settings brought into range; fixed facts keep their own years. */
export function normalizeHistorySettings(raw: Partial<HistorySettings> | undefined): HistorySettings {
  const s = raw ?? {};
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const centuries = Math.round(clamp(s.centuries, HISTORY_LIMITS.centuries.min, HISTORY_LIMITS.centuries.max, 6));
  const endYear = Math.round(clamp(s.endYear, -1_000_000, 1_000_000, 1000));
  const pins = (Array.isArray(s.pins) ? s.pins : []).filter((p): p is HistoryPin => !!p && typeof p === 'object'
    && typeof p.id === 'string' && Number.isFinite(p.year)
    && ((p.kind === 'realm-exists' && typeof p.polity === 'string') || (p.kind === 'city-falls' && typeof p.place === 'string')))
    .slice(0, HISTORY_LIMITS.pins)
    .map((p) => ({ ...p, year: Math.round(p.year) }));
  return {
    seed: typeof s.seed === 'string' && s.seed.trim() ? s.seed.trim().slice(0, 80) : 'history',
    centuries,
    aggression: clamp(s.aggression, 0, 1, 0.45),
    endYear,
    pins,
  };
}

interface Node extends GraphNode {
  name: string;
  /** Strength it lends its holder. */
  weight: number;
  langId: string;
  /** Today's settlement (true) or a ruin (false). */
  standing: boolean;
  /** Today's realm, settlements only. */
  realm: number;
  capitalOf: number;
  rank: string;
  condition?: string;
  founded: number;
  owner: number;
  razed?: number;
  /** Not to be taken or razed before this year (a city-falls pin). */
  shieldUntil?: number;
  /** Seat of a realm the author wants standing until this year. */
  holdUntil?: number;
}

interface Live extends Polity {
  /** Must be gone by this year (realms that are not on today's map). */
  fallBy?: number;
  /** Must stand until this year (realm-exists pin). */
  standUntil?: number;
  reignEnd: number;
  lostWarAt: number;
  alive: boolean;
}

interface War { key: string; a: number; b: number; from: number; event: HistoryEvent }

const roundStep = (years: number) => Math.round(years / HISTORY_STEP) * HISTORY_STEP;

export function simulateHistory(input: HistoryInput, rawSettings: Partial<HistorySettings>): WorldHistory {
  const settings = normalizeHistorySettings(rawSettings);
  const { seed, aggression } = settings;
  const span = settings.centuries * 100;
  const end = settings.endYear;
  const start = end - span;
  const rng = createRng(seed, 'history');
  const notes: string[] = [];
  const events: HistoryEvent[] = [];
  const onCadence = (year: number) => start + roundStep(year - start);

  // ---- places ---------------------------------------------------------------
  const nodes: Node[] = [];
  const capitals = new Map(input.realms.map((r) => [r.capital, r.id]));
  for (const p of input.places) {
    const capitalOf = capitals.get(p.id) ?? -1;
    nodes.push({
      key: p.key, x: p.x, y: p.y, port: p.port, name: p.name, langId: p.langId, standing: true, realm: p.realm,
      capitalOf, rank: p.rank, weight: 1 + Math.log10(1 + Math.max(0, p.population)) + (capitalOf >= 0 ? 2 : 0),
      founded: start, owner: -1,
    });
  }
  for (const r of input.ruins) {
    nodes.push({
      key: r.key, x: r.x, y: r.y, port: false, name: r.name, langId: '', standing: false, realm: -1, capitalOf: -1,
      rank: 'ruin', condition: r.condition, weight: 1 + 4 * Math.max(0, Math.min(1, r.importance)), founded: start, owner: -1,
    });
  }
  const byKey = new Map(nodes.map((n, i) => [n.key, i]));
  const graph = buildPlaceGraph(input.world, nodes);
  const nearestStanding = (n: Node): Node | undefined => {
    let best: Node | undefined, bd = Infinity;
    for (const m of nodes) {
      if (!m.standing) continue;
      const d = Math.hypot(m.x - n.x, m.y - n.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };
  const langs = input.languages.length ? input.languages.map((l) => l.id) : [''];
  for (const n of nodes) if (!n.standing) n.langId = nearestStanding(n)?.langId ?? langs[Math.floor(rng() * langs.length)];

  // Founding years: capitals early, villages late, ruins in the older half.
  const share: Record<string, number> = { capital: 0.2, city: 0.5, town: 0.7, village: 0.9, ruin: 0.45 };
  for (const n of nodes) n.founded = onCadence(start + rng() * (n.capitalOf >= 0 ? 0.2 : share[n.rank] ?? 0.8) * span);

  // ---- realms ----------------------------------------------------------------
  const polities: Live[] = [];
  const keyIndex = new Map<string, number>();
  const addPolity = (p: Omit<Live, 'alive' | 'reignEnd' | 'lostWarAt' | 'dynasties'>): number => {
    polities.push({ ...p, dynasties: [], alive: false, reignEnd: 0, lostWarAt: -Infinity });
    keyIndex.set(p.key, polities.length - 1);
    return polities.length - 1;
  };
  for (const r of input.realms) {
    const seat = input.places.find((p) => p.id === r.capital);
    if (!seat) continue;
    const node = nodes[byKey.get(seat.key)!];
    addPolity({ key: `realm:${r.id}`, name: r.name, langId: r.langId || node.langId, hue: r.hue, founded: node.founded, seat: seat.key, realm: r.id });
  }
  const ruinNodes = nodes.filter((n) => !n.standing).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const lostCount = Math.min(ruinNodes.length, Math.max(ruinNodes.length ? 1 : 0, Math.min(14, Math.round(ruinNodes.length * 0.35) + 1)));
  for (const seatNode of ruinNodes.slice(0, lostCount)) {
    const fallBy = onCadence(seatNode.founded + 80 + rng() * Math.max(0, end - span * 0.05 - seatNode.founded - 80));
    addPolity({
      key: `lost:${seatNode.key}`, name: input.nameIn(seatNode.langId, `realm:${seatNode.key}`, 'realm'), langId: seatNode.langId,
      hue: Math.floor(rng() * 360), founded: seatNode.founded, seat: seatNode.key, fallBy: Math.min(end - HISTORY_STEP, fallBy),
    });
  }

  // ---- the author's fixed facts ---------------------------------------------
  const fallPins = new Map<number, Extract<HistoryPin, { kind: 'city-falls' }>[]>();
  const pinNote = (pin: HistoryPin, reason: string) => notes.push(`pin:${pin.id}:${reason}`);
  for (const pin of settings.pins) {
    const { year } = pin;
    if (year < start || year > end) { pinNote(pin, 'outside-span'); continue; }
    if (pin.kind !== 'realm-exists') continue;
    const pi = keyIndex.get(pin.polity);
    if (pi === undefined) { pinNote(pin, 'unknown-realm'); continue; }
    const p = polities[pi];
    if (p.fallBy !== undefined && year === end) { pinNote(pin, 'absent-today'); continue; }
    const seat = nodes[byKey.get(p.seat)!];
    if (p.founded > year) {
      p.founded = Math.max(start, onCadence(year - HISTORY_STEP));
      seat.founded = Math.min(seat.founded, p.founded);
    }
    p.standUntil = Math.max(p.standUntil ?? -Infinity, year + 1);
    seat.holdUntil = Math.max(seat.holdUntil ?? -Infinity, p.standUntil);
    if (p.fallBy !== undefined) p.fallBy = Math.max(p.fallBy, p.standUntil);
  }
  for (const pin of [...settings.pins].sort((a, b) => a.year - b.year)) {
    const { year } = pin;
    if (pin.kind !== 'city-falls' || year < start || year > end) continue;
    const ni = byKey.get(pin.place);
    if (ni === undefined) { pinNote(pin, 'unknown-place'); continue; }
    const n = nodes[ni];
    const seated = keyIndex.get(`lost:${n.key}`);
    const p = seated === undefined ? undefined : polities[seated];
    if (p?.standUntil !== undefined && p.standUntil > year) { pinNote(pin, 'realm-protected'); continue; }
    if (!n.standing && n.shieldUntil !== undefined) { pinNote(pin, 'earlier-fall'); continue; }
    if (n.founded >= year) n.founded = Math.max(start, onCadence(year - 2 * HISTORY_STEP));
    n.shieldUntil = year;
    if (p) {
      p.founded = Math.min(p.founded, n.founded);
      p.fallBy = year;
    }
    const scheduled = fallPins.get(year) ?? [];
    scheduled.push(pin);
    fallPins.set(year, scheduled);
  }

  // ---- state helpers ---------------------------------------------------------
  const owners: Record<string, { polity: string; from: number }[]> = {};
  const ruins: RuinStory[] = [];
  const setOwner = (ni: number, pi: number, year: number) => {
    const n = nodes[ni];
    n.owner = pi;
    (owners[n.key] ??= []).push({ polity: pi >= 0 ? polities[pi].key : '', from: year });
  };
  const ev = (e: Omit<HistoryEvent, 'id'>): HistoryEvent => {
    const id = `${e.kind}:${e.year}:${e.polity ?? ''}:${e.place ?? ''}:${e.other ?? ''}`;
    const event = { id, ...e } as HistoryEvent;
    events.push(event);
    return event;
  };
  const at = (n: Node) => ({ x: n.x, y: n.y });
  const strengthOf = (pi: number) => {
    let s = 0;
    for (const n of nodes) if (n.owner === pi && n.razed === undefined) s += n.weight;
    return s;
  };
  const nodesOf = (pi: number) => nodes.map((n, i) => (n.owner === pi && n.razed === undefined ? i : -1)).filter((i) => i >= 0);

  const newRuler = (pi: number, year: number, newHouse: Dynasty['rise'] | null, r: Rng) => {
    const p = polities[pi];
    const last = p.dynasties[p.dynasties.length - 1];
    if (last?.rulers.length) last.rulers[last.rulers.length - 1].to = year;
    let house = last;
    if (newHouse || !house) {
      if (last) last.to = year;
      const hkey = `${p.key}:h${p.dynasties.length}`;
      house = { key: hkey, name: input.nameIn(p.langId, hkey, 'house'), from: year, to: end, rise: newHouse ?? 'founding', rulers: [] };
      p.dynasties.push(house);
      if (newHouse && newHouse !== 'founding') ev({ year, kind: 'dynasty', polity: p.key, dynasty: hkey });
    }
    house.rulers.push({ name: input.nameIn(p.langId, `${house.key}:r${house.rulers.length}`, 'ruler'), from: year, to: end });
    p.reignEnd = year + roundStep(8 + r() * 30);
  };

  /** `holder`: whose it was when it fell (by default, whoever holds it now). */
  const raze = (ni: number, year: number, cause: RuinCause, by: number, holder = nodes[ni].owner) => {
    const n = nodes[ni];
    n.razed = year;
    setOwner(ni, -1, year);
    ruins.push({ ruin: n.key, name: n.name, founded: n.founded, fell: year, cause, ...(holder >= 0 ? { polity: polities[holder].key } : {}), ...(by >= 0 ? { by: polities[by].key } : {}) });
  };

  const collapse = (pi: number, year: number, by: number, r: Rng) => {
    const p = polities[pi];
    if (!p.alive) return;
    p.alive = false;
    p.fell = year;
    if (by >= 0) p.fellTo = polities[by].key;
    const last = p.dynasties[p.dynasties.length - 1];
    if (last) { last.to = year; if (last.rulers.length) last.rulers[last.rulers.length - 1].to = year; }
    const seatIndex = byKey.get(p.seat)!;
    const seat = nodes[seatIndex];
    ev({ year, kind: 'collapse', polity: p.key, ...(by >= 0 ? { other: polities[by].key } : {}), place: p.seat, ...at(seat) });
    // A seat that is a ruin today does not outlive its realm.
    if (!seat.standing && seat.razed === undefined && !(seat.shieldUntil !== undefined && seat.shieldUntil > year)) {
      const flood = seat.condition === 'flooded' || seat.condition === 'drowned';
      raze(seatIndex, year, by >= 0 ? (seat.condition === 'burnt' ? 'sack' : 'conquest') : flood ? 'flood' : 'collapse', by, pi);
    }
    for (const ni of nodesOf(pi)) {
      if (by >= 0) setOwner(ni, by, year);
      else setOwner(ni, -1, year);
    }
    // Some peoples leave: a migration to a place a good way off.
    if (p.realm === undefined && r() < 0.55) {
      const far = nodes
        .map((n, i) => ({ n, i, d: Math.hypot(n.x - seat.x, n.y - seat.y) }))
        .filter(({ n, d }) => n.standing && n.founded <= year && n.razed === undefined && d > input.world.width * 0.06 && d < input.world.width * 0.3 && n.capitalOf < 0)
        .sort((a, b) => a.d - b.d || a.i - b.i);
      if (far.length) {
        const dest = far[Math.floor(r() * Math.min(far.length, 8))];
        ev({ year, kind: 'migration', polity: p.key, place: p.seat, toPlace: dest.n.key, langId: p.langId, ...at(dest.n) });
        if (dest.n.owner < 0 && year < end - span * 0.1) {
          const mi = addPolity({
            key: `mig:${p.key}:${dest.n.key}`, name: input.nameIn(p.langId, `mig:${dest.n.key}`, 'realm'), langId: p.langId,
            hue: (p.hue + 40) % 360, founded: year, seat: dest.n.key, migrantsFrom: p.key,
            fallBy: Math.min(end - HISTORY_STEP, onCadence(year + 60 + r() * 200)),
          });
          found(mi, year, r);
        }
      }
    }
  };

  const found = (pi: number, year: number, r: Rng) => {
    const p = polities[pi];
    p.alive = true;
    p.founded = year;
    const si = byKey.get(p.seat)!;
    const seat = nodes[si];
    if (seat.founded > year) seat.founded = year;
    const prior = seat.owner;
    setOwner(si, pi, year);
    // A realm gets a generation to settle before its seat can be taken.
    seat.holdUntil = Math.max(seat.holdUntil ?? -Infinity, year + 30);
    ev({ year, kind: 'polity-founded', polity: p.key, place: p.seat, ...(prior >= 0 ? { other: polities[prior].key } : {}), ...(p.migrantsFrom ? { langId: p.langId } : {}), ...at(seat) });
    if (prior >= 0 && polities[prior].realm === undefined && nodesOf(prior).length === 0) collapse(prior, year, -1, r);
    newRuler(pi, year, 'founding', r);
  };

  // ---- war helpers -----------------------------------------------------------
  const wars: War[] = [];
  const truce = new Map<string, number>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const takeable = (n: Node, year: number) => n.razed === undefined && n.capitalOf < 0
    && !(n.shieldUntil !== undefined && n.shieldUntil >= year) && !(n.holdUntil !== undefined && n.holdUntil > year);
  /** The defender's place nearest an attacker's, across one edge. */
  const frontier = (att: number, def: number, year: number): number => {
    let best = -1, bc = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].owner !== att || nodes[i].razed !== undefined) continue;
      for (const e of graph.edges[i]) {
        const m = nodes[e.to];
        if (m.owner === def && takeable(m, year) && e.cost < bc) { bc = e.cost; best = e.to; }
      }
    }
    return best;
  };
  const conquer = (ni: number, att: number, year: number, war: string | undefined, r: Rng, pinned?: string) => {
    const n = nodes[ni];
    const def = n.owner;
    ev({ year, kind: 'conquest', polity: polities[att].key, ...(def >= 0 ? { other: polities[def].key } : {}), place: n.key, ...(war ? { war } : {}), ...(pinned ? { pinned } : {}), ...at(n) });
    if (!n.standing && (pinned || r() < 0.15 + 0.5 * aggression)) {
      ev({ year, kind: 'sack', polity: polities[att].key, ...(def >= 0 ? { other: polities[def].key } : {}), place: n.key, ...(war ? { war } : {}), ...at(n) });
      // Razed while still the defender's: the ruin remembers whose it was.
      raze(ni, year, 'sack', att);
    } else setOwner(ni, att, year);
    if (def >= 0) {
      polities[def].lostWarAt = year;
      const p = polities[def];
      // Today's realms survive any loss: the end of the span gives them back their land.
      if (p.alive && p.realm === undefined && (n.key === p.seat || nodesOf(def).length === 0)) collapse(def, year, att, r);
    }
  };
  const neighbours = (): [number, number][] => {
    const pairs = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].owner;
      if (a < 0 || nodes[i].razed !== undefined) continue;
      for (const e of graph.edges[i]) {
        const b = nodes[e.to].owner;
        if (b >= 0 && b !== a && nodes[e.to].razed === undefined) pairs.add(pairKey(a, b));
      }
    }
    return [...pairs].sort().map((k) => k.split('|').map(Number) as [number, number]);
  };
  const strongestNeighbour = (pi: number): number => {
    let best = -1, bs = -1;
    for (const [a, b] of neighbours()) {
      const o = a === pi ? b : b === pi ? a : -1;
      if (o < 0 || !polities[o].alive) continue;
      const s = strengthOf(o);
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  };
  const endWar = (w: War, year: number) => {
    w.event.endYear = year;
    const a = polities[w.a], b = polities[w.b];
    if (a.alive && b.alive) ev({ year, kind: 'peace', polity: a.key, other: b.key, war: w.key, place: a.seat });
    truce.set(pairKey(w.a, w.b), year + 25);
  };

  // ---- the years -------------------------------------------------------------
  const order = polities.map((_, i) => i).sort((a, b) => polities[a].founded - polities[b].founded || a - b);
  let nextFound = 0;
  const applyFalls = (year: number, r: Rng) => {
    for (const pin of fallPins.get(year) ?? []) {
      const ni = byKey.get(pin.place)!;
      const n = nodes[ni];
      if (n.razed !== undefined) { notes.push(`pin:${pin.id}:already-ruined`); continue; }
      let by = pin.by ? keyIndex.get(pin.by) ?? -1 : -1;
      if (by >= 0 && !polities[by].alive) { notes.push(`pin:${pin.id}:conqueror-not-standing`); by = -1; }
      if (by >= 0 && by === n.owner) { notes.push(`pin:${pin.id}:conqueror-already-holds`); by = -1; }
      if (by < 0 && n.owner >= 0) by = strongestNeighbour(n.owner);
      if (by < 0) {
        let bd = Infinity;
        polities.forEach((p, pi) => { if (p.alive && pi !== n.owner) { const s = nodes[byKey.get(p.seat)!]; const d = Math.hypot(s.x - n.x, s.y - n.y); if (d < bd) { bd = d; by = pi; } } });
      }
      if (by < 0 || by === n.owner) { notes.push(`pin:${pin.id}:no-conqueror`); continue; }
      conquer(ni, by, year, undefined, r, pin.id);
    }
  };
  const years = new Set(fallPins.keys());
  // A protected lost realm may be due to fall between regular ticks.
  for (const p of polities) if (p.fallBy !== undefined) years.add(p.fallBy);
  for (let year = start; year <= end; year += HISTORY_STEP) years.add(year);
  for (const year of [...years].sort((a, b) => a - b)) {
    const regular = year < end && (year - start) % HISTORY_STEP === 0;
    const r = createRng(seed, `history:${year}`);
    if (regular) {
      // Places founded this step.
      for (const n of nodes) {
        if (n.founded !== year) continue;
        if (n.rank === 'capital' || n.rank === 'city' || !n.standing) ev({ year, kind: 'city-founded', place: n.key, ...at(n) });
      }
      // Realms founded this step.
      while (nextFound < order.length && polities[order[nextFound]].founded <= year) {
        const pi = order[nextFound++];
        if (!polities[pi].alive && polities[pi].fell === undefined) found(pi, Math.max(year, polities[pi].founded), r);
      }
      // Unclaimed places join the neighbour that reaches them most easily.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.owner >= 0 || n.founded > year || n.razed !== undefined) continue;
        let best = -1, bs = 0;
        for (const e of graph.edges[i]) {
          const o = nodes[e.to].owner;
          if (o < 0 || nodes[e.to].razed !== undefined || !polities[o].alive) continue;
          const pull = (polities[o].realm !== undefined && polities[o].realm === n.realm ? 2 : 1) / e.cost;
          if (pull > bs) { bs = pull; best = o; }
        }
        if (best >= 0 && r() < 0.35) {
          setOwner(i, best, year);
          if (n.rank === 'city' || n.rank === 'town' || !n.standing) ev({ year, kind: 'annexed', polity: polities[best].key, place: n.key, ...at(n) });
        }
      }
      // New wars.
      for (const [a, b] of neighbours()) {
        if (wars.some((w) => pairKey(w.a, w.b) === pairKey(a, b))) continue;
        if ((truce.get(pairKey(a, b)) ?? -Infinity) > year) continue;
        if (r() >= 0.05 * Math.pow(aggression, 1.3)) continue;
        const sa = strengthOf(a) * (0.5 + r()), sb = strengthOf(b) * (0.5 + r());
        const [att, def] = sa >= sb ? [a, b] : [b, a];
        const key = `war:${year}:${polities[att].key}:${polities[def].key}`;
        const event = ev({ year, kind: 'war', polity: polities[att].key, other: polities[def].key, war: key, place: polities[def].seat });
        wars.push({ key, a: att, b: def, from: year, event });
      }
      // Wars go on.
      for (const w of [...wars]) {
        const A = polities[w.a], B = polities[w.b];
        if (!A.alive || !B.alive) { endWar(w, year); wars.splice(wars.indexOf(w), 1); continue; }
        const sa = strengthOf(w.a), sb = strengthOf(w.b);
        const roll = r();
        if (roll < 0.55 * sa / (sa + sb + 1e-9) + 0.1) {
          const t = frontier(w.a, w.b, year);
          if (t >= 0) conquer(t, w.a, year, w.key, r);
        } else if (roll > 0.85) {
          const t = frontier(w.b, w.a, year);
          if (t >= 0) conquer(t, w.b, year, w.key, r);
        }
        if (!A.alive || !B.alive || (year > w.from && r() < 0.25)) { endWar(w, year); wars.splice(wars.indexOf(w), 1); }
      }
    }
    applyFalls(year, r);
    // Realms that must be gone.
    for (let pi = 0; pi < polities.length; pi++) {
      const p = polities[pi];
      if (!p.alive || p.fallBy === undefined || p.fallBy > year) continue;
      if (p.standUntil !== undefined && p.standUntil > year) continue;
      const by = strongestNeighbour(pi);
      if (by >= 0) {
        const key = `war:${year}:${polities[by].key}:${p.key}`;
        ev({ year, kind: 'war', polity: polities[by].key, other: p.key, war: key, place: p.seat, endYear: year });
        const seatIndex = byKey.get(p.seat)!;
        if (nodes[seatIndex].owner === pi && takeable(nodes[seatIndex], year)) conquer(seatIndex, by, year, key, r);
        if (p.alive) collapse(pi, year, by, r);
      } else collapse(pi, year, -1, r);
    }
    if (!regular) continue;
    // Reigns end; sometimes the house with them.
    for (let pi = 0; pi < polities.length; pi++) {
      const p = polities[pi];
      if (!p.alive || p.reignEnd > year) continue;
      const shaken = year - p.lostWarAt <= 10 ? 0.3 : 0;
      const change = r() < 0.12 + 0.25 * aggression + shaken;
      const rise: Dynasty['rise'] = shaken ? 'usurpation' : (['usurpation', 'marriage', 'extinction'] as const)[Math.floor(r() * 3)];
      newRuler(pi, year, change ? rise : null, r);
    }
  }

  // ---- settling into today's map --------------------------------------------
  const r = createRng(seed, 'history:end');
  for (const w of wars) endWar(w, end);
  for (let pi = 0; pi < polities.length; pi++) {
    const p = polities[pi];
    if (p.alive && p.realm === undefined) collapse(pi, end, -1, r);
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.standing) {
      if (n.razed === undefined) {
        const year = Math.max(
          n.founded + 1, n.shieldUntil ?? start, owners[n.key]?.at(-1)?.from ?? start,
          end - HISTORY_STEP * (1 + Math.floor(r() * 6)),
        );
        const flood = n.condition === 'flooded' || n.condition === 'drowned';
        ev({ year, kind: flood ? 'flood' : 'abandoned', place: n.key, ...(n.owner >= 0 ? { polity: polities[n.owner].key } : {}), x: n.x, y: n.y });
        raze(i, year, flood ? 'flood' : 'abandoned', -1);
      }
      continue;
    }
    const target = n.realm >= 0 ? keyIndex.get(`realm:${n.realm}`) ?? -1 : -1;
    if (n.owner === target) continue;
    const year = Math.max(
      n.founded, owners[n.key]?.at(-1)?.from ?? start, Math.min(end, (n.shieldUntil ?? start - 1) + 1),
      end - HISTORY_STEP * (1 + Math.floor(r() * 4)),
    );
    if (target >= 0) {
      if (n.owner >= 0) ev({ year, kind: 'cession', polity: polities[n.owner].key, other: polities[target].key, place: n.key, x: n.x, y: n.y });
      else if (n.rank !== 'village') ev({ year, kind: 'annexed', polity: polities[target].key, place: n.key, x: n.x, y: n.y });
    }
    setOwner(i, target, year);
  }
  // Today's realms stand with their last ruler still reigning.
  for (const p of polities) {
    if (p.fell !== undefined) continue;
    const last = p.dynasties[p.dynasties.length - 1];
    if (last) { last.to = end; if (last.rulers.length) last.rulers[last.rulers.length - 1].to = end; }
  }

  // ---- names that outlived their language -----------------------------------
  const toponyms: Toponym[] = [];
  for (const n of nodes) {
    if (!n.standing || n.owner < 0) continue;
    const ruler = polities[n.owner];
    if (!ruler.langId || ruler.langId === n.langId) continue;
    const hist = owners[n.key] ?? [];
    let since = hist.length ? hist[hist.length - 1].from : start;
    for (let k = hist.length - 1; k >= 0 && hist[k].polity === ruler.key; k--) since = hist[k].from;
    toponyms.push({ place: n.key, name: n.name, langId: n.langId, rulerLangId: ruler.langId, since, alternative: input.nameIn(ruler.langId, `place:${n.key}`, 'place') });
  }

  // Owners entries in time order (end settlement entries may precede late events).
  for (const k of Object.keys(owners)) owners[k].sort((a, b) => a.from - b.from);
  const founded: Record<string, number> = {};
  for (const n of nodes) if (n.founded > start) founded[n.key] = n.founded;
  events.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
  // Duplicate ids (two identical acts in one step) get a counter.
  const seen = new Map<string, number>();
  for (const e of events) { const c = seen.get(e.id) ?? 0; seen.set(e.id, c + 1); if (c) e.id = `${e.id}#${c}`; }
  ruins.sort((a, b) => a.fell - b.fell || a.ruin.localeCompare(b.ruin));

  return {
    settings, startYear: start, endYear: end, step: HISTORY_STEP,
    polities: polities.map(({ fallBy: _f, standUntil: _s, reignEnd: _r, lostWarAt: _l, alive: _a, ...p }) => { void _f; void _s; void _r; void _l; void _a; return p; }),
    owners, founded, events, ruins, toponyms, notes,
  };
}

/** Who held a place in `year` ('' = nobody, undefined = not yet founded or already ruined). */
export function ownerAt(history: WorldHistory, place: string, year: number): string | undefined {
  const founded = history.founded[place] ?? history.startYear;
  if (year < founded) return undefined;
  const ruin = history.ruins.find((r) => r.ruin === place);
  if (ruin && year >= ruin.fell) return undefined;
  const hist = history.owners[place];
  if (!hist?.length) return '';
  let out = '';
  for (const h of hist) { if (h.from <= year) out = h.polity; else break; }
  return out;
}

/** Realms standing in `year`. */
export function politiesAt(history: WorldHistory, year: number): Polity[] {
  return history.polities.filter((p) => p.founded <= year && (p.fell === undefined || p.fell > year));
}
