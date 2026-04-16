import { useState, useRef } from 'react';
import { ArrowLeft, Trash2, Pin, Clock } from 'lucide-react';
import type { DiaryEntry, DiaryMood } from '../types';
import { MOOD_CONFIG } from '../types';
import TiptapEditor from '@/components/editor/TiptapEditor';

interface EntryEditorProps {
  entry: DiaryEntry;
  isNew?: boolean;
  onSave: (changes: Partial<DiaryEntry>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export default function EntryEditor({ entry, isNew, onSave, onDelete, onClose }: EntryEditorProps) {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [entryDate, setEntryDate] = useState(entry.entryDate);
  const [mood, setMood] = useState<DiaryMood | ''>(entry.mood || '');
  const [tagsText, setTagsText] = useState(entry.tags.join(', '));
  const [pinned, setPinned] = useState(entry.pinned);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef(content);

  // Keep a ref for TipTap's onChange (avoids stale closure issues)
  const handleContentChange = (html: string) => {
    contentRef.current = html;
    setContent(html);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await onSave({
      title: title.trim(),
      content: contentRef.current,
      entryDate,
      mood: mood || undefined,
      tags,
      pinned,
    });
    setSaving(false);
  };

  const setToNow = () => {
    setEntryDate(new Date().toISOString().slice(0, 16));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              onClick={() => {
                if (confirm('Delete this entry permanently?')) onDelete();
              }}
              className="p-2 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition"
              title="Delete entry"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-accent-gold text-white rounded-lg hover:bg-accent-amber transition font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : isNew ? 'Create Entry' : 'Save'}
          </button>
        </div>
      </div>

      {/* Date & time + pin */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-dim">Date & time</label>
          <input
            type="datetime-local"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
          <button
            onClick={setToNow}
            className="p-1.5 rounded-lg text-text-dim hover:text-accent-gold hover:bg-accent-gold/10 transition"
            title="Set to now"
          >
            <Clock size={13} />
          </button>
        </div>
        <button
          onClick={() => setPinned(!pinned)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition ${
            pinned
              ? 'bg-accent-gold/20 text-accent-gold'
              : 'bg-elevated text-text-dim hover:text-accent-gold'
          }`}
        >
          <Pin size={11} />
          {pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      {/* Mood row */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-dim mr-1">Mood:</span>
        {Object.entries(MOOD_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setMood(mood === key ? '' : (key as DiaryMood))}
            className={`px-2.5 py-1 rounded-full text-xs transition ${
              mood === key
                ? 'bg-accent-gold/20 ring-1 ring-accent-gold'
                : 'bg-elevated hover:bg-elevated/80'
            }`}
            title={cfg.label}
          >
            {cfg.emoji} {cfg.label}
          </button>
        ))}
      </div>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full px-3 py-2 text-lg font-serif bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
      />

      {/* Rich text editor */}
      <TiptapEditor
        content={content}
        onChange={handleContentChange}
        placeholder="Write your thoughts..."
      />

      {/* Tags */}
      <div>
        <label className="text-xs text-text-dim mb-1 block">Tags (comma-separated)</label>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="inspiration, research, idea..."
          className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
        />
      </div>
    </div>
  );
}
