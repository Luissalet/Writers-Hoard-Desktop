import type { MapExploration, MapParty, MapPoint, MapTrailStep } from '@/types';

// ============================================================================
// Exploration of a picture map: a coarse raster of explored cells, the party's
// position and its trail. Pure: no DOM, no Dexie. The stored mask is a
// run-length code so a whole map costs a few hundred bytes.
// ============================================================================

/** Cells across the picture; the rows follow the picture's proportions. */
export const EXPLORATION_COLS = 256;
export const EXPLORATION_ROWS_RANGE = { min: 8, max: 1024 } as const;
export const MAX_TRAIL_STEPS = 500;
/** How far the party sees by default: percent of the picture's width. */
export const DEFAULT_SIGHT_RADIUS = 8;
export const SIGHT_RADIUS_RANGE = { min: 0.5, max: 100 } as const;
export const BRUSH_RADIUS_RANGE = { min: 0.5, max: 100 } as const;
export const DEFAULT_BRUSH_RADIUS = 6;
/** Sight radius is not worth storing with more than this many characters of session label. */
export const MAX_SESSION_LENGTH = 60;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const percent = (value: number): number => clamp(value, 0, 100);

/** Rows for a picture of the given height over width; a picture of unknown shape gets 16:10. */
export function explorationRows(aspect: number | undefined): number {
  const ratio = finite(aspect) && aspect > 0 ? aspect : 0.625;
  return clamp(Math.round(EXPLORATION_COLS * ratio), EXPLORATION_ROWS_RANGE.min, EXPLORATION_ROWS_RANGE.max);
}

/** A cell grid, 1 = explored. */
export type MaskCells = Uint8Array;

// --- Run-length code: alternating run lengths (first run = fogged cells, may be 0) as LEB128 varints, base64. ---

export function encodeMask(cells: MaskCells): string {
  const bytes: number[] = [];
  const push = (value: number) => { let rest = value; while (rest >= 0x80) { bytes.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); } bytes.push(rest); };
  let current = 0, run = 0;
  for (let index = 0; index < cells.length; index++) {
    const bit = cells[index] ? 1 : 0;
    if (bit === current) run++;
    else { push(run); current = bit; run = 1; }
  }
  push(run);
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.slice(at, at + 8192));
  return btoa(text);
}

/** The cells of a record; a damaged or mismatched mask reads as fully fogged rather than throwing. */
export function decodeMask(record: Pick<MapExploration, 'cols' | 'rows' | 'mask'>): MaskCells {
  const total = record.cols * record.rows, cells = new Uint8Array(total);
  try {
    const text = atob(record.mask), runs: number[] = [];
    let value = 0, shift = 0;
    for (let index = 0; index < text.length; index++) {
      const byte = text.charCodeAt(index);
      value += (byte & 0x7f) * 2 ** shift;
      if (byte & 0x80) { shift += 7; if (shift > 35) return new Uint8Array(total); continue; }
      runs.push(value); value = 0; shift = 0;
    }
    let at = 0, bit = 0;
    for (const run of runs) {
      if (bit && run > 0) cells.fill(1, at, Math.min(total, at + run));
      at += run; bit = bit ? 0 : 1;
      if (at >= total) break;
    }
  } catch { return new Uint8Array(total); }
  return cells;
}

/** Fill a circle (centre in percent of the picture, radius in percent of its width) with explored (1) or fogged (0); returns how many cells changed. */
export function paintCircle(cells: MaskCells, cols: number, rows: number, x: number, y: number, radius: number, value: 0 | 1): number {
  const cx = percent(x) / 100 * cols, cy = percent(y) / 100 * rows, r = Math.max(0, radius) / 100 * cols;
  const r2 = r * r;
  let changed = 0;
  const minRow = Math.max(0, Math.floor(cy - r)), maxRow = Math.min(rows - 1, Math.ceil(cy + r));
  const minCol = Math.max(0, Math.floor(cx - r)), maxCol = Math.min(cols - 1, Math.ceil(cx + r));
  const home = Math.min(rows - 1, Math.floor(cy)) * cols + Math.min(cols - 1, Math.floor(cx));
  for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
    const dx = col + 0.5 - cx, dy = row + 0.5 - cy, index = row * cols + col;
    if (dx * dx + dy * dy > r2 && index !== home) continue;
    if (cells[index] !== value) { cells[index] = value; changed++; }
  }
  return changed;
}

/** Share of the picture explored, percent with one decimal. */
export function exploredPercent(cells: MaskCells): number {
  if (!cells.length) return 0;
  let count = 0;
  for (const cell of cells) if (cell) count++;
  return Math.round(count / cells.length * 1000) / 10;
}

export function cellRevealed(cells: MaskCells, cols: number, rows: number, x: number, y: number): boolean {
  const col = Math.min(cols - 1, Math.max(0, Math.floor(percent(x) / 100 * cols))), row = Math.min(rows - 1, Math.max(0, Math.floor(percent(y) / 100 * rows)));
  return cells[row * cols + col] === 1;
}

// --- Records ---

export function createExploration(aspect: number | undefined, enabled = true): MapExploration {
  const rows = explorationRows(aspect);
  return { revision: 0, enabled, cols: EXPLORATION_COLS, rows, mask: encodeMask(new Uint8Array(EXPLORATION_COLS * rows)) };
}

export type RevealOp = { op: 'reveal' | 'hide'; x: number; y: number; radius: number } | { op: 'all' | 'none' };

/** The record after some brush operations; the revision always advances. */
export function applyRevealOps(record: MapExploration, ops: readonly RevealOp[]): MapExploration {
  const cells = decodeMask(record);
  for (const op of ops) {
    if (op.op === 'all') cells.fill(1);
    else if (op.op === 'none') cells.fill(0);
    else if (op.op === 'reveal' || op.op === 'hide') paintCircle(cells, record.cols, record.rows, op.x, op.y, op.radius, op.op === 'reveal' ? 1 : 0);
  }
  return { ...record, revision: record.revision + 1, mask: encodeMask(cells) };
}

export interface PartyMove { x: number; y: number; sightRadius?: number; trail?: boolean; session?: string }

/** The record after the party moves: it sees a circle around its new place, and may leave a trail step. */
export function movePartyRecord(record: MapExploration, move: PartyMove, at: number): MapExploration {
  const sightRadius = clamp(move.sightRadius ?? record.party?.sightRadius ?? DEFAULT_SIGHT_RADIUS, SIGHT_RADIUS_RANGE.min, SIGHT_RADIUS_RANGE.max);
  const x = percent(move.x), y = percent(move.y), cells = decodeMask(record);
  paintCircle(cells, record.cols, record.rows, x, y, sightRadius, 1);
  const session = move.session?.trim().slice(0, MAX_SESSION_LENGTH);
  const step: MapTrailStep = { x, y, at, ...(session ? { session } : {}) };
  const trail = move.trail ? [...(record.trail ?? []), step].slice(-MAX_TRAIL_STEPS) : record.trail;
  return { ...record, revision: record.revision + 1, mask: encodeMask(cells), party: { x, y, sightRadius }, ...(trail ? { trail } : {}) };
}

/** What the map editor asks for; applied to the record as it is at write time. */
export type ExplorationIntent =
  | { kind: 'brush'; ops: RevealOp[] }
  | { kind: 'party'; move: PartyMove }
  | { kind: 'enabled'; value: boolean }
  | { kind: 'clear-trail' };

/** The record after an editor intent; a map without a record gets a new one (fog on) first. */
export function applyIntent(current: MapExploration | undefined, aspect: number | undefined, intent: ExplorationIntent, at: number): MapExploration {
  const base = current ?? createExploration(aspect, true);
  if (intent.kind === 'brush') return applyRevealOps(base, intent.ops);
  if (intent.kind === 'party') return movePartyRecord(base, intent.move, at);
  if (intent.kind === 'enabled') return { ...base, revision: base.revision + 1, enabled: intent.value };
  const { trail, ...rest } = base; void trail;
  return { ...rest, revision: base.revision + 1 };
}

/** Sanity-check a stored record (backups and clones carry whatever was on disk); undefined when it cannot be used. */
export function readExploration(raw: unknown): MapExploration | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Partial<MapExploration>;
  const size = (value: unknown) => finite(value) && Number.isInteger(value) && value >= EXPLORATION_ROWS_RANGE.min && value <= EXPLORATION_ROWS_RANGE.max;
  if (!size(record.cols) || !size(record.rows) || typeof record.mask !== 'string' || typeof record.enabled !== 'boolean') return undefined;
  const party = record.party && finite(record.party.x) && finite(record.party.y) ? { x: percent(record.party.x), y: percent(record.party.y), sightRadius: clamp(finite(record.party.sightRadius) ? record.party.sightRadius : DEFAULT_SIGHT_RADIUS, SIGHT_RADIUS_RANGE.min, SIGHT_RADIUS_RANGE.max) } satisfies MapParty : undefined;
  const trail = Array.isArray(record.trail) ? record.trail.filter((step): step is MapTrailStep => !!step && finite(step.x) && finite(step.y) && finite(step.at)).slice(-MAX_TRAIL_STEPS).map(step => ({ x: percent(step.x), y: percent(step.y), at: step.at, ...(typeof step.session === 'string' && step.session ? { session: step.session.slice(0, MAX_SESSION_LENGTH) } : {}) })) : undefined;
  return { revision: finite(record.revision) && record.revision >= 0 ? Math.floor(record.revision) : 0, enabled: record.enabled, cols: record.cols as number, rows: record.rows as number, mask: record.mask, ...(party ? { party } : {}), ...(trail?.length ? { trail } : {}) };
}

// --- What a viewer under fog sees ---

/** A decoded record ready to filter content and to draw. */
export interface MapFog { cols: number; rows: number; cells: MaskCells; party?: MapParty; trail: MapTrailStep[] }

/** The fog to draw for players: null when the map has none or it is switched off. */
export function fogOf(record: unknown): MapFog | null {
  const valid = readExploration(record);
  if (!valid || !valid.enabled) return null;
  return { cols: valid.cols, rows: valid.rows, cells: decodeMask(valid), party: valid.party, trail: valid.trail ?? [] };
}

export const pointRevealed = (fog: MapFog, point: MapPoint): boolean => cellRevealed(fog.cells, fog.cols, fog.rows, point.x, point.y);
/** A pin shows where its spot is explored. */
export const pinRevealed = (fog: MapFog, pin: { position: MapPoint }): boolean => pointRevealed(fog, pin.position);
/** A shape shows while any of its points is explored (a label has one). */
export const shapeRevealed = (fog: MapFog, shape: { points: MapPoint[] }): boolean => shape.points.some(point => pointRevealed(fog, point));

/** Hidden cells as rectangles in cell units, merged across rows where identical. */
export function fogRects(fog: Pick<MapFog, 'cols' | 'rows' | 'cells'>): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let open = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (let row = 0; row < fog.rows; row++) {
    const next = new Map<string, { x: number; y: number; w: number; h: number }>();
    let col = 0;
    while (col < fog.cols) {
      if (fog.cells[row * fog.cols + col]) { col++; continue; }
      const start = col;
      while (col < fog.cols && !fog.cells[row * fog.cols + col]) col++;
      const key = `${start}:${col - start}`, above = open.get(key);
      if (above) { above.h++; next.set(key, above); } else { const rect = { x: start, y: row, w: col - start, h: 1 }; out.push(rect); next.set(key, rect); }
    }
    open = next;
  }
  return out;
}

/** The hidden region as one SVG path, scaled to `w` x `h` units. */
export function fogPathData(fog: Pick<MapFog, 'cols' | 'rows' | 'cells'>, w: number, h: number, bleed = 0): string {
  const fx = w / fog.cols, fy = h / fog.rows, round = (value: number) => Math.round(value * 100) / 100;
  // Rectangles on the picture's edge reach `bleed` past it, so a blurred edge stays opaque up to the border.
  return fogRects(fog).map(rect => {
    const left = rect.x === 0 ? bleed : 0, right = rect.x + rect.w === fog.cols ? bleed : 0, top = rect.y === 0 ? bleed : 0, bottom = rect.y + rect.h === fog.rows ? bleed : 0;
    return `M${round(rect.x * fx - left)} ${round(rect.y * fy - top)}h${round(rect.w * fx + left + right)}v${round(rect.h * fy + top + bottom)}h${-round(rect.w * fx + left + right)}z`;
  }).join('');
}

/** Per-cell opacity of the fog (0-255): hidden cells, softened over their 3x3 neighbourhood so edges fade. */
export function fogAlpha(cells: MaskCells, cols: number, rows: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cells.length);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    let hidden = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const r = row + dy, c = col + dx;
      if (r < 0 || c < 0 || r >= rows || c >= cols) { continue; }
      count++; if (!cells[r * cols + c]) hidden++;
    }
    // The inside of fog is fully opaque, the inside of the explored area fully clear.
    out[row * cols + col] = Math.round(255 * hidden / Math.max(1, count));
  }
  return out;
}
