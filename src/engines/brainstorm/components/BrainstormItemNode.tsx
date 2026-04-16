// ============================================
// Brainstorm Engine — Item Node Component
// ============================================

import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Edit2, Trash2 } from 'lucide-react';
import type { BrainstormItem } from '../types';

interface BrainstormItemNodeProps {
  data: BrainstormItem & {
    onEdit: (item: BrainstormItem) => void;
    onDelete: (itemId: string) => void;
  };
}

// Legacy named color maps (for backward compatibility with existing items)
const NOTE_COLORS: Record<string, string> = {
  yellow: '#fef3c7',
  pink: '#fce7f3',
  blue: '#dbeafe',
  green: '#d1fae5',
  purple: '#ede9fe',
};

const NOTE_COLORS_DARK: Record<string, string> = {
  yellow: '#92400e',
  pink: '#831843',
  blue: '#0c4a6e',
  green: '#065f46',
  purple: '#4c1d95',
};

/** Darken a hex color by a factor (0–1). Used when a custom hex is provided. */
function darkenHex(hex: string, factor = 0.45): string {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Resolve a note color (named or hex) into bg + text pair. */
function resolveNoteColor(raw?: string): { bg: string; text: string } {
  if (!raw) return { bg: NOTE_COLORS.yellow, text: NOTE_COLORS_DARK.yellow };
  // Named color?
  if (NOTE_COLORS[raw]) return { bg: NOTE_COLORS[raw], text: NOTE_COLORS_DARK[raw] };
  // Hex color → use as-is for bg, darken for text
  if (raw.startsWith('#')) return { bg: raw, text: darkenHex(raw) };
  return { bg: NOTE_COLORS.yellow, text: NOTE_COLORS_DARK.yellow };
}

export default function BrainstormItemNode({ data }: BrainstormItemNodeProps) {
  const [hovering, setHovering] = useState(false);

  const renderContent = () => {
    switch (data.type) {
      case 'note': {
        const { bg: bgColor, text: textColor } = resolveNoteColor(data.color);
        return (
          <div
            style={{
              backgroundColor: bgColor,
              color: textColor,
            }}
            className="w-40 h-40 p-3 rounded-lg shadow-lg overflow-hidden flex flex-col"
          >
            <div className="flex-1 text-sm leading-relaxed overflow-auto">
              {data.content}
            </div>
          </div>
        );
      }

      case 'image': {
        return (
          <div className="w-48 h-48 rounded-lg overflow-hidden shadow-lg bg-elevated border border-border">
            {data.imageData ? (
              <img src={data.imageData} alt="Item" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                No image
              </div>
            )}
          </div>
        );
      }

      case 'entity-ref': {
        let previewData = null;
        try {
          if (data.refPreviewData) {
            previewData = JSON.parse(data.refPreviewData);
          }
        } catch {
          // Fallback if JSON parsing fails
        }

        return (
          <div className="w-56 p-3 rounded-lg bg-elevated border border-border shadow-lg">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-xs font-semibold text-accent-gold uppercase">
                  {data.refEntityType || 'Entity'}
                </p>
                <p className="text-sm font-medium text-text-primary mt-1">
                  {previewData?.title || data.refEntityId || 'Unknown'}
                </p>
                {previewData?.subtitle && (
                  <p className="text-xs text-text-muted mt-1">
                    {previewData.subtitle}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      }

      case 'text-block': {
        return (
          <div className="w-80 p-4 rounded-lg bg-elevated border border-border shadow-lg">
            <div
              className="prose prose-invert prose-sm max-w-none overflow-auto max-h-64"
              dangerouslySetInnerHTML={{ __html: data.richContent || '' }}
            />
          </div>
        );
      }

      case 'section': {
        return (
          <div
            className="p-4 rounded-lg border-2 border-dashed shadow-lg bg-black/20"
            style={{
              borderColor: data.sectionColor || '#6b7280',
              width: data.width || '300px',
              minHeight: data.height || '200px',
            }}
          >
            <p className="text-sm font-semibold text-text-primary">
              {data.label || 'Section'}
            </p>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="relative"
    >
      <Handle type="target" position={Position.Top} />
      {renderContent()}
      <Handle type="source" position={Position.Bottom} />

      {hovering && (
        <div className="absolute -top-10 right-0 flex gap-1">
          <button
            onClick={() => data.onEdit(data)}
            className="p-1.5 rounded bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => data.onDelete(data.id)}
            className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
