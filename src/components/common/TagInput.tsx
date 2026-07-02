import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** Known tags to suggest as the user types (e.g. tags already used elsewhere). */
  suggestions?: string[];
}

export default function TagInput({ tags, onChange, placeholder, suggestions = [] }: TagInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.addTag');
  const [input, setInput] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  /** Add one or more tags from text, splitting on commas. Fires on Enter, comma, blur and paste. */
  const commitInput = (raw: string = input) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const next = [...tags];
      for (const part of parts) {
        if (!next.includes(part)) next.push(part);
      }
      onChange(next);
    }
    setInput('');
    setActiveIndex(-1);
  };

  const selectSuggestion = (value: string) => {
    if (!tags.includes(value)) onChange([...tags, value]);
    setInput('');
    setActiveIndex(-1);
  };

  /** Existing tags that match what's typed and aren't already applied. */
  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => !tags.includes(s) && s.toLowerCase().includes(q))
      .slice(0, 8);
  }, [input, suggestions, tags]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setActiveIndex(-1);
    // Typing or pasting a comma commits the tag(s) immediately.
    if (value.includes(',')) {
      commitInput(value);
    } else {
      setInput(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === 'Tab' && !e.shiftKey && matches.length > 0) {
      // Tab accepts the highlighted suggestion (or the first match) without a click.
      e.preventDefault();
      selectSuggestion(activeIndex >= 0 ? matches[activeIndex] : matches[0]);
    } else if (e.key === 'Enter') {
      // Pick the highlighted suggestion if any, otherwise commit the typed text.
      if (activeIndex >= 0 && matches[activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        selectSuggestion(matches[activeIndex]);
      } else if (input.trim()) {
        e.preventDefault();
        e.stopPropagation();
        commitInput();
      }
    } else if (e.key === 'Escape' && matches.length > 0) {
      // Close the dropdown without bubbling up to (e.g.) a modal close handler.
      e.preventDefault();
      e.stopPropagation();
      setInput('');
      setActiveIndex(-1);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((tg) => tg !== tag));
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 p-2 bg-elevated border border-border rounded-lg min-h-[42px] focus-within:border-accent-gold transition">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-plum/20 text-accent-plum-light text-sm rounded"
          >
            {tag}
            <button onClick={() => removeTag(tag)} className="hover:text-white transition">
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => commitInput()}
          placeholder={tags.length === 0 ? resolvedPlaceholder : ''}
          className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-text-primary text-sm"
        />
      </div>

      {matches.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 bottom-full mb-1 max-h-48 overflow-y-auto bg-elevated border border-border rounded-lg shadow-xl py-1">
          {matches.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                // mouseDown + preventDefault keeps the input focused, so its onBlur
                // doesn't fire and commit the partial text before we select.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(s);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  i === activeIndex
                    ? 'bg-accent-gold/20 text-foreground'
                    : 'text-muted hover:bg-surface hover:text-foreground'
                }`}
              >
                <span className="text-accent-plum-light">#</span>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
