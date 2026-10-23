import type { Pt, WorldEdit } from './edits';

/**
 * Zones: named areas the author draws on a generated world — a march, a
 * cursed wood, the hunting grounds of a clan, the start of a campaign — free
 * of the realms' politics and of the ground underneath. Stored as world edits
 * (undoable, era-scoped, travelling with the world): a `zone` edit is the
 * whole record of one zone under its id (a later one replaces it), a
 * `zoneRemove` takes it off. They change nothing in the world itself.
 */
export const ZONE_PATTERNS = ['outline', 'wash', 'hatch'] as const;
export type ZonePattern = (typeof ZONE_PATTERNS)[number];
export const ZONE_NAME_MAX = 80;
export const ZONE_POINTS = { min: 3, max: 400 } as const;
/** The colours offered for a zone, and the default. */
export const ZONE_COLORS = ['#b8432f', '#2f6db3', '#3d8b5a', '#8a5a2b', '#7b3fa0', '#c08a1e', '#2a2a2a'] as const;

export interface WorldZone {
  id: string;
  name: string;
  /** The outline, in world cells (continuous; a cell centre is n + 0.5), going round once. */
  pts: Pt[];
  color: string;
  pattern: ZonePattern;
  /** 0.05–1: how strongly it is drawn. */
  opacity?: number;
}

/** Validate and tidy one record; throws with a readable message. */
export function normalizeZone(input: unknown): WorldZone {
  if (!input || typeof input !== 'object') throw new Error('A zone must be an object.');
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 80) throw new Error('id must be a short non-empty string.');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > ZONE_NAME_MAX) throw new Error(`name must be 1-${ZONE_NAME_MAX} characters.`);
  if (!Array.isArray(raw.pts) || raw.pts.length < ZONE_POINTS.min || raw.pts.length > ZONE_POINTS.max
    || !raw.pts.every((p) => !!p && typeof p === 'object' && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y))) {
    throw new Error(`pts must be ${ZONE_POINTS.min}-${ZONE_POINTS.max} points {x, y} in world cells.`);
  }
  if (raw.color !== undefined && !(typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color))) throw new Error('color must be #RRGGBB.');
  if (raw.pattern !== undefined && !ZONE_PATTERNS.includes(raw.pattern as ZonePattern)) throw new Error(`pattern must be one of ${ZONE_PATTERNS.join(', ')}.`);
  if (raw.opacity !== undefined && !(typeof raw.opacity === 'number' && raw.opacity >= 0.05 && raw.opacity <= 1)) throw new Error('opacity must be from 0.05 to 1.');
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    pts: (raw.pts as Pt[]).map((p) => ({ x: Math.round(p.x * 64) / 64, y: Math.round(p.y * 64) / 64 })),
    color: typeof raw.color === 'string' ? raw.color.toLowerCase() : ZONE_COLORS[0],
    pattern: (raw.pattern as ZonePattern | undefined) ?? 'wash',
    ...(typeof raw.opacity === 'number' ? { opacity: Math.round(raw.opacity * 100) / 100 } : {}),
  };
}

/** The zones a list of edits leaves, in the order they were first drawn. */
export function zonesFrom(edits: readonly WorldEdit[]): WorldZone[] {
  const byId = new Map<string, WorldZone>();
  for (const edit of edits) {
    if (edit.kind === 'zone') {
      const { kind: _kind, ...record } = edit;
      void _kind;
      byId.set(record.id, record);
    } else if (edit.kind === 'zoneRemove') {
      byId.delete(edit.id);
    }
  }
  return [...byId.values()];
}

/** The outline laid out without a jump at the date line: each point the wrapped branch nearest the one before. */
export function unwrapRing(pts: readonly Pt[], W: number): Pt[] {
  const out: Pt[] = [];
  let prev = pts[0]?.x ?? 0;
  for (const p of pts) {
    let x = p.x;
    while (x - prev > W / 2) x -= W;
    while (x - prev < -W / 2) x += W;
    prev = x;
    out.push({ x, y: p.y });
  }
  return out;
}

/** Area in cells and the label anchor (the centroid of the outline), unwrapped. */
export function zoneShape(zone: Pick<WorldZone, 'pts'>, W: number): { cells: number; cx: number; cy: number } {
  const ring = unwrapRing(zone.pts, W);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const mx = ring.reduce((s, p) => s + p.x, 0) / ring.length, my = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    return { cells: 0, cx: ((mx % W) + W) % W, cy: my };
  }
  cx /= 3 * a; cy /= 3 * a;
  return { cells: Math.abs(a) / 2, cx: ((cx % W) + W) % W, cy };
}

/** Whether a point (cells) lies inside a zone, across the date line too. */
export function zoneContains(zone: Pick<WorldZone, 'pts'>, W: number, x: number, y: number): boolean {
  const ring = unwrapRing(zone.pts, W);
  let px = x;
  const mid = ring.reduce((s, p) => s + p.x, 0) / ring.length;
  while (px - mid > W / 2) px -= W;
  while (px - mid < -W / 2) px += W;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && px < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
