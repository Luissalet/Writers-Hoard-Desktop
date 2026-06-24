import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export default function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.addTag');
  const [input, setInput] = useState('');

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
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Typing or pasting a comma commits the tag(s) immediately.
    if (value.includes(',')) {
      commitInput(value);
    } else {
      setInput(value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      e.stopPropagation();
      commitInput();
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-elevated border border-border rounded-lg min-h-[42px] focus-within:border-accent-gold transition">
      {tags.map(tag => (
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
  );
}
