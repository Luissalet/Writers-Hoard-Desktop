import { Pencil, Pin } from 'lucide-react';
import type { DiaryEntry } from '../types';
import { MOOD_CONFIG } from '../types';

interface EntryCardProps {
  entry: DiaryEntry;
  onEdit: () => void;
  onTogglePin: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function EntryCard({ entry, onEdit, onTogglePin }: EntryCardProps) {
  const moodCfg = entry.mood ? MOOD_CONFIG[entry.mood] : null;

  return (
    <div className="group relative border border-border rounded-lg bg-elevated/50 hover:bg-elevated transition p-3">
      {/* Top row: time + mood + pin */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-text-dim font-mono">
          {formatTime(entry.entryDate)}
        </span>
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

      {/* Body */}
      <p className="text-sm text-text-secondary leading-relaxed line-clamp-4 whitespace-pre-wrap">
        {entry.content}
      </p>

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
          onClick={onTogglePin}
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
          onClick={onEdit}
          className="p-1 rounded text-text-dim hover:text-accent-gold transition"
          title="Edit entry"
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}
