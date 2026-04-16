/**
 * Custom drag hook for color picker interactions.
 * Handles both mouse and touch events for canvas and slider dragging.
 */

import { useRef, useCallback, useEffect } from 'react';

export interface DragOptions {
  onDrag: (x: number, y: number, rect: DOMRect) => void;
}

export interface DragResult {
  ref: React.RefObject<HTMLDivElement | null>;
  start: (e: React.MouseEvent | React.TouchEvent) => void;
}

/**
 * Hook for handling drag interactions on color picker elements.
 * Supports both mouse and touch input.
 *
 * Usage:
 *   const { ref, start } = useDrag((x, y, rect) => {
 *     // Handle drag...
 *   });
 *
 *   return (
 *     <div ref={ref} onMouseDown={start} onTouchStart={start}>
 *       Draggable area
 *     </div>
 *   );
 */
export function useDrag({ onDrag }: DragOptions): DragResult {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const start = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      const rect = ref.current!.getBoundingClientRect();
      const pos = 'touches' in e ? e.touches[0] : e;
      onDrag(pos.clientX, pos.clientY, rect);
    },
    [onDrag],
  );

  useEffect(() => {
    const move = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current || !ref.current) return;
      e.preventDefault();
      const rect = ref.current.getBoundingClientRect();
      const pos = 'touches' in e ? e.touches[0] : e;
      onDrag(pos.clientX, pos.clientY, rect);
    };

    const up = () => {
      dragging.current = false;
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);

    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
    };
  }, [onDrag]);

  return { ref, start };
}
