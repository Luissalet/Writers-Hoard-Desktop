import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical } from 'lucide-react';
import type { OutlineBeat } from '../types';
import { BEAT_STATUS_CONFIG, BEAT_LEVEL_INDENT, BEAT_LEVEL_LABEL } from '../types';
import BeatEditor from './BeatEditor';

interface BeatListProps {
  beats: OutlineBeat[];
  onAddBeat: (beat: Omit<OutlineBeat, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateBeat: (beatId: string, changes: Partial<OutlineBeat>) => void;
  onDeleteBeat: (beatId: string) => void;
}

export default function BeatList({
  beats,
  onAddBeat,
  onUpdateBeat,
  onDeleteBeat,
}: BeatListProps) {
  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(new Set());
  const [editingBeat, setEditingBeat] = useState<OutlineBeat | null>(null);

  const toggleExpanded = (beatId: string) => {
    const newExpanded = new Set(expandedBeats);
    if (newExpanded.has(beatId)) {
      newExpanded.delete(beatId);
    } else {
      newExpanded.add(beatId);
    }
    setExpandedBeats(newExpanded);
  };

  const getChildBeats = (parentId: string) => {
    return beats.filter((b) => b.parentId === parentId).sort((a, b) => a.order - b.order);
  };

  const hasChildren = (beatId: string) => {
    return beats.some((b) => b.parentId === beatId);
  };

  const renderBeatRow = (beat: OutlineBeat, depth: number = 0) => {
    const isExpanded = expandedBeats.has(beat.id);
    const hasChildBeats = hasChildren(beat.id);
    const statusConfig = BEAT_STATUS_CONFIG[beat.status];

    return (
      <div key={beat.id}>
        <div
          className="flex items-center gap-2 p-3 hover:bg-surface/80 rounded-lg transition border border-transparent hover:border-border group"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {/* Expand/Collapse */}
          {hasChildBeats ? (
            <button
              onClick={() => toggleExpanded(beat.id)}
              className="text-text-dim hover:text-text-primary transition"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <div className="w-4" />
          )}

          {/* Drag Handle */}
          <GripVertical size={14} className="text-text-dim opacity-0 group-hover:opacity-100 transition" />

          {/* Color Dot */}
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: beat.color || '#c4973b' }}
          />

          {/* Level Label */}
          <span className="text-xs font-medium text-text-dim uppercase w-12 flex-shrink-0">
            {BEAT_LEVEL_LABEL[beat.level]}
          </span>

          {/* Title and Description */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-text-primary truncate">
              {beat.title}
            </div>
            {beat.description && (
              <div className="text-xs text-text-dim line-clamp-1">
                {beat.description}
              </div>
            )}
          </div>

          {/* Story Position */}
          {beat.storyPosition !== undefined && (
            <div className="text-xs text-text-dim px-2 py-1 bg-surface rounded flex-shrink-0">
              {beat.storyPosition}%
            </div>
          )}

          {/* Status Badge */}
          <div
            className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${statusConfig.color}`}
          >
            {statusConfig.label}
          </div>

          {/* Actions */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <button
              onClick={() => setEditingBeat(beat)}
              className="p-1.5 hover:bg-accent-gold/10 rounded text-accent-gold transition"
              title="Edit"
            >
              <div className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDeleteBeat(beat.id)}
              className="p-1.5 hover:bg-red-500/10 rounded text-red-500 transition"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Child Beats */}
        {isExpanded && getChildBeats(beat.id).map((child) => renderBeatRow(child, depth + 1))}
      </div>
    );
  };

  // Render only top-level beats (no parent)
  const topLevelBeats = beats.filter((b) => !b.parentId).sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {/* Add Button */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            const newBeat: Omit<OutlineBeat, 'id' | 'createdAt' | 'updatedAt'> = {
              outlineId: beats[0]?.outlineId || '',
              projectId: beats[0]?.projectId || '',
              order: beats.length,
              level: 'beat',
              title: 'New Beat',
              description: '',
              status: 'empty',
              tags: [],
            };
            onAddBeat(newBeat);
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
        >
          <Plus size={13} />
          Add Beat
        </button>
      </div>

      {/* Beat List */}
      <div className="border border-border rounded-xl bg-surface/30 overflow-hidden">
        {topLevelBeats.length === 0 ? (
          <div className="p-8 text-center text-text-dim">
            <p className="text-sm">No beats yet. Click "Add Beat" to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {topLevelBeats.map((beat) => renderBeatRow(beat))}
          </div>
        )}
      </div>

      {/* Beat Editor Modal */}
      {editingBeat && (
        <BeatEditor
          beat={editingBeat}
          onSave={(changes) => {
            onUpdateBeat(editingBeat.id, changes);
          }}
          onClose={() => setEditingBeat(null)}
        />
      )}
    </div>
  );
}
