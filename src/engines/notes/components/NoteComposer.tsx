import { useRef, useState } from 'react';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { NOTE_KINDS, NOTE_KIND_META, type NoteKind } from '../types';

export interface NoteDraft {
  kind: NoteKind;
  text: string;
  source?: string;
  tags: string[];
}

interface NoteComposerProps {
  onSubmit: (draft: NoteDraft) => void;
  /** Tags already used in this scope — offered as quick picks. */
  tagSuggestions?: string[];
  autoFocus?: boolean;
  /** Compact skin for the quick-capture modal (no card chrome). */
  bare?: boolean;
}

/**
 * The capture box. One rule drives the whole design: typing a thought must
 * never cost more than "click, type, Enter". Kind, source and tags are all
 * optional and never block the primary path.
 */
export default function NoteComposer({
  onSubmit,
  tagSuggestions = [],
  autoFocus = false,
  bare = false,
}: NoteComposerProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<NoteKind>('note');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim()) return;
    onSubmit({ kind, text, source: source.trim() || undefined, tags });
    setText('');
    setSource('');
    setTags([]);
    setTagInput('');
    setShowDetails(false);
    textRef.current?.focus();
  };

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '');
    if (!tag || tags.includes(tag)) return;
    setTags([...tags, tag]);
    setTagInput('');
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Quotes almost always want an attribution, so the field opens itself.
  const pickKind = (next: NoteKind) => {
    setKind(next);
    if (next === 'quote') setShowDetails(true);
    textRef.current?.focus();
  };

  const unusedSuggestions = tagSuggestions.filter((tg) => !tags.includes(tg)).slice(0, 6);

  return (
    <div
      className={
        bare
          ? 'space-y-2'
          : 'bg-surface border border-border rounded-xl p-3 space-y-2 shadow-sm'
      }
    >
      {/* Kind chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {NOTE_KINDS.map((k) => {
          const { icon: Icon, color } = NOTE_KIND_META[k];
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${
                active
                  ? 'border-transparent text-deep font-semibold'
                  : 'border-border text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
              style={active ? { backgroundColor: color } : undefined}
            >
              <Icon size={13} />
              {t(`notes.kind.${k}`)}
            </button>
          );
        })}
      </div>

      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleTextKeyDown}
        autoFocus={autoFocus}
        rows={bare ? 3 : 2}
        placeholder={kind === 'quote' ? t('notes.quotePlaceholder') : t('notes.placeholder')}
        className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition resize-none"
      />

      {showDetails && (
        <div className="space-y-2">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t('notes.sourcePlaceholder')}
            className="w-full px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm text-text-primary placeholder:text-text-dim outline-none focus:border-accent-gold transition"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <TagIcon size={13} className="text-text-dim" />
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-plum-light/15 text-accent-plum-light text-xs"
              >
                #{tag}
                <button type="button" onClick={() => setTags(tags.filter((x) => x !== tag))}>
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  e.stopPropagation();
                  addTag(tagInput);
                } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                  setTags(tags.slice(0, -1));
                }
              }}
              placeholder={t('common.addTag')}
              className="flex-1 min-w-[8rem] px-2 py-0.5 bg-transparent text-xs text-text-primary placeholder:text-text-dim outline-none"
            />
          </div>
          {unusedSuggestions.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {unusedSuggestions.map((tg) => (
                <button
                  key={tg}
                  type="button"
                  onClick={() => addTag(tg)}
                  className="px-2 py-0.5 rounded-full border border-border text-xs text-text-dim hover:text-text-primary hover:bg-elevated transition"
                >
                  #{tg}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs text-text-dim hover:text-text-primary transition"
        >
          {showDetails ? t('common.less') : t('notes.addDetails')}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-text-dim hidden sm:inline">{t('notes.saveHint')}</span>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={15} /> {t('notes.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
