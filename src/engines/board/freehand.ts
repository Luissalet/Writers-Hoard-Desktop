import { makeNode } from './graph/mutations';
import type { BoardNode } from './types';
import { simplifyStroke as simplifyBoardStroke, type StrokePoint } from '@/utils/freehand';
export { simplifyStroke as simplifyBoardStroke } from '@/utils/freehand';
export type { StrokePoint } from '@/utils/freehand';

/** A stroke is an ordinary shape node: all existing undo/layer/backup tools work. */
export function makeFreehandNode(options: { projectId: string; boardId: string; title: string; color: string; width: number; points: StrokePoint[]; layerId?: string; tolerance?: number }): BoardNode | null {
  const points = simplifyBoardStroke(options.points, options.tolerance);
  if (!points.length) return null;
  const width = Number.isFinite(options.width) ? Math.max(1, Math.min(24, options.width)) : 3;
  const padding = width * 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const spanX = maxX - minX, spanY = maxY - minY;
  const size = { width: Math.max(60, spanX + padding * 2), height: Math.max(60, spanY + padding * 2) };
  const position = { x: minX - padding - (size.width - spanX - padding * 2) / 2, y: minY - padding - (size.height - spanY - padding * 2) / 2 };
  const normalized = points.map(point => ({ x: (point.x - position.x) * 100 / size.width, y: (point.y - position.y) * 100 / size.height }));
  if (normalized.length === 1) normalized.push({ x: normalized[0].x + .01, y: normalized[0].y });
  return { ...makeNode({ projectId: options.projectId, boardId: options.boardId, title: options.title, kind: 'shape', position, size, color: options.color, layerId: options.layerId }), freehand: { points: normalized, width } };
}
