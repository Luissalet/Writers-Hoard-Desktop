import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface PostItNodeData {
  title: string;
  color: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const POSTIT_COLORS = [
  '#fef3c7', // yellow
  '#fce7f3', // pink
  '#dbeafe', // blue
  '#dcfce7', // green
  '#f3e8ff', // purple
  '#ffedd5', // orange
];

export default function PostItNode({ data, id }: NodeProps) {
  const { t } = useTranslation();
  const d = data as unknown as PostItNodeData;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(d.title);

  // Random rotation for organic look
  const rotation = ((id.charCodeAt(0) + id.charCodeAt(1)) % 6) - 3; // -3 to 3 degrees

  const handleBlur = () => {
    if (editValue.trim() && editValue !== d.title) {
      d.onEdit(id);
    }
    setIsEditing(false);
  };

  return (
    <div
      className="relative group shadow-lg rounded-sm overflow-hidden"
      style={{
        width: '160px',
        height: '120px',
        backgroundColor: d.color || POSTIT_COLORS[0],
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 0.2s',
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

      {/* Shadow pin effect */}
      <div
        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-lg"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
        }}
      />

      {/* Content */}
      <div className="p-3 h-full flex flex-col">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBlur();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="flex-1 bg-transparent text-sm font-serif outline-none text-gray-800"
          />
        ) : (
          <h4
            onClick={() => setIsEditing(true)}
            className="flex-1 font-serif text-sm font-bold text-gray-800 cursor-pointer hover:bg-black/5 px-1 py-0.5 rounded line-clamp-5 break-words"
          >
            {d.title}
          </h4>
        )}
      </div>

      {/* Action buttons - show on hover */}
      <div className="absolute -top-2.5 -right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onEdit(id);
          }}
          className="w-5 h-5 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition shadow-md text-gray-800 text-xs"
          title={t('common.edit')}
        >
          ✏
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete(id);
          }}
          className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition shadow-md text-white text-xs"
          title={t('common.delete')}
        >
          ×
        </button>
      </div>
    </div>
  );
}
