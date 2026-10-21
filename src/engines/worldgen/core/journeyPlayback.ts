import { HARD_PACE_REST_EVERY, type Route, type RouteStage } from './travel';

/**
 * Where a party is on a planned route at a given moment, and what it is doing.
 *
 * Time runs in days from the start (0) to arrival (`route.days`, rest days
 * included). Each night falls where the planner put it (`route.stages`); between
 * nights the party moves along the route's own cells, so the marker follows the
 * roads and passes the planner chose rather than a straight line. A hard pace
 * spends a whole day resting after every `HARD_PACE_REST_EVERY` days on the move.
 */
export interface TravellerState {
  x: number;
  y: number;
  /** Days since setting off, 0..route.days. */
  day: number;
  /** Days on the move so far (rest days excluded). */
  travelled: number;
  phase: 'start' | 'travel' | 'night' | 'rest' | 'arrived';
  /** The night being spent (or the last one, while resting). */
  stage?: RouteStage;
}

/** Share of a day on the road spent moving; the rest is the night's halt. */
export const MOVING_SHARE = 0.6;

/** Days of rest completed before `t`, and whether `t` falls inside a rest day. */
function restAt(t: number, restDays: number): { done: number; resting: boolean } {
  let done = 0;
  for (let k = 1; k <= restDays; k++) {
    const start = HARD_PACE_REST_EVERY * k + (k - 1);
    if (t <= start) break;
    if (t < start + 1) return { done, resting: true };
    done++;
  }
  return { done, resting: false };
}

/** The index in `cells` nearest to a cell position, searching forward from `from`. */
function cellIndexNear(route: Route, width: number, x: number, y: number, from: number): number {
  let best = from, bestD = Infinity;
  for (let i = from; i < route.cells.length; i++) {
    const cx = route.cells[i] % width, cy = Math.floor(route.cells[i] / width);
    let dx = Math.abs(cx - x); if (dx > width / 2) dx = width - dx;
    const d = dx * dx + (cy - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
    if (d === 0) break;
  }
  return best;
}

/** Anchors along the route: day of travel → cell index. Night n falls after n days on the move. */
export function travelAnchors(route: Route, width: number): { travelled: number; index: number }[] {
  const travelDays = Math.max(0, route.days - (route.restDays ?? 0));
  const anchors = [{ travelled: 0, index: 0 }];
  let from = 0;
  for (const stage of route.stages) {
    if (stage.night >= travelDays) break;
    from = cellIndexNear(route, width, stage.x, stage.y, from);
    anchors.push({ travelled: stage.night, index: from });
  }
  anchors.push({ travelled: travelDays, index: route.cells.length - 1 });
  return anchors;
}

export function travellerAt(route: Route, width: number, day: number, anchors = travelAnchors(route, width)): TravellerState | null {
  if (route.impossible || route.cells.length < 2) return null;
  const t = Math.max(0, Math.min(route.days, day));
  const rest = restAt(t, route.restDays ?? 0);
  const travelDays = anchors[anchors.length - 1].travelled;
  // Each day on the road is spent moving for its first MOVING_SHARE and halted
  // for the night the rest, so the banner visibly stops where each night falls.
  const onRoad = rest.resting ? Math.floor(t) - rest.done : t - rest.done;
  const base = Math.floor(onRoad + 1e-9), u = onRoad - base;
  const halted = !rest.resting && u >= MOVING_SHARE;
  const travelled = Math.min(travelDays, rest.resting ? onRoad : base + Math.min(1, u / MOVING_SHARE));
  let a = anchors[0], b = anchors[anchors.length - 1];
  for (let i = 1; i < anchors.length; i++) { if (anchors[i].travelled >= travelled) { a = anchors[i - 1]; b = anchors[i]; break; } }
  const f = b.travelled > a.travelled ? (travelled - a.travelled) / (b.travelled - a.travelled) : 1;
  const exact = a.index + (b.index - a.index) * f;
  const i0 = Math.floor(exact), i1 = Math.min(route.cells.length - 1, i0 + 1), g = exact - i0;
  const x0 = route.cells[i0] % width, y0 = Math.floor(route.cells[i0] / width);
  let x1 = route.cells[i1] % width; const y1 = Math.floor(route.cells[i1] / width);
  if (x1 - x0 > width / 2) x1 -= width; else if (x0 - x1 > width / 2) x1 += width;
  const x = ((x0 + (x1 - x0) * g) % width + width) % width, y = y0 + (y1 - y0) * g;
  const nightIndex = Math.floor(travelled + 1e-9);
  const stage = route.stages.find((s) => s.night === nightIndex);
  let phase: TravellerState['phase'] = 'travel';
  if (t <= 0) phase = 'start';
  else if (travelled >= travelDays - 1e-9) phase = 'arrived';
  else if (rest.resting) phase = 'rest';
  else if (halted && stage) phase = 'night';
  return { x, y, day: t, travelled, phase, stage: phase === 'night' || phase === 'rest' ? stage ?? route.stages.filter((s) => s.night <= nightIndex).at(-1) : undefined };
}
