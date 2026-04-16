/**
 * Hue Slider Component
 * Renders the horizontal hue gradient slider with thumb.
 */

import React from 'react';
import { hsvToHex } from '@/utils/colorMath';

export interface HueSliderProps {
  hue: number;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  size?: 'sm' | 'md';
}

export function HueSlider({
  hue,
  sliderRef,
  onMouseDown,
  onTouchStart,
  size = 'md',
}: HueSliderProps) {
  const pureHue = hsvToHex(hue, 1, 1);
  const heightClass = size === 'sm' ? 'h-2.5' : 'h-3';
  const thumbSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const marginBottom = size === 'sm' ? 'mb-2' : 'mb-3';

  return (
    <div
      ref={sliderRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`relative w-full ${heightClass} rounded-full cursor-pointer ${marginBottom} select-none`}
      style={{
        background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
      }}
    >
      {/* Hue thumb */}
      <div
        className={`absolute top-1/2 ${thumbSize} rounded-full border-2 border-white shadow-md pointer-events-none`}
        style={{
          left: `${(hue / 360) * 100}%`,
          transform: 'translate(-50%, -50%)',
          backgroundColor: pureHue,
        }}
      />
    </div>
  );
}
