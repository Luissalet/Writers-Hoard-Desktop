/**
 * Saturation/Value Canvas Component
 * Renders the 2D color picker area with crosshair cursor.
 */

import React from 'react';
import { hsvToHex } from '@/utils/colorMath';

export interface SaturationCanvasProps {
  hue: number;
  saturation: number;
  value: number;
  currentColor: string;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  size?: 'sm' | 'md';
}

export function SaturationCanvas({
  hue,
  saturation,
  value,
  currentColor,
  canvasRef,
  onMouseDown,
  onTouchStart,
  size = 'md',
}: SaturationCanvasProps) {
  const pureHue = hsvToHex(hue, 1, 1);
  const heightClass = size === 'sm' ? 'h-28' : 'h-32';
  const dotSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div
      ref={canvasRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`relative w-full ${heightClass} rounded-lg cursor-crosshair mb-2 select-none`}
      style={{
        background: `
          linear-gradient(to top, #000, transparent),
          linear-gradient(to right, #fff, ${pureHue})
        `,
      }}
    >
      {/* Picker crosshair dot */}
      <div
        className={`absolute ${dotSize} rounded-full border-2 border-white shadow-md pointer-events-none`}
        style={{
          left: `${saturation * 100}%`,
          top: `${(1 - value) * 100}%`,
          transform: 'translate(-50%, -50%)',
          backgroundColor: currentColor,
        }}
      />
    </div>
  );
}
