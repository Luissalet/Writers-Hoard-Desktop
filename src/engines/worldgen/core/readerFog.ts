import { strokeMask } from '../sculpt/ops';
import type { WorldEdit } from './edits';

/**
 * The reader's-eye map: what the story has shown so far.
 *
 * Every cell is hidden (blank paper), heard of (a sketch) or seen (in ink).
 * The author paints those states with the Fog brush; a stroke may say in which
 * chapter it is revealed, so the reader's view "as of chapter N" applies only
 * the strokes up to that chapter (strokes without a chapter always apply).
 * Strokes apply in order and the last one over a cell wins.
 */
export const FOG_HIDDEN = 0, FOG_HEARD = 1, FOG_SEEN = 2;
export type FogOp = 'seen' | 'heard' | 'hide';
export const FOG_OPS: FogOp[] = ['seen', 'heard', 'hide'];
/** How the reader's map starts before any stroke: blank paper, all sketched, or all in ink. */
export type ReaderStart = 'blank' | 'sketch' | 'ink';
export const READER_STARTS: ReaderStart[] = ['blank', 'sketch', 'ink'];

const STATE: Record<FogOp, number> = { seen: FOG_SEEN, heard: FOG_HEARD, hide: FOG_HIDDEN };

export function fogMask(edits: readonly WorldEdit[], width: number, height: number, start: ReaderStart = 'blank', chapter: number | null = null): Uint8Array {
  const mask = new Uint8Array(width * height).fill(start === 'ink' ? FOG_SEEN : start === 'sketch' ? FOG_HEARD : FOG_HIDDEN);
  for (const edit of edits) {
    if (edit.kind !== 'fog' || !FOG_OPS.includes(edit.op)) continue;
    if (chapter !== null && edit.chapter !== undefined && edit.chapter > chapter) continue;
    const brush = strokeMask(edit.stroke, width, height);
    if (!brush || brush.empty) continue;
    const value = STATE[edit.op];
    brush.each((i, cover) => { if (cover >= 0.5) mask[i] = value; });
  }
  return mask;
}

/** Shares of the sheet in each state, 0..1. */
export function fogShares(mask: Uint8Array): { seen: number; heard: number; hidden: number } {
  let seen = 0, heard = 0;
  for (const v of mask) { if (v === FOG_SEEN) seen++; else if (v === FOG_HEARD) heard++; }
  const n = Math.max(1, mask.length);
  return { seen: seen / n, heard: heard / n, hidden: (n - seen - heard) / n };
}

/** Chapters that reveal something, in order — for the reader's-view picker. */
export function fogChapters(edits: readonly WorldEdit[]): number[] {
  const out = new Set<number>();
  for (const edit of edits) if (edit.kind === 'fog' && typeof edit.chapter === 'number') out.add(edit.chapter);
  return [...out].sort((a, b) => a - b);
}

/**
 * A "seen" stroke along a route: what the party saw on the way, within a sight
 * radius. Cells are world indices; the points are thinned to no more than half
 * the radius apart, and a step that jumps the seam is unwrapped so the stroke
 * stays one continuous line.
 */
export function routeFogEdit(cells: readonly number[], width: number, radiusCells: number, chapter: number | null = null): WorldEdit | null {
  if (!cells.length || width < 1 || !(radiusCells > 0)) return null;
  const step = Math.max(1, radiusCells / 2);
  const pts: { x: number; y: number }[] = [];
  let prevX = 0, keptX = 0, keptY = 0;
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k];
    let x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    if (k > 0) {
      // Unwrapped against the previous cell, so a seam crossing stays continuous.
      while (x - prevX > width / 2) x -= width;
      while (x - prevX < -width / 2) x += width;
    }
    prevX = x;
    if (!pts.length || k === cells.length - 1 || Math.hypot(x - keptX, y - keptY) >= step) {
      pts.push({ x, y });
      keptX = x; keptY = y;
    }
  }
  const stroke = { pts, radius: radiusCells, strength: 1, softness: 0.35 };
  return chapter === null ? { kind: 'fog', op: 'seen', stroke } : { kind: 'fog', op: 'seen', stroke, chapter };
}
