import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Edit3, Trash2 } from 'lucide-react';

interface ShapeNodeData {
  title: string;
  shape: 'rectangle' | 'circle' | 'diamond' | 'pill';
  color: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ShapeNode({ data, id }: NodeProps) {
  const d = data as unknown as ShapeNodeData;
  const shape = d.shape || 'rectangle';

  // Determine dimensions based on shape
  const getShapeStyle = () => {
    const base = {
      width: '120px',
      height: '120px',
      backgroundColor: `${d.color}30`,
      borderColor: d.color,
      borderWidth: '2px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative' as const,
    };

    switch (shape) {
      case 'circle':
        return {
          ...base,
          borderRadius: '50%',
        };
      case 'diamond':
        return {
          ...base,
          transform: 'rotate(45deg)',
          borderRadius: '0',
        };
      case 'pill':
        return {
          ...base,
          width: '160px',
          borderRadius: '60px',
        };
      case 'rectangle':
      default:
        return {
          ...base,
          borderRadius: '8px',
        };
    }
  };

  const shapeStyle = getShapeStyle();

  return (
    <div style={shapeStyle} className="group shadow-lg">
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

      {/* Text - adjust for diamond rotation */}
      <h4
        className="font-serif font-bold text-sm text-text-primary text-center px-2"
        style={{
          transform: shape === 'diamond' ? 'rotate(-45deg)' : 'none',
        }}
      >
        {d.title}
      </h4>

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
