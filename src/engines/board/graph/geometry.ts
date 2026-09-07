// ============================================
// Board Engine — Edge geometry
// ============================================
//
// Every edge on the board is drawn by this module, including the two shapes
// React Flow cannot express natively:
//
//   • hyper-edges   — many sources and/or many targets meeting at a hub, so
//                     "the storm AND the letter cause the shipwreck" is one
//                     statement rather than two unrelated lines.
//   • edge-to-edge  — an endpoint that is another edge, so you can say "this
//                     alliance exists *because of* that betrayal".
//
// Because an edge anchored on an edge needs that edge's midpoint, resolution
// is done in passes: everything grounded in nodes resolves first, then edges
// that depend on those, and so on. Cycles are detected and fall back to the
// node endpoints they do have, so a malformed board still draws.

import type { BoardBox, BoardEdge, BoardEndpoint, BoardNode, BoardPoint, BoardSide } from '../types';

export interface EdgeLeg {
  /** SVG path data in flow coordinates. */
  d: string;
  start: BoardPoint;
  end: BoardPoint;
  /** A point on the visible path, used by labels and relation anchors. */
  mid?: BoardPoint;
  /** Tangent angle in degrees at `start`, pointing away from the path. */
  startAngle: number;
  /** Tangent angle in degrees at `end`, pointing along the path. */
  endAngle: number;
  /** Which side of the relation this leg belongs to. */
  side: 'source' | 'target';
  endpointId: string;
}

export interface EdgeGeometry {
  legs: EdgeLeg[];
  /** Meeting point for hyper-edges; undefined for a plain two-ended edge. */
  hub?: BoardPoint;
  /** Where the label and the edge-to-edge anchor sit. */
  mid: BoardPoint;
  /** True when the edge has exactly one source and one target. */
  simple: boolean;
}

const MAX_PASSES = 8;
const ARROW_GAP = 3;

export function boxOfNode(node: BoardNode): BoardBox {
  return {
    x: node.position.x,
    y: node.position.y,
    width: Math.max(1, node.size?.width ?? 1),
    height: Math.max(1, node.size?.height ?? 1),
  };
}

export function centerOfBox(box: BoardBox): BoardPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Point where the ray from the box centre towards `towards` leaves the box.
 * Used so lines stop at the card border instead of burrowing into the middle.
 */
export function clipToBox(box: BoardBox, towards: BoardPoint, pad = ARROW_GAP): BoardPoint {
  const c = centerOfBox(box);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return c;

  const hw = box.width / 2 + pad;
  const hh = box.height / 2 + pad;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function angleBetween(from: BoardPoint, to: BoardPoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function midOf(a: BoardPoint, b: BoardPoint): BoardPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centroid(points: BoardPoint[]): BoardPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

function straightPath(a: BoardPoint, b: BoardPoint): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

/**
 * Quadratic curve bowed perpendicular to the chord. `bend` is a signed
 * multiplier so parallel edges between the same pair fan out instead of
 * stacking on top of each other.
 */
function curvedPath(a: BoardPoint, b: BoardPoint, bend: number): { d: string; control: BoardPoint } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.min(120, length * 0.22) * bend;
  const control = {
    x: (a.x + b.x) / 2 - (dy / length) * offset,
    y: (a.y + b.y) / 2 + (dx / length) * offset,
  };
  return { d: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`, control };
}

/** Orthogonal routing with rounded corners — the "step" curvature. */
function stepPath(a: BoardPoint, b: BoardPoint): string {
  const midX = (a.x + b.x) / 2;
  const r = Math.min(12, Math.abs(b.y - a.y) / 2, Math.abs(midX - a.x) || 12);
  if (r < 2) return straightPath(a, b);
  const dirY = b.y > a.y ? 1 : -1;
  const dirX = midX > a.x ? 1 : -1;
  return [
    `M ${a.x} ${a.y}`,
    `L ${midX - r * dirX} ${a.y}`,
    `Q ${midX} ${a.y} ${midX} ${a.y + r * dirY}`,
    `L ${midX} ${b.y - r * dirY}`,
    `Q ${midX} ${b.y} ${midX + r * dirX} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(' ');
}

function arcPath(a: BoardPoint, b: BoardPoint, bend: number): string {
  const radius = Math.hypot(b.x - a.x, b.y - a.y) * 0.75 || 1;
  const sweep = bend >= 0 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 ${sweep} ${b.x} ${b.y}`;
}

/** Self-loop drawn as a teardrop above the node. */
function loopPath(box: BoardBox, bend: number): { d: string; mid: BoardPoint; start: BoardPoint; end: BoardPoint; startAngle: number; endAngle: number } {
  const c = centerOfBox(box);
  const r = 30 + Math.abs(bend) * 14;
  const start = { x: c.x - box.width * 0.2, y: box.y - ARROW_GAP };
  const end = { x: c.x + box.width * 0.2, y: box.y - ARROW_GAP };
  const top = { x: c.x, y: box.y - r * 2 };
  return {
    d: `M ${start.x} ${start.y} C ${start.x - r} ${top.y} ${end.x + r} ${top.y} ${end.x} ${end.y}`,
    mid: { x: c.x, y: (start.y + 6 * top.y + end.y) / 8 },
    start,
    end,
    startAngle: angleBetween({ x: start.x - r, y: top.y }, start),
    endAngle: angleBetween({ x: end.x + r, y: top.y }, end),
  };
}

// ---------------------------------------------------------------------------
// Bundling — keep parallel relations legible
// ---------------------------------------------------------------------------

function pairKey(edge: BoardEdge): string {
  const a = edge.sources.map((s) => s.id).sort().join('+');
  const b = edge.targets.map((t) => t.id).sort().join('+');
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Signed fan-out factor per edge so N relations between the same pair spread
 * into N distinct arcs: 0, +1, -1, +2, -2 …
 */
export function computeBends(edges: BoardEdge[]): Map<string, number> {
  const buckets = new Map<string, string[]>();
  for (const edge of edges) {
    const key = pairKey(edge);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(edge.id);
    else buckets.set(key, [edge.id]);
  }
  const bends = new Map<string, number>();
  for (const ids of buckets.values()) {
    if (ids.length === 1) {
      bends.set(ids[0], 0);
      continue;
    }
    ids.forEach((id, index) => {
      const step = Math.ceil((index + 1) / 2);
      bends.set(id, index % 2 === 0 ? step : -step);
    });
  }
  return bends;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface ResolvedAnchor {
  /** Where the line actually meets this endpoint. */
  point: BoardPoint;
  /** Box to clip against when no explicit side was chosen. */
  box?: BoardBox;
  /** Outward unit vector — set only when the author picked a side. */
  normal?: BoardPoint;
  /** True when `point` is final and must not be re-derived from the box. */
  fixed?: boolean;
}

const SIDE_NORMAL: Record<BoardSide, BoardPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Midpoint of one face of a box, nudged clear of the border. */
function sideAnchor(box: BoardBox, side: BoardSide): ResolvedAnchor {
  const normal = SIDE_NORMAL[side];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    point: {
      x: cx + normal.x * (box.width / 2 + ARROW_GAP),
      y: cy + normal.y * (box.height / 2 + ARROW_GAP),
    },
    box,
    normal,
    fixed: true,
  };
}

/**
 * Cubic bezier that leaves each end along its outward normal. This is what
 * makes a thread dropped on the left of a card visibly arrive from the left
 * instead of curving round to whichever face the geometry found closest.
 */
function normalPath(
  a: ResolvedAnchor,
  b: ResolvedAnchor,
  bend: number,
): { d: string; c1: BoardPoint; c2: BoardPoint } {
  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.max(48, Math.min(240, distance * 0.45)) * (1 + Math.abs(bend) * 0.35);
  const na = a.normal ?? { x: 0, y: 0 };
  const nb = b.normal ?? { x: 0, y: 0 };
  // Parallel relations between the same pair still fan out, perpendicular to
  // the chord, so a second thread does not hide underneath the first.
  const ox = distance > 0 ? (-dy / distance) * bend * 26 : 0;
  const oy = distance > 0 ? (dx / distance) * bend * 26 : 0;
  const c1 = { x: a.point.x + na.x * reach + ox, y: a.point.y + na.y * reach + oy };
  const c2 = { x: b.point.x + nb.x * reach + ox, y: b.point.y + nb.y * reach + oy };
  return {
    d: `M ${a.point.x} ${a.point.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.point.x} ${b.point.y}`,
    c1,
    c2,
  };
}

function buildLeg(
  from: ResolvedAnchor,
  to: ResolvedAnchor,
  side: 'source' | 'target',
  endpointId: string,
  curvature: BoardEdge['curvature'],
  bend: number,
): EdgeLeg {
  const a = from.point;
  const b = to.point;

  let d: string;
  let controlForStart: BoardPoint = b;
  let controlForEnd: BoardPoint = a;
  let mid = midOf(a, b);

  if (curvature === 'straight') {
    d = straightPath(a, b);
  } else if (curvature === 'step') {
    d = stepPath(a, b);
    controlForStart = { x: (a.x + b.x) / 2, y: a.y };
    controlForEnd = { x: (a.x + b.x) / 2, y: b.y };
  } else if (from.normal || to.normal) {
    // At least one end is pinned to a face: honour it whatever the curvature
    // preset says. An "arc" that ignored the connector you used would be a
    // decorative lie about where the relation attaches.
    const curve = normalPath(from, to, bend);
    d = curve.d;
    controlForStart = curve.c1;
    controlForEnd = curve.c2;
    mid = { x: (a.x + 3 * curve.c1.x + 3 * curve.c2.x + b.x) / 8, y: (a.y + 3 * curve.c1.y + 3 * curve.c2.y + b.y) / 8 };
  } else if (curvature === 'arc') {
    d = arcPath(a, b, bend);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const radius = distance * 0.75;
    const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - distance * distance / 4));
    const sign = bend >= 0 ? -1 : 1;
    if (distance > 0) mid = { x: mid.x - (b.y - a.y) / distance * sagitta * sign, y: mid.y + (b.x - a.x) / distance * sagitta * sign };
  } else {
    const curve = curvedPath(a, b, bend);
    d = curve.d;
    controlForStart = curve.control;
    controlForEnd = curve.control;
    mid = { x: (a.x + 2 * curve.control.x + b.x) / 4, y: (a.y + 2 * curve.control.y + b.y) / 4 };
  }

  return {
    d,
    start: a,
    end: b,
    mid,
    startAngle: angleBetween(controlForStart, a),
    endAngle: angleBetween(controlForEnd, b),
    side,
    endpointId,
  };
}

function anchorFor(
  endpoint: BoardEndpoint,
  boxes: Map<string, BoardBox>,
  edgeAnchors: Map<string, BoardPoint>,
): ResolvedAnchor | null {
  if (endpoint.on === 'node') {
    const box = boxes.get(endpoint.id);
    if (!box) return null;
    if (endpoint.side) return sideAnchor(box, endpoint.side);
    return { point: centerOfBox(box), box };
  }
  const point = edgeAnchors.get(endpoint.id);
  return point ? { point, fixed: true } : null;
}

/** Pins a free anchor to its border, aiming at whatever it connects to. */
function aim(anchor: ResolvedAnchor, towards: BoardPoint): ResolvedAnchor {
  if (anchor.fixed || !anchor.box) return anchor;
  return { ...anchor, point: clipToBox(anchor.box, towards), fixed: true };
}

/**
 * Computes the drawable geometry of every edge on the board.
 *
 * `boxes` must contain a box for every *visible* node; endpoints pointing at
 * hidden or deleted nodes are dropped, and an edge that loses every endpoint
 * on a side is omitted entirely rather than drawn as a stub.
 */
export function computeEdgeGeometry(
  edges: BoardEdge[],
  boxes: Map<string, BoardBox>,
): Map<string, EdgeGeometry> {
  const bends = computeBends(edges);
  const result = new Map<string, EdgeGeometry>();
  const edgeAnchors = new Map<string, BoardPoint>();
  let pending = edges.slice();

  for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass += 1) {
    const stillPending: BoardEdge[] = [];
    let progressed = false;

    for (const edge of pending) {
      const geometry = tryResolve(edge, boxes, edgeAnchors, bends.get(edge.id) ?? 0, false);
      if (geometry) {
        result.set(edge.id, geometry);
        edgeAnchors.set(edge.id, geometry.mid);
        progressed = true;
      } else {
        stillPending.push(edge);
      }
    }

    pending = stillPending;
    if (!progressed) break;
  }

  // Anything left depends on a cycle of edge-to-edge anchors. Draw it from the
  // endpoints that *are* grounded so the author can see and fix the loop.
  for (const edge of pending) {
    const geometry = tryResolve(edge, boxes, edgeAnchors, bends.get(edge.id) ?? 0, true);
    if (geometry) {
      result.set(edge.id, geometry);
      edgeAnchors.set(edge.id, geometry.mid);
    }
  }

  return result;
}

function tryResolve(
  edge: BoardEdge,
  boxes: Map<string, BoardBox>,
  edgeAnchors: Map<string, BoardPoint>,
  bend: number,
  lenient: boolean,
): EdgeGeometry | null {
  const sources: Array<{ endpoint: BoardEndpoint; anchor: ResolvedAnchor }> = [];
  const targets: Array<{ endpoint: BoardEndpoint; anchor: ResolvedAnchor }> = [];

  for (const endpoint of edge.sources) {
    const anchor = anchorFor(endpoint, boxes, edgeAnchors);
    if (anchor) sources.push({ endpoint, anchor });
    else if (!lenient && endpoint.on === 'edge') return null;
  }
  for (const endpoint of edge.targets) {
    const anchor = anchorFor(endpoint, boxes, edgeAnchors);
    if (anchor) targets.push({ endpoint, anchor });
    else if (!lenient && endpoint.on === 'edge') return null;
  }

  if (sources.length === 0 || targets.length === 0) return null;

  // Self-relation: the same node on both sides.
  if (
    sources.length === 1 &&
    targets.length === 1 &&
    sources[0].endpoint.id === targets[0].endpoint.id &&
    sources[0].anchor.box
  ) {
    const from = sources[0].anchor;
    const to = targets[0].anchor;
    // Two different faces were chosen: bow between them along their normals
    // instead of the generic loop, so the ends stay where they were dropped.
    if (from.normal && to.normal && (from.point.x !== to.point.x || from.point.y !== to.point.y)) {
      const curve = normalPath(from, to, bend === 0 ? 1 : bend);
      return {
        simple: true,
        mid: {
          x: (from.point.x + 3 * curve.c1.x + 3 * curve.c2.x + to.point.x) / 8,
          y: (from.point.y + 3 * curve.c1.y + 3 * curve.c2.y + to.point.y) / 8,
        },
        legs: [{
          d: curve.d,
          start: from.point,
          end: to.point,
          startAngle: angleBetween(curve.c1, from.point),
          endAngle: angleBetween(curve.c2, to.point),
          side: 'target',
          endpointId: targets[0].endpoint.id,
        }],
      };
    }
    const loop = loopPath(sources[0].anchor.box, bend);
    return {
      simple: true,
      mid: loop.mid,
      legs: [{
        d: loop.d,
        start: loop.start,
        end: loop.end,
        startAngle: loop.startAngle,
        endAngle: loop.endAngle,
        side: 'target',
        endpointId: targets[0].endpoint.id,
      }],
    };
  }

  // Plain two-ended edge: one leg, face to face.
  if (sources.length === 1 && targets.length === 1) {
    const rawFrom = sources[0].anchor;
    const rawTo = targets[0].anchor;
    const from = aim(rawFrom, rawTo.point);
    const to = aim(rawTo, from.point);
    const leg = buildLeg(from, to, 'source', targets[0].endpoint.id, edge.curvature, bend);
    return { simple: true, mid: leg.mid ?? midOf(leg.start, leg.end), legs: [leg] };
  }

  // Hyper-edge: every endpoint meets at a hub placed at the centroid.
  const hub = centroid([...sources, ...targets].map((entry) => entry.anchor.point));
  const hubAnchor: ResolvedAnchor = { point: hub, fixed: true };
  const legs: EdgeLeg[] = [];
  for (const { endpoint, anchor } of sources) {
    legs.push(buildLeg(aim(anchor, hub), hubAnchor, 'source', endpoint.id, edge.curvature, bend * 0.5));
  }
  for (const { endpoint, anchor } of targets) {
    legs.push({
      ...buildLeg(hubAnchor, aim(anchor, hub), 'source', endpoint.id, edge.curvature, bend * 0.5),
      side: 'target',
    });
  }

  return { simple: false, hub, mid: hub, legs };
}

/** Bounding box of a set of nodes, with padding. Used by fit-to-selection. */
export function boundsOfNodes(nodes: BoardNode[], pad = 40): BoardBox | null {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const box = boxOfNode(node);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
