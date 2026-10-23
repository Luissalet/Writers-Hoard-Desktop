import {createCanvasPile,setPileCollapsed} from '../graph/piles';
import {hiddenCanvasNodeIds,pileSelection,pileItemCount} from '../graph/membership';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Background, BackgroundVariant, ConnectionLineType, ConnectionMode, Controls, MiniMap,
  Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Plus, Route, Search, Trash2, X } from 'lucide-react';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import {boardReferenceRoute,resolveBoardTile} from '../entityTiles';
import { usePaneNavigate } from '@/engines/_shared/usePaneNavigate';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { DEFAULT_SIZE, EDGE_KINDS, GRID_STEP, SURFACE_PALETTE } from '../catalog';
import { useBoardGraph, useBoardLayers, useBoardViews, type BoardPendingReview } from '../hooks';
import { boundsOfNodes } from '../graph/geometry';
import { cloneSelection, makeEdge, makeNode, nodesInsideFrame } from '../graph/mutations';
import { quickConnected } from '../graph/quickConnect';
import { runLayout, type LayoutKind } from '../graph/layout';
import { computeMetrics } from '../graph/metrics';
import { evaluateQuery } from '../graph/query';
import { shortestPath } from '../graph/paths';
import { canMoveNode, findOpenPosition, isCanvasShortcutTarget } from '../graph/interactions';
import { getBoardCopy } from '../copy';
import { rememberProjectRoute } from '@/services/projectIntelligence';
import type {
  Board, BoardBox, BoardEdge, BoardEndpoint, BoardLayer, BoardNode,
  BoardNodeKind, BoardSide, BoardView, BoardViewport,
} from '../types';
import BoardNodeView, { type BoardFlowNode } from './BoardNodeView';
import EdgeLayer from './EdgeLayer';
import EntityPicker from './EntityPicker';
import { EdgeInspector, NodeInspector } from './Inspector';
import { LayersPanel, MetricsPanel, ViewsPanel } from './SidePanels';
import Toolbar, { type PanelKey } from './Toolbar';
import FreehandOverlay,{type InkTool} from './FreehandOverlay';
import { erasedNodeIds,makeFreehandNode } from '../freehand';
import {arrangeCanvasNodes,expandFrameMoves} from '../canvasGeometry';
import { freehandCopy } from '../freehandCopy';
import AssetsRail from './AssetsRail';
import { BOARD_ASSET_MIME, imageFile } from './boardAssets';
import { db } from '@/db';
import { useLiveQuery } from 'dexie-react-hooks';

const nodeTypes = { board: BoardNodeView };
const fitOptions = { padding: { top: '128px', left: '112px', right: '48px', bottom: '64px' }, maxZoom: 1 } as const;

/** Survives remounts so copy on one board pastes on another. */
const clipboard: { nodes: BoardNode[]; edges: BoardEdge[] } = { nodes: [], edges: [] };

const SURFACE_CLASS: Record<Board['surface'], string> = {
  cork: 'cork-bg',
  slate: 'bg-deep',
  grid: 'bg-surface',
  blueprint: 'bg-[#0b1522]',
  white: 'bg-white',
  lined: 'wh-board-lined',
  chalk: 'bg-[#1f3b2d]',
};

const SIDES = new Set<BoardSide>(['top', 'right', 'bottom', 'left']);

/** React Flow hands back the handle id; ours are named after the face. */
function asSide(handleId: string | null | undefined): BoardSide | undefined {
  return handleId && SIDES.has(handleId as BoardSide) ? (handleId as BoardSide) : undefined;
}

interface Transient {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface LinkState {
  sources: BoardEndpoint[];
  targets: BoardEndpoint[];
  stage: 'source' | 'target';
  kind: string;
}

export interface BoardCanvasProps {
  projectId: string;
  board: Board;
  onViewportChange: (viewport: BoardViewport) => void;
  /** Right-click → Comment: the host opens a comment about that card. */
  onCommentNode?: (node: BoardNode) => void;
}

export default function BoardCanvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <BoardCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function BoardCanvasInner({ projectId, board, onViewportChange, onCommentNode }: BoardCanvasProps) {
  const { t, locale } = useTranslation();
  const worldScope=useWorldEraScope(projectId);
  const navigateTo = usePaneNavigate();
  const copy = getBoardCopy(locale);
  const [searchParams] = useSearchParams();
  const targetNodeId = searchParams.get('node');
  const boardId = board.id;
  const graph = useBoardGraph(boardId,projectId);
  const [pendingReview,setPendingReview]=useState<BoardPendingReview|null>(null);
  const recoveryText=(value:unknown):string=>{if(value===null||value===undefined)return '∅';if(typeof value==='string')return value.startsWith('data:')?'[media]':value.replace(/<[^>]*>/g,'');return typeof value==='object'?'[structured value]':String(value);};
  const { items: layers, addItem: addLayer, editItem: editLayer, removeItem: removeLayer } =
    useBoardLayers(boardId);
  const { items: views, addItem: addView, editItem: editView, removeItem: removeView } =
    useBoardViews(boardId);

  const flow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [transient, setTransient] = useState<Record<string, Transient>>({});
  const [query, setQuery] = useState('');
  const [ideaDraft, setIdeaDraft] = useState('');
  const [queryMode, setQueryMode] = useState<'filter' | 'highlight'>('highlight');
  const [link, setLink] = useState<LinkState | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [drawingColor, setDrawingColor] = useState('#d5b575');
  const [drawingWidth, setDrawingWidth] = useState(3);
  const [inkTool,setInkTool]=useState<InkTool>('pen');
  const [pickerFor, setPickerFor] = useState<string | 'new' | null>(null);
  const [pathIds, setPathIds] = useState<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ nodes: string[]; edges: string[] } | null>(null);

  // Kept in a ref as well as in state: the drag handler needs the value it
  // just wrote, in the same tick, before React has re-rendered.
  const transientRef = useRef<Record<string, Transient>>({});
  const applyTransient = useCallback((next: Record<string, Transient>) => {
    transientRef.current = next;
    setTransient(next);
  }, []);
  const frameDrag = useRef<{ frameId: string; origin: { x: number; y: number }; children: Array<{ id: string; x: number; y: number }> } | null>(null);

  // ---- derived graph --------------------------------------------------

  // Metrics depend on the SHAPE of the graph, never on what a node says.
  // `computeMetrics` runs Brandes betweenness, closeness, components and
  // Tarjan's critical elements — all O(V·E) — and it was memoised on the
  // identity of `graph.nodes`, which `applyOps` rebuilds on every mutation.
  // Inline renaming calls `patchNodes` per keystroke, so typing a title on a
  // 300-node board re-ran the whole suite (~300 BFS passes) for every letter.
  //
  // Keying on a signature of ids + edge topology means a rename now costs
  // exactly one string rebuild, and the metrics are only recomputed when
  // something that can actually change them does.
  const topologySignature = useMemo(() => {
    const nodePart = graph.nodes.map((node) => node.id).join(',');
    const edgePart = graph.edges
      .map((edge) =>
        [
          edge.id,
          edge.kind,
          edge.weight,
          edge.certainty,
          edge.direction,
          edge.sources.map((s) => `${s.on}:${s.id}`).join('|'),
          edge.targets.map((tg) => `${tg.on}:${tg.id}`).join('|'),
        ].join('~'),
      )
      .join(';');
    return `${nodePart}#${edgePart}`;
  }, [graph.nodes, graph.edges]);

  // Keyed on the topology signature ON PURPOSE. `graph.nodes`/`graph.edges`
  // change identity on every content edit; listing them as deps would restore
  // the very per-keystroke recomputation this memo exists to prevent. When the
  // signature is unchanged the captured arrays are topologically identical to
  // the current ones, so the cached result is still correct.
  const metrics = useMemo(
    () => computeMetrics(graph.nodes, graph.edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologySignature],
  );

  const layerById = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);

  const queryResult = useMemo(
    () => evaluateQuery(query, { nodes: graph.nodes, edges: graph.edges, layers, metrics }),
    [query, graph.nodes, graph.edges, layers, metrics],
  );

  const isLayerVisible = useCallback(
    (layerId: string | undefined): boolean => (layerId ? (layerById.get(layerId)?.visible ?? true) : true),
    [layerById],
  );

  const hiddenByCollapse=useMemo(()=>hiddenCanvasNodeIds(graph.nodes),[graph.nodes]);

  const visibleNodes = useMemo(
    () =>
      graph.nodes.filter(
        (node) =>
          isLayerVisible(node.layerId) &&
          !hiddenByCollapse.has(node.id) &&
          (queryMode === 'highlight' || queryResult.nodeIds.has(node.id)),
      ),
    [graph.nodes, isLayerVisible, hiddenByCollapse, queryMode, queryResult.nodeIds],
  );

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter((edge) => {
        if (!isLayerVisible(edge.layerId)) return false;
        if (queryMode === 'filter' && !queryResult.edgeIds.has(edge.id)) return false;
        return [...edge.sources, ...edge.targets].every(
          (endpoint) => endpoint.on === 'edge' || visibleNodeIds.has(endpoint.id),
        );
      }),
    [graph.edges, isLayerVisible, queryMode, queryResult.edgeIds, visibleNodeIds],
  );

  const positionOf = useCallback(
    (node: BoardNode) => {
      const override = transient[node.id];
      return { x: override?.x ?? node.position.x, y: override?.y ?? node.position.y };
    },
    [transient],
  );

  const sizeOf = useCallback(
    (node: BoardNode) => {
      const override = transient[node.id];
      return {
        width: override?.width ?? node.size.width,
        height: override?.height ?? node.size.height,
      };
    },
    [transient],
  );

  const boxes = useMemo(() => {
    const map = new Map<string, BoardBox>();
    for (const node of visibleNodes) {
      const position = positionOf(node);
      const size = sizeOf(node);
      map.set(node.id, { x: position.x, y: position.y, width: size.width, height: size.height });
    }
    return map;
  }, [visibleNodes, positionOf, sizeOf]);

  // ---- node callbacks (stable identities keep memoised nodes still) ----

  const openInspector = useCallback((id: string) => {
    setPanel(null);
    setSelectedNodeIds(new Set([id]));
    setSelectedEdgeIds(new Set());
  }, []);

  const requestDelete = useCallback((id: string) => {
    setPendingDelete({ nodes:pileSelection([id],graph.nodes).map(node=>node.id), edges: [] });
  }, [graph.nodes]);

  const startLink = useCallback((id: string) => {
    setLink({ sources: [{ id, on: 'node' }], targets: [], stage: 'target', kind: 'related' });
  }, []);

  const renameNode = useCallback(
    (id: string, title: string) => graph.patchNodes([{ id, changes: { title } }], t('board.history.rename'), `rename:${id}`),
    [graph, t],
  );

  const openRef = useCallback(
    (id: string) => {
      const node = graph.nodeById.get(id);
      if (!node?.ref) return;
      const ref=node.ref;void resolveBoardTile(worldScope,ref).then(tile=>{if(tile)navigateTo(boardReferenceRoute(projectId,ref));});
    },
    [graph.nodeById, projectId, navigateTo,worldScope],
  );

  // A new idea like the selected one on the side clicked, joined to it, in one undo step.
  const quickConnectRef = useRef<(id: string, side: 'top' | 'right' | 'bottom' | 'left') => void>(() => undefined);
  const quickConnectNow = (id: string, side: 'top' | 'right' | 'bottom' | 'left') => {
    const from = graph.nodeById.get(id);
    if (!from || graph.loading || (from.layerId && layerById.get(from.layerId)?.locked)) return;
    const { node, edge } = quickConnected(from, side, graph.nodes, { layerId: activeLayerId && !layerById.get(activeLayerId)?.locked ? activeLayerId : from.layerId });
    graph.batch(t('board.history.add'), { addNodes: [node], addEdges: [edge] });
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
  };
  useLayoutEffect(() => { quickConnectRef.current = quickConnectNow; });
  const quickConnect = useCallback((id: string, side: 'top' | 'right' | 'bottom' | 'left') => quickConnectRef.current(id, side), []);
  const togglePile=useCallback((id:string)=>{const frame=graph.nodeById.get(id);if(!frame||!canMoveNode(frame,layerById))return;graph.patchNodes([{id,changes:setPileCollapsed(frame,graph.nodes,!frame.collapsed)}],frame.collapsed?copy.openPile:copy.collapsePile);},[graph,layerById,copy.openPile,copy.collapsePile]);

  // ---- React Flow nodes ------------------------------------------------

  const flowNodes = useMemo<BoardFlowNode[]>(() => {
    const linkingSources = new Set(link?.sources.filter((e) => e.on === 'node').map((e) => e.id) ?? []);
    const linkingTargets = new Set(link?.targets.filter((e) => e.on === 'node').map((e) => e.id) ?? []);

    return visibleNodes.map((node) => {
      const position = positionOf(node);
      const size = sizeOf(node);
      const layer = node.layerId ? layerById.get(node.layerId) : undefined;
      return {
        id: node.id,
        type: 'board' as const,
        position,
        width: size.width,
        height: size.height,
        selected: selectedNodeIds.has(node.id),
        draggable: !node.locked && !(layer?.locked ?? false),
        selectable: !(layer?.locked ?? false),
        // Frames sit under the edge layer (z 1); everything else above it.
        zIndex: node.kind === 'frame' ? 0 : 2 + Math.max(0, node.zIndex),
        data: {
          node,
          layerLocked: layer?.locked ?? false,
          dimmed: queryMode === 'highlight' && !queryResult.passthrough && !queryResult.nodeIds.has(node.id),
          layerOpacity: layer?.opacity ?? 1,
          linking: linkingSources.has(node.id) ? 'source' : linkingTargets.has(node.id) ? 'target' : false,
          onPath: pathIds?.nodes.has(node.id) ?? false,
          onEdit: openInspector,
          onDelete: requestDelete,
          onStartLink: startLink,
          onOpenRef: openRef,
          onRename: renameNode,
          onToggleFrame:togglePile,
          onQuickConnect: quickConnect,
          memberCount:node.kind==='frame'?pileItemCount(node,graph.nodes):0,
        },
      };
    });
  }, [
    visibleNodes, positionOf, sizeOf, layerById, selectedNodeIds, queryMode,
    queryResult.passthrough, queryResult.nodeIds, pathIds, link,
    openInspector, requestDelete, startLink, openRef, renameNode,togglePile,graph.nodes, quickConnect,
  ]);

  // ---- drag / resize ---------------------------------------------------

  const commitTransient = useCallback(() => {
    const entries = Object.entries(transientRef.current);
    if (entries.length === 0) return;
    const patches = entries.flatMap(([id, value]) => {
      const node = graph.nodeById.get(id);
      if (!node) return [];
      const changes: Partial<BoardNode> = {};
      if (value.x !== undefined || value.y !== undefined) {
        changes.position = { x: value.x ?? node.position.x, y: value.y ?? node.position.y };
      }
      if (value.width !== undefined || value.height !== undefined) {
        changes.size = {
          width: value.width ?? node.size.width,
          height: value.height ?? node.size.height,
        };
      }
      return Object.keys(changes).length > 0 ? [{ id, changes }] : [];
    });
    applyTransient({});
    if (patches.length > 0) graph.patchNodes(patches, t('board.history.move'));
  }, [graph, t, applyTransient]);

  const onNodesChange = useCallback(
    (changes: NodeChange<BoardFlowNode>[]) => {
      let nextTransient: Record<string, Transient> | null = null;
      let commit = false;
      const selectionUpdates: Array<{ id: string; selected: boolean }> = [];

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          nextTransient = nextTransient ?? { ...transientRef.current };
          nextTransient[change.id] = {
            ...nextTransient[change.id],
            x: change.position.x,
            y: change.position.y,
          };

          // A frame carries whatever it encloses. Captured once at drag start,
          // so a card does not silently join a frame it merely passed over.
          const drag = frameDrag.current;
          if (drag && drag.frameId === change.id) {
            const dx = change.position.x - drag.origin.x;
            const dy = change.position.y - drag.origin.y;
            for (const child of drag.children) {
              nextTransient[child.id] = {
                ...nextTransient[child.id],
                x: child.x + dx,
                y: child.y + dy,
              };
            }
          }
          if (change.dragging === false) commit = true;
        } else if (change.type === 'dimensions' && change.dimensions && change.resizing !== undefined) {
          // Only resizer-driven changes; plain measurement must not overwrite
          // the author's chosen size.
          nextTransient = nextTransient ?? { ...transientRef.current };
          nextTransient[change.id] = {
            ...nextTransient[change.id],
            width: change.dimensions.width,
            height: change.dimensions.height,
          };
          if (change.resizing === false) commit = true;
        } else if (change.type === 'select') {
          selectionUpdates.push({ id: change.id, selected: change.selected });
        }
      }

      if (nextTransient) applyTransient(nextTransient);
      if (selectionUpdates.length > 0) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          for (const update of selectionUpdates) {
            if (update.selected) next.add(update.id);
            else next.delete(update.id);
          }
          return next;
        });
        setSelectedEdgeIds(new Set());
      }
      if (commit) {
        frameDrag.current = null;
        // Defer so the transient state above lands first.
        window.setTimeout(commitTransient, 0);
      }
    },
    [commitTransient, applyTransient],
  );

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: BoardFlowNode) => {
      const model = graph.nodeById.get(node.id);
      if (!model || model.kind !== 'frame') {
        frameDrag.current = null;
        return;
      }
      frameDrag.current = {
        frameId: node.id,
        origin: { ...model.position },
        children: nodesInsideFrame(model, graph.nodes).filter((child) => canMoveNode(child, layerById)).map((child) => ({
          id: child.id,
          x: child.position.x,
          y: child.position.y,
        })),
      };
    },
    [graph.nodeById, graph.nodes, layerById],
  );

  // ---- creating things -------------------------------------------------

  const viewportCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [flow]);

  const addNode = useCallback(
    (kind: BoardNodeKind, overrides: Partial<Parameters<typeof makeNode>[0]> = {}) => {
      if (graph.loading) return;
      if (kind === 'entity') {
        setPickerFor('new');
        return;
      }
      if (kind === 'image' && !overrides.image) {
        fileRef.current?.click();
        return;
      }
      const center = viewportCenter();
      const size = DEFAULT_SIZE[kind];
      const node = makeNode({
        projectId,
        boardId,
        kind,
        position: findOpenPosition({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size, graph.nodes),
        layerId: activeLayerId && !layerById.get(activeLayerId)?.locked ? activeLayerId : undefined,
        title: kind === 'frame' ? t('board.add.frame') : '',
        ...overrides,
      });
      graph.addNodes([node], t('board.history.add'));
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeIds(new Set());
      setPanel(null);
    },
    [viewportCenter, projectId, boardId, activeLayerId, graph, t, layerById],
  );

  const addImagesFromFiles = useCallback(
    (files: FileList | File[], at?: { x: number; y: number }) => {
      const center = at ?? viewportCenter();
      let offset = 0;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const reader = new FileReader();
        const dx = offset;
        offset += 40;
        reader.onload = () => {
          const node = makeNode({
            projectId,
            boardId,
            kind: 'image',
            position: { x: center.x + dx, y: center.y + dx },
            image: String(reader.result),
            imageOriginal: String(reader.result),
            title: file.name.replace(/\.[^.]+$/, ''),
            layerId: activeLayerId ?? undefined,
          });
          graph.addNodes([node], t('board.history.add'));
        };
        reader.readAsDataURL(file);
      }
    },
    [viewportCenter, projectId, boardId, activeLayerId, graph, t],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // The handle ids ARE the sides ('top' | 'right' | 'bottom' | 'left'), so
      // the relation remembers where it was attached. Dropping a thread on the
      // left of a card and watching it reattach itself underneath was the bug.
      const edge = makeEdge({
        projectId,
        boardId,
        sources: [{ id: connection.source, on: 'node', side: asSide(connection.sourceHandle) }],
        targets: [{ id: connection.target, on: 'node', side: asSide(connection.targetHandle) }],
        kind: link?.kind ?? 'related',
        layerId: activeLayerId ?? undefined,
      });
      graph.addEdges([edge], t('board.history.connect'));
    },
    [projectId, boardId, link?.kind, activeLayerId, graph, t],
  );

  // ---- link tool -------------------------------------------------------

  const toggleEndpoint = useCallback(
    (id: string, on: 'node' | 'edge') => {
      setLink((current) => {
        if (!current) return current;
        const key = current.stage === 'source' ? 'sources' : 'targets';
        const list = current[key];
        const exists = list.some((endpoint) => endpoint.id === id && endpoint.on === on);
        return {
          ...current,
          [key]: exists
            ? list.filter((endpoint) => !(endpoint.id === id && endpoint.on === on))
            : [...list, { id, on }],
        };
      });
    },
    [],
  );

  const commitLink = useCallback(() => {
    if (!link || link.sources.length === 0 || link.targets.length === 0) return;
    const edge = makeEdge({
      projectId,
      boardId,
      sources: link.sources,
      targets: link.targets,
      kind: link.kind,
      layerId: activeLayerId ?? undefined,
    });
    graph.addEdges([edge], t('board.history.connect'));
    setLink(null);
    setSelectedEdgeIds(new Set([edge.id]));
    setSelectedNodeIds(new Set());
  }, [link, projectId, boardId, activeLayerId, graph, t]);

  const selectEdge = useCallback(
    (id: string, additive: boolean) => {
      if (link) {
        toggleEndpoint(id, 'edge');
        return;
      }
      setSelectedEdgeIds((current) => {
        if (!additive) return new Set([id]);
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedNodeIds(new Set());
    },
    [link, toggleEndpoint],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: BoardFlowNode) => {
      if (link) toggleEndpoint(node.id, 'node');
    },
    [link, toggleEndpoint],
  );

  // ---- selection actions ----------------------------------------------

  const selectedNodes = useMemo(
    () => graph.nodes.filter((node) => selectedNodeIds.has(node.id)),
    [graph.nodes, selectedNodeIds],
  );
  const resumeNodeId = selectedNodes.length === 1 ? selectedNodes[0].id : null;
  useEffect(() => {
    if (resumeNodeId) rememberProjectRoute(projectId, { engineId: 'board', entityId: resumeNodeId });
  }, [resumeNodeId, projectId]);

  const movableNodes = selectedNodes.filter((node) => canMoveNode(node, layerById));

  const captureIdea = (branch: boolean) => {
    const title = ideaDraft.trim();
    if (!title || graph.loading) return;
    const parent = branch && selectedNodes.length === 1 ? selectedNodes[0] : undefined;
    const center = viewportCenter();
    const size = DEFAULT_SIZE.card;
    const desired = parent
      ? { x: parent.position.x + parent.size.width + 96, y: parent.position.y }
      : { x: center.x - size.width / 2, y: center.y - size.height / 2 };
    const node = makeNode({
      projectId, boardId, kind: 'card', role: 'concept', title,
      position: findOpenPosition(desired, size, graph.nodes),
      layerId: activeLayerId && !layerById.get(activeLayerId)?.locked ? activeLayerId : undefined,
    });
    graph.batch(t('board.history.add'), {
      addNodes: [node],
      addEdges: parent ? [makeEdge({ projectId, boardId,
        sources: [{ id: parent.id, on: 'node', side: 'right' }],
        targets: [{ id: node.id, on: 'node', side: 'left' }],
      })] : [],
    });
    setIdeaDraft('');
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setPanel(null);
    void flow.setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, { zoom: flow.getZoom(), duration: 200 });
  };

  const deleteSelection = useCallback(() => {
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;
    setPendingDelete({ nodes: pileSelection(selectedNodeIds,graph.nodes).map(node=>node.id), edges: Array.from(selectedEdgeIds) });
  }, [selectedNodeIds, selectedEdgeIds,graph.nodes]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    graph.remove(pendingDelete.nodes, pendingDelete.edges, t('board.history.delete'));
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setPendingDelete(null);
  }, [pendingDelete, graph, t]);

  const copySelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    const copied=pileSelection(selectedNodes.map(node=>node.id),graph.nodes),ids = new Set(copied.map((node) => node.id));
    clipboard.nodes = copied.map((node) => ({ ...node }));
    clipboard.edges = graph.edges.filter((edge) =>
      [...edge.sources, ...edge.targets].every((endpoint) => endpoint.on !== 'node' || ids.has(endpoint.id)),
    );
  }, [selectedNodes, graph.edges,graph.nodes]);

  const paste = useCallback(
    (offset = { x: 40, y: 40 }) => {
      if (clipboard.nodes.length === 0) return;
      const cloned = cloneSelection(clipboard.nodes, clipboard.edges, offset, boardId, projectId);
      graph.batch(t('board.history.paste'), { addNodes: cloned.nodes, addEdges: cloned.edges });
      setSelectedNodeIds(new Set(cloned.nodes.map((node) => node.id)));
      setSelectedEdgeIds(new Set());
    },
    [boardId, projectId, graph, t],
  );

  const groupIntoFrame = useCallback(() => {
    if (selectedNodes.length < 1) return;
    const bounds = boundsOfNodes(selectedNodes, 40);
    if (!bounds) return;
    const frame = makeNode({
      projectId,
      boardId,
      kind: 'frame',
      position: { x: bounds.x, y: bounds.y - 32 },
      size: { width: bounds.width, height: bounds.height + 32 },
      title: t('board.add.frame'),
      layerId: activeLayerId ?? undefined,
    });
    graph.addNodes([frame], t('board.history.group'));
    setSelectedNodeIds(new Set([frame.id]));
  }, [selectedNodes, projectId, boardId, activeLayerId, graph, t]);

  // Comments left about a card, counted for the menu.
  const commentCounts = useLiveQuery(async () => { const rows = await db.annotations.where('[sourceEngineId+sourceEntityId]').equals(['board', board.id]).toArray(); const counts = new Map<string, number>(); for (const row of rows) if (row.anchor?.elementId) counts.set(row.anchor.elementId, (counts.get(row.anchor.elementId) ?? 0) + 1); return counts; }, [board.id]) ?? new Map<string, number>();
  // Right-click: the same actions as the toolbar and keys, at the pointer.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; at: { x: number; y: number }; onNode: boolean } | null>(null);
  const reorder = (front: boolean) => {
    const ids = new Set(selectedNodes.map(node => node.id)); if (!ids.size) return;
    const others = graph.nodes.filter(node => !ids.has(node.id) && node.kind !== 'frame');
    const top = Math.max(0, ...others.map(node => node.zIndex));
    graph.patchNodes(front ? selectedNodes.map(node => ({ id: node.id, changes: { zIndex: top + 1 } })) : [...selectedNodes.map(node => ({ id: node.id, changes: { zIndex: 0 } })), ...others.filter(node => node.zIndex === 0).map(node => ({ id: node.id, changes: { zIndex: 1 } }))], front ? (locale === 'es' ? 'Traer al frente' : 'Bring to front') : (locale === 'es' ? 'Enviar al fondo' : 'Send to back'));
  };
  const unframe = () => { const frames = selectedNodes.filter(node => node.kind === 'frame'); if (frames.length) { graph.remove(frames.map(node => node.id), [], locale === 'es' ? 'Quitar marco' : 'Remove frame'); setSelectedNodeIds(new Set()); } };
  const collapseSelection=useCallback(()=>{const frame=createCanvasPile(graph.nodes,selectedNodes.map(node=>node.id),copy.pile);if(activeLayerId)frame.layerId=activeLayerId;graph.addNodes([frame],copy.collapsePile);setSelectedNodeIds(new Set([frame.id]));setSelectedEdgeIds(new Set());void flow.setCenter(frame.position.x+frame.size.width/2,frame.position.y+frame.size.height/2,{zoom:1,duration:200});},[graph,selectedNodes,copy.pile,copy.collapsePile,activeLayerId,flow]);

  const align = useCallback((mode:'left'|'center-x'|'right'|'top'|'center-y'|'bottom')=>{graph.patchNodes(expandFrameMoves(graph.nodes,arrangeCanvasNodes(movableNodes,mode),node=>canMoveNode(node,layerById)),t('board.history.align'));},[movableNodes,graph,t,layerById]);
  const distribute = useCallback((axis:'x'|'y')=>{graph.patchNodes(expandFrameMoves(graph.nodes,arrangeCanvasNodes(movableNodes,axis==='x'?'distribute-x':'distribute-y'),node=>canMoveNode(node,layerById)),t('board.history.distribute'));},[movableNodes,graph,t,layerById]);

  const applyLayout = useCallback(
    (kind: LayoutKind) => {
      const scope = (selectedNodes.length >= 2 ? selectedNodes : visibleNodes)
        .map((node) => canMoveNode(node, layerById) ? node : { ...node, locked: true });
      const result = runLayout(kind, scope, visibleEdges, {
        focusId: selectedNodes[0]?.id,
      });
      const patches = Object.entries(result).map(([id, position]) => ({ id, changes: { position } }));
      if (patches.length > 0) graph.patchNodes(patches, t(`board.layout.${kind}`));
    },
    [selectedNodes, visibleNodes, visibleEdges, graph, t, layerById],
  );

  const tracePath = useCallback(() => {
    if (selectedNodes.length !== 2) return;
    const result = shortestPath(metrics.adjacency, selectedNodes[0].id, selectedNodes[1].id);
    setPathIds(
      result.nodeIds.length > 0
        ? { nodes: new Set(result.nodeIds), edges: new Set(result.edgeIds) }
        : { nodes: new Set(), edges: new Set() },
    );
  }, [selectedNodes, metrics.adjacency]);

  // ---- keyboard --------------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!isCanvasShortcutTarget(event.target, containerRef.current) || pendingDelete || pickerFor || graph.loading) return;

      const mod = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        setDrawing(false);
        setLink(null);
        setPathIds(null);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setPanel(null);
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) graph.redo();
        else graph.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        graph.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        paste();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        copySelection();
        paste();
        return;
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedNodeIds(new Set(visibleNodes.map((node) => node.id)));
        return;
      }
      if (mod && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        groupIntoFrame();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Enter' && link) {
        event.preventDefault();
        commitLink();
        return;
      }
      if (event.key === 'Tab' && link) {
        event.preventDefault();
        setLink((current) => (current ? { ...current, stage: current.stage === 'source' ? 'target' : 'source' } : current));
        return;
      }
      if (event.key.startsWith('Arrow') && selectedNodeIds.size > 0) {
        event.preventDefault();
        // React Flow also nudges focused nodes. Own the gesture once so its
        // built-in movement cannot race our undoable persisted movement.
        event.stopPropagation();
        const step = event.shiftKey ? GRID_STEP : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        graph.patchNodes(
          expandFrameMoves(graph.nodes,movableNodes.map((node) => ({
            id: node.id,
            changes: { position: { x: node.position.x + dx, y: node.position.y + dy } },
          })),node=>canMoveNode(node,layerById)),
          t('board.history.move'),
          'nudge',
        );
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    graph, copySelection, paste, groupIntoFrame, deleteSelection, commitLink,
    link, selectedNodeIds, movableNodes, visibleNodes, t, pendingDelete, pickerFor, layerById,
  ]);

  // ---- clipboard images ------------------------------------------------

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      if (!isCanvasShortcutTarget(event.target, containerRef.current) || pendingDelete || pickerFor || graph.loading) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      addImagesFromFiles(files);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [addImagesFromFiles, pendingDelete, pickerFor, graph.loading]);

  // Live tiles resolve effective records reactively in their own read-only component.

  // ---- deep link -------------------------------------------------------

  const deepLinked = useRef<string | null>(null);
  useEffect(() => {
    if (!targetNodeId) { deepLinked.current = null; return; }
    if (graph.loading || deepLinked.current === targetNodeId) return;
    const target = targetNodeId;
    if (!target) return;
    const node = graph.nodeById.get(target);
    if (!node) return;
    // Deferred a frame: the graph has only just landed and React Flow needs a
    // measured canvas before it can centre on anything.
    const frame = window.requestAnimationFrame(() => {
      deepLinked.current = target;
      setSelectedNodeIds(new Set([target]));
      flow.setCenter(node.position.x + node.size.width / 2, node.position.y + node.size.height / 2, {
        zoom: 1,
        duration: 400,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graph.loading, graph.nodeById, flow, targetNodeId]);

  // ---- views -----------------------------------------------------------

  const applyView = useCallback(
    (view: BoardView) => {
      setActiveViewId(view.id);
      setQuery(view.query);
      setQueryMode(view.mode);
      for (const layer of layers) {
        void editLayer(layer.id, { visible: view.layerIds.includes(layer.id) });
      }
      if (view.positions) {
        const patches = Object.entries(view.positions)
          .filter(([id]) => { const node = graph.nodeById.get(id); return node && canMoveNode(node, layerById); })
          .map(([id, position]) => ({ id, changes: { position } }));
        if (patches.length > 0) graph.patchNodes(patches, t('board.history.applyView'));
      }
      if (view.viewport) flow.setViewport(view.viewport, { duration: 300 });
    },
    [layers, editLayer, graph, flow, t, layerById],
  );

  const snapshotView = useCallback(
    (name: string) => ({
      id: generateId('bview'),
      projectId,
      boardId,
      name,
      query,
      layerIds: layers.filter((layer) => layer.visible).map((layer) => layer.id),
      mode: queryMode,
      viewport: flow.getViewport(),
      positions: Object.fromEntries(graph.nodes.map((node) => [node.id, { ...node.position }])),
      order: views.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [projectId, boardId, query, layers, queryMode, flow, graph.nodes, views.length],
  );

  // ---- export ----------------------------------------------------------

  // Loaded on demand: the rasteriser is only needed the moment someone
  // exports, and it is heavier than the whole graph layer put together.
  const exportPng = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    const { toPng } = await import('html-to-image');
    void toPng(element, {
      backgroundColor: '#07070d',
      filter: (domNode) =>
        !(domNode instanceof HTMLElement) ||
        (!domNode.classList.contains('board-chrome') &&
          !domNode.classList.contains('react-flow__minimap') &&
          !domNode.classList.contains('react-flow__controls') &&
          !domNode.classList.contains('react-flow__panel')),
    }).then((dataUrl) => {
      const link = document.createElement('a');
      link.download = `${board.title.replace(/[^\w\-. ]+/g, '_') || 'board'}.png`;
      link.href = dataUrl;
      link.click();
    });
  }, [board.title]);

  // ---- selection detail ------------------------------------------------

  const selectedEdge = useMemo(() => {
    if (selectedEdgeIds.size !== 1) return null;
    const [id] = Array.from(selectedEdgeIds);
    return graph.edgeById.get(id) ?? null;
  }, [selectedEdgeIds, graph.edgeById]);

  const selectedNode = useMemo(() => (selectedNodes.length === 1 ? selectedNodes[0] : null), [selectedNodes]);

  const layerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) {
      if (node.layerId) counts.set(node.layerId, (counts.get(node.layerId) ?? 0) + 1);
    }
    for (const edge of graph.edges) {
      if (edge.layerId) counts.set(edge.layerId, (counts.get(edge.layerId) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes, graph.edges]);

  const layerOpacityByEdge = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of graph.edges) {
      map.set(edge.id, edge.layerId ? (layerById.get(edge.layerId)?.opacity ?? 1) : 1);
    }
    return map;
  }, [graph.edges, layerById]);

  const dimmedEdgeIds = useMemo(() => {
    if (queryMode !== 'highlight' || queryResult.passthrough) return new Set<string>();
    return new Set(graph.edges.filter((edge) => !queryResult.edgeIds.has(edge.id)).map((edge) => edge.id));
  }, [queryMode, queryResult, graph.edges]);

  const linkingEdgeIds = useMemo(
    () =>
      new Set(
        [...(link?.sources ?? []), ...(link?.targets ?? [])]
          .filter((endpoint) => endpoint.on === 'edge')
          .map((endpoint) => endpoint.id),
      ),
    [link],
  );

  const keystoneTitles = useMemo(
    () =>
      metrics.summary.keystoneIds.map((id) => ({
        id,
        title: graph.nodeById.get(id)?.title || t('board.untitled'),
        score: metrics.byNode.get(id)?.betweenness ?? 0,
      })),
    [metrics, graph.nodeById, t],
  );

  const focusNode = useCallback(
    (id: string) => {
      const node = graph.nodeById.get(id);
      if (!node) return;
      setSelectedNodeIds(new Set([id]));
      flow.setCenter(node.position.x + node.size.width / 2, node.position.y + node.size.height / 2, {
        zoom: 1.1,
        duration: 400,
      });
    },
    [graph.nodeById, flow],
  );

  // ---------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        if (isCanvasShortcutTarget(event.target, containerRef.current)) containerRef.current?.focus({ preventScroll: true });
      }}
      className={`relative h-[calc(100vh-11rem)] min-h-[520px] w-full overflow-hidden rounded-xl border border-border ${SURFACE_CLASS[board.surface] ?? 'cork-bg'}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          addImagesFromFiles(event.dataTransfer.files, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }
        const assetId = event.dataTransfer.getData(BOARD_ASSET_MIME);
        if (assetId) { const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); void db.inspirationImages.get(assetId).then(picture => picture ? imageFile(picture.imageData, 'imagen') : undefined).then(file => { if (file) addImagesFromFiles([file], at); }); }
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeClick={onNodeClick}
        onConnect={onConnect}
        onMoveEnd={(_event, viewport) => { if (!graph.loading) onViewportChange(viewport); }}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).classList.contains('react-flow__pane') || graph.loading) return;
          addNode('card', { position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
        }}
        onNodeContextMenu={(event, flowNode) => {
          event.preventDefault();
          const box = containerRef.current?.getBoundingClientRect();
          if (!selectedNodeIds.has(flowNode.id)) { setSelectedNodeIds(new Set([flowNode.id])); setSelectedEdgeIds(new Set()); }
          setContextMenu({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), onNode: true });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const box = containerRef.current?.getBoundingClientRect();
          setContextMenu({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), onNode: false });
        }}
        onMoveStart={() => setContextMenu(null)}
        onPaneClick={() => {
          setContextMenu(null);
          setSelectedEdgeIds(new Set());
          setPathIds(null);
        }}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        panOnDrag={!drawing}
        zoomOnScroll={!drawing}
        zoomOnPinch={!drawing}
        // Loose: any handle accepts a thread from any other. Strict mode meant
        // you had to leave from a bottom/right dot and land on a top/left one,
        // which is a rule the board has no reason to impose.
        connectionMode={ConnectionMode.Loose}
        // Snap to the nearest handle within this radius, so dropping *near*
        // a card connects to it instead of dropping the thread on the floor.
        connectionRadius={48}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: '#c4973b', strokeWidth: 2.5 }}
        snapToGrid={snap}
        snapGrid={[GRID_STEP, GRID_STEP]}
        minZoom={0.005}
        maxZoom={16}
        onlyRenderVisibleElements={visibleNodes.length > 200}
        defaultViewport={board.viewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={!board.viewport}
        fitViewOptions={fitOptions}
        className="h-full w-full"
      >
        {board.surface !== 'lined' && <Background
          variant={board.surface === 'blueprint' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={GRID_STEP}
          size={board.surface === 'chalk' ? 1.5 : 1}
          color={board.surface === 'white' ? '#d5d5de' : board.surface === 'chalk' ? '#ffffff33' : '#2a2a3a'}
        />}
        <Controls className="board-chrome wh-canvas-controls" position="bottom-right" showInteractive={false} fitViewOptions={fitOptions} />
        <MiniMap
          className="board-chrome !ml-28"
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(node) => (node.data as BoardFlowNode['data'])?.node?.color ?? '#c4973b'}
          maskColor="rgba(0,0,0,0.55)"
        />

        <EdgeLayer
          edges={visibleEdges}
          boxes={boxes}
          selectedEdgeIds={selectedEdgeIds}
          dimmedEdgeIds={dimmedEdgeIds}
          pathEdgeIds={pathIds?.edges ?? new Set()}
          linkingEdgeIds={linkingEdgeIds}
          layerOpacityByEdge={layerOpacityByEdge}
          showLabels={showLabels}
          onSelectEdge={selectEdge}
          onOpenEdge={(id) => {
            setSelectedEdgeIds(new Set([id]));
            setSelectedNodeIds(new Set());
          }}
        />

        <Panel position="top-left">
          <Toolbar
            onAdd={kind => { setDrawing(false); addNode(kind); }}
            drawing={drawing}
            drawingDisabled={graph.loading}
            onToggleDrawing={() => { setDrawing(value => !value); setLink(null); setPanel(null); }}
            linking={Boolean(link)}
            onToggleLink={() => { setDrawing(false); setLink((current) => (current ? null : { sources: [], targets: [], stage: 'source', kind: 'related' })); }}
            onUndo={graph.undo}
            onRedo={graph.redo}
            canUndo={graph.canUndo}
            canRedo={graph.canRedo}
            undoLabel={graph.undoLabel}
            redoLabel={graph.redoLabel}
            onLayout={applyLayout}
            onAlign={align}
            onDistribute={distribute}
            selectionCount={selectedNodes.length}
            snap={snap}
            onToggleSnap={() => setSnap((value) => !value)}
            labels={showLabels}
            onToggleLabels={() => setShowLabels((value) => !value)}
            panel={panel}
            onPanel={setPanel}
            onFit={() => flow.fitView({ duration: 400, ...fitOptions })}
            onExport={() => void exportPng()}
          />
        </Panel>

        <Panel position="top-center" style={{ left: 112, right: 12, transform: 'none', margin: 0, top: 12 }}>
          <div className="board-chrome flex min-w-0 flex-col gap-2">
            <form onSubmit={(event) => { event.preventDefault(); captureIdea(false); }} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <input aria-label={copy.capture} value={ideaDraft} onChange={(event) => setIdeaDraft(event.target.value)} placeholder={copy.capture} disabled={graph.loading} className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />
              {selectedNodes.length === 1 && <button type="button" onClick={() => captureIdea(true)} disabled={!ideaDraft.trim() || graph.loading} title={`${copy.branchHint}: ${selectedNodes[0].title || t('board.untitled')}`} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-primary hover:border-accent-gold focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-40"><GitBranch size={14} /> {copy.branch}</button>}
              <button type="submit" disabled={!ideaDraft.trim() || graph.loading} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-gold px-2.5 py-1.5 text-xs font-semibold text-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold disabled:opacity-40"><Plus size={14} /> {copy.add}</button>
            </form>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur">
              <Search size={14} className="text-text-dim" />
              <input
                aria-label={copy.search}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveViewId(null);
                }}
                placeholder={t('board.query.placeholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none"
              />
              <button
                type="button"
                onClick={() => setQueryMode((mode) => (mode === 'filter' ? 'highlight' : 'filter'))}
                className="rounded-lg border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted transition hover:text-accent-gold"
              >
                {t(`board.query.${queryMode}`)}
              </button>
              {query ? (
                <button type="button" onClick={() => setQuery('')} className="text-text-dim hover:text-text-primary" title={t('engines.clearSearch')} aria-label={t('engines.clearSearch')}>
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {query && !queryResult.passthrough ? (
              <div className="rounded-lg border border-border bg-surface/90 px-2 py-1 text-[11px] text-text-muted backdrop-blur">
                {t('board.query.matched')
                  .replace('{nodes}', String(queryResult.nodeIds.size))
                  .replace('{edges}', String(queryResult.edgeIds.size))}
                {queryResult.problems.length > 0 ? (
                  <span className="ml-2 text-warning">{queryResult.problems.join(' · ')}</span>
                ) : null}
              </div>
            ) : null}
            {/* The queue retries in the background, but silence while a batch
                is failing is how an afternoon's work went missing: the canvas
                keeps painting from memory and only the next open shows it. */}
            {graph.error ? (
              <div
                className="rounded-lg border border-danger/60 bg-surface/95 px-2 py-1 text-[11px] text-danger backdrop-blur"
                title={graph.error.message}
              >
                {t('board.saveFailed')}
                <button type="button" onClick={() => void graph.flush()} className="ml-2 min-h-9 underline underline-offset-2">{copy.saveRetry}</button>
                <button type="button" onClick={() => void graph.reviewPending().then(setPendingReview)} className="ml-2 min-h-9 underline underline-offset-2">{locale==='es'?'Revisar cambios guardados':'Review saved changes'}</button>
                {pendingReview&&<section aria-label={locale==='es'?'Cambios pendientes':'Pending changes'} className="mt-2 max-h-64 max-w-[min(480px,80vw)] overflow-auto text-text-primary">
                  <p className="mb-2">{locale==='es'?'Conservar aplica tus campos modificados sobre esta versión revisada.':'Keeping changes applies your edited fields to this reviewed version.'}</p>
                  {pendingReview.changes.map((change,index)=><div key={index} className="mb-2 border-t border-border pt-2 break-words"><strong>{change.title} · {change.field}</strong><p>{locale==='es'?'Guardado':'Saved'}: {recoveryText(change.saved)}</p><p>{locale==='es'?'Pendiente':'Pending'}: {recoveryText(change.draft)}</p></div>)}
                  <button type="button" className="min-h-9 rounded border border-border px-3" onClick={()=>void graph.keepPending(pendingReview).then(saved=>{if(saved)setPendingReview(null);})}>{locale==='es'?'Conservar mis cambios pendientes':'Keep my pending changes'}</button>
                  <button type="button" className="ml-2 min-h-9 px-2" onClick={()=>setPendingReview(null)}>{locale==='es'?'Cerrar':'Close'}</button>
                </section>}
              </div>
            ) : null}
          </div>
        </Panel>

        {graph.nodes.length === 0 && !query && !graph.error && (
          <Panel position="bottom-center" className="pointer-events-none mb-32 w-[min(65%,440px)] text-center">
            <div className="rounded-xl bg-surface/95 p-6">
              <h3 className="font-serif text-xl text-text-primary">{graph.loading ? copy.loading : copy.emptyTitle}</h3>
              {!graph.loading && <><p className="mt-3 text-sm leading-relaxed text-text-muted">{copy.emptyBody}</p><p className="mt-4 text-xs text-text-muted">{copy.emptyHint}</p></>}
            </div>
          </Panel>
        )}

        {link ? (
          <Panel position="bottom-center">
            <div className="board-chrome flex items-center gap-2 rounded-xl border border-accent-gold/60 bg-surface/95 px-3 py-2 shadow-xl backdrop-blur">
              <span className="text-xs text-text-muted">
                {t('board.link.staging')
                  .replace('{sources}', String(link.sources.length))
                  .replace('{targets}', String(link.targets.length))}
              </span>
              <button
                type="button"
                onClick={() => setLink({ ...link, stage: link.stage === 'source' ? 'target' : 'source' })}
                className="rounded-lg border border-border px-2 py-1 text-xs text-accent-gold"
              >
                {link.stage === 'source' ? t('board.link.pickingSources') : t('board.link.pickingTargets')}
              </button>
              <select
                value={link.kind}
                onChange={(event) => setLink({ ...link, kind: event.target.value })}
                className="rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary outline-none"
              >
                {EDGE_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {t(kind.labelKey)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={link.sources.length === 0 || link.targets.length === 0}
                onClick={commitLink}
                className="rounded-lg bg-accent-gold px-2.5 py-1 text-xs font-semibold text-deep disabled:opacity-40"
              >
                {t('board.link.create')}
              </button>
              <button type="button" onClick={() => setLink(null)} className="text-text-muted hover:text-danger" title={t('common.cancel')} aria-label={t('common.cancel')}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </Panel>
        ) : selectedNodes.length > 1 || selectedEdgeIds.size > 0 ? (
          <Panel position="bottom-center">
            <div className="board-chrome flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-xl backdrop-blur">
              <span className="text-xs text-text-muted">
                {t('board.selection.count')
                  .replace('{nodes}', String(selectedNodes.length))
                  .replace('{edges}', String(selectedEdgeIds.size))}
              </span>
              {selectedNodes.length > 1 && <button type="button" onClick={groupIntoFrame} className="rounded-lg border border-border px-2 py-1 text-xs text-text-primary">{copy.group}</button>}{selectedNodes.length>1&&<button type="button" onClick={collapseSelection} className="min-h-9 rounded-lg border border-border px-2 py-1 text-xs text-text-primary">{copy.collapsePile}</button>}
              {SURFACE_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() =>
                    graph.batch(t('board.history.recolour'), {
                      patchNodes: selectedNodes.map((node) => ({ id: node.id, changes: { color } })),
                      patchEdges: Array.from(selectedEdgeIds).map((id) => ({ id, changes: { color } })),
                    })
                  }
                  style={{ background: color }}
                  className="h-4 w-4 rounded border border-black/30"
                />
              ))}
              {selectedNodes.length === 2 ? (
                <button
                  type="button"
                  onClick={tracePath}
                  className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted transition hover:text-accent-gold"
                >
                  <Route size={12} /> {t('board.selection.trace')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={deleteSelection}
                className="rounded-lg border border-danger/40 p-1 text-danger"
                title={t('common.delete')}
                aria-label={t('common.delete')}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </Panel>
        ) : null}
        {drawing && <FreehandOverlay tool={inkTool} onTool={setInkTool} color={drawingColor} width={drawingWidth} onColor={setDrawingColor} onWidth={setDrawingWidth} onDone={() => setDrawing(false)} disabled={graph.loading || (!!activeLayerId && (layerById.get(activeLayerId)?.locked === true || layerById.get(activeLayerId)?.visible === false))} onStroke={(points, zoom) => {
          if (graph.loading || (activeLayerId && (layerById.get(activeLayerId)?.locked || layerById.get(activeLayerId)?.visible === false))) return;
          if(inkTool==='eraser'){const ids=erasedNodeIds(visibleNodes.filter(node=>canMoveNode(node,layerById)),points,8/Math.max(.005,zoom));if(ids.length){graph.remove(ids,[],freehandCopy(locale).erase);setSelectedNodeIds(new Set());setSelectedEdgeIds(new Set());}return;}
          const node = makeFreehandNode({ tool:inkTool,projectId, boardId, title: freehandCopy(locale).title, color: drawingColor, width: drawingWidth, points, layerId: activeLayerId ?? undefined, tolerance: 1 / Math.max(.005, zoom) });
          if (node) { graph.addNodes([node], freehandCopy(locale).title); setSelectedNodeIds(new Set([node.id])); setSelectedEdgeIds(new Set()); }
        }} />}
      </ReactFlow>
      {contextMenu && <div role="menu" data-testid="board-context-menu" aria-label={locale === 'es' ? 'Acciones' : 'Actions'} className="board-chrome absolute z-40 min-w-48 rounded-xl border border-border bg-surface p-1 text-sm shadow-2xl" style={{ left: Math.min(contextMenu.x, (containerRef.current?.clientWidth ?? 800) - 200), top: Math.min(contextMenu.y, (containerRef.current?.clientHeight ?? 600) - 260) }} onKeyDown={event => { if (event.key === 'Escape') setContextMenu(null); }} onMouseLeave={() => undefined}>
        {((contextMenu.onNode ? [
          ['duplicate', locale === 'es' ? 'Duplicar' : 'Duplicate', () => { copySelection(); paste({ x: 40, y: 40 }); }],
          ['copy', locale === 'es' ? 'Copiar' : 'Copy', copySelection],
          ...(onCommentNode && selectedNodes.length === 1 ? [['comment', `${locale === 'es' ? 'Comentar' : 'Comment'}${commentCounts.get(selectedNodes[0].id) ? ` (${commentCounts.get(selectedNodes[0].id)})` : ''}`, () => onCommentNode(selectedNodes[0])]] : []),
          ['front', locale === 'es' ? 'Traer al frente' : 'Bring to front', () => reorder(true)],
          ['back', locale === 'es' ? 'Enviar al fondo' : 'Send to back', () => reorder(false)],
          ['frame', locale === 'es' ? 'Agrupar en un marco' : 'Group into a frame', groupIntoFrame],
          ...(selectedNodes.some(node => node.kind === 'frame') ? [['unframe', locale === 'es' ? 'Quitar el marco (deja su contenido)' : 'Remove frame, keep contents', unframe] as [string, string, () => void]] : []),
          ['delete', locale === 'es' ? 'Borrar' : 'Delete', deleteSelection],
        ] : [
          ['card', locale === 'es' ? 'Nueva tarjeta aquí' : 'New card here', () => addNode('card', { position: contextMenu.at })],
          ...(clipboard.nodes.length ? [['paste', locale === 'es' ? 'Pegar aquí' : 'Paste here', () => { const box = boundsOfNodes(clipboard.nodes, 0); paste(box ? { x: contextMenu.at.x - box.x, y: contextMenu.at.y - box.y } : { x: 40, y: 40 }); }] as [string, string, () => void]] : []),
          ['all', locale === 'es' ? 'Seleccionar todo' : 'Select all', () => { setSelectedNodeIds(new Set(visibleNodes.map(node => node.id))); setSelectedEdgeIds(new Set()); }],
          ['fit', locale === 'es' ? 'Ajustar a la vista' : 'Zoom to fit', () => void flow.fitView(fitOptions)],
        ]) as [string, string, () => void][]).map(([id, label, action]) => <button key={id} type="button" role="menuitem" data-testid={`board-menu-${id}`} className={`block w-full rounded-lg px-3 py-1.5 text-left hover:bg-elevated ${id === 'delete' ? 'text-danger' : 'text-text-primary'}`} onClick={() => { setContextMenu(null); action(); }}>{label}</button>)}
      </div>}

      {(selectedNode || selectedEdge || panel) && (
        <aside className="board-chrome absolute right-3 top-28 z-20 max-h-[calc(100%-8rem)] w-[min(300px,calc(100%-8rem))] overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-xl">
          <div className="mb-2 flex justify-end"><button type="button" aria-label={copy.close} title={copy.close} onClick={() => { setPanel(null); setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); }} className="rounded-md p-1.5 text-text-muted hover:bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold"><X size={16} /></button></div>
          {panel === 'layers' ? (
            <LayersPanel
              layers={layers}
              activeLayerId={activeLayerId}
              counts={layerCounts}
              onCreate={(name) =>
                void addLayer({
                  id: generateId('blayer'),
                  projectId,
                  boardId,
                  name,
                  color: SURFACE_PALETTE[layers.length % SURFACE_PALETTE.length],
                  visible: true,
                  locked: false,
                  opacity: 1,
                  order: layers.length,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                } satisfies BoardLayer)
              }
              onPatch={(id, changes) => editLayer(id, changes)}
              onDelete={(id) => void removeLayer(id)}
              onSetActive={setActiveLayerId}
              onSelectContents={(id) =>
                setSelectedNodeIds(new Set(graph.nodes.filter((node) => node.layerId === id).map((node) => node.id)))
              }
            />
          ) : null}

          {panel === 'views' ? (
            <ViewsPanel
              views={views}
              activeViewId={activeViewId}
              onApply={applyView}
              onSave={(name) => void addView(snapshotView(name))}
              onUpdate={(id) => {
                const snapshot = snapshotView('');
                void editView(id, {
                  query: snapshot.query,
                  layerIds: snapshot.layerIds,
                  mode: snapshot.mode,
                  viewport: snapshot.viewport,
                  positions: snapshot.positions,
                });
              }}
              onDelete={(id) => void removeView(id)}
            />
          ) : null}

          {panel === 'assets' ? <AssetsRail projectId={projectId} locale={locale} onAdd={file => addImagesFromFiles([file])} /> : null}

          {panel === 'metrics' ? (
            <MetricsPanel
              summary={metrics.summary}
              keystoneTitles={keystoneTitles}
              onFocus={focusNode}
              onQuery={setQuery}
            />
          ) : null}

          {!panel && selectedNode ? (
            <NodeInspector
              // Sin `key` el inspector no remonta al cambiar de tarjeta: React
              // reutiliza la instancia y el mini-formulario de «propiedad
              // personalizada» conserva lo escrito para la anterior. Escribías
              // «coartada / en el teatro» para el Sospechoso A, pinchabas en el
              // B para comparar, dabas a «+» y la propiedad se le añadía a B.
              key={selectedNode.id}
              node={selectedNode}
              layers={layers}
              onPatch={(changes) =>
                graph.patchNodes([{ id: selectedNode.id, changes:changes.collapsed!==undefined?setPileCollapsed(selectedNode,graph.nodes,changes.collapsed):changes }], t('board.history.edit'), `edit:${selectedNode.id}`)
              }
              onDelete={() => requestDelete(selectedNode.id)}
              onBindEntity={() => setPickerFor(selectedNode.id)}
              onRaise={(delta) =>
                graph.patchNodes(
                  [{ id: selectedNode.id, changes: { zIndex: Math.max(0, selectedNode.zIndex + delta) } }],
                  t('board.history.reorder'),
                )
              }
            />
          ) : null}

          {!panel && !selectedNode && selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              layers={layers}
              nodeTitle={(id) => graph.nodeById.get(id)?.title || t('board.untitled')}
              edgeTitle={(id) => graph.edgeById.get(id)?.label || graph.edgeById.get(id)?.kind || t('board.untitled')}
              onPatch={(changes) =>
                graph.patchEdges([{ id: selectedEdge.id, changes }], t('board.history.editEdge'), `edge:${selectedEdge.id}`)
              }
              onDelete={() => setPendingDelete({ nodes: [], edges: [selectedEdge.id] })}
              onDetach={(side, endpointId) => {
                const next = selectedEdge[side].filter((endpoint) => endpoint.id !== endpointId);
                graph.patchEdges(
                  [
                    {
                      id: selectedEdge.id,
                      changes: {
                        [side]: next,
                        ...(side === 'sources' ? { sourceId: next[0]?.id ?? '' } : { targetId: next[0]?.id ?? '' }),
                      },
                    },
                  ],
                  t('board.history.editEdge'),
                );
              }}
              onSwap={() =>
                graph.patchEdges(
                  [
                    {
                      id: selectedEdge.id,
                      changes: {
                        sources: selectedEdge.targets,
                        targets: selectedEdge.sources,
                        sourceId: selectedEdge.targets[0]?.id ?? '',
                        targetId: selectedEdge.sources[0]?.id ?? '',
                      },
                    },
                  ],
                  t('board.history.editEdge'),
                )
              }
            />
          ) : null}
        </aside>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addImagesFromFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <EntityPicker
        open={pickerFor !== null}
        projectId={projectId}
        onClose={() => setPickerFor(null)}
        onPick={(preview) => {
          const ref = {
            engineId: preview.engineId,
            entityType: preview.type,
            entityId: preview.id,
            title: preview.title,
            subtitle: preview.subtitle,
            thumbnail: preview.thumbnail,
            color: preview.color,
            missing: false,
            checkedAt: Date.now(),
          };
          if (pickerFor === 'new') {
            const center = viewportCenter();
            const node = makeNode({
              projectId,
              boardId,
              kind: 'entity',
              size:preview.engineId==='maps'?{width:360,height:260}:{width:280,height:220},
              position: center,
              title: preview.title,
              color: preview.color ?? '#4a9e6d',
              ref,
              layerId: activeLayerId ?? undefined,
            });
            graph.addNodes([node], t('board.history.add'));
            setSelectedNodeIds(new Set([node.id]));
          } else if (pickerFor) {
            graph.patchNodes([{ id: pickerFor, changes: { ref } }], t('board.history.bind'));
          }
          setPickerFor(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('board.confirmDelete')
          .replace('{nodes}', String(pendingDelete?.nodes.length ?? 0))
          .replace('{edges}', String(pendingDelete?.edges.length ?? 0))}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
