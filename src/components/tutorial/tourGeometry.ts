// Pure geometry for the spotlight and its popover. No DOM, so it is testable
// and cannot throw on a missing element.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type Side = 'bottom' | 'top' | 'right' | 'left' | 'center';

/** The hole in the dimmed screen: the target grown by `pad`, kept inside the viewport. */
export function spotlightBox(target: Box, viewport: Viewport, pad = 6): Box {
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** The four dimmed strips around a hole. Together with the hole they tile the viewport. */
export function dimStrips(hole: Box, viewport: Viewport): Box[] {
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  return [
    { left: 0, top: 0, width: viewport.width, height: hole.top },
    { left: 0, top: bottom, width: viewport.width, height: Math.max(0, viewport.height - bottom) },
    { left: 0, top: hole.top, width: hole.left, height: hole.height },
    { left: right, top: hole.top, width: Math.max(0, viewport.width - right), height: hole.height },
  ];
}

/**
 * Where the popover goes: below the hole if it fits, else above, else beside,
 * else the middle of the screen. Always clamped inside the viewport.
 */
export function placePopover(
  hole: Box | null,
  size: { width: number; height: number },
  viewport: Viewport,
  gap = 14,
  margin = 12,
): { left: number; top: number; side: Side } {
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - size.width - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, viewport.height - size.height - margin));
  const centred = () => ({
    left: clampX((viewport.width - size.width) / 2),
    top: clampY((viewport.height - size.height) / 2),
    side: 'center' as const,
  });
  if (!hole) return centred();
  const centreX = hole.left + hole.width / 2 - size.width / 2;
  const centreY = hole.top + hole.height / 2 - size.height / 2;
  if (hole.top + hole.height + gap + size.height + margin <= viewport.height) {
    return { left: clampX(centreX), top: hole.top + hole.height + gap, side: 'bottom' };
  }
  if (hole.top - gap - size.height - margin >= 0) {
    return { left: clampX(centreX), top: hole.top - gap - size.height, side: 'top' };
  }
  if (hole.left + hole.width + gap + size.width + margin <= viewport.width) {
    return { left: hole.left + hole.width + gap, top: clampY(centreY), side: 'right' };
  }
  if (hole.left - gap - size.width - margin >= 0) {
    return { left: hole.left - gap - size.width, top: clampY(centreY), side: 'left' };
  }
  return centred();
}

/** Is a measured rectangle worth spotlighting? */
export function usableRect(rect: { width: number; height: number }): boolean {
  return rect.width > 0 && rect.height > 0;
}
