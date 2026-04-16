// ============================================
// Full-spectrum Color Picker (Photoshop-style)
// ============================================
// Custom HSV canvas + hue slider with full drag support.
// No native <input type="color"> — everything is inline.

import { useState, useRef, useCallback, useEffect } from 'react';
import { hsvToHex, hexToHsv } from '@/utils/colorMath';
import { useDrag } from '@/hooks/useColorDrag';
import { useTranslation } from '@/i18n/useTranslation';
import {
  SaturationCanvas,
  HueSlider,
  PresetGrid,
  HexInput,
} from './color-picker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PRESETS = [
  '#c4973b', '#7c5cbf', '#4a7ec4', '#4a9e6d',
  '#c4463a', '#d4a843', '#e4a853', '#9b7ed8',
  '#f87171', '#fbbf24', '#60a5fa', '#10b981',
];

// ---------------------------------------------------------------------------
// Main ColorPicker (Dropdown variant)
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
  const { t } = useTranslation();
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
  const canvas = useDrag({ onDrag: onCanvasDrag });

  // --- Hue slider drag ---
  const onHueDrag = useCallback(
    (cx: number, _cy: number, rect: DOMRect) => {
      const h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
      setHue(h);
      emit(h, sat, val);
    },
    [sat, val, emit],
  );
  const hueSlider = useDrag({ onDrag: onHueDrag });

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

  const handleHexChange = useCallback(
    (newColor: string) => {
      setTempColor(newColor);
      onChange(newColor);
    },
    [onChange],
  );

  return (
    <div ref={containerRef} className="relative inline-block">
      {label && (
        <label className="block text-sm font-medium text-text-primary mb-2">
          {label}
        </label>
      )}

      <HexInput
        value={tempColor}
        onChange={handleHexChange}
        onHsvChange={(h, s, v) => {
          setHue(h);
          setSat(s);
          setVal(v);
        }}
        size={size}
      />

      {/* Dropdown panel */}
      {showPicker && (
        <div className="absolute z-50 mt-2 p-3 rounded-xl bg-surface border border-border shadow-2xl min-w-[220px] animate-in fade-in slide-in-from-top-2 duration-150">
          <SaturationCanvas
            hue={hue}
            saturation={sat}
            value={val}
            currentColor={tempColor}
            canvasRef={canvas.ref}
            onMouseDown={canvas.start}
            onTouchStart={canvas.start}
            size={size}
          />

          <HueSlider
            hue={hue}
            sliderRef={hueSlider.ref}
            onMouseDown={hueSlider.start}
            onTouchStart={hueSlider.start}
            size={size}
          />

          <PresetGrid
            presets={presets}
            currentColor={tempColor}
            onSelectColor={handlePresetClick}
            size={size}
          />
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="mt-2 px-3 py-1 text-xs bg-elevated border border-border rounded hover:border-accent-gold transition"
      >
        {showPicker ? t('common.close') : t('common.open')} {t('common.picker')}
      </button>
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
  const { t } = useTranslation();
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
  const canvas = useDrag({ onDrag: onCanvasDrag });

  const onHueDrag = useCallback(
    (cx: number, _cy: number, rect: DOMRect) => {
      const h = Math.max(0, Math.min(360, ((cx - rect.left) / rect.width) * 360));
      setHue(h);
      emit(h, sat, val);
    },
    [sat, val, emit],
  );
  const hueSlider = useDrag({ onDrag: onHueDrag });

  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className={`${dim} rounded-full ring-2 ring-white/20 hover:ring-accent-gold/60 transition-all cursor-pointer`}
        style={{ backgroundColor: value }}
        title={t('common.changeColor')}
      />

      {showPicker && (
        <div className="absolute z-50 mt-2 top-full left-0 p-3 rounded-xl bg-surface border border-border shadow-2xl min-w-[200px] animate-in fade-in slide-in-from-top-2 duration-150">
          <SaturationCanvas
            hue={hue}
            saturation={sat}
            value={val}
            currentColor={tempColor}
            canvasRef={canvas.ref}
            onMouseDown={canvas.start}
            onTouchStart={canvas.start}
            size={size}
          />

          <HueSlider
            hue={hue}
            sliderRef={hueSlider.ref}
            onMouseDown={hueSlider.start}
            onTouchStart={hueSlider.start}
            size={size}
          />
        </div>
      )}
    </div>
  );
}
