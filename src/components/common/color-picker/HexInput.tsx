/**
 * Hex Color Input Component
 * Renders the hex input field with a color swatch.
 */

import React, { useCallback } from 'react';
import { hexToHsv } from '@/utils/colorMath';

export interface HexInputProps {
  value: string;
  onChange: (color: string) => void;
  onHsvChange?: (h: number, s: number, v: number) => void;
  size?: 'sm' | 'md';
}

export function HexInput({
  value,
  onChange,
  onHsvChange,
  size = 'md',
}: HexInputProps) {
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      onChange(v);

      if (/^#[0-9a-fA-F]{6}$/.test(v) && onHsvChange) {
        const [h, s, vv] = hexToHsv(v);
        onHsvChange(h, s, vv);
      }
    },
    [onChange, onHsvChange],
  );

  return (
    <div className="flex items-center gap-2">
      {/* Color swatch */}
      <button
        type="button"
        className={`${dim} rounded-full ring-2 ring-white/20 hover:ring-accent-gold/60 transition-all cursor-pointer flex-shrink-0`}
        style={{ backgroundColor: value }}
        title="Color swatch"
        disabled
      />

      {/* Hex input */}
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        className="w-[5.5rem] px-2 py-1 text-xs font-mono bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-accent-gold transition"
        spellCheck={false}
        placeholder="#000000"
      />
    </div>
  );
}
