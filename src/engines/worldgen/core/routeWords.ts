// ============================================
// World Generator — A journey in words
// ============================================
// What a writer asks of a route once it is planned: which towns it passes and
// how far along, which roads it follows (named after the towns they join),
// what time of day each stretch is walked, when the party sets off and makes
// camp, and when it arrives. Pure: the route and the geography in, plain data
// out; the panel and the bridge put it into words.

import { coordinateDistance, type Route, type TravelGeography } from './travel';
import type { WorldData } from './types';

export type DayPart = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night';
export const DAY_PARTS: DayPart[] = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'];
/** When a party sets off unless the author says otherwise. */
export const DEFAULT_SET_OFF_HOUR = 7;
export const SET_OFF_RANGE = { min: 0, max: 23 } as const;

/** The part of the day an hour falls in (hours past 24 wrap). */
export function dayPart(hour: number): DayPart {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 14) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'dusk';
  return 'night';
}

export interface JourneyClock {
  /** 1 for the first day on the road (rest days not counted). */
  day: number;
  /** Clock hour, set-off hour plus the hours on the move that day. */
  hour: number;
  part: DayPart;
}

/**
 * Where the clock stands after `travelHours` on the move, each day starting at
 * `setOffHour` and lasting `hoursPerDay`. `ending` puts a moment that falls
 * exactly on a day's end at the end of that day rather than the start of the next.
 */
export function clockAt(travelHours: number, hoursPerDay: number, setOffHour = DEFAULT_SET_OFF_HOUR, ending = false): JourneyClock {
  const perDay = hoursPerDay > 0 ? hoursPerDay : 1;
  const h = Math.max(0, travelHours);
  let index = Math.floor(h / perDay + 1e-9);
  if (ending && index > 0 && Math.abs(h - index * perDay) < 1e-6) index -= 1;
  const hour = setOffHour + (h - index * perDay);
  return { day: index + 1, hour, part: dayPart(hour) };
}

/** "07:30" for 7.5. */
export function clockText(hour: number): string {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The clock at the start of each terrain leg of the route. */
export function legClocks(route: Pick<Route, 'legs'>, hoursPerDay: number, setOffHour = DEFAULT_SET_OFF_HOUR): JourneyClock[] {
  let acc = 0;
  return route.legs.map((leg) => { const at = clockAt(acc, hoursPerDay, setOffHour); acc += leg.hours; return at; });
}

export interface PassedPlace {
  name: string;
  rank: string;
  /** Kilometres from the start where the route comes closest. */
  atKm: number;
  /** How far off the route it lies. */
  offKm: number;
}

type World = Pick<WorldData, 'width' | 'height'>;

/** Kilometres from the start at each cell of the route, scaled to the route's own length. */
function alongKm(world: World, route: Pick<Route, 'cells' | 'km'>, radiusKm: number): number[] {
  const W = world.width, cells = route.cells;
  const out = new Array<number>(cells.length).fill(0);
  for (let k = 1; k < cells.length; k++) {
    out[k] = out[k - 1] + coordinateDistance(world as WorldData, cells[k - 1] % W, Math.floor(cells[k - 1] / W), cells[k] % W, Math.floor(cells[k] / W), radiusKm);
  }
  const total = out[out.length - 1] || 0;
  if (total > 0 && route.km > 0) for (let k = 0; k < out.length; k++) out[k] *= route.km / total;
  return out;
}

/**
 * The towns the route passes, in the order it reaches them, with where along
 * the way and how far off it each lies. The towns at either end are left out;
 * stops on the way are included. Near means within `nearKm` (default: the
 * larger of 10 km and one and a half world cells).
 */
export function placesPassed(
  world: World, geo: Pick<TravelGeography, 'settlements'>, route: Pick<Route, 'cells' | 'km'>,
  /** `ends`: the names of the towns the journey starts and ends at, always left out. */
  options: { nearKm?: number; radiusKm?: number; limit?: number; ends?: readonly string[] } = {},
): PassedPlace[] {
  const W = world.width, cells = route.cells;
  if (cells.length < 2) return [];
  const radius = options.radiusKm ?? 6371;
  const along = alongKm(world, route, radius);
  const cellKm = (2 * Math.PI * radius) / W;
  const near = options.nearKm ?? Math.max(10, cellKm * 1.5);
  const first = cells[0], last = cells[cells.length - 1];
  const out: PassedPlace[] = [];
  for (const s of geo.settlements) {
    const sx = s.x + 0.5, sy = s.y + 0.5;
    let best = Infinity, bestK = -1;
    for (let k = 0; k < cells.length; k++) {
      const d = coordinateDistance(world as WorldData, (cells[k] % W) + 0.5, Math.floor(cells[k] / W) + 0.5, sx, sy, radius);
      if (d < best) { best = d; bestK = k; }
    }
    if (bestK < 0 || best > near) continue;
    // The towns the journey starts and ends at: by name, or within a cell and a
    // half of either end (an itinerary's stop can sit a cell off the town's own).
    if (options.ends?.includes(s.name)) continue;
    const atEnd = (cell: number) => coordinateDistance(world as WorldData, (cell % W) + 0.5, Math.floor(cell / W) + 0.5, sx, sy, radius) <= cellKm * 1.5;
    if (atEnd(first) || atEnd(last)) continue;
    out.push({ name: s.name, rank: s.rank, atKm: along[bestK], offKm: best });
  }
  out.sort((a, b) => a.atKm - b.atKm);
  return options.limit ? out.slice(0, options.limit) : out;
}

export interface RoadTaken {
  /** The towns at its two ends, west to east as drawn; one name when both ends are the same town. */
  from: string;
  to: string;
  /** Kilometres of the route on it. */
  km: number;
}

/**
 * The made roads the route follows for a stretch, in the order it joins them,
 * each named after the towns nearest its two ends ("the road from A to B").
 * Roads the route only touches (under `minCells` cells) are left out.
 */
export function roadsTaken(
  world: World, geo: Pick<TravelGeography, 'roads' | 'settlements'>, route: Pick<Route, 'cells' | 'km'>,
  options: { minCells?: number; radiusKm?: number } = {},
): RoadTaken[] {
  const W = world.width, cells = route.cells;
  if (cells.length < 2 || !geo.settlements.length) return [];
  const radius = options.radiusKm ?? 6371;
  const along = alongKm(world, route, radius);
  const position = new Map<number, number>();
  cells.forEach((cell, k) => { if (!position.has(cell)) position.set(cell, k); });
  const nearestTown = (cell: number) => {
    const x = (cell % W) + 0.5, y = Math.floor(cell / W) + 0.5;
    let best = geo.settlements[0], bestD = Infinity;
    for (const s of geo.settlements) {
      const d = coordinateDistance(world as WorldData, x, y, s.x + 0.5, s.y + 0.5, radius);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best.name;
  };
  const found: { firstK: number; road: RoadTaken }[] = [];
  for (const road of geo.roads) {
    if (road.cells.length < 2) continue;
    const ks: number[] = [];
    for (const cell of road.cells) { const k = position.get(cell); if (k !== undefined) ks.push(k); }
    if (ks.length < (options.minCells ?? 3)) continue;
    ks.sort((a, b) => a - b);
    let km = 0;
    for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] === 1) km += along[ks[i]] - along[ks[i - 1]];
    if (km <= 0) continue;
    const a = nearestTown(road.cells[0]), b = nearestTown(road.cells[road.cells.length - 1]);
    found.push({ firstK: ks[0], road: { from: a, to: b, km } });
  }
  found.sort((p, q) => p.firstK - q.firstK);
  // The same pair of towns twice (a road drawn in pieces) is one road.
  const merged: RoadTaken[] = [];
  for (const { road } of found) {
    const same = merged.find((r) => (r.from === road.from && r.to === road.to) || (r.from === road.to && r.to === road.from));
    if (same) same.km += road.km; else merged.push({ ...road });
  }
  return merged;
}

/** Water as the route's legs name it, in either language. */
const WATER = new Set(['mar', 'lago', 'sea', 'lake']);
export function isWaterLeg(leg: { terrain: string }): boolean { return WATER.has(leg.terrain); }

/** Kilometres of the route on water (sea or lake). */
export function kmOnWater(route: Pick<Route, 'legs'>): number {
  return route.legs.reduce((sum, leg) => sum + (isWaterLeg(leg) ? leg.km : 0), 0);
}

/** The different grounds crossed off-road and on land, in order of first meeting, at most `limit`. */
export function groundsCrossed(route: Pick<Route, 'legs'>, limit = 3): string[] {
  const out: string[] = [];
  for (const leg of route.legs) {
    if (leg.onRoad || isWaterLeg(leg) || out.includes(leg.terrain)) continue;
    out.push(leg.terrain);
    if (out.length >= limit) break;
  }
  return out;
}
