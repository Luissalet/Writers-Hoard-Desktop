import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Edit3, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface ImageNodeData {
  title?: string;
  image: string;
  color: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ImageNode({ data, id }: NodeProps) {
  const { t } = useTranslation();
  const d = data as unknown as ImageNodeData;

  return (
    <div
      className="rounded-lg overflow-hidden shadow-lg border border-[#2a2a3a] bg-[#1a1a25] group"
      style={{ width: '200px' }}
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

      {/* Image container */}
      <div className="relative bg-[#07070d] overflow-hidden" style={{ height: '180px' }}>
        {d.image && (
          <img src={d.image} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      {/* Caption area */}
      {d.title && (
        <div className="px-3 py-2 bg-[#111119] border-t border-[#2a2a3a]">
          <p className="text-xs text-text-primary font-serif font-semibold line-clamp-2">
            {d.title}
          </p>
        </div>
      )}

      {/* Action buttons - show on hover */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10">
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
    </div>
  );
}
