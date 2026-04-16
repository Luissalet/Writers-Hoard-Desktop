// ============================================
// Full-spectrum Color Picker (Photoshop-style)
// ============================================
// Replaces fixed color swatches with a gradient
// picker + optional quick-access presets.

import { useState, useRef, useCallback, useEffect } from 'react';

const DEFAULT_PRESETS = [
  '#c4973b', '#7c5cbf', '#4a7ec4', '#4a9e6d',
  '#c4463a', '#d4a843', '#e4a853', '#9b7ed8',
  '#f87171', '#fbbf24', '#60a5fa', '#10b981',
];

interface ColorPickerProps {
  /** Current hex color value */
  value: string;
  /** Called with hex string when color changes */
  onChange: (color: string) => void;
  /** Optional quick-access presets (hex strings) */
  presets?: string[];
  /** Size variant */
  size?: 'sm' | 'md';
  /** Optional label shown above picker */
  label?: string;
}

export default function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  size = 'md',
  label,
}: ColorPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [tempColor, setTempColor] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync temp when value changes externally
  useEffect(() => { setTempColor(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const handleNativeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTempColor(e.target.value);
    onChange(e.target.value);
  }, [onChange]);

  const handlePresetClick = useCallback((color: string) => {
    setTempColor(color);
    onChange(color);
  }, [onChange]);

  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const presetDim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <div ref={containerRef} className="relative inline-block">
      {label && (
        <label className="block text-sm font-medium text-text-primary mb-2">
          {label}
        </label>
      )}

      <div className="flex items-center gap-2">
        {/* Active color swatch — opens picker */}
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className={`${dim} rounded-full ring-2 ring-white/20 hover:ring-accent-gold/60 transition-all cursor-pointer flex-shrink-0`}
          style={{ backgroundColor: tempColor }}
          title="Open color picker"
        />

        {/* Hex input */}
        <input
          type="text"
          value={tempColor}
          onChange={(e) => {
            const v = e.target.value;
            setTempColor(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              onChange(v);
            }
          }}
          className="w-[5.5rem] px-2 py-1 text-xs font-mono bg-elevated border border-border rounded text-text-primary focus:outline-none focus:border-accent-gold transition"
          spellCheck={false}
        />
      </div>

      {/* Dropdown panel */}
      {showPicker && (
        <div className="absolute z-50 mt-2 p-3 rounded-xl bg-surface border border-border shadow-2xl min-w-[220px] animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Native color input styled as wide gradient bar */}
          <div className="relative mb-3">
            <input
              ref={inputRef}
              type="color"
              value={tempColor}
              onChange={handleNativeChange}
              className="w-full h-32 rounded-lg cursor-crosshair border-0 p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0"
              style={{ background: 'none' }}
            />
          </div>

          {/* Quick presets */}
          {presets.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
                Quick picks
              </div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => handlePresetClick(color)}
                    className={`${presetDim} rounded-full transition-transform border-2 ${
                      tempColor.toLowerCase() === color.toLowerCase()
                        ? 'border-accent-gold scale-110'
                        : 'border-transparent hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Compact inline variant (no dropdown, no label)
// Used for tight spaces like toolbars.
// ============================================

export function InlineColorPicker({
  value,
  onChange,
  size = 'sm',
}: Pick<ColorPickerProps, 'value' | 'onChange' | 'size'>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`${dim} rounded-full ring-2 ring-white/20 hover:ring-accent-gold/60 transition-all cursor-pointer`}
        style={{ backgroundColor: value }}
        title="Pick a color"
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />
    </div>
  );
}
