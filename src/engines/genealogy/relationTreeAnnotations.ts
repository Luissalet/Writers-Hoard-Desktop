import { simplifyStroke, type StrokePoint } from '@/utils/freehand';

interface AnnotationBase {
  id: string;
  position: StrokePoint;
  size: { width: number; height: number };
  color: string;
}
export interface TreeTextAnnotation extends AnnotationBase { kind: 'text'; text: string; fontSize: number }
export interface TreeStrokeAnnotation extends AnnotationBase { kind: 'stroke'; points: StrokePoint[]; width: number }
export type RelationTreeAnnotation = TreeTextAnnotation | TreeStrokeAnnotation;
export const TREE_ANNOTATION_COLOR = '#c7a462';
export const MAX_TREE_ANNOTATIONS = 500;
const finite = (value: unknown, max = 1e7): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;

/** Imported annotations stay inert data; reject unbounded or active SVG values. */
export function annotationIssues(value: unknown, occupied: ReadonlySet<string>): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TREE_ANNOTATIONS) return ['invalid_annotations'];
  const ids = new Set(occupied);
  for (const item of value) {
    if (!item || typeof item !== 'object') return ['invalid_annotations'];
    const annotation = item as RelationTreeAnnotation;
    if (typeof annotation.id !== 'string' || !annotation.id || ids.has(annotation.id)) return ['duplicate_annotation'];
    ids.add(annotation.id);
    if (!annotation.position || !finite(annotation.position.x) || !finite(annotation.position.y) || !annotation.size || !finite(annotation.size.width, 50000) || !finite(annotation.size.height, 50000) || annotation.size.width < 8 || annotation.size.height < 8 || !/^#[0-9a-f]{6}$/i.test(annotation.color)) return ['invalid_annotations'];
    if (annotation.kind === 'text') {
      if (typeof annotation.text !== 'string' || annotation.text.length > 20000 || !finite(annotation.fontSize, 96) || annotation.fontSize < 10) return ['invalid_annotations'];
    } else if (annotation.kind === 'stroke') {
      if (!finite(annotation.width, 24) || annotation.width < 1 || !Array.isArray(annotation.points) || !annotation.points.length || annotation.points.length > 12000 || annotation.points.some(point => !point || !finite(point.x, 100) || !finite(point.y, 100) || point.x < 0 || point.y < 0)) return ['invalid_annotations'];
    } else return ['invalid_annotations'];
  }
  return [];
}

export function makeTreeText(id: string, text: string, position: StrokePoint): TreeTextAnnotation {
  return { id, kind: 'text', text, position, size: { width: 280, height: 130 }, color: TREE_ANNOTATION_COLOR, fontSize: 20 };
}

/** Reuses the Board's iterative stroke simplification; no Board entity is created. */
export function makeTreeStroke(id: string, source: StrokePoint[], color: string, width: number, zoom = 1): TreeStrokeAnnotation | null {
  if (source.length > 30000 || !/^#[0-9a-f]{6}$/i.test(color) || !finite(width, 24) || width < 1) return null;
  const points = simplifyStroke(source, 1 / Math.max(.1, zoom));
  if (!points.length || points.length > 12000) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of points) { x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y); }
  const padding = width * 2;
  const size = { width: Math.max(16, right - x + padding * 2), height: Math.max(16, bottom - y + padding * 2) };
  const position = { x: x - padding, y: y - padding };
  const normalized = points.map(point => ({ x: (point.x - position.x) / size.width * 100, y: (point.y - position.y) / size.height * 100 }));
  if (normalized.length === 1) normalized.push({ ...normalized[0] });
  const stroke: TreeStrokeAnnotation = { id, kind: 'stroke', position, size, color, width, points: normalized };
  return annotationIssues([stroke], new Set()).length ? null : stroke;
}

export function annotationPolyline(annotation: TreeStrokeAnnotation): string {
  return annotation.points.map(point => `${point.x * annotation.size.width / 100},${point.y * annotation.size.height / 100}`).join(' ');
}

/** Deterministic multiline wrapping shared by the editor and portable SVG. */
export function annotationLines(annotation: TreeTextAnnotation): string[] {
  const limit = Math.max(1, Math.floor((annotation.size.width - 16) / (annotation.fontSize * .61)));
  return annotation.text.split(/\r?\n/).flatMap(line => {
    const chars = Array.from(line), lines: string[] = [];
    do {
      let count = limit;
      if (chars.length > limit) { const space = chars.slice(0, limit + 1).lastIndexOf(' '); if (space > limit / 2) count = space; }
      lines.push(chars.splice(0, count).join(''));
      if (chars[0] === ' ' && count < limit) chars.shift();
    } while (chars.length);
    return lines;
  });
}
