// ============================================
// Regional sheet — The lane network
// ============================================
// Roads on a world map are abstractions: a line between two cities that says
// "there is a way". At regional scale the way itself is the subject, and it has
// to obey the things that actually shaped it — the contour, the ford, the dry
// ridge across the marsh, and above all the fact that a new track joins an old
// one at the first opportunity rather than running beside it.
//
// That last property is the whole design. Each place is routed to the NETWORK,
// not to another place, and every path found is added to the network at a
// steep discount. The result builds itself: farms feed hamlets, hamlets feed
// villages, villages feed the highway, and the highway crosses the river once,
// at the place everything else has already decided is the crossing.

import { chaikin } from './terrain';
import { SphereNoise } from '../core/noise';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { Cover, type RegionParams, type RegionPlace, type RegionStream, type RegionTrack, type TrackKind } from './types';
import type { RegionGeometry, TerrainFields } from './terrain';
import type { SiteFields } from './places';
import { materializeRegionPlace } from './identity';

/** How hard the ground is to make a way over, per unit distance. */
const COVER_COST: Partial<Record<number, number>> = {
  [Cover.Marsh]: 7.5, [Cover.Moor]: 2.2, [Cover.Scree]: 5.5, [Cover.Rock]: 6,
  [Cover.Snow]: 9, [Cover.Dune]: 6.5, [Cover.Waste]: 1.7, [Cover.Wood]: 1.8,
  [Cover.Coppice]: 1.4, [Cover.Scrub]: 1.3, [Cover.Heath]: 1.1, [Cover.Beach]: 1.5,
  [Cover.Arable]: 1.05, [Cover.Pasture]: 1, [Cover.Grass]: 1, [Cover.Meadow]: 1.25,
  [Cover.Orchard]: 1.15, [Cover.Vineyard]: 1.2,
};

class Heap {
  private key: Float64Array;
  private val: Int32Array;
  private n = 0;
  constructor(cap: number) {
    this.key = new Float64Array(cap);
    this.val = new Int32Array(cap);
  }
  get size(): number { return this.n; }
  clear(): void { this.n = 0; }
  push(k: number, v: number): void {
    if (this.n >= this.key.length) {
      const nk = new Float64Array(this.key.length * 2);
      const nv = new Int32Array(this.val.length * 2);
      nk.set(this.key); nv.set(this.val);
      this.key = nk; this.val = nv;
    }
    let i = this.n++;
    this.key[i] = k; this.val[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      const tk = this.key[p]; this.key[p] = this.key[i]; this.key[i] = tk;
      const tv = this.val[p]; this.val[p] = this.val[i]; this.val[i] = tv;
      i = p;
    }
  }
  pop(): number {
    const top = this.val[0];
    this.n--;
    if (this.n > 0) {
      this.key[0] = this.key[this.n]; this.val[0] = this.val[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.key[l] < this.key[m]) m = l;
        if (r < this.n && this.key[r] < this.key[m]) m = r;
        if (m === i) break;
        const tk = this.key[m]; this.key[m] = this.key[i]; this.key[i] = tk;
        const tv = this.val[m]; this.val[m] = this.val[i]; this.val[i] = tv;
        i = m;
      }
    }
    return top;
  }
  peekKey(): number { return this.key[0]; }
}

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

export function buildTracks(
  world: WorldData,
  geo: HumanGeography,
  g: RegionGeometry,
  t: TerrainFields,
  cover: Uint8Array,
  places: RegionPlace[],
  streams: RegionStream[],
  site: SiteFields,
  params: RegionParams,
): RegionTrack[] {
  const W = g.width, H = g.height;
  const S = W > 480 ? 2 : 1;               // routing stride
  const RW = Math.ceil(W / S), RH = Math.ceil(H / S);
  const RN = RW * RH;
  const tracks: RegionTrack[] = [];

  // ---- terrain cost on the routing grid ------------------------------------
  const cost = new Float32Array(RN);
  const cellM = g.metresPerCell * S;
  const km2Cell = Math.pow(g.metresPerCell / 1000, 2);
  // Coherent noise on the going, at about a kilometre. Real ways bend around
  // things no map records — a boggy patch, a bad landlord, an old boundary —
  // and on genuinely flat ground a pure least-cost route is a dead straight
  // line from edge to edge, which is the one thing a medieval road never is.
  const going = new SphereNoise(world.params.seed, 'region-going');
  const fGoing = (2 * Math.PI * 6371) / 1.1;
  for (let ry = 0; ry < RH; ry++) {
    for (let rx = 0; rx < RW; rx++) {
      const x = Math.min(W - 1, rx * S), y = Math.min(H - 1, ry * S);
      const i = y * W + x;
      const wx = g.originX + x * g.worldPerCellX;
      const wy = g.originY + y * g.worldPerCellY;
      const gu = ((wx / world.width) % 1 + 1) % 1;
      const gv = Math.min(1, Math.max(0, wy / world.height));
      if (t.water[i] !== 0) { cost[ry * RW + rx] = Infinity; continue; }
      const base = COVER_COST[cover[i]] ?? 1.3;
      // Slope: cheap up to a gentle grade, then punishing. A track will happily
      // go a long way round rather than climb 1-in-4, which is why real roads
      // follow contours and generated ones look like they were fired from a bow.
      const s = t.slope[i];
      const grade = s < 0.05 ? 1 : s < 0.12 ? 1.25 : s < 0.2 ? 2.1 : s < 0.32 ? 4.5 : 11;
      // Crossing running water costs a bridge, priced by the actual catchment
      // rather than by rank on this sheet — otherwise the widest brook on a dry
      // sheet is priced like the Danube and every lane detours round it.
      const areaKm2 = t.accum[i] * km2Cell;
      const ford = areaKm2 > 2.5 ? 3 + Math.min(85, areaKm2 * 0.4) : 0;
      const wet = t.wet[i] > 0.8 ? 3 : 1;
      const going1 = 1 + going.fbm(gu, gv, fGoing, 3, 2.1, 0.5) * 0.42;
      cost[ry * RW + rx] = base * grade * wet * going1 + ford;
    }
  }

  const network = new Uint8Array(RN);
  const inNet = (rx: number, ry: number) => network[ry * RW + rx] === 1;
  const markNet = (rx: number, ry: number) => {
    if (rx >= 0 && rx < RW && ry >= 0 && ry < RH) network[ry * RW + rx] = 1;
  };

  // ---- the world's roads, clipped ------------------------------------------
  const WW = world.width;
  const toSheet = (wx: number, wy: number) => {
    let dx = wx - g.originX;
    while (dx < -WW / 2) dx += WW;
    while (dx > WW / 2) dx -= WW;
    return { x: dx / g.worldPerCellX, y: (wy - g.originY) / g.worldPerCellY };
  };
  const M = 4;
  for (const r of geo.roads) {
    const pts: { x: number; y: number }[] = [];
    let any = false;
    for (const c of r.cells) {
      const p = toSheet(c % WW, (c / WW) | 0);
      pts.push(p);
      if (p.x > -M && p.x < W + M && p.y > -M && p.y < H + M) any = true;
    }
    if (!any || pts.length < 2) continue;
    for (const seg of clipRuns(pts, W, H, 30)) {
      if (seg.length < 2) continue;
      // A world road is a straight line between two cells 20 km apart. Re-route
      // it over the sheet's own terrain so it arrives at the same places by a
      // way that actually exists.
      const route = drapeRoad(seg, cost, RW, RH, S, W, H);
      if (route.length < 2) continue;
      for (const p of route) markNet(Math.round(p.x / S), Math.round(p.y / S));
      tracks.push({
        kind: 'road',
        pts: chaikin(route, 2),
        exits: exitsOf(route, W, H),
        name: r.major ? 'camino real' : undefined,
      });
    }
  }

  // If the sheet has no highway at all, the biggest place is still the hub —
  // otherwise every hamlet routes to nothing and the sheet has no lanes.
  if (!tracks.length) {
    const hub = [...places].filter((p) => p.kind !== 'ruin')
      .sort((a, b) => b.importance - a.importance)[0];
    if (hub) markNet(Math.round(hub.x / S), Math.round(hub.y / S));
  }

  // ---- everything else routes to the network -------------------------------
  const dist = new Float32Array(RN);
  const prev = new Int32Array(RN);
  const stamp = new Int32Array(RN);
  const heap = new Heap(4096);
  let query = 0;

  const ORDER: Record<string, number> = {
    town: 0, abbey: 1, village: 2, mine: 3, quarry: 3, mill: 4,
    hamlet: 5, inn: 5, tower: 6, farm: 7,
  };
  const routable = places
    .filter((p) => ORDER[p.kind] !== undefined)
    .sort((a, b) => (ORDER[a.kind] - ORDER[b.kind]) || (b.importance - a.importance));

  const KIND_OF: Record<string, TrackKind> = {
    town: 'road', abbey: 'lane', village: 'lane', mill: 'path', hamlet: 'lane',
    farm: 'path', inn: 'lane', tower: 'path', quarry: 'path', mine: 'path',
  };

  for (const place of routable) {
    const sx = Math.min(RW - 1, Math.max(0, Math.round(place.x / S)));
    const sy = Math.min(RH - 1, Math.max(0, Math.round(place.y / S)));
    if (inNet(sx, sy)) continue;
    const start = sy * RW + sx;
    if (!isFinite(cost[start])) { markNet(sx, sy); continue; }

    query++;
    heap.clear();
    dist[start] = 0; prev[start] = -1; stamp[start] = query;
    heap.push(0, start);

    // A farm does not justify a five-league lane; a town does. Capping the
    // search by budget rather than by node count keeps the rule geographic.
    const budgetKm = place.kind === 'farm' ? 3.5 : place.kind === 'hamlet' ? 7 : 22;
    const budget = (budgetKm * 1000) / cellM * 3.5;
    let hit = -1;
    let expanded = 0;
    while (heap.size > 0) {
      const i = heap.pop();
      if (dist[i] > budget || expanded++ > 60000) break;
      if (network[i] === 1) { hit = i; break; }
      const x = i % RW, y = (i / RW) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || nx >= RW || ny < 0 || ny >= RH) continue;
        const j = ny * RW + nx;
        const c = cost[j];
        if (!isFinite(c)) continue;
        const len = (k & 1) ? Math.SQRT2 : 1;
        const nd = dist[i] + c * len;
        if (stamp[j] !== query || nd < dist[j]) {
          stamp[j] = query; dist[j] = nd; prev[j] = i;
          heap.push(nd, j);
        }
      }
    }
    if (hit < 0) continue;

    const path: { x: number; y: number }[] = [];
    for (let i = hit; i >= 0; i = prev[i]) {
      path.push({ x: (i % RW) * S + S / 2, y: ((i / RW) | 0) * S + S / 2 });
      if (prev[i] === -1) break;
    }
    path.reverse();
    if (path.length < 2) continue;
    for (const p of path) {
      const rx = Math.round(p.x / S), ry = Math.round(p.y / S);
      markNet(rx, ry);
      // Reusing an existing way is nearly free, which is what makes lanes merge
      // into a trunk instead of running side by side across the parish.
      if (rx >= 0 && rx < RW && ry >= 0 && ry < RH) cost[ry * RW + rx] = Math.min(cost[ry * RW + rx], 0.22);
    }
    tracks.push({
      kind: KIND_OF[place.kind] ?? 'path',
      pts: chaikin(path, 2),
      exits: exitsOf(path, W, H),
    });
  }

  // ---- bridges and fords ---------------------------------------------------
  addCrossings(tracks, streams, places, g, t, world.width);
  void site;
  void params;
  return tracks;
}

/** Split a polyline into the runs that lie inside the sheet (with slack). */
function clipRuns(
  pts: { x: number; y: number }[], W: number, H: number, slack: number,
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of pts) {
    const inside = p.x > -slack && p.x < W + slack && p.y > -slack && p.y < H + slack;
    if (inside) cur.push(p);
    else if (cur.length) { cur.push(p); out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Lay a world road onto the sheet's terrain.
 *
 * The world's road is a sequence of waypoints 20 km apart. Joining them with
 * straight lines puts the highway through cliffs and across rivers at random,
 * so each consecutive pair is re-routed by least cost — the waypoints are
 * treated as places the road is known to visit, not as the road itself.
 */
function drapeRoad(
  way: { x: number; y: number }[], cost: Float32Array, RW: number, RH: number,
  S: number, W: number, H: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dist = new Float32Array(RW * RH);
  const prev = new Int32Array(RW * RH);
  const stamp = new Int32Array(RW * RH);
  const heap = new Heap(4096);
  let query = 0;
  const clampNode = (p: { x: number; y: number }) => {
    const rx = Math.min(RW - 1, Math.max(0, Math.round(p.x / S)));
    const ry = Math.min(RH - 1, Math.max(0, Math.round(p.y / S)));
    return ry * RW + rx;
  };
  for (let k = 0; k < way.length - 1; k++) {
    const a = clampNode(way[k]), b = clampNode(way[k + 1]);
    if (a === b) continue;
    if (!isFinite(cost[a]) || !isFinite(cost[b])) {
      // A leg that starts or ends in water is a ferry; draw it straight.
      out.push(way[k], way[k + 1]);
      continue;
    }
    query++;
    heap.clear();
    dist[a] = 0; prev[a] = -1; stamp[a] = query;
    heap.push(0, a);
    const bx = b % RW, by = (b / RW) | 0;
    let found = false;
    let expanded = 0;
    while (heap.size > 0) {
      const i = heap.pop();
      if (i === b) { found = true; break; }
      if (expanded++ > 90000) break;
      const x = i % RW, y = (i / RW) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX8[d], ny = y + DY8[d];
        if (nx < 0 || nx >= RW || ny < 0 || ny >= RH) continue;
        const j = ny * RW + nx;
        const c = cost[j];
        if (!isFinite(c)) continue;
        const len = (d & 1) ? Math.SQRT2 : 1;
        const nd = dist[i] + c * len;
        if (stamp[j] !== query || nd < dist[j]) {
          stamp[j] = query; dist[j] = nd; prev[j] = i;
          // A* with an admissible heuristic: the cheapest ground is ~1 per step.
          heap.push(nd + Math.hypot(nx - bx, ny - by) * 0.95, j);
        }
      }
    }
    if (!found) { out.push(way[k], way[k + 1]); continue; }
    const seg: { x: number; y: number }[] = [];
    for (let i = b; i >= 0; i = prev[i]) {
      seg.push({ x: (i % RW) * S + S / 2, y: ((i / RW) | 0) * S + S / 2 });
      if (prev[i] === -1) break;
    }
    seg.reverse();
    for (const s of seg) out.push(s);
  }
  void W; void H;
  return dedupe(out);
}

function dedupe(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

function exitsOf(pts: { x: number; y: number }[], W: number, H: number): ('n' | 's' | 'e' | 'w')[] {
  const out = new Set<'n' | 's' | 'e' | 'w'>();
  for (const p of [pts[0], pts[pts.length - 1]]) {
    if (p.x < 3) out.add('w');
    else if (p.x > W - 3) out.add('e');
    else if (p.y < 3) out.add('n');
    else if (p.y > H - 3) out.add('s');
  }
  return [...out];
}

/**
 * Wherever a way meets running water there is a bridge or a ford, and which one
 * it is depends on how much water — which is the sort of detail that makes a
 * map answer questions instead of just decorating a wall.
 */
function addCrossings(
  tracks: RegionTrack[], streams: RegionStream[], places: RegionPlace[],
  g: RegionGeometry, t: TerrainFields, worldWidth: number,
): void {
  const W = g.width, H = g.height;
  const cellKm = g.metresPerCell / 1000;
  let id = places.reduce((m, p) => Math.max(m, p.id), 0) + 1;

  // A bridge is a named place, and a named place has to be worth naming. Only
  // real watercourses get one: a lane stepping over a two-metre brook is not a
  // ford, it is just a lane, and treating it as one produced a hundred and
  // ninety "Vado de …" labels on a single sheet.
  const worthy = streams.filter((s) => s.areaKm2 >= 24);
  if (!worthy.length || !tracks.length) return;

  // Spatial hash over the stream segments. Without it this is
  // O(tracks × points × streams × points) — 1.6 billion segment tests on a
  // busy sheet, which was ten of the fifteen seconds a sheet used to take.
  const CELL = 6;
  const gw = Math.ceil(W / CELL) + 1, gh = Math.ceil(H / CELL) + 1;
  const buckets: number[][] = new Array(gw * gh);
  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; s: RegionStream }[] = [];
  for (const s of worthy) {
    for (let k = 1; k < s.pts.length; k++) {
      const a = s.pts[k - 1], b = s.pts[k];
      const si = segs.length;
      segs.push({ a, b, s });
      const x0 = Math.max(0, Math.min(gw - 1, Math.floor(Math.min(a.x, b.x) / CELL)));
      const x1 = Math.max(0, Math.min(gw - 1, Math.floor(Math.max(a.x, b.x) / CELL)));
      const y0 = Math.max(0, Math.min(gh - 1, Math.floor(Math.min(a.y, b.y) / CELL)));
      const y1 = Math.max(0, Math.min(gh - 1, Math.floor(Math.max(a.y, b.y) / CELL)));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const bi = gy * gw + gx;
          (buckets[bi] ?? (buckets[bi] = [])).push(si);
        }
      }
    }
  }

  const taken: { x: number; y: number }[] = [];
  const minGap = Math.max(1.2, 1.6 / cellKm);
  const seenSeg = new Set<number>();

  for (const tr of tracks) {
    if (tr.kind === 'path') continue;
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1], b = tr.pts[i];
      const x0 = Math.max(0, Math.min(gw - 1, Math.floor(Math.min(a.x, b.x) / CELL)));
      const x1 = Math.max(0, Math.min(gw - 1, Math.floor(Math.max(a.x, b.x) / CELL)));
      const y0 = Math.max(0, Math.min(gh - 1, Math.floor(Math.min(a.y, b.y) / CELL)));
      const y1 = Math.max(0, Math.min(gh - 1, Math.floor(Math.max(a.y, b.y) / CELL)));
      seenSeg.clear();
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const list = buckets[gy * gw + gx];
          if (!list) continue;
          for (const si of list) {
            if (seenSeg.has(si)) continue;
            seenSeg.add(si);
            const seg = segs[si];
            const hit = segmentHit(a, b, seg.a, seg.b);
            if (!hit) continue;
            let clash = false;
            for (const q of taken) {
              if ((q.x - hit.x) ** 2 + (q.y - hit.y) ** 2 < minGap * minGap) { clash = true; break; }
            }
            if (clash) continue;
            taken.push(hit);
            const xi = Math.min(W - 1, Math.max(0, Math.round(hit.x)));
            const yi = Math.min(H - 1, Math.max(0, Math.round(hit.y)));
            const flow = t.flow[yi * W + xi];
            const major = tr.kind === 'road';
            const bridge = seg.s.areaKm2 > 140 || (major && seg.s.areaKm2 > 60) || flow > 0.8;
            places.push(materializeRegionPlace({
              id: id++,
              kind: bridge ? 'bridge' : 'ford',
              x: hit.x, y: hit.y,
              name: `${bridge ? 'Puente' : 'Vado'} de ${nearestName(places, hit.x, hit.y)}`,
              importance: bridge ? 0.22 : 0.12,
            }, g, worldWidth));
          }
        }
      }
    }
  }
}

function nearestName(places: RegionPlace[], x: number, y: number): string {
  let best = 'la Vega', bd = Infinity;
  for (const p of places) {
    if (p.kind === 'bridge' || p.kind === 'ford' || p.kind === 'ruin') continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = p.name; }
  }
  return best.replace(/^(Casa|Casal|Alquería|Granja|Cortijo|Majada|Caserío|Venta|Molino|Abadía|Monasterio|Mina|Cantera|Torre|Atalaya|Vigía) de(l)? /i, '');
}

function segmentHit(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): { x: number; y: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const tt = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const uu = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (tt < 0 || tt > 1 || uu < 0 || uu > 1) return null;
  return { x: a.x + r.x * tt, y: a.y + r.y * tt };
}
