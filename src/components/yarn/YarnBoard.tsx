import { useCallback, useState, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
  Panel,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Download, User, Zap, Lightbulb, StickyNote, Trash2, Edit3, X, ImagePlus } from 'lucide-react';
import { toPng } from 'html-to-image';
import { generateId } from '@/utils/idGenerator';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import type { YarnNode, YarnEdge } from '@/types';

const YARN_COLORS = {
  red: { color: '#c4463a', label: 'Conflict' },
  green: { color: '#4a9e6d', label: 'Alliance' },
  blue: { color: '#4a7ec4', label: 'Romance' },
  yellow: { color: '#d4a843', label: 'Mystery' },
  plum: { color: '#7c5cbf', label: 'Other' },
};

const NODE_TYPES_CONFIG = {
  character: { icon: User, label: 'Character', color: '#c4973b' },
  event: { icon: Zap, label: 'Event', color: '#4a7ec4' },
  concept: { icon: Lightbulb, label: 'Concept', color: '#7c5cbf' },
  note: { icon: StickyNote, label: 'Note', color: '#4a9e6d' },
};

interface YarnBoardProps {
  projectId: string;
  boardId: string;
  initialNodes: YarnNode[];
  initialEdges: YarnEdge[];
  onSaveNode: (node: YarnNode) => void;
  onUpdateNode: (id: string, changes: Partial<YarnNode>) => void;
  onSaveEdge: (edge: YarnEdge) => void;
  onUpdateEdge: (id: string, changes: Partial<YarnEdge>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

// ─── Custom Node Component ───
function YarnNodeComponent({ data, id }: NodeProps) {
  const d = data as { title: string; content: string; nodeType: string; color: string; image?: string; onEdit: (id: string) => void; onDelete: (id: string) => void };
  const config = NODE_TYPES_CONFIG[d.nodeType as keyof typeof NODE_TYPES_CONFIG] || NODE_TYPES_CONFIG.note;
  const Icon = config.icon;

  return (
    <div
      className="px-4 py-3 rounded-xl border-2 shadow-lg min-w-[160px] max-w-[220px] relative group"
      style={{ backgroundColor: '#1a1a25', borderColor: d.color || config.color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30 !w-2 !h-2 !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-white/30 !w-2 !h-2 !border-0" />

      {/* Pin */}
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white/20"
        style={{ backgroundColor: d.color || config.color }}
      />

      {/* Action buttons - show on hover */}
      <div className="absolute -top-3 -right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10">
        <button
          onClick={(e) => { e.stopPropagation(); d.onEdit(id); }}
          className="w-6 h-6 rounded-full bg-[#c4973b] flex items-center justify-center hover:bg-[#e4a853] transition shadow-md"
          title="Edit"
        >
          <Edit3 size={11} className="text-[#07070d]" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); d.onDelete(id); }}
          className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center hover:bg-red-500 transition shadow-md"
          title="Delete"
        >
          <Trash2 size={11} className="text-white" />
        </button>
      </div>

      {/* Image */}
      {d.image && (
        <div className="mb-2 -mx-2 -mt-1">
          <img src={d.image} alt="" className="w-full h-20 object-cover rounded-lg" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} style={{ color: d.color || config.color }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: d.color || config.color }}>
          {d.nodeType}
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

const nodeTypes = { yarn: YarnNodeComponent };

// ─── Edit Node Modal ───
function NodeEditModal({
  node,
  onSave,
  onClose,
}: {
  node: YarnNode;
  onSave: (changes: Partial<YarnNode>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);
  const [nodeType, setNodeType] = useState(node.type);
  const [color, setColor] = useState(node.color);
  const [image, setImage] = useState(node.image || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    onSave({ title, content, type: nodeType, color, image: image || undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111119] border border-[#2a2a3a] rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif font-bold text-lg text-[#e8e5e0]">Edit Node</h3>
          <button onClick={onClose} className="p-1 text-[#8a8690] hover:text-[#e8e5e0] transition">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Image */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Image</label>
            <div className="flex items-center gap-3">
              {image ? (
                <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#2a2a3a]">
                  <img src={image} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImage('')}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-[#2a2a3a] flex flex-col items-center justify-center gap-1 text-[#8a8690] hover:border-[#c4973b]/50 hover:text-[#c4973b] transition"
                >
                  <ImagePlus size={18} />
                  <span className="text-[10px]">Add</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              {image && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-[#8a8690] hover:text-[#c4973b] transition"
                >
                  Change
                </button>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition font-serif"
              autoFocus
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition resize-none text-sm"
              placeholder="Description, notes..."
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Type</label>
            <div className="flex gap-2">
              {(Object.entries(NODE_TYPES_CONFIG) as [string, typeof NODE_TYPES_CONFIG.character][]).map(([key, cfg]) => {
                const TypeIcon = cfg.icon;
                return (
                  <button
                    key={key}
                    onClick={() => { setNodeType(key as YarnNode['type']); setColor(cfg.color); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
                      nodeType === key ? 'border-2' : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                    }`}
                    style={nodeType === key ? { borderColor: cfg.color, color: cfg.color, backgroundColor: `${cfg.color}15` } : {}}
                  >
                    <TypeIcon size={13} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Color</label>
            <div className="flex gap-2 items-center">
              {['#c4973b', '#4a7ec4', '#7c5cbf', '#4a9e6d', '#c4463a', '#d4a843', '#e4a853', '#8a8690'].map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white/30' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 py-2.5 bg-[#c4973b] text-[#07070d] font-semibold rounded-lg hover:bg-[#e4a853] transition"
            >
              Save
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 border border-[#2a2a3a] text-[#8a8690] rounded-lg hover:bg-[#1a1a25] transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Edge Modal ───
function EdgeEditModal({
  edge,
  onSave,
  onDelete,
  onClose,
}: {
  edge: YarnEdge;
  onSave: (changes: Partial<YarnEdge>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(edge.label || '');
  const [color, setColor] = useState(edge.color);
  const [style, setStyle] = useState(edge.style);

  const handleSave = () => {
    onSave({ label, color, style });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111119] border border-[#2a2a3a] rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif font-bold text-lg text-[#e8e5e0]">Edit Connection</h3>
          <button onClick={onClose} className="p-1 text-[#8a8690] hover:text-[#e8e5e0] transition">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Label */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition text-sm"
              placeholder="Relationship type..."
              autoFocus
            />
          </div>

          {/* Yarn Color */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Yarn Color</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {Object.entries(YARN_COLORS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => { setColor(val.color); if (!label) setLabel(val.label); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
                    color === val.color ? 'ring-2 ring-white/30' : ''
                  }`}
                  style={{ backgroundColor: `${val.color}30`, color: val.color }}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: val.color }} />
                  {val.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8a8690]">Custom:</span>
              <InlineColorPicker value={color} onChange={setColor} size="sm" />
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">Line Style</label>
            <div className="flex gap-2">
              {(['solid', 'dashed', 'dotted'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs capitalize transition ${
                    style === s ? 'bg-[#c4973b]/20 text-[#c4973b] border border-[#c4973b]/40' : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                  }`}
                >
                  <svg width="30" height="4" className="overflow-visible">
                    <line
                      x1="0" y1="2" x2="30" y2="2"
                      stroke={style === s ? '#c4973b' : '#666'}
                      strokeWidth="2"
                      strokeDasharray={s === 'dashed' ? '6 3' : s === 'dotted' ? '2 3' : undefined}
                    />
                  </svg>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 py-2.5 bg-[#c4973b] text-[#07070d] font-semibold rounded-lg hover:bg-[#e4a853] transition"
            >
              Save
            </button>
            <button
              onClick={() => { onDelete(); onClose(); }}
              className="px-4 py-2.5 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 border border-[#2a2a3a] text-[#8a8690] rounded-lg hover:bg-[#1a1a25] transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main YarnBoard ───
export default function YarnBoard({
  boardId,
  initialNodes,
  initialEdges,
  onSaveNode,
  onUpdateNode,
  onSaveEdge,
  onUpdateEdge,
  onDeleteNode,
  onDeleteEdge,
  projectId,
}: YarnBoardProps) {
  const [yarnColor, setYarnColor] = useState<keyof typeof YARN_COLORS>('red');
  const [addNodeType, setAddNodeType] = useState<keyof typeof NODE_TYPES_CONFIG>('character');
  const [editingNode, setEditingNode] = useState<YarnNode | null>(null);
  const [editingEdge, setEditingEdge] = useState<YarnEdge | null>(null);

  // Keep a ref to the original data for lookups
  const nodesDataRef = useRef<Map<string, YarnNode>>(new Map());
  const edgesDataRef = useRef<Map<string, YarnEdge>>(new Map());

  useEffect(() => {
    const map = new Map<string, YarnNode>();
    initialNodes.forEach(n => map.set(n.id, n));
    nodesDataRef.current = map;
  }, [initialNodes]);

  useEffect(() => {
    const map = new Map<string, YarnEdge>();
    initialEdges.forEach(e => map.set(e.id, e));
    edgesDataRef.current = map;
  }, [initialEdges]);

  const handleEditNode = useCallback((nodeId: string) => {
    const nodeData = nodesDataRef.current.get(nodeId);
    if (nodeData) setEditingNode(nodeData);
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    onDeleteNode(nodeId);
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDeleteNode]);

  const rfNodes: Node[] = initialNodes.map(n => ({
    id: n.id,
    type: 'yarn',
    position: n.position,
    data: {
      title: n.title,
      content: n.content,
      nodeType: n.type,
      color: n.color,
      image: n.image,
      onEdit: handleEditNode,
      onDelete: handleDeleteNode,
    },
  }));

  const rfEdges: Edge[] = initialEdges.map(e => ({
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    style: {
      stroke: e.color,
      strokeWidth: 3,
      strokeDasharray: e.style === 'dashed' ? '8 4' : e.style === 'dotted' ? '3 3' : undefined,
    },
    label: e.label,
    labelStyle: { fill: '#e8e5e0', fontSize: 11 },
    animated: false,
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync when initialNodes/initialEdges change
  useEffect(() => {
    setNodes(initialNodes.map(n => ({
      id: n.id,
      type: 'yarn',
      position: n.position,
      data: {
        title: n.title,
        content: n.content,
        nodeType: n.type,
        color: n.color,
        image: n.image,
        onEdit: handleEditNode,
        onDelete: handleDeleteNode,
      },
    })));
  }, [initialNodes, handleEditNode, handleDeleteNode, setNodes]);

  useEffect(() => {
    setEdges(initialEdges.map(e => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      style: {
        stroke: e.color,
        strokeWidth: 3,
        strokeDasharray: e.style === 'dashed' ? '8 4' : e.style === 'dotted' ? '3 3' : undefined,
      },
      label: e.label,
      labelStyle: { fill: '#e8e5e0', fontSize: 11 },
      animated: false,
    })));
  }, [initialEdges, setEdges]);

  // ─── Persist position on drag end ───
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    onUpdateNode(node.id, { position: { x: node.position.x, y: node.position.y } });
  }, [onUpdateNode]);

  // ─── Edge click to edit ───
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const edgeData = edgesDataRef.current.get(edge.id);
    if (edgeData) setEditingEdge(edgeData);
  }, []);

  // ─── Double click node to edit ───
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const nodeData = nodesDataRef.current.get(node.id);
    if (nodeData) setEditingNode(nodeData);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const yarnConfig = YARN_COLORS[yarnColor];
    const newEdge: YarnEdge = {
      id: generateId('edge'),
      boardId,
      sourceId: connection.source!,
      targetId: connection.target!,
      color: yarnConfig.color,
      style: 'solid',
      label: yarnConfig.label,
    };
    onSaveEdge(newEdge);

    setEdges((eds) => addEdge({
      ...connection,
      id: newEdge.id,
      style: { stroke: yarnConfig.color, strokeWidth: 3 },
      label: yarnConfig.label,
      labelStyle: { fill: '#e8e5e0', fontSize: 11 },
    }, eds));
  }, [yarnColor, boardId, onSaveEdge, setEdges]);

  const handleAddNode = () => {
    const config = NODE_TYPES_CONFIG[addNodeType];
    const newNode: YarnNode = {
      id: generateId('ynode'),
      projectId,
      boardId,
      type: addNodeType,
      title: `New ${config.label}`,
      content: '',
      color: config.color,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
    };
    onSaveNode(newNode);

    setNodes((nds) => [...nds, {
      id: newNode.id,
      type: 'yarn',
      position: newNode.position,
      data: {
        title: newNode.title,
        content: newNode.content,
        nodeType: newNode.type,
        color: newNode.color,
        image: undefined,
        onEdit: handleEditNode,
        onDelete: handleDeleteNode,
      },
    }]);
  };

  const handleExport = async () => {
    const el = document.querySelector('.react-flow') as HTMLElement;
    if (!el) return;
    const dataUrl = await toPng(el, { backgroundColor: '#07070d' });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'yarn-board.png';
    a.click();
  };

  // ─── Node edit save handler ───
  const handleNodeEditSave = (changes: Partial<YarnNode>) => {
    if (!editingNode) return;
    onUpdateNode(editingNode.id, changes);

    // Update local state immediately
    setNodes(nds => nds.map(n => {
      if (n.id !== editingNode.id) return n;
      const d = n.data as Record<string, unknown>;
      return {
        ...n,
        data: {
          title: changes.title ?? d.title,
          content: changes.content ?? d.content,
          nodeType: changes.type ?? d.nodeType,
          color: changes.color ?? d.color,
          image: changes.image ?? d.image,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
        },
      };
    }));
  };

  // ─── Edge edit save handler ───
  const handleEdgeEditSave = (changes: Partial<YarnEdge>) => {
    if (!editingEdge) return;
    onUpdateEdge(editingEdge.id, changes);

    setEdges(eds => eds.map(e => {
      if (e.id !== editingEdge.id) return e;
      const newStyle = changes.style ?? editingEdge.style;
      return {
        ...e,
        style: {
          stroke: changes.color ?? (e.style as Record<string, unknown>)?.stroke as string,
          strokeWidth: 3,
          strokeDasharray: newStyle === 'dashed' ? '8 4' : newStyle === 'dotted' ? '3 3' : undefined,
        },
        label: changes.label ?? e.label,
        labelStyle: { fill: '#e8e5e0', fontSize: 11 },
      };
    }));
  };

  return (
    <div className="w-full h-[600px] rounded-xl overflow-hidden border border-border cork-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-transparent"
        deleteKeyCode={null}
      >
        <Controls className="!bg-surface !border-border !rounded-lg [&_button]:!bg-elevated [&_button]:!border-border [&_button]:!text-text-primary" />
        <MiniMap
          className="!bg-surface !border-border !rounded-lg"
          nodeColor={() => '#c4973b'}
          maskColor="rgba(0,0,0,0.6)"
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2a3a" />

        <Panel position="top-left" className="flex items-center gap-2 flex-wrap">
          {/* Add node */}
          <div className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg px-2 py-1.5 backdrop-blur-sm">
            <select
              value={addNodeType}
              onChange={(e) => setAddNodeType(e.target.value as keyof typeof NODE_TYPES_CONFIG)}
              className="bg-transparent text-text-primary text-xs outline-none"
            >
              {Object.entries(NODE_TYPES_CONFIG).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <button
              onClick={handleAddNode}
              className="p-1 bg-accent-gold/20 text-accent-gold rounded hover:bg-accent-gold/30 transition"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Yarn color */}
          <div className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg px-2 py-1.5 backdrop-blur-sm">
            <span className="text-[10px] text-text-muted mr-1">Yarn:</span>
            {Object.entries(YARN_COLORS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => setYarnColor(key as keyof typeof YARN_COLORS)}
                className={`w-5 h-5 rounded-full transition-transform ${yarnColor === key ? 'scale-125 ring-1 ring-white/40' : 'hover:scale-110'}`}
                style={{ backgroundColor: val.color }}
                title={val.label}
              />
            ))}
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition backdrop-blur-sm"
          >
            <Download size={12} /> Export PNG
          </button>
        </Panel>

        <Panel position="bottom-left">
          <div className="bg-surface/80 border border-border rounded-lg px-3 py-2 backdrop-blur-sm text-[10px] text-text-dim space-y-0.5">
            <p>Double-click node to edit · Hover for actions</p>
            <p>Click a connection to edit · Drag between nodes to connect</p>
          </div>
        </Panel>
      </ReactFlow>

      {/* Edit modals */}
      {editingNode && (
        <NodeEditModal
          node={editingNode}
          onSave={handleNodeEditSave}
          onClose={() => setEditingNode(null)}
        />
      )}
      {editingEdge && (
        <EdgeEditModal
          edge={editingEdge}
          onSave={handleEdgeEditSave}
          onDelete={() => onDeleteEdge(editingEdge.id)}
          onClose={() => setEditingEdge(null)}
        />
      )}
    </div>
  );
}
