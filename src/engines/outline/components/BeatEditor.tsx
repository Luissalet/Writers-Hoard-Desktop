import { useState } from 'react';
import { X, Link2, Unlink } from 'lucide-react';
import type { OutlineBeat, BeatStatus } from '../types';
import type { Scene } from '@/engines/dialog-scene/types';

interface BeatEditorProps {
  beat: OutlineBeat;
  onSave: (changes: Partial<OutlineBeat>) => void;
  onClose: () => void;
  /** Available scenes for linking */
  scenes?: Scene[];
}

const PRESET_COLORS = [
  '#c4973b', '#e8b661', '#f59e0b', '#f97316', '#ef4444',
  '#7c5cbf', '#8b5cf6', '#3b82f6', '#10b981', '#6b7280',
  '#4a9e6d', '#06b6d4', '#ec4899', '#a855f7',
];

export default function BeatEditor({ beat, onSave, onClose, scenes = [] }: BeatEditorProps) {
  const [title, setTitle] = useState(beat.title);
  const [description, setDescription] = useState(beat.description);
  const [level, setLevel] = useState<'act' | 'chapter' | 'scene' | 'beat'>(beat.level);
  const [status, setStatus] = useState<BeatStatus>(beat.status);
  const [storyPosition, setStoryPosition] = useState(beat.storyPosition || 0);
  const [color, setColor] = useState(beat.color || '#c4973b');
  const [wordTarget, setWordTarget] = useState(beat.wordTarget || 0);
  const [linkedSceneId, setLinkedSceneId] = useState(beat.linkedSceneId || '');

  const handleSave = () => {
    onSave({
      title,
      description,
      level,
      status,
      storyPosition,
      color,
      wordTarget: wordTarget || undefined,
      linkedSceneId: linkedSceneId || undefined,
      updatedAt: Date.now(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-elevated border border-border rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Edit Beat</h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              placeholder="Beat title..."
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 resize-none"
              placeholder="What happens in this beat?"
            />
          </div>

          {/* Level and Status Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Level
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as 'act' | 'chapter' | 'scene' | 'beat')}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              >
                <option value="act">Act</option>
                <option value="chapter">Chapter</option>
                <option value="scene">Scene</option>
                <option value="beat">Beat</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BeatStatus)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              >
                <option value="empty">Empty</option>
                <option value="outlined">Outlined</option>
                <option value="drafted">Drafted</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          {/* Story Position */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Story Position: {storyPosition}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={storyPosition}
              onChange={(e) => setStoryPosition(Number(e.target.value))}
              className="w-full h-2 bg-surface border border-border rounded-lg appearance-none cursor-pointer accent-accent-gold"
            />
          </div>

          {/* Word Target */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Word Count Target
            </label>
            <input
              type="number"
              value={wordTarget}
              onChange={(e) => setWordTarget(Number(e.target.value) || 0)}
              min="0"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              placeholder="Leave blank for no target"
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#c4973b' : 'transparent',
                    borderWidth: color === c ? '3px' : '0px',
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Link to Scene */}
          {scenes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1 flex items-center gap-1.5">
                <Link2 size={14} className="text-accent-gold" />
                Linked Scene
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={linkedSceneId}
                  onChange={(e) => setLinkedSceneId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 text-sm"
                >
                  <option value="">No linked scene</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sceneNumber ? `#${s.sceneNumber} ` : ''}{s.title}
                      {s.isOmitted ? ' (omitted)' : ''}
                    </option>
                  ))}
                </select>
                {linkedSceneId && (
                  <button
                    onClick={() => setLinkedSceneId('')}
                    className="p-2 text-text-dim hover:text-danger rounded transition"
                    title="Unlink scene"
                  >
                    <Unlink size={14} />
                  </button>
                )}
              </div>
              <p className="text-xs text-text-dim mt-1">
                Link this beat to a Dialog/Scene to track it bidirectionally.
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border bg-surface text-text-primary hover:bg-surface/80 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition font-medium"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
