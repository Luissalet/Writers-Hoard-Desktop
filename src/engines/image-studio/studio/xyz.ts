// ============================================================================
// X/Y/Z plot — how a writer finds out what the knobs do
// ============================================================================
//
// Pick up to three fields, give each a list of values, and the studio runs the
// product of them and lays the results out in a labelled grid. It is the single
// cheapest thing in this whole contract: pure client orchestration over the
// same generate call, so it works identically on every backend, and it teaches
// more about steps and CFG in one run than any amount of prose.
//
// Nothing here runs anything. It builds the matrix, and it is tested by
// checking the matrix — a plot that spends twenty minutes of GPU time to be
// tested is a plot nobody tests.

import type { StudioField } from './levels';

export type AxisField = 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'seed' | 'clipSkip' | 'hiresDenoise' | 'promptSuffix';

/** Which capability an axis needs, so a refused knob cannot become an axis. */
export const AXIS_REQUIRES: Record<AxisField, StudioField> = {
  steps: 'steps',
  cfg: 'cfg',
  sampler: 'sampler',
  scheduler: 'scheduler',
  seed: 'seed',
  clipSkip: 'clipSkip',
  hiresDenoise: 'passChain',
  promptSuffix: 'model',
};

export const AXIS_FIELDS: readonly AxisField[] = Object.keys(AXIS_REQUIRES) as AxisField[];

const NUMERIC_AXES: readonly AxisField[] = ['steps', 'cfg', 'seed', 'clipSkip', 'hiresDenoise'];

export interface XyzAxis {
  field: AxisField;
  values: string[];
}

/**
 * A run that has not happened yet: which cell of the grid it is, and what it
 * changes about the base recipe.
 */
export interface XyzCell {
  index: number;
  /** Position in the grid, X first. Used to lay the contact sheet out. */
  x: number;
  y: number;
  z: number;
  /** The label under the picture: "steps 30 · cfg 7". */
  coords: { field: AxisField; value: string }[];
  overrides: XyzOverrides;
}

export interface XyzOverrides {
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  seed?: number;
  clipSkip?: number;
  hiresDenoise?: number;
  /** Appended to the prompt, so a prompt axis does not have to retype it. */
  promptSuffix?: string;
}

/**
 * A run of this many pictures is minutes of GPU time per cell on a laptop. The
 * cap is here rather than in the dialog so that the honest refusal and the
 * matrix that produced it cannot drift apart.
 */
export const XYZ_MAX_CELLS = 64;

/**
 * Parse "20, 30, 40" or a range: "20-40 (10)" is 20, 30, 40.
 *
 * Ranges only for numeric axes: "euler-lcm (2)" is not a range, it is a writer
 * typing a sampler name with a hyphen in it, and turning that into arithmetic
 * would be a small betrayal.
 */
export function parseAxisValues(field: AxisField, raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const numeric = NUMERIC_AXES.includes(field);
  const range = numeric ? /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?$/.exec(text) : null;
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    const step = Number(range[3] ?? (to >= from ? 1 : -1)) || 1;
    const values: string[] = [];
    const direction = to >= from ? 1 : -1;
    for (let value = from; direction > 0 ? value <= to : value >= to; value += step * direction) {
      values.push(String(Math.round(value * 1000) / 1000));
      if (values.length >= XYZ_MAX_CELLS) break;
    }
    return values;
  }
  return text.split(',').map((value) => value.trim()).filter(Boolean);
}

function overrideFor(field: AxisField, value: string): XyzOverrides {
  switch (field) {
    case 'steps': return { steps: Math.max(1, Math.round(Number(value))) };
    case 'cfg': return { cfg: Number(value) };
    case 'sampler': return { sampler: value };
    case 'scheduler': return { scheduler: value };
    case 'seed': return { seed: Math.max(0, Math.round(Number(value))) };
    case 'clipSkip': return { clipSkip: Math.round(Number(value)) };
    case 'hiresDenoise': return { hiresDenoise: Number(value) };
    case 'promptSuffix': return { promptSuffix: value };
  }
}

/**
 * The product of the axes, X varying fastest.
 *
 * X fastest is not arbitrary: it is what makes the first axis a ROW, which is
 * how every grid anyone has ever posted is read, and reading a grid whose axes
 * are transposed from the labels is worse than having no labels.
 */
export function buildXyzMatrix(axes: readonly XyzAxis[]): XyzCell[] {
  const active = axes.filter((axis) => axis.values.length > 0);
  if (active.length === 0) return [];
  const [x, y, z] = active;
  const cells: XyzCell[] = [];
  const zValues = z?.values ?? [''];
  const yValues = y?.values ?? [''];
  for (let zi = 0; zi < zValues.length; zi += 1) {
    for (let yi = 0; yi < yValues.length; yi += 1) {
      for (let xi = 0; xi < x.values.length; xi += 1) {
        if (cells.length >= XYZ_MAX_CELLS) return cells;
        const coords: XyzCell['coords'] = [{ field: x.field, value: x.values[xi] }];
        if (y) coords.push({ field: y.field, value: y.values[yi] });
        if (z) coords.push({ field: z.field, value: z.values[zi] });
        cells.push({
          index: cells.length,
          x: xi,
          y: yi,
          z: zi,
          coords,
          overrides: coords.reduce<XyzOverrides>(
            (all, coord) => ({ ...all, ...overrideFor(coord.field, coord.value) }),
            {},
          ),
        });
      }
    }
  }
  return cells;
}

/** How many cells the axes ask for, before the cap is applied. */
export function xyzRequestedCells(axes: readonly XyzAxis[]): number {
  return axes
    .filter((axis) => axis.values.length > 0)
    .reduce((total, axis) => total * axis.values.length, 1);
}

/** The grid's shape, so the contact sheet can be laid out before anything runs. */
export function xyzShape(axes: readonly XyzAxis[]): { columns: number; rows: number; sheets: number } {
  const active = axes.filter((axis) => axis.values.length > 0);
  return {
    columns: active[0]?.values.length ?? 0,
    rows: active[1]?.values.length ?? 1,
    sheets: active[2]?.values.length ?? 1,
  };
}
