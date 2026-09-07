import type { BoardLayer, BoardNode } from '../types';
import { GRID_STEP } from '../catalog';

/** A lock applies to every way of moving an idea, including group gestures. */
export function canMoveNode(node: BoardNode, layers: Map<string, BoardLayer>): boolean {
  return !node.locked && !(node.layerId && layers.get(node.layerId)?.locked);
}

/** Find the first free slot without piling successive ideas on the same spot. */
export function findOpenPosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  nodes: BoardNode[],
): { x: number; y: number } {
  const origin = {
    x: Math.round(desired.x / GRID_STEP) * GRID_STEP,
    y: Math.round(desired.y / GRID_STEP) * GRID_STEP,
  };
  const gap = GRID_STEP * 2;
  for (let row = 0; row <= nodes.length; row += 1) {
    const candidate = { x: origin.x, y: origin.y + row * (size.height + gap) };
    const overlaps = nodes.some((node) => node.kind !== 'frame' &&
      candidate.x < node.position.x + node.size.width + gap &&
      candidate.x + size.width + gap > node.position.x &&
      candidate.y < node.position.y + node.size.height + gap &&
      candidate.y + size.height + gap > node.position.y);
    if (!overlaps) return candidate;
  }
  return origin;
}

/** Keep shortcuts inside the canvas and out of forms, dialogs and toolbars. */
export function isCanvasShortcutTarget(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement) || !container?.contains(target)) return false;
  return !target.closest('input, textarea, select, button, [contenteditable="true"], [role="dialog"], [role="menu"]');
}
