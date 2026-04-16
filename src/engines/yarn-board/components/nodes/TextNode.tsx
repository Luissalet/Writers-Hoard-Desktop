import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Edit3, Trash2 } from 'lucide-react';

interface TextNodeData {
  content: string;
  color: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function TextNode({ data, id }: NodeProps) {
  const d = data as unknown as TextNodeData;

  return (
    <div
      className="relative group"
      style={{
        minWidth: '200px',
        maxWidth: '400px',
      }}
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

      {/* Text content - no border, just text on canvas */}
      <div className="px-2 py-1 text-sm text-text-primary font-serif whitespace-pre-wrap break-words">
        {d.content}
      </div>

      {/* Action buttons - show on hover */}
      <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onEdit(id);
          }}
          className="w-6 h-6 rounded-full bg-[#c4973b] flex items-center justify-center hover:bg-[#e4a853] transition shadow-md"
          title="Edit"
        >
          <Edit3 size={11} className="text-[#07070d]" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete(id);
          }}
          className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-500 transition shadow-md"
          title="Delete"
        >
          <Trash2 size={11} className="text-white" />
        </button>
      </div>
    </div>
  );
}
