// ============================================
// Full-spectrum Color Picker (Photoshop-style)
// ============================================
// Custom HSV canvas + hue slider with full drag support.
// No native <input type="color"> — everything is inline.

import { useState, useRef, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Color math helpers
// ---------------------------------------------------------------------------

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, s, v];
}

// ---------------------------------------------------------------------------
// Shared drag hook — works for both canvas and slider
// ---------------------------------------------------------------------------

function useDrag(
  onDrag: (x: number, y: number, rect: DOMRect) => void,
) {
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
    const up = () => { dragging.current = false; };
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PRESETS = [
  '#c4973b', '#7c5cbf', '#4a7ec4', '#4a9e6d',
  '#c4463a', '#d4a843', '#e4a853', '#9b7ed8',
  '#f87171', '#fbbf24', '#60a5fa', '#10b981',
];

// ---------------------------------------------------------------------------
// Main ColorPicker
// ---------------------------------------------------------------------------

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

  // HSV state derived from current color
  const [hue, setHue] = useState(() => hexToHsv(value)[0]);
  const [sat, setSat] = useState(() => hexToHsv(value)[1]);
  const [val, setVal] = useState(() => hexToHsv(value)[2]);

  // Sync when value changes externally
  useEffect(() => {
    setTempColor(value);
    const [h, s, v] = hexToHsv(value);
    setHue(h);
    setSat(s);
    setVal(v);
  }, [value]);

  // Emit color
  const emit = useCallback(
    (h: number, s: number, v: number) => {
      const hex = hsvToHex(h, s, v);
      setTempColor(hex);
      onChange(hex);
    },
    [onChange],
  );

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

  // --- Saturation/Value canvas drag ---
  const onCanvasDrag = useCallback(
    (cx: number, cy: number, rect: DOMRect) => {
      const s = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
      setSat(s);
      setVal(v);
      emit(hue, s, v);
    },
    [hue, emit],
  );
  const canvas = useDrag(onCanvasDrag);

  // --- Hue slider drag ---
  const onHueDrag = useCallback(
    (cx: number, _cy: number, rect: DOMRect) => {
      const h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
      setHue(h);
      emit(h, sat, val);
    },
    [sat, val, emit],
  );
  const hueSlider = useDrag(onHueDrag);

  const handlePresetClick = useCallback(
    (color: string) => {
      setTempColor(color);
      const [h, s, v] = hexToHsv(color);
      setHue(h);
      setSat(s);
      setVal(v);
      onChange(color);
    },
    [onChange],
  );

  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const presetDim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  // Pure-hue color for canvas background
  const pureHue = hsvToHex(hue, 1, 1);

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
              const [h, s, vv] = hexToHsv(v);
              setHue(h);
              setSat(s);
              setVal(vv);
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
          {/* Saturation / Value canvas */}
          <div
            ref={canvas.ref}
            onMouseDown={canvas.start}
            onTouchStart={canvas.start}
            className="relative w-full h-32 rounded-lg cursor-crosshair mb-2 select-none"
            style={{
              background: `
                linear-gradient(to top, #000, transparent),
                linear-gradient(to right, #fff, ${pureHue})
              `,
            }}
          >
            {/* Picker dot */}
            <div
              className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `${sat * 100}%`,
                top: `${(1 - val) * 100}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: tempColor,
              }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueSlider.ref}
            onMouseDown={hueSlider.start}
            onTouchStart={hueSlider.start}
            className="relative w-full h-3 rounded-full cursor-pointer mb-3 select-none"
            style={{
              background:
                'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          >
            {/* Hue thumb */}
            <div
              className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `${(hue / 360) * 100}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: pureHue,
              }}
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
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hue, setHue] = useState(() => hexToHsv(value)[0]);
  const [sat, setSat] = useState(() => hexToHsv(value)[1]);
  const [val, setVal] = useState(() => hexToHsv(value)[2]);
  const [tempColor, setTempColor] = useState(value);

  useEffect(() => {
    setTempColor(value);
    const [h, s, v] = hexToHsv(value);
    setHue(h);
    setSat(s);
    setVal(v);
  }, [value]);

  const emit = useCallback(
    (h: number, s: number, v: number) => {
      const hex = hsvToHex(h, s, v);
      setTempColor(hex);
      onChange(hex);
    },
    [onChange],
  );

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

  const onCanvasDrag = useCallback(
    (cx: number, cy: number, rect: DOMRect) => {
      const s = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height));
      setSat(s);
      setVal(v);
      emit(hue, s, v);
    },
    [hue, emit],
  );
  const canvas = useDrag(onCanvasDrag);

  const onHueDrag = useCallback(
    (cx: number, _cy: number, rect: DOMRect) => {
      const h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
      setHue(h);
      emit(h, sat, val);
    },
    [sat, val, emit],
  );
  const hueSlider = useDrag(onHueDrag);

  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const pureHue = hsvToHex(hue, 1, 1);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className={`${dim} rounded-full ring-2 ring-white/20 hover:ring-accent-gold/60 transition-all cursor-pointer`}
        style={{ backgroundColor: value }}
        title="Pick a color"
      />

      {showPicker && (
        <div className="absolute z-50 mt-2 top-full left-0 p-3 rounded-xl bg-surface border border-border shadow-2xl min-w-[200px] animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Saturation / Value canvas */}
          <div
            ref={canvas.ref}
            onMouseDown={canvas.start}
            onTouchStart={canvas.start}
            className="relative w-full h-28 rounded-lg cursor-crosshair mb-2 select-none"
            style={{
              background: `
                linear-gradient(to top, #000, transparent),
                linear-gradient(to right, #fff, ${pureHue})
              `,
            }}
          >
            <div
              className="absolute w-3 h-3 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `${sat * 100}%`,
                top: `${(1 - val) * 100}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: tempColor,
              }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueSlider.ref}
            onMouseDown={hueSlider.start}
            onTouchStart={hueSlider.start}
            className="relative w-full h-2.5 rounded-full cursor-pointer select-none"
            style={{
              background:
                'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          >
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `${(hue / 360) * 100}%`,
                transform: 'translate(-50%, -50%)',
                backgroundColor: pureHue,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
