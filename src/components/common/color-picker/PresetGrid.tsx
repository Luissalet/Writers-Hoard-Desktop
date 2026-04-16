/**
 * Preset Color Grid Component
 * Renders quick-access preset color buttons.
 */

// React import not needed with JSX transform

export interface PresetGridProps {
  presets: string[];
  currentColor: string;
  onSelectColor: (color: string) => void;
  size?: 'sm' | 'md';
}

export function PresetGrid({
  presets,
  currentColor,
  onSelectColor,
  size = 'md',
}: PresetGridProps) {
  if (presets.length === 0) return null;

  const presetDim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <>
      <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
        Quick picks
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onSelectColor(color)}
            className={`${presetDim} rounded-full transition-transform border-2 ${
              currentColor.toLowerCase() === color.toLowerCase()
                ? 'border-accent-gold scale-110'
                : 'border-transparent hover:scale-110'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </>
  );
}
