import { deserializeEdits, type WorldEdit } from './edits';
import type { DomainDocument } from './domainDocument';
import type { WorldData } from './types';
import type { DomainBounds } from './worldDomain';

export interface DomainCanonEdit {
  edit: WorldEdit;
  /** Absolute cells still present through every later resize. */
  clip: DomainBounds | null;
  seaDeltaKm?: number;
  /** Only the old prefix was authored on a wrapping source grid. */
  wrapWidth?: number;
}

function intersect(a: DomainBounds, b: DomainBounds): DomainBounds | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function domainCanonContains(bounds: DomainBounds | null, x: number, y: number): boolean {
  return !!bounds && x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

/** A transient plan derived from the one durable journal, never another authority. */
export function domainCanonEdits(document: DomainDocument, sourceBounds: DomainBounds): DomainCanonEdit[] {
  const later: (DomainBounds | null | undefined)[] = new Array(document.steps.length + 1);
  let intersection: DomainBounds | null | undefined;
  for (let i = document.steps.length - 1; i >= 0; i--) {
    const step = document.steps[i];
    if (step.kind === 'resize') intersection = intersection === undefined ? step.bounds : intersection && intersect(intersection, step.bounds);
    later[i] = intersection;
  }
  const surviving = (authored: DomainBounds, future: DomainBounds | null | undefined) => future === undefined ? authored : future && intersect(authored, future);
  const result: DomainCanonEdit[] = [];
  let seaM = 0;
  const add = (edit: WorldEdit, clip: DomainBounds | null, wrapWidth?: number) => {
    const entry: DomainCanonEdit = { edit, clip, ...(wrapWidth ? { wrapWidth } : {}) };
    if (edit.kind === 'seaLevel') { entry.seaDeltaKm = (edit.m - seaM) / 1000; seaM = edit.m; }
    result.push(entry);
  };
  const initialSurvival = surviving(document.initial.bounds, later[0]);
  const prefixClip = initialSurvival && intersect(sourceBounds, initialSurvival);
  for (const edit of deserializeEdits(document.legacy.json).slice(0, document.legacy.count)) {
    add(edit, prefixClip, document.initial.topology === 'legacy' ? sourceBounds.width : undefined);
  }
  let authored = document.initial.bounds;
  for (let i = 0; i < document.steps.length; i++) {
    const step = document.steps[i];
    if (step.kind === 'resize') authored = step.bounds;
    else add(step.edit, surviving(authored, later[i + 1]));
  }
  return result;
}

export function domainCanonSeaShift(plan: readonly DomainCanonEdit[], x: number, y: number): number {
  let shift = 0;
  for (const entry of plan) if (entry.seaDeltaKm && domainCanonContains(entry.clip, x, y)) shift += entry.seaDeltaKm;
  return shift;
}

/** One elevation grid without physical strokes, resized in the journal's order.
 * Cropped terrain is discarded; a later grow fills it instead of resurrecting it. */
export function domainCanonElevation(source: WorldData, document: DomainDocument): Float32Array {
  let bounds: DomainBounds = { x: 0, y: 0, width: source.width, height: source.height };
  let elevation = source.elevation.slice();
  const resize = (next: DomainBounds, fill: 'sea' | 'land') => {
    if (next.x === bounds.x && next.y === bounds.y && next.width === bounds.width && next.height === bounds.height) return;
    const values = new Float32Array(next.width * next.height).fill(fill === 'sea' ? -1.6 : 0.3);
    const overlap = intersect(bounds, next);
    if (overlap) for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
      const from = (y - bounds.y) * bounds.width + overlap.x - bounds.x;
      values.set(elevation.subarray(from, from + overlap.width), (y - next.y) * next.width + overlap.x - next.x);
    }
    elevation = values; bounds = next;
  };
  resize(document.initial.bounds, 'sea');
  for (const step of document.steps) if (step.kind === 'resize') resize(step.bounds, step.fill.kind);
  return elevation;
}
