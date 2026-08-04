import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User, Zap, Lightbulb, StickyNote, Edit3, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

// Icon + color config per semantic type. Labels are translated via i18n
// (`yarn.node.<type>`), not hardcoded here.
const NODE_TYPES_CONFIG = {
  character: { icon: User, color: '#c4973b' },
  event: { icon: Zap, color: '#4a7ec4' },
  concept: { icon: Lightbulb, color: '#7c5cbf' },
  note: { icon: StickyNote, color: '#4a9e6d' },
};

interface SemanticNodeData {
  title: string;
  content: string;
  nodeType: 'character' | 'event' | 'concept' | 'note';
  color: string;
  image?: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SemanticNode({ data, id }: NodeProps) {
  const { t } = useTranslation();
  const d = data as unknown as SemanticNodeData;
  const config = NODE_TYPES_CONFIG[d.nodeType] || NODE_TYPES_CONFIG.note;
  const Icon = config.icon;

  return (
    <div
      className="px-4 py-3 rounded-xl border-2 shadow-lg min-w-[160px] max-w-[260px] relative group"
      style={{ backgroundColor: '#1a1a25', borderColor: d.color || config.color }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-white/30 !w-2 !h-2 !border-0"
      />

      {/* Pin */}
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white/20"
        style={{ backgroundColor: d.color || config.color }}
      />

      {/* Action buttons - show on hover */}
      <div className="absolute -top-3 -right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onEdit(id);
          }}
          className="w-6 h-6 rounded-full bg-[#c4973b] flex items-center justify-center hover:bg-[#e4a853] transition shadow-md"
          title={t('common.edit')}
        >
          <Edit3 size={11} className="text-[#07070d]" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete(id);
          }}
          className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-500 transition shadow-md"
          title={t('common.delete')}
        >
          <Trash2 size={11} className="text-white" />
        </button>
      </div>

      {/* Image */}
      {d.image && (
        <div className="mb-2 -mx-2 -mt-1 overflow-hidden rounded-lg">
          <img src={d.image} alt="" className="w-full max-h-40 object-contain" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} style={{ color: d.color || config.color }} />
        <span
          className="text-xs uppercase tracking-wider"
          style={{ color: d.color || config.color }}
        >
          {t(`yarn.node.${d.nodeType}`)}
        </span>
      </div>
      <h4 className="font-serif font-bold text-sm text-text-primary leading-tight">
        {d.title}
      </h4>
      {d.content && (
        <p className="text-xs text-text-muted mt-1 line-clamp-3">{d.content}</p>
      )}
    </div>
  );
}
