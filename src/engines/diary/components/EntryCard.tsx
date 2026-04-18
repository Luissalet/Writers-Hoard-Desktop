import { Pencil, Pin, FileText, MessageSquare } from 'lucide-react';
import type { DiaryEntry } from '../types';
import { MOOD_CONFIG } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface EntryCardProps {
  entry: DiaryEntry;
  onEdit: () => void;
  onTogglePin: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** True when content looks like rich HTML (has tags beyond a bare <p>) */
function isRichContent(html: string): boolean {
  return /<(h[1-6]|ul|ol|blockquote|img|a |strong|em)\b/.test(html);
}

/** Strip HTML tags for plain-text preview */
function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export default function EntryCard({ entry, onEdit, onTogglePin }: EntryCardProps) {
  const { t } = useTranslation();
  const moodCfg = entry.mood ? MOOD_CONFIG[entry.mood] : null;
  const rich = isRichContent(entry.content);

  return (
    <div
      className="group relative border border-border rounded-lg bg-elevated/50 hover:bg-elevated transition p-3 cursor-pointer"
      onClick={onEdit}
    >
      {/* Top row: time + type badge + mood + pin */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-text-dim font-mono">
          {formatTime(entry.entryDate)}
        </span>
        {rich || entry.title ? (
          <span className="flex items-center gap-0.5 text-[10px] text-accent-gold/70 bg-accent-gold/5 px-1.5 py-0.5 rounded">
            <FileText size={9} />
            Entry
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-[10px] text-text-dim/70 bg-surface px-1.5 py-0.5 rounded">
            <MessageSquare size={9} />
            Quick
          </span>
        )}
        {moodCfg && (
          <span className={`text-xs ${moodCfg.color}`} title={moodCfg.label}>
            {moodCfg.emoji}
          </span>
        )}
        {entry.pinned && (
          <Pin size={10} className="text-accent-gold" />
        )}
      </div>

      {/* Title */}
      {entry.title && (
        <h4 className="text-sm font-semibold text-text-primary mb-0.5 font-serif">
          {entry.title}
        </h4>
      )}

      {/* Body — render HTML preview for rich entries, plain text for quick */}
      {rich ? (
        <div
          className="text-sm text-text-secondary leading-relaxed line-clamp-4 prose prose-invert prose-sm max-w-none
                     [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold
                     [&_img]:hidden [&_ul]:my-0 [&_ol]:my-0 [&_p]:my-0.5 [&_blockquote]:my-0.5"
          dangerouslySetInnerHTML={{ __html: entry.content }}
        />
      ) : (
        <p className="text-sm text-text-secondary leading-relaxed line-clamp-4 whitespace-pre-wrap">
          {stripHtml(entry.content)}
        </p>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] bg-accent-gold/10 text-accent-gold rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Hover actions */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`p-1 rounded transition ${
            entry.pinned
              ? 'text-accent-gold hover:text-accent-amber'
              : 'text-text-dim hover:text-accent-gold'
          }`}
          title={entry.pinned ? 'Unpin' : 'Pin'}
        >
          <Pin size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1 rounded text-text-dim hover:text-accent-gold transition"
          title={t('diary.editEntry')}
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}
