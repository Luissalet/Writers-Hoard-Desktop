import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import type { DiaryMood } from '../types';
import { MOOD_CONFIG } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface QuickEntryProps {
  onSubmit: (content: string, mood?: DiaryMood) => Promise<void>;
}

export default function QuickEntry({ onSubmit }: QuickEntryProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [mood, setMood] = useState<DiaryMood | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    await onSubmit(trimmed, mood || undefined);
    setText('');
    setMood('');
    setSubmitting(false);
    inputRef.current?.focus();
  };

  return (
    <div className="border border-border rounded-xl bg-surface/50 p-3">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('diary.quickEntryPlaceholder')}
          rows={1}
          className="flex-1 resize-none bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="self-end p-2.5 rounded-lg bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
          title={t('diary.saveEntryShort')}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Mood selector row */}
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Mood:</span>
        {Object.entries(MOOD_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setMood(mood === key ? '' : (key as DiaryMood))}
            className={`px-2 py-0.5 rounded-full text-xs transition ${
              mood === key
                ? 'bg-accent-gold/20 ring-1 ring-accent-gold'
                : 'bg-elevated hover:bg-elevated/80'
            }`}
            title={cfg.label}
          >
            {cfg.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
