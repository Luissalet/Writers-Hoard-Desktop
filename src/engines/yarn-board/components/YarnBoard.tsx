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
  BackgroundVariant,
  Panel,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus,
  Download,
  User,
  Zap,
  Lightbulb,
  StickyNote,
  X,
  ImagePlus,
  Square,
  Circle,
  Diamond,
  Pill,
  ArrowRight,
  ArrowLeftRight,
  Minus,
  Grid3x3,
  Type,
  Image as ImageIcon,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { generateId } from '@/utils/idGenerator';
import { InlineColorPicker } from '@/components/common/ColorPicker';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { useTranslation } from '@/i18n/useTranslation';
import { nodeTypes } from './nodes';
import type { YarnNode, YarnEdge, YarnNodeType, YarnEdgeDirection } from '@/types';

const YARN_COLORS_CONFIG = {
  red: { color: '#c4463a', key: 'yarn.color.conflict' },
  green: { color: '#4a9e6d', key: 'yarn.color.alliance' },
  blue: { color: '#4a7ec4', key: 'yarn.color.romance' },
  yellow: { color: '#d4a843', key: 'yarn.color.mystery' },
  plum: { color: '#7c5cbf', key: 'yarn.color.other' },
};

const SEMANTIC_NODE_CONFIG = {
  character: { icon: User, key: 'yarn.node.character', color: '#c4973b' },
  event: { icon: Zap, key: 'yarn.node.event', color: '#4a7ec4' },
  concept: { icon: Lightbulb, key: 'yarn.node.concept', color: '#7c5cbf' },
  note: { icon: StickyNote, key: 'yarn.node.note', color: '#4a9e6d' },
};

const CANVAS_NODE_CONFIG = {
  postit: { icon: StickyNote, key: 'yarn.node.postit', color: '#fef3c7' },
  image: { icon: ImageIcon, key: 'yarn.node.image', color: '#d4a843' },
  text: { icon: Type, key: 'yarn.node.text', color: '#8a8690' },
  shape: { icon: Square, key: 'yarn.node.shape', color: '#c4973b' },
  group: { icon: Grid3x3, key: 'yarn.node.group', color: '#4a7ec4' },
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
  const { t } = useTranslation();
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);
  const [nodeType, setNodeType] = useState(node.type);
  const [color, setColor] = useState(node.color);
  const [image, setImage] = useState(node.image || '');
  const [imageOriginal, setImageOriginal] = useState(node.imageOriginal || node.image || '');
  const [shape, setShape] = useState(node.shape || 'rectangle');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSemanticType = ['character', 'event', 'concept', 'note'].includes(nodeType);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPendingImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const updates: Partial<YarnNode> = {
      title,
      color,
    };

    // Add optional fields based on node type
    if (isSemanticType) {
      updates.type = nodeType;
      updates.content = content;
      if (image) {
        updates.image = image;
        updates.imageOriginal = imageOriginal || image;
      }
    } else if (nodeType === 'postit') {
      // postit: just title + color
    } else if (nodeType === 'image') {
      if (image) {
        updates.image = image;
        updates.imageOriginal = imageOriginal || image;
      }
    } else if (nodeType === 'text') {
      updates.content = content;
    } else if (nodeType === 'group') {
      // group: just title + color
    } else if (nodeType === 'shape') {
      updates.shape = shape as 'rectangle' | 'circle' | 'diamond' | 'pill';
    }

    onSave(updates);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#111119] border border-[#2a2a3a] rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif font-bold text-lg text-[#e8e5e0]">
            {t('yarn.editNode').replace('{type}', t(`yarn.node.${nodeType}`))}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-[#8a8690] hover:text-[#e8e5e0] transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Type selector for semantic types */}
          {isSemanticType && (
            <div>
              <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.type')}</label>
              <div className="flex gap-2">
                {(
                  Object.entries(SEMANTIC_NODE_CONFIG) as [
                    string,
                    (typeof SEMANTIC_NODE_CONFIG)[keyof typeof SEMANTIC_NODE_CONFIG],
                  ][]
                ).map(([key, cfg]) => {
                  const TypeIcon = cfg.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setNodeType(key as YarnNodeType);
                        setColor(cfg.color);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
                        nodeType === key
                          ? 'border-2'
                          : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                      }`}
                      style={
                        nodeType === key
                          ? {
                              borderColor: cfg.color,
                              color: cfg.color,
                              backgroundColor: `${cfg.color}15`,
                            }
                          : {}
                      }
                    >
                      <TypeIcon size={13} />
                      {t(cfg.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Image upload for semantic/image types */}
          {(isSemanticType || nodeType === 'image') && (
            <div>
              <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.image')}</label>
              <div className="flex items-center gap-3">
                {image ? (
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#2a2a3a] cursor-pointer" onClick={() => setPendingImage(imageOriginal || image)}>
                    <img src={image} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setImage(''); }}
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
                    <span className="text-[10px]">{t('yarn.addImage')}</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                {image && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-[#8a8690] hover:text-[#c4973b] transition"
                  >
                    {t('yarn.changeImage')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.title')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition font-serif"
              autoFocus
            />
          </div>

          {/* Content for semantic and text types */}
          {(isSemanticType || nodeType === 'text') && (
            <div>
              <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.content')}</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition resize-none text-sm"
                placeholder={t('yarn.contentPlaceholder')}
              />
            </div>
          )}

          {/* Shape selector for shape type */}
          {nodeType === 'shape' && (
            <div>
              <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.shape')}</label>
              <div className="flex gap-2">
                {['rectangle', 'circle', 'diamond', 'pill'].map((s) => (
                  <button
                    key={s}
                    onClick={() =>
                      setShape(s as 'rectangle' | 'circle' | 'diamond' | 'pill')
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
                      shape === s
                        ? 'border-2 border-[#c4973b] bg-[#c4973b]/15 text-[#c4973b]'
                        : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                    }`}
                  >
                    {s === 'rectangle' && <Square size={13} />}
                    {s === 'circle' && <Circle size={13} />}
                    {s === 'diamond' && <Diamond size={13} />}
                    {s === 'pill' && <Pill size={13} />}
                    {t(`yarn.shape.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color picker */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.color')}</label>
            <InlineColorPicker value={color} onChange={setColor} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 py-2.5 bg-[#c4973b] text-[#07070d] font-semibold rounded-lg hover:bg-[#e4a853] transition"
            >
              {t('yarn.save')}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 border border-[#2a2a3a] text-[#8a8690] rounded-lg hover:bg-[#1a1a25] transition"
            >
              {t('yarn.cancel')}
            </button>
          </div>
        </div>
      </div>
      <ImagePreviewCrop
        imageSrc={pendingImage}
        onConfirm={(cropped, original) => {
          setImage(cropped);
          setImageOriginal(original);
          setPendingImage(null);
        }}
        onCancel={() => setPendingImage(null)}
      />
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
  const { t } = useTranslation();
  const [label, setLabel] = useState(edge.label || '');
  const [color, setColor] = useState(edge.color);
  const [style, setStyle] = useState(edge.style);
  const [direction, setDirection] = useState<YarnEdgeDirection>(
    edge.direction || 'none'
  );
  const [curvature, setCurvature] = useState(edge.curvature || 'curved');

  const handleSave = () => {
    onSave({ label, color, style, direction, curvature });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#111119] border border-[#2a2a3a] rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif font-bold text-lg text-[#e8e5e0]">
            {t('yarn.editConnection')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-[#8a8690] hover:text-[#e8e5e0] transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Label */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.label')}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a25] border border-[#2a2a3a] rounded-lg text-[#e8e5e0] outline-none focus:border-[#c4973b] transition text-sm"
              placeholder={t('yarn.labelPlaceholder')}
              autoFocus
            />
          </div>

          {/* Yarn Color */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.yarnColor')}</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {Object.entries(YARN_COLORS_CONFIG).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => {
                    setColor(val.color);
                    if (!label) setLabel(t(val.key));
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
                    color === val.color ? 'ring-2 ring-white/30' : ''
                  }`}
                  style={{ backgroundColor: `${val.color}30`, color: val.color }}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: val.color }} />
                  {t(val.key)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8a8690]">{t('yarn.custom')}</span>
              <InlineColorPicker value={color} onChange={setColor} size="sm" />
            </div>
          </div>

          {/* Line Style */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.lineStyle')}</label>
            <div className="flex gap-2">
              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs capitalize transition ${
                    style === s
                      ? 'bg-[#c4973b]/20 text-[#c4973b] border border-[#c4973b]/40'
                      : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                  }`}
                >
                  <svg width="30" height="4" className="overflow-visible">
                    <line
                      x1="0"
                      y1="2"
                      x2="30"
                      y2="2"
                      stroke={style === s ? '#c4973b' : '#666'}
                      strokeWidth="2"
                      strokeDasharray={
                        s === 'dashed' ? '6 3' : s === 'dotted' ? '2 3' : undefined
                      }
                    />
                  </svg>
                  {t(`yarn.style.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.direction')}</label>
            <div className="flex gap-2">
              {(['none', 'forward', 'backward', 'both'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs capitalize transition ${
                    direction === d
                      ? 'bg-[#c4973b]/20 text-[#c4973b] border border-[#c4973b]/40'
                      : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                  }`}
                >
                  {d === 'none' && <Minus size={13} />}
                  {d === 'forward' && <ArrowRight size={13} />}
                  {d === 'backward' && <ArrowRight size={13} className="rotate-180" />}
                  {d === 'both' && <ArrowLeftRight size={13} />}
                  {t(`yarn.direction.${d}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Curvature */}
          <div>
            <label className="block text-sm text-[#8a8690] mb-1.5">{t('yarn.pathType')}</label>
            <div className="flex gap-2">
              {(['straight', 'curved', 'step'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurvature(c)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs capitalize transition ${
                    curvature === c
                      ? 'bg-[#c4973b]/20 text-[#c4973b] border border-[#c4973b]/40'
                      : 'border border-[#2a2a3a] text-[#8a8690] hover:text-[#e8e5e0]'
                  }`}
                >
                  <svg width="30" height="15" className="overflow-visible">
                    {c === 'straight' && (
                      <line
                        x1="0"
                        y1="7"
                        x2="30"
                        y2="7"
                        stroke={curvature === c ? '#c4973b' : '#666'}
                        strokeWidth="2"
                      />
                    )}
                    {c === 'curved' && (
                      <path
                        d="M 0 12 Q 15 2 30 12"
                        stroke={curvature === c ? '#c4973b' : '#666'}
                        fill="none"
                        strokeWidth="2"
                      />
                    )}
                    {c === 'step' && (
                      <path
                        d="M 0 7 L 15 7 L 15 12 L 30 12"
                        stroke={curvature === c ? '#c4973b' : '#666'}
                        fill="none"
                        strokeWidth="2"
                      />
                    )}
                  </svg>
                  {t(`yarn.path.${c}`)}
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
              {t('yarn.save')}
            </button>
            <button
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="px-4 py-2.5 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition"
            >
              <X size={16} />
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 border border-[#2a2a3a] text-[#8a8690] rounded-lg hover:bg-[#1a1a25] transition"
            >
              {t('yarn.cancel')}
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
  const { t } = useTranslation();
  const [yarnColor, setYarnColor] = useState(YARN_COLORS_CONFIG.red.color);
  const [selectedNodeCategory, setSelectedNodeCategory] = useState<
    'semantic' | 'canvas' | 'layout'
  >('semantic');
  const [selectedNodeType, setSelectedNodeType] = useState<YarnNodeType>('character');
  const [editingNode, setEditingNode] = useState<YarnNode | null>(null);
  const [editingEdge, setEditingEdge] = useState<YarnEdge | null>(null);

  // Keep a ref to the original data for lookups
  const nodesDataRef = useRef<Map<string, YarnNode>>(new Map());
  const edgesDataRef = useRef<Map<string, YarnEdge>>(new Map());

  useEffect(() => {
    const map = new Map<string, YarnNode>();
    initialNodes.forEach((n) => map.set(n.id, n));
    nodesDataRef.current = map;
  }, [initialNodes]);

  useEffect(() => {
    const map = new Map<string, YarnEdge>();
    initialEdges.forEach((e) => map.set(e.id, e));
    edgesDataRef.current = map;
  }, [initialEdges]);

  const handleEditNode = useCallback((nodeId: string) => {
    const nodeData = nodesDataRef.current.get(nodeId);
    if (nodeData) setEditingNode(nodeData);
  }, []);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      onDeleteNode(nodeId);
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
      );
    },
    [onDeleteNode]
  );

  const rfNodes: Node[] = initialNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      title: n.title,
      content: n.content,
      nodeType: n.type,
      color: n.color,
      image: n.image,
      shape: n.shape,
      onEdit: handleEditNode,
      onDelete: handleDeleteNode,
    },
  }));

  const getEdgeType = (curvature: string) => {
    switch (curvature) {
      case 'straight':
        return 'straight';
      case 'step':
        return 'step';
      case 'curved':
      default:
        return 'smoothstep';
    }
  };

  const rfEdges: Edge[] = initialEdges.map((e) => {
    const strokeDasharray =
      e.style === 'dashed' ? '8 4' : e.style === 'dotted' ? '3 3' : undefined;

    const markerEnd =
      e.direction === 'forward' || e.direction === 'both'
        ? { type: MarkerType.ArrowClosed, color: e.color }
        : undefined;
    const markerStart =
      e.direction === 'backward' || e.direction === 'both'
        ? { type: MarkerType.ArrowClosed, color: e.color }
        : undefined;

    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: getEdgeType(e.curvature || 'curved'),
      style: {
        stroke: e.color,
        strokeWidth: 3,
        strokeDasharray,
      },
      label: e.label,
      labelStyle: { fill: '#1a1a25', fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: '#e8e5e0', opacity: 0.85, rx: 4, ry: 4 },
      labelBgPadding: [6, 4] as [number, number],
      markerEnd,
      markerStart,
      animated: false,
    };
  });

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync when initialNodes/initialEdges change
  useEffect(() => {
    setNodes(
      initialNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          title: n.title,
          content: n.content,
          nodeType: n.type,
          color: n.color,
          image: n.image,
          shape: n.shape,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
        },
      }))
    );
  }, [initialNodes, handleEditNode, handleDeleteNode, setNodes]);

  useEffect(() => {
    setEdges(
      initialEdges.map((e) => {
        const strokeDasharray =
          e.style === 'dashed' ? '8 4' : e.style === 'dotted' ? '3 3' : undefined;

        const markerEnd =
          e.direction === 'forward' || e.direction === 'both'
            ? { type: MarkerType.ArrowClosed, color: e.color }
            : undefined;
        const markerStart =
          e.direction === 'backward' || e.direction === 'both'
            ? { type: MarkerType.ArrowClosed, color: e.color }
            : undefined;

        return {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          type: getEdgeType(e.curvature || 'curved'),
          style: {
            stroke: e.color,
            strokeWidth: 3,
            strokeDasharray,
          },
          label: e.label,
          labelStyle: { fill: '#1a1a25', fontSize: 11, fontWeight: 600 },
          labelBgStyle: { fill: '#e8e5e0', opacity: 0.85, rx: 4, ry: 4 },
          labelBgPadding: [6, 4] as [number, number],
          markerEnd,
          markerStart,
          animated: false,
        };
      })
    );
  }, [initialEdges, setEdges]);

  // ─── Persist position on drag end ───
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onUpdateNode(node.id, {
        position: { x: node.position.x, y: node.position.y },
      });
    },
    [onUpdateNode]
  );

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

  const onConnect = useCallback(
    (connection: Connection) => {
      // Find a label from YARN_COLORS_CONFIG if the current color matches a preset
      const preset = Object.values(YARN_COLORS_CONFIG).find(
        (v) => v.color === yarnColor
      );
      const label = preset ? t(preset.key) : '';
      const newEdge: YarnEdge = {
        id: generateId('edge'),
        boardId,
        sourceId: connection.source!,
        targetId: connection.target!,
        color: yarnColor,
        style: 'solid',
        label,
        direction: 'none',
        curvature: 'curved',
      };
      onSaveEdge(newEdge);

      const markerEnd =
        newEdge.direction === 'forward' || newEdge.direction === 'both'
          ? { type: MarkerType.ArrowClosed, color: yarnColor }
          : undefined;
      const markerStart =
        newEdge.direction === 'backward' || newEdge.direction === 'both'
          ? { type: MarkerType.ArrowClosed, color: yarnColor }
          : undefined;

      setEdges((eds) => {
        const newEdges = addEdge(
          {
            ...connection,
            id: newEdge.id,
            type: getEdgeType(newEdge.curvature || 'curved'),
            style: {
              stroke: yarnColor,
              strokeWidth: 3,
              strokeDasharray:
                newEdge.style === 'dashed' ? '8 4' : newEdge.style === 'dotted' ? '3 3' : undefined,
            } as Record<string, unknown>,
            label,
            labelStyle: { fill: '#1a1a25', fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fill: '#e8e5e0', opacity: 0.85, rx: 4, ry: 4 },
            labelBgPadding: [6, 4] as [number, number],
            markerEnd,
            markerStart,
          } as Edge,
          eds
        );
        return newEdges as Edge[];
      });
    },
    [yarnColor, boardId, onSaveEdge, setEdges]
  );

  const handleAddNode = () => {
    let nodeType = selectedNodeType;
    let config = SEMANTIC_NODE_CONFIG[nodeType as keyof typeof SEMANTIC_NODE_CONFIG];

    if (!config) {
      // Fall back to canvas config
      config = CANVAS_NODE_CONFIG[nodeType as keyof typeof CANVAS_NODE_CONFIG];
    }

    const newNode: YarnNode = {
      id: generateId('ynode'),
      projectId,
      boardId,
      type: nodeType,
      title: t('yarn.newNode').replace('{label}', config ? t(config.key) : 'Node'),
      content: '',
      color: config?.color || '#8a8690',
      position: {
        x: Math.random() * 400 + 100,
        y: Math.random() * 300 + 100,
      },
      ...(nodeType === 'shape' && { shape: 'rectangle' }),
    };
    onSaveNode(newNode);

    setNodes((nds) => [
      ...nds,
      {
        id: newNode.id,
        type: newNode.type,
        position: newNode.position,
        data: {
          title: newNode.title,
          content: newNode.content,
          nodeType: newNode.type,
          color: newNode.color,
          image: undefined,
          shape: newNode.shape,
          onEdit: handleEditNode,
          onDelete: handleDeleteNode,
        },
      },
    ]);
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
    setNodes((nds) =>
      nds.map((n) => {
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
            shape: changes.shape ?? d.shape,
            onEdit: handleEditNode,
            onDelete: handleDeleteNode,
          },
        };
      })
    );
  };

  // ─── Edge edit save handler ───
  const handleEdgeEditSave = (changes: Partial<YarnEdge>) => {
    if (!editingEdge) return;
    onUpdateEdge(editingEdge.id, changes);

    setEdges((eds) =>
      eds.map((e) => {
        if (e.id !== editingEdge.id) return e;
        const newStyle = changes.style ?? editingEdge.style;
        const newCurvature = changes.curvature ?? (editingEdge.curvature || 'curved');
        const newDirection = changes.direction ?? (editingEdge.direction || 'none');

        const markerEnd =
          newDirection === 'forward' || newDirection === 'both'
            ? { type: MarkerType.ArrowClosed, color: changes.color ?? editingEdge.color }
            : undefined;
        const markerStart =
          newDirection === 'backward' || newDirection === 'both'
            ? { type: MarkerType.ArrowClosed, color: changes.color ?? editingEdge.color }
            : undefined;

        return {
          ...e,
          type: getEdgeType(newCurvature),
          style: {
            stroke: changes.color ?? (e.style as Record<string, unknown> | undefined)?.stroke,
            strokeWidth: 3,
            strokeDasharray:
              newStyle === 'dashed' ? '8 4' : newStyle === 'dotted' ? '3 3' : undefined,
          } as Record<string, unknown>,
          label: changes.label ?? e.label,
          labelStyle: { fill: '#1a1a25', fontSize: 11, fontWeight: 600 },
          labelBgStyle: { fill: '#e8e5e0', opacity: 0.85, rx: 4, ry: 4 },
          labelBgPadding: [6, 4] as [number, number],
          markerEnd,
          markerStart,
        } as Edge;
      })
    );
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

        <Panel position="top-left" className="flex flex-col gap-2">
          {/* Add node - Category tabs */}
          <div className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg p-1 backdrop-blur-sm">
            {(['semantic', 'canvas', 'layout'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedNodeCategory(cat)}
                className={`px-2 py-1 text-xs rounded transition ${
                  selectedNodeCategory === cat
                    ? 'bg-[#c4973b]/30 text-[#c4973b] border border-[#c4973b]/50'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {t(`yarn.${cat}`)}
              </button>
            ))}
          </div>

          {/* Node type selector */}
          <div className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg p-1.5 backdrop-blur-sm flex-wrap max-w-xs">
            {selectedNodeCategory === 'semantic' &&
              Object.entries(SEMANTIC_NODE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedNodeType(key as YarnNodeType)}
                    className={`p-1.5 rounded transition ${
                      selectedNodeType === key
                        ? 'bg-[#c4973b]/30 border border-[#c4973b]/50'
                        : 'hover:bg-surface text-text-muted hover:text-text-primary'
                    }`}
                    title={t(cfg.key)}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            {selectedNodeCategory === 'canvas' &&
              Object.entries(CANVAS_NODE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedNodeType(key as YarnNodeType)}
                    className={`p-1.5 rounded transition ${
                      selectedNodeType === key
                        ? 'bg-[#c4973b]/30 border border-[#c4973b]/50'
                        : 'hover:bg-surface text-text-muted hover:text-text-primary'
                    }`}
                    title={t(cfg.key)}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            {selectedNodeCategory === 'layout' && (
              <button
                onClick={() => setSelectedNodeType('group')}
                className={`p-1.5 rounded transition ${
                  selectedNodeType === 'group'
                    ? 'bg-[#c4973b]/30 border border-[#c4973b]/50'
                    : 'hover:bg-surface text-text-muted hover:text-text-primary'
                }`}
                title={t('yarn.node.group')}
              >
                <Grid3x3 size={14} />
              </button>
            )}
          </div>

          {/* Add button */}
          <button
            onClick={handleAddNode}
            className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition backdrop-blur-sm w-fit"
          >
            <Plus size={14} /> {t('yarn.add')}
          </button>

          {/* Yarn color */}
          <div className="flex items-center gap-1.5 bg-surface/90 border border-border rounded-lg px-2 py-1.5 backdrop-blur-sm">
            <span className="text-[10px] text-text-muted">{t('yarn.edgeColor')}</span>
            <InlineColorPicker value={yarnColor} onChange={setYarnColor} size="sm" />
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 bg-surface/90 border border-border rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition backdrop-blur-sm w-fit"
          >
            <Download size={12} /> {t('yarn.export')}
          </button>
        </Panel>

        <Panel position="bottom-left">
          <div className="bg-surface/80 border border-border rounded-lg px-3 py-2 backdrop-blur-sm text-[10px] text-text-dim space-y-0.5">
            <p>{t('yarn.hintNodes')}</p>
            <p>{t('yarn.hintEdges')}</p>
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
