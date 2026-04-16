// ============================================
// Searchable Icon Picker — full Lucide library
// ============================================
// Renders a searchable grid of every Lucide icon.
// Selected icon is stored by name string (e.g. 'BookOpen').

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { icons, type LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Curated "featured" icons shown first when search is empty
// ---------------------------------------------------------------------------
const FEATURED_ICONS = [
  'BookOpen', 'Feather', 'Scroll', 'PenTool', 'Library', 'Lightbulb',
  'Layers', 'Globe', 'Map', 'Compass', 'Castle', 'Crown',
  'Sword', 'Shield', 'Flame', 'Star', 'Moon', 'Sun',
  'Heart', 'Skull', 'Ghost', 'Trees', 'Mountain', 'Anchor',
  'Gem', 'Sparkles', 'Wand2', 'Drama', 'Music', 'Camera',
  'Eye', 'Brain', 'Rocket', 'Zap', 'Puzzle', 'Target',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert PascalCase icon name to searchable lowercase words */
function iconNameToWords(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
}

// Pre-build the icon entries list (name -> component) once
const ALL_ICON_ENTRIES: [string, LucideIcon][] = Object.entries(icons) as [string, LucideIcon][];

// ---------------------------------------------------------------------------
// IconPicker (Dropdown variant — used in CreateProjectModal)
// ---------------------------------------------------------------------------

interface IconPickerProps {
  /** Currently selected icon name */
  value?: string;
  /** Called with icon name on selection */
  onChange: (iconName: string) => void;
  /** Preview color for the icon */
  color?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export default function IconPicker({
  value,
  onChange,
  color = '#c4973b',
  size = 'md',
}: IconPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  // Filter icons
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      // Show featured first, then the rest
      const featuredSet = new Set(FEATURED_ICONS);
      const featured = FEATURED_ICONS
        .filter(name => icons[name as keyof typeof icons])
        .map(name => [name, icons[name as keyof typeof icons]] as [string, LucideIcon]);
      const rest = ALL_ICON_ENTRIES
        .filter(([name]) => !featuredSet.has(name))
        .slice(0, 200); // cap for performance
      return [...featured, ...rest];
    }

    return ALL_ICON_ENTRIES.filter(([name]) => {
      const words = iconNameToWords(name);
      return words.includes(query) || name.toLowerCase().includes(query);
    }).slice(0, 120);
  }, [search]);

  const SelectedIcon = value ? (icons[value as keyof typeof icons] || null) : null;
  const btnSize = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const iconSize = size === 'sm' ? 18 : 22;

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger button — shows current icon */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${btnSize} rounded-xl flex items-center justify-center border border-border hover:border-accent-gold/50 bg-elevated transition`}
        style={{ backgroundColor: `${color}15` }}
        title={value ? t('common.iconLabel', { name: value }) : t('common.pickIcon')}
      >
        {SelectedIcon ? (
          <SelectedIcon size={iconSize} style={{ color }} />
        ) : (
          <Sparkles size={iconSize} style={{ color }} />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 p-3 rounded-xl bg-surface border border-border shadow-2xl w-[320px] animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Search bar */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.searchIcons')}
              className="w-full pl-8 pr-8 py-2 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-border rounded transition"
              >
                <X size={12} className="text-text-dim" />
              </button>
            )}
          </div>

          {/* Icon grid */}
          <div className="grid grid-cols-8 gap-1 max-h-[240px] overflow-y-auto pr-1 scrollbar-thin">
            {filtered.map(([name, Icon]) => {
              const isSelected = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => { onChange(name); setOpen(false); }}
                  className={`p-2 rounded-lg flex items-center justify-center transition ${
                    isSelected
                      ? 'bg-accent-gold/20 ring-1 ring-accent-gold/50'
                      : 'hover:bg-elevated'
                  }`}
                  title={name}
                >
                  <Icon size={18} style={{ color: isSelected ? color : undefined }} className={isSelected ? '' : 'text-text-muted'} />
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <p className="text-center text-text-dim text-xs py-6">{t('common.noIconsFound')}</p>
          )}

          {/* Clear selection */}
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="mt-2 w-full text-center text-xs text-text-dim hover:text-text-muted py-1 transition"
            >
              {t('common.resetDefault')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact inline variant (for ProjectCard hover menu)
// ---------------------------------------------------------------------------

interface InlineIconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
  color?: string;
}

export function InlineIconPicker({ value, onChange, color = '#c4973b' }: InlineIconPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Calculate position from button rect — dropdown renders above via portal
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + window.scrollY - 8, // 8px gap above button
      left: rect.right + window.scrollX,   // align right edge
    });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      const featuredSet = new Set(FEATURED_ICONS);
      const featured = FEATURED_ICONS
        .filter(name => icons[name as keyof typeof icons])
        .map(name => [name, icons[name as keyof typeof icons]] as [string, LucideIcon]);
      const rest = ALL_ICON_ENTRIES
        .filter(([name]) => !featuredSet.has(name))
        .slice(0, 200);
      return [...featured, ...rest];
    }
    return ALL_ICON_ENTRIES.filter(([name]) => {
      const words = iconNameToWords(name);
      return words.includes(query) || name.toLowerCase().includes(query);
    }).slice(0, 120);
  }, [search]);

  const handleSelect = useCallback((name: string) => {
    onChange(name);
    setOpen(false);
  }, [onChange]);

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999] p-3 rounded-xl bg-surface border border-border shadow-2xl w-[280px] animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{
        top: pos.top,
        left: pos.left,
        transform: 'translate(-100%, -100%)', // anchor bottom-right to the position
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.searchIcons')}
          className="w-full pl-7 pr-7 py-1.5 text-xs bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          onClick={(e) => e.stopPropagation()}
        />
        {search && (
          <button
            onClick={(e) => { e.stopPropagation(); setSearch(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-border rounded transition"
          >
            <X size={10} className="text-text-dim" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1 max-h-[180px] overflow-y-auto pr-1 scrollbar-thin">
        {filtered.map(([name, Icon]) => {
          const isSelected = name === value;
          return (
            <button
              key={name}
              type="button"
              onClick={(e) => { e.stopPropagation(); handleSelect(name); }}
              className={`p-1.5 rounded-md flex items-center justify-center transition ${
                isSelected
                  ? 'bg-accent-gold/20 ring-1 ring-accent-gold/50'
                  : 'hover:bg-elevated'
              }`}
              title={name}
            >
              <Icon size={16} style={{ color: isSelected ? color : undefined }} className={isSelected ? '' : 'text-text-muted'} />
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-text-dim text-xs py-4">{t('common.noIconsFound')}</p>
      )}

      {value && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
          className="mt-1.5 w-full text-center text-xs text-text-dim hover:text-text-muted py-1 transition"
        >
          {t('common.resetDefault')}
        </button>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 rounded-lg hover:bg-accent-gold/20 transition"
        title={t('common.changeIcon')}
      >
        <Sparkles size={14} className="text-accent-gold" />
      </button>
      {dropdown}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper: resolve icon name → component (used in ProjectCard, etc.)
// ---------------------------------------------------------------------------
export function resolveIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  return (icons[name as keyof typeof icons] as LucideIcon) || null;
}

// Re-export Sparkles for the default display
import { Sparkles } from 'lucide-react';
