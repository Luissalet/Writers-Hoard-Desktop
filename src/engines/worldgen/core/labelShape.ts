/**
 * The shape of a hand-written map label: how big, at what angle, how widely
 * spaced and how much it bends. One layout serves every view (atlas, Carta,
 * 3D overlay) so a label set in one reads the same in the others.
 */

export const LABEL_SIZE_RANGE = { min: 8, max: 48 } as const;
/** Extra space between letters, as a share of the type size. */
export const LABEL_SPACING_RANGE = { min: 0, max: 1 } as const;
/** −1 bows the line down at its middle (a smile), 1 arches it up; 0 is straight. */
export const LABEL_CURVE_RANGE = { min: -1, max: 1 } as const;
/** The widest bend: a full curve spans this much of a circle. */
const MAX_ARC = Math.PI * 0.85;

export interface LabelGlyph { x: number; y: number; a: number }

/**
 * Where each glyph's centre goes and how it turns, for glyph advance widths
 * laid out around (cx, cy). Straight runs are centred on the anchor; curved
 * runs follow a circular arc through it, so the label stays where it was put.
 */
export function labelGlyphs(widths: number[], tracking: number, curve: number, angle: number, cx: number, cy: number): LabelGlyph[] {
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, widths.length - 1);
  const bend = Math.max(-1, Math.min(1, curve || 0));
  const cos = Math.cos(angle || 0), sin = Math.sin(angle || 0);
  const out: LabelGlyph[] = [];
  let s = -total / 2;
  const theta = Math.abs(bend) * MAX_ARC;
  const radius = theta > 1e-3 ? total / theta : Infinity;
  const sign = bend > 0 ? 1 : -1;
  for (const width of widths) {
    const mid = s + width / 2;
    let lx = mid, ly = 0, la = 0;
    if (Number.isFinite(radius)) {
      const phi = mid / radius;
      lx = radius * Math.sin(phi);
      // Arch up: the ends drop below the anchor (canvas y grows downwards).
      ly = sign * radius * (1 - Math.cos(phi));
      la = sign * phi;
    }
    out.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos, a: la + (angle || 0) });
    s += width + tracking;
  }
  return out;
}

/** A box round the laid-out glyphs, for collision tests and hit areas. */
export function glyphBounds(glyphs: LabelGlyph[], widths: number[], size: number): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  glyphs.forEach((g, i) => {
    const r = Math.max(widths[i] ?? size, size) * 0.62;
    x0 = Math.min(x0, g.x - r); y0 = Math.min(y0, g.y - r);
    x1 = Math.max(x1, g.x + r); y1 = Math.max(y1, g.y + r);
  });
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

export interface LabelChange {
  text?: string;
  style?: 'region' | 'water' | 'range' | 'settlement' | 'note';
  size?: number;
  /** Radians, positive clockwise on screen. */
  angle?: number;
  spacing?: number;
  curve?: number;
}
export const LABEL_STYLE_IDS = ['region', 'water', 'range', 'settlement', 'note'] as const;
/** Letter spacing each style gets when the author has not set one: the Carta's own tracking. */
export const LABEL_DEFAULT_SPACING: Record<typeof LABEL_STYLE_IDS[number], number> = { region: 0.2, water: 0.2, range: 0.28, settlement: 0.1, note: 0.1 };

/** Validates a label change; refuses rather than clamps so callers learn the range. */
export function normalizeLabelChange(input: Record<string, unknown>): LabelChange {
  const out: LabelChange = {};
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('text must be a non-empty string.');
    out.text = input.text.trim().slice(0, 120);
  }
  if (input.style !== undefined) {
    if (!LABEL_STYLE_IDS.includes(input.style as never)) throw new Error(`style must be one of ${LABEL_STYLE_IDS.join(', ')}.`);
    out.style = input.style as LabelChange['style'];
  }
  const num = (key: 'size' | 'angle' | 'spacing' | 'curve', min: number, max: number) => {
    const value = input[key];
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be a number from ${min} to ${max}.`);
    out[key] = Math.round(value * 1000) / 1000;
  };
  num('size', LABEL_SIZE_RANGE.min, LABEL_SIZE_RANGE.max);
  num('angle', -Math.PI, Math.PI);
  num('spacing', LABEL_SPACING_RANGE.min, LABEL_SPACING_RANGE.max);
  num('curve', LABEL_CURVE_RANGE.min, LABEL_CURVE_RANGE.max);
  return out;
}
