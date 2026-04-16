import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { User, MapPin, Clapperboard } from 'lucide-react';

export interface AutocompleteSuggestion {
  label: string;
  category: 'character' | 'location' | 'transition';
  color?: string;
}

interface ScriptAutocompleteProps {
  /** Current input value */
  value: string;
  /** All available suggestions (characters, locations, transitions) */
  suggestions: AutocompleteSuggestion[];
  /** Called when user selects a suggestion — returns the replacement string */
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  /** Anchor position (relative to parent) */
  anchorRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Whether autocomplete should be active */
  active: boolean;
}

// Standard screenplay transitions
export const SCREENPLAY_TRANSITIONS: AutocompleteSuggestion[] = [
  'CUT TO:',
  'FADE IN:',
  'FADE OUT.',
  'FADE TO BLACK.',
  'SMASH CUT TO:',
  'MATCH CUT TO:',
  'JUMP CUT TO:',
  'DISSOLVE TO:',
  'WIPE TO:',
  'TIME CUT:',
  'IRIS IN:',
  'IRIS OUT.',
  'FREEZE FRAME.',
  'INTERCUT WITH:',
].map((t) => ({ label: t, category: 'transition' as const }));

// Standard slug/scene heading prefixes
export const SLUG_PREFIXES = [
  'INT.',
  'EXT.',
  'INT./EXT.',
  'EXT./INT.',
  'I/E.',
  'E/I.',
];

const CATEGORY_ICONS = {
  character: User,
  location: MapPin,
  transition: Clapperboard,
};

const CATEGORY_COLORS = {
  character: 'text-blue-400',
  location: 'text-green-400',
  transition: 'text-amber-400',
};

export default function ScriptAutocomplete({
  value,
  suggestions,
  onSelect,
  anchorRef,
  active,
}: ScriptAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on current input
  const filtered = useMemo(() => {
    if (!value || !active) return [];
    const query = value.toLowerCase().trim();
    if (query.length < 1) return [];
    return suggestions
      .filter((s) => s.label.toLowerCase().includes(query))
      .slice(0, 8);
  }, [value, suggestions, active]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Keyboard handler — attach to the anchor element externally
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (filtered.length > 0) {
          e.preventDefault();
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        // Let parent handle
      }
    },
    [filtered, selectedIndex, onSelect],
  );

  // Attach keyboard listener to anchor
  useEffect(() => {
    const el = anchorRef.current;
    if (!el || filtered.length === 0) return;
    const handler = handleKeyDown as EventListener;
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [anchorRef, handleKeyDown, filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filtered.length > 0) {
      const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, filtered.length]);

  if (filtered.length === 0 || !active) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-30 mt-1 w-64 max-h-48 overflow-y-auto bg-elevated border border-border rounded-lg shadow-xl"
      style={{ left: 0 }}
    >
      {filtered.map((suggestion, i) => {
        const Icon = CATEGORY_ICONS[suggestion.category];
        return (
          <button
            key={`${suggestion.category}-${suggestion.label}`}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent blur
              onSelect(suggestion);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition ${
              i === selectedIndex
                ? 'bg-accent-gold/15 text-text-primary'
                : 'text-text-muted hover:bg-surface/80'
            }`}
          >
            <Icon size={13} className={CATEGORY_COLORS[suggestion.category]} />
            <span className="flex-1 truncate">{suggestion.label}</span>
            {suggestion.color && (
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: suggestion.color }}
              />
            )}
            <span className="text-[10px] text-text-dim uppercase">{suggestion.category}</span>
          </button>
        );
      })}
    </div>
  );
}
