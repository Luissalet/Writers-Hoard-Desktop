// ============================================
// Brainstorm Engine — Canvas Component
// ============================================

import { useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
} from '@xyflow/react';
import { Lightbulb, Plus, Type, Image, Grid3x3 } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import BrainstormItemNode from './BrainstormItemNode';
import BrainstormItemEditor from './BrainstormItemEditor';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import type { BrainstormItem, BrainstormConnection } from '../types';
import { generateId } from '@/utils/idGenerator';

interface BrainstormCanvasProps {
  projectId: string;
  boardId: string;
  items: BrainstormItem[];
  connections: BrainstormConnection[];
  onAddItem: (item: BrainstormItem) => Promise<void>;
  onUpdateItem: (id: string, changes: Partial<BrainstormItem>) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onAddConnection: (connection: BrainstormConnection) => Promise<void>;
  onUpdateConnection: (id: string, changes: Partial<BrainstormConnection>) => Promise<void>;
  onDeleteConnection: (id: string) => Promise<void>;
}

const nodeTypes = {
  brainstormItem: BrainstormItemNode,
};

export default function BrainstormCanvas({
  projectId,
  boardId,
  items,
  connections,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onAddConnection,
}: BrainstormCanvasProps) {
  const [editingItem, setEditingItem] = useState<BrainstormItem | null>(null);
  const [selectedColor, setSelectedColor] = useState('#fef3c7');

  // Convert items to ReactFlow nodes
  const nodes = items.map((item) => ({
    id: item.id,
    data: {
      ...item,
      onEdit: (editItem: BrainstormItem) => setEditingItem(editItem),
      onDelete: (itemId: string) => handleDeleteItem(itemId),
    },
    position: item.position,
    type: 'brainstormItem',
  }));

  // Convert connections to ReactFlow edges
  const edges = connections.map((conn) => ({
    id: conn.id,
    source: conn.sourceId,
    target: conn.targetId,
    label: conn.label,
    style: {
      stroke: conn.color || '#9ca3af',
      strokeDasharray:
        conn.style === 'dashed' ? '5,5' : conn.style === 'dotted' ? '2,2' : 'none',
    },
  }));

  const [flowNodes, , onNodesChange] = useNodesState(nodes);
  const [flowEdges, , onEdgesChange] = useEdgesState(edges);

  const handleAddNote = async () => {
    const newItem: BrainstormItem = {
      id: generateId('item'),
      boardId,
      projectId,
      type: 'note',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      content: 'New note',
      color: selectedColor,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await onAddItem(newItem);
  };

  const handleAddTextBlock = async () => {
    const newItem: BrainstormItem = {
      id: generateId('item'),
      boardId,
      projectId,
      type: 'text-block',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      richContent: '<p>Start writing...</p>',
      width: 400,
      height: 300,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await onAddItem(newItem);
  };

  const handleAddSection = async () => {
    const newItem: BrainstormItem = {
      id: generateId('item'),
      boardId,
      projectId,
      type: 'section',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      label: 'New Section',
      sectionColor: '#6b7280',
      width: 300,
      height: 200,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await onAddItem(newItem);
  };

  const handleAddImage = async () => {
    // Create file input for image upload
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const imageData = event.target?.result as string;
        const newItem: BrainstormItem = {
          id: generateId('item'),
          boardId,
          projectId,
          type: 'image',
          position: { x: Math.random() * 400, y: Math.random() * 400 },
          imageData,
          width: 300,
          height: 300,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await onAddItem(newItem);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleDeleteItem = async (itemId: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      await onDeleteItem(itemId);
    }
  };

  const handleNodeDragStop = async (_event: any, node: any) => {
    await onUpdateItem(node.id, {
      position: node.position,
    });
  };

  const handleConnect = async (connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const newConnection: BrainstormConnection = {
      id: generateId('connection'),
      boardId,
      sourceId: connection.source,
      targetId: connection.target,
      style: 'solid',
      color: '#9ca3af',
    };
    await onAddConnection(newConnection);
  };

  return (
    <div className="relative w-full h-screen">
      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-surface to-transparent p-4 flex items-center gap-2">
        <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-surface/80 border border-border backdrop-blur">
          <Lightbulb size={16} className="text-accent-gold" />
          <span className="text-sm font-semibold text-text-primary">Brainstorm</span>
        </div>

        <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-surface/80 border border-border backdrop-blur">
          <button
            onClick={handleAddNote}
            className="p-1.5 text-text-muted hover:text-text-primary transition flex items-center gap-1.5"
            title="Add Note"
          >
            <Plus size={14} />
            <span className="text-xs font-medium">Note</span>
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={handleAddTextBlock}
            className="p-1.5 text-text-muted hover:text-text-primary transition flex items-center gap-1.5"
            title="Add Text Block"
          >
            <Type size={14} />
            <span className="text-xs font-medium">Text</span>
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={handleAddImage}
            className="p-1.5 text-text-muted hover:text-text-primary transition flex items-center gap-1.5"
            title="Add Image"
          >
            <Image size={14} />
            <span className="text-xs font-medium">Image</span>
          </button>

          <div className="w-px h-4 bg-border" />

          <button
            onClick={handleAddSection}
            className="p-1.5 text-text-muted hover:text-text-primary transition flex items-center gap-1.5"
            title="Add Section"
          >
            <Grid3x3 size={14} />
            <span className="text-xs font-medium">Section</span>
          </button>
        </div>

        <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-surface/80 border border-border backdrop-blur ml-4">
          <span className="text-xs text-text-muted mr-2">Note Color:</span>
          <InlineColorPicker value={selectedColor} onChange={setSelectedColor} size="sm" />
        </div>
      </div>

      {/* ReactFlow Canvas */}
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#374151" gap={16} size={1} />
        <Controls />
        <MiniMap
          style={{
            backgroundColor: '#1f2937',
            border: '1px solid #4b5563',
          }}
        />
      </ReactFlow>

      {/* Editor Modal */}
      {editingItem && (
        <BrainstormItemEditor
          item={editingItem}
          onSave={async (changes) => {
            await onUpdateItem(editingItem.id, changes);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
