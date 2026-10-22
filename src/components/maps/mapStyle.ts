import type { MapFeature, MapLabelStyle } from '@/types';

/**
 * The look of a classic map's shapes: outline, hatch and lettering. One place
 * for the rules so the editor canvas, the SVG export and the bridge agree.
 * Every field is optional and absent means the look maps had before it.
 */
export const MAP_PATTERNS = ['stripes', 'stripes-v', 'stripes-d', 'dots', 'crosshatch'] as const;
export const MAP_LABEL_FONTS = ['serif', 'sans', 'mono', 'script'] as const;
export const MAP_STROKE_WIDTH = { min: 0.5, max: 12 } as const;
export const MAP_PATTERN_SCALE = { min: 0.5, max: 4 } as const;
export const MAP_LABEL_SIZE = { min: 0.6, max: 8 } as const;
export const MAP_LABEL_OUTLINE = { min: 0, max: 10 } as const;
export const DEFAULT_LABEL_SIZE = 1.8;

export const FONT_FAMILY: Record<NonNullable<MapLabelStyle['font']>, string> = {
  serif: 'Georgia,serif',
  sans: '"Source Sans 3",Arial,sans-serif',
  mono: 'Consolas,"Courier New",monospace',
  script: '"Segoe Script","Brush Script MT",cursive',
};

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export class MapStyleError extends Error {}

/** Validate a partial style for a shape (the bridge's entry point); throws with a readable message. */
export function normalizeMapFeatureStyle(input: Record<string, unknown>): Partial<Pick<MapFeature, 'strokeColor' | 'strokeWidth' | 'pattern' | 'patternScale' | 'labelStyle' | 'color' | 'opacity'>> {
  const out: Partial<Pick<MapFeature, 'strokeColor' | 'strokeWidth' | 'pattern' | 'patternScale' | 'labelStyle' | 'color' | 'opacity'>> = {};
  const colour = (key: string, value: unknown): string => {
    if (typeof value !== 'string' || !HEX.test(value)) throw new MapStyleError(`${key} must be a #rrggbb colour.`);
    return value.toLowerCase();
  };
  const number = (key: string, value: unknown, range: { min: number; max: number }): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) throw new MapStyleError(`${key} must be a number from ${range.min} to ${range.max}.`);
    return Math.round(value * 100) / 100;
  };
  if (input.color !== undefined) out.color = colour('color', input.color);
  if (input.opacity !== undefined) out.opacity = number('opacity', input.opacity, { min: 0, max: 1 });
  if (input.strokeColor !== undefined) out.strokeColor = colour('strokeColor', input.strokeColor);
  if (input.strokeWidth !== undefined) out.strokeWidth = number('strokeWidth', input.strokeWidth, MAP_STROKE_WIDTH);
  if (input.pattern !== undefined && input.pattern !== null && input.pattern !== 'none') {
    if (!MAP_PATTERNS.includes(input.pattern as never)) throw new MapStyleError(`pattern must be none or one of ${MAP_PATTERNS.join(', ')}.`);
    out.pattern = input.pattern as MapFeature['pattern'];
  }
  if (input.patternScale !== undefined) out.patternScale = number('patternScale', input.patternScale, MAP_PATTERN_SCALE);
  if (input.labelStyle !== undefined) {
    const raw = input.labelStyle;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MapStyleError('labelStyle must be an object.');
    const r = raw as Record<string, unknown>, style: MapLabelStyle = {};
    for (const key of Object.keys(r)) if (!['font', 'size', 'color', 'outline', 'outlineWidth', 'bold', 'italic', 'rotation'].includes(key)) throw new MapStyleError(`Unknown labelStyle field "${key}".`);
    if (r.font !== undefined) { if (!MAP_LABEL_FONTS.includes(r.font as never)) throw new MapStyleError(`labelStyle.font must be one of ${MAP_LABEL_FONTS.join(', ')}.`); style.font = r.font as MapLabelStyle['font']; }
    if (r.size !== undefined) style.size = number('labelStyle.size', r.size, MAP_LABEL_SIZE);
    if (r.color !== undefined) style.color = colour('labelStyle.color', r.color);
    if (r.outline !== undefined) style.outline = colour('labelStyle.outline', r.outline);
    if (r.outlineWidth !== undefined) style.outlineWidth = number('labelStyle.outlineWidth', r.outlineWidth, MAP_LABEL_OUTLINE);
    if (r.bold !== undefined) { if (typeof r.bold !== 'boolean') throw new MapStyleError('labelStyle.bold must be true or false.'); style.bold = r.bold; }
    if (r.italic !== undefined) { if (typeof r.italic !== 'boolean') throw new MapStyleError('labelStyle.italic must be true or false.'); style.italic = r.italic; }
    if (r.rotation !== undefined) style.rotation = number('labelStyle.rotation', r.rotation, { min: -180, max: 180 });
    out.labelStyle = style;
  }
  return out;
}

/** What a shape's lettering resolves to, defaults filled in. */
export function resolvedLabel(feature: Pick<MapFeature, 'color' | 'labelStyle'>) {
  const s = feature.labelStyle ?? {};
  return {
    family: FONT_FAMILY[s.font ?? 'serif'],
    size: clamp(s.size ?? DEFAULT_LABEL_SIZE, MAP_LABEL_SIZE.min, MAP_LABEL_SIZE.max),
    fill: s.color ?? feature.color,
    outline: s.outline ?? '#17191a',
    outlineWidth: clamp(s.outlineWidth ?? 3, MAP_LABEL_OUTLINE.min, MAP_LABEL_OUTLINE.max),
    weight: s.bold ? 700 : 400,
    style: s.italic ? 'italic' : 'normal',
    rotation: clamp(s.rotation ?? 0, -180, 180),
  };
}

/** A shape's outline colour and width (screen pixels). */
export function resolvedStroke(feature: Pick<MapFeature, 'kind' | 'color' | 'strokeColor' | 'strokeWidth'>) {
  return {
    color: feature.strokeColor ?? feature.color,
    width: clamp(feature.strokeWidth ?? (feature.kind === 'path' ? 3 : 2), MAP_STROKE_WIDTH.min, MAP_STROKE_WIDTH.max),
  };
}

export interface PatternMark { tag: 'line' | 'circle'; attrs: Record<string, string | number> }

/**
 * A hatch as an SVG <pattern>: its tile size and the marks in it, in user
 * units of the drawing it lands in (`unit` = how big 1% of the map is there).
 */
export function patternTile(feature: Pick<MapFeature, 'pattern' | 'patternScale' | 'strokeColor' | 'color'>, unit: number): { size: number; rotate: number; marks: PatternMark[] } | null {
  if (!feature.pattern) return null;
  const size = 1.6 * clamp(feature.patternScale ?? 1, MAP_PATTERN_SCALE.min, MAP_PATTERN_SCALE.max) * unit;
  const stroke = feature.strokeColor ?? feature.color;
  const w = Math.max(0.12 * unit, size * 0.12);
  const line = (x1: number, y1: number, x2: number, y2: number): PatternMark => ({ tag: 'line', attrs: { x1, y1, x2, y2, stroke, 'stroke-width': w, 'stroke-opacity': 0.75 } });
  switch (feature.pattern) {
    case 'stripes': return { size, rotate: 0, marks: [line(0, size / 2, size, size / 2)] };
    case 'stripes-v': return { size, rotate: 0, marks: [line(size / 2, 0, size / 2, size)] };
    case 'stripes-d': return { size, rotate: 45, marks: [line(0, size / 2, size, size / 2)] };
    case 'crosshatch': return { size, rotate: 45, marks: [line(0, size / 2, size, size / 2), line(size / 2, 0, size / 2, size)] };
    case 'dots': return { size, rotate: 0, marks: [{ tag: 'circle', attrs: { cx: size / 2, cy: size / 2, r: size * 0.16, fill: stroke, 'fill-opacity': 0.75 } }] };
    default: return null;
  }
}

/** The same tile as SVG markup, for the export. */
export function patternSvg(id: string, tile: NonNullable<ReturnType<typeof patternTile>>): string {
  const marks = tile.marks.map(m => `<${m.tag} ${Object.entries(m.attrs).map(([k, v]) => `${k}="${typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v).replace(/"/g, '&quot;')}"`).join(' ')}/>`).join('');
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile.size}" height="${tile.size}"${tile.rotate ? ` patternTransform="rotate(${tile.rotate})"` : ''}>${marks}</pattern>`;
}

/** Move one shape in the drawing order (the end of the list is drawn on top). */
export function reorderFeature(features: MapFeature[], id: string, how: 'front' | 'forward' | 'backward' | 'back'): MapFeature[] {
  const index = features.findIndex(feature => feature.id === id);
  if (index < 0) return features;
  const next = features.slice();
  const [item] = next.splice(index, 1);
  const target = how === 'front' ? next.length : how === 'back' ? 0 : how === 'forward' ? Math.min(next.length, index + 1) : Math.max(0, index - 1);
  next.splice(target, 0, item);
  return next;
}

export const MAP_PATH_STYLES = ['road', 'trail', 'river'] as const;

/**
 * How a path's line is drawn by kind: a road gets a dark casing under it, a
 * trail is dashed, a river has a soft bank of its own colour under it. A plain
 * route (no style) is drawn as before.
 */
export function pathLook(style: MapFeature['pathStyle'], color: string, width: number): { under?: { color: string; width: number; opacity: number }; dash?: string } {
  if (style === 'road') return { under: { color: '#2b2620', width: width + 2.5, opacity: .85 } };
  if (style === 'trail') return { dash: `${Math.max(3, width * 2)} ${Math.max(3, width * 1.6)}` };
  if (style === 'river') return { under: { color, width: width + 4, opacity: .28 } };
  return {};
}
