import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, ConnectionLineType, ConnectionMode, Controls, MiniMap,
  Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Route, Search, Trash2, X } from 'lucide-react';
import ConfirmDialog from '@/engines/_shared/components/ConfirmDialog';
import { resolveEntity } from '@/engines/_shared';
import { navigateTo } from '@/engines/_shared/anchoring';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { DEFAULT_SIZE, EDGE_KINDS, GRID_STEP, SURFACE_PALETTE } from '../catalog';
import { useBoardGraph, useBoardLayers, useBoardViews } from '../hooks';
import { boundsOfNodes, boxOfNode } from '../graph/geometry';
import { cloneSelection, makeEdge, makeNode, nodesInsideFrame } from '../graph/mutations';
import { runLayout, type LayoutKind } from '../graph/layout';
import { computeMetrics } from '../graph/metrics';
import { evaluateQuery } from '../graph/query';
import { shortestPath } from '../graph/paths';
import type {
  Board, BoardBox, BoardEdge, BoardEndpoint, BoardEntityRef, BoardLayer, BoardNode,
  BoardNodeKind, BoardSide, BoardView,
} from '../types';
import BoardNodeView, { type BoardFlowNode } from './BoardNodeView';
import EdgeLayer from './EdgeLayer';
import EntityPicker from './EntityPicker';
import { EdgeInspector, NodeInspector } from './Inspector';
import { LayersPanel, MetricsPanel, ViewsPanel } from './SidePanels';
import Toolbar, { type PanelKey } from './Toolbar';

const nodeTypes = { board: BoardNodeView };

/** Survives remounts so copy on one board pastes on another. */
const clipboard: { nodes: BoardNode[]; edges: BoardEdge[] } = { nodes: [], edges: [] };

const SURFACE_CLASS: Record<Board['surface'], string> = {
  cork: 'cork-bg',
  slate: 'bg-deep',
  grid: 'bg-surface',
  blueprint: 'bg-[#0b1522]',
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
  onRenameBoard: (title: string) => void;
}

export default function BoardCanvas(props: BoardCanvasProps) {
  return (
    <ReactFlowProvider>
      <BoardCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function BoardCanvasInner({ projectId, board }: BoardCanvasProps) {
  const { t } = useTranslation();
  const boardId = board.id;
  const graph = useBoardGraph(boardId);
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
  const [queryMode, setQueryMode] = useState<'filter' | 'highlight'>('highlight');
  const [link, setLink] = useState<LinkState | null>(null);
  const [panel, setPanel] = useState<PanelKey>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
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

  const metrics = useMemo(
    () => computeMetrics(graph.nodes, graph.edges),
    [graph.nodes, graph.edges],
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

  const collapsedFrames = useMemo(
    () => graph.nodes.filter((node) => node.kind === 'frame' && node.collapsed),
    [graph.nodes],
  );

  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<string>();
    for (const frame of collapsedFrames) {
      for (const child of nodesInsideFrame(frame, graph.nodes)) hidden.add(child.id);
    }
    return hidden;
  }, [collapsedFrames, graph.nodes]);

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
    setSelectedNodeIds(new Set([id]));
    setSelectedEdgeIds(new Set());
  }, []);

  const requestDelete = useCallback((id: string) => {
    setPendingDelete({ nodes: [id], edges: [] });
  }, []);

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
      if (!node?.ref || node.ref.missing) return;
      navigateTo(`/project/${projectId}/${node.ref.engineId}`);
    },
    [graph.nodeById, projectId],
  );

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
          dimmed: queryMode === 'highlight' && !queryResult.passthrough && !queryResult.nodeIds.has(node.id),
          layerOpacity: layer?.opacity ?? 1,
          linking: linkingSources.has(node.id) ? 'source' : linkingTargets.has(node.id) ? 'target' : false,
          onPath: pathIds?.nodes.has(node.id) ?? false,
          onEdit: openInspector,
          onDelete: requestDelete,
          onStartLink: startLink,
          onOpenRef: openRef,
          onRename: renameNode,
        },
      };
    });
  }, [
    visibleNodes, positionOf, sizeOf, layerById, selectedNodeIds, queryMode,
    queryResult.passthrough, queryResult.nodeIds, pathIds, link,
    openInspector, requestDelete, startLink, openRef, renameNode,
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
        children: nodesInsideFrame(model, graph.nodes).map((child) => ({
          id: child.id,
          x: child.position.x,
          y: child.position.y,
        })),
      };
    },
    [graph.nodeById, graph.nodes],
  );

  // ---- creating things -------------------------------------------------

  const viewportCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [flow]);

  const addNode = useCallback(
    (kind: BoardNodeKind, overrides: Partial<Parameters<typeof makeNode>[0]> = {}) => {
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
        position: {
          x: Math.round((center.x - size.width / 2) / GRID_STEP) * GRID_STEP,
          y: Math.round((center.y - size.height / 2) / GRID_STEP) * GRID_STEP,
        },
        layerId: activeLayerId ?? undefined,
        title: kind === 'frame' ? t('board.add.frame') : '',
        ...overrides,
      });
      graph.addNodes([node], t('board.history.add'));
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeIds(new Set());
    },
    [viewportCenter, projectId, boardId, activeLayerId, graph, t],
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

  const deleteSelection = useCallback(() => {
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;
    setPendingDelete({ nodes: Array.from(selectedNodeIds), edges: Array.from(selectedEdgeIds) });
  }, [selectedNodeIds, selectedEdgeIds]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    graph.remove(pendingDelete.nodes, pendingDelete.edges, t('board.history.delete'));
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setPendingDelete(null);
  }, [pendingDelete, graph, t]);

  const copySelection = useCallback(() => {
    if (selectedNodes.length === 0) return;
    const ids = new Set(selectedNodes.map((node) => node.id));
    clipboard.nodes = selectedNodes.map((node) => ({ ...node }));
    clipboard.edges = graph.edges.filter((edge) =>
      [...edge.sources, ...edge.targets].every((endpoint) => endpoint.on !== 'node' || ids.has(endpoint.id)),
    );
  }, [selectedNodes, graph.edges]);

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

  const align = useCallback(
    (mode: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom') => {
      if (selectedNodes.length < 2) return;
      const boxList = selectedNodes.map((node) => ({ node, box: boxOfNode(node) }));
      const minX = Math.min(...boxList.map((entry) => entry.box.x));
      const maxX = Math.max(...boxList.map((entry) => entry.box.x + entry.box.width));
      const minY = Math.min(...boxList.map((entry) => entry.box.y));
      const maxY = Math.max(...boxList.map((entry) => entry.box.y + entry.box.height));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const patches = boxList.map(({ node, box }) => {
        const position = { ...node.position };
        if (mode === 'left') position.x = minX;
        if (mode === 'right') position.x = maxX - box.width;
        if (mode === 'center-x') position.x = centerX - box.width / 2;
        if (mode === 'top') position.y = minY;
        if (mode === 'bottom') position.y = maxY - box.height;
        if (mode === 'center-y') position.y = centerY - box.height / 2;
        return { id: node.id, changes: { position } };
      });
      graph.patchNodes(patches, t('board.history.align'));
    },
    [selectedNodes, graph, t],
  );

  const distribute = useCallback(
    (axis: 'x' | 'y') => {
      if (selectedNodes.length < 3) return;
      const sorted = selectedNodes
        .slice()
        .sort((a, b) => (axis === 'x' ? a.position.x - b.position.x : a.position.y - b.position.y));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span =
        axis === 'x'
          ? last.position.x + last.size.width - first.position.x
          : last.position.y + last.size.height - first.position.y;
      const totalSize = sorted.reduce(
        (sum, node) => sum + (axis === 'x' ? node.size.width : node.size.height),
        0,
      );
      const gap = (span - totalSize) / (sorted.length - 1);

      let cursor = axis === 'x' ? first.position.x : first.position.y;
      const patches = sorted.map((node) => {
        const position = { ...node.position };
        if (axis === 'x') position.x = cursor;
        else position.y = cursor;
        cursor += (axis === 'x' ? node.size.width : node.size.height) + gap;
        return { id: node.id, changes: { position } };
      });
      graph.patchNodes(patches, t('board.history.distribute'));
    },
    [selectedNodes, graph, t],
  );

  const applyLayout = useCallback(
    (kind: LayoutKind) => {
      const scope = selectedNodes.length >= 3 ? selectedNodes : visibleNodes;
      const result = runLayout(kind, scope, visibleEdges, {
        focusId: selectedNodes[0]?.id,
      });
      const patches = Object.entries(result).map(([id, position]) => ({ id, changes: { position } }));
      if (patches.length > 0) graph.patchNodes(patches, t(`board.layout.${kind}`));
    },
    [selectedNodes, visibleNodes, visibleEdges, graph, t],
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
      if (!containerRef.current?.closest('body')) return;

      const mod = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        setLink(null);
        setPathIds(null);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
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
        const step = event.shiftKey ? GRID_STEP : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        graph.patchNodes(
          selectedNodes.map((node) => ({
            id: node.id,
            changes: { position: { x: node.position.x + dx, y: node.position.y + dy } },
          })),
          t('board.history.move'),
          'nudge',
        );
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    graph, copySelection, paste, groupIntoFrame, deleteSelection, commitLink,
    link, selectedNodeIds, selectedNodes, visibleNodes, t,
  ]);

  // ---- clipboard images ------------------------------------------------

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      addImagesFromFiles(files);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [addImagesFromFiles]);

  // ---- cross-engine reference revalidation -----------------------------

  const revalidatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph.loading || revalidatedFor.current === boardId) return;
    const referencing = graph.nodes.filter((node) => node.ref);
    revalidatedFor.current = boardId;
    if (referencing.length === 0) return;

    let cancelled = false;
    type RefPatch = { id: string; changes: Partial<BoardNode> };
    void Promise.all(
      referencing.map(async (node): Promise<RefPatch | null> => {
        const ref = node.ref;
        if (!ref) return null;
        try {
          const preview = await resolveEntity(ref.entityId, ref.entityType);
          if (!preview) {
            return ref.missing
              ? null
              : { id: node.id, changes: { ref: { ...ref, missing: true, checkedAt: Date.now() } } };
          }
          const next: BoardEntityRef = {
            ...ref,
            title: preview.title,
            subtitle: preview.subtitle,
            thumbnail: preview.thumbnail,
            color: preview.color,
            engineId: preview.engineId,
            missing: false,
            checkedAt: Date.now(),
          };
          const unchanged =
            ref.title === next.title &&
            ref.subtitle === next.subtitle &&
            ref.thumbnail === next.thumbnail &&
            !ref.missing;
          return unchanged ? null : { id: node.id, changes: { ref: next } };
        } catch {
          return null;
        }
      }),
    ).then((patches) => {
      if (cancelled) return;
      const real = patches.filter((patch): patch is RefPatch => patch !== null);
      if (real.length > 0) graph.sync(real);
    });

    return () => {
      cancelled = true;
    };
  }, [graph, boardId]);

  // ---- deep link -------------------------------------------------------

  const deepLinked = useRef(false);
  useEffect(() => {
    if (graph.loading || deepLinked.current) return;
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search);
    const target = params.get('node');
    if (!target) return;
    const node = graph.nodeById.get(target);
    if (!node) return;
    deepLinked.current = true;
    // Deferred a frame: the graph has only just landed and React Flow needs a
    // measured canvas before it can centre on anything.
    const frame = window.requestAnimationFrame(() => {
      setSelectedNodeIds(new Set([target]));
      flow.setCenter(node.position.x + node.size.width / 2, node.position.y + node.size.height / 2, {
        zoom: 1,
        duration: 400,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graph.loading, graph.nodeById, flow]);

  // ---- views -----------------------------------------------------------

  const applyView = useCallback(
    (view: BoardView) => {
      setActiveViewId(view.id);
      setQuery(view.query);
      setQueryMode(view.mode);
      if (view.layerIds.length > 0) {
        for (const layer of layers) {
          void editLayer(layer.id, { visible: view.layerIds.includes(layer.id) });
        }
      }
      if (view.positions) {
        const patches = Object.entries(view.positions)
          .filter(([id]) => graph.nodeById.has(id))
          .map(([id, position]) => ({ id, changes: { position } }));
        if (patches.length > 0) graph.patchNodes(patches, t('board.history.applyView'));
      }
      if (view.viewport) flow.setViewport(view.viewport, { duration: 300 });
    },
    [layers, editLayer, graph, flow, t],
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
      className={`relative h-[calc(100vh-11rem)] min-h-[520px] w-full overflow-hidden rounded-xl border border-border ${SURFACE_CLASS[board.surface] ?? 'cork-bg'}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          addImagesFromFiles(event.dataTransfer.files, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }
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
        onPaneClick={() => {
          setSelectedEdgeIds(new Set());
          setPathIds(null);
        }}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
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
        className="h-full w-full"
      >
        <Background
          variant={board.surface === 'blueprint' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={GRID_STEP}
          size={1}
          color="#2a2a3a"
        />
        <Controls className="board-chrome" position="bottom-right" showInteractive={false} />
        <MiniMap
          className="board-chrome"
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
            onAdd={addNode}
            linking={Boolean(link)}
            onToggleLink={() =>
              setLink((current) => (current ? null : { sources: [], targets: [], stage: 'source', kind: 'related' }))
            }
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
            onFit={() => flow.fitView({ duration: 400, padding: 0.15 })}
            onExport={() => void exportPng()}
          />
        </Panel>

        <Panel position="top-center">
          <div className="board-chrome flex w-[min(60vw,540px)] flex-col gap-1">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur">
              <Search size={14} className="text-text-dim" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveViewId(null);
                }}
                placeholder={t('board.query.placeholder')}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none"
              />
              <button
                type="button"
                onClick={() => setQueryMode((mode) => (mode === 'filter' ? 'highlight' : 'filter'))}
                className="rounded-lg border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted transition hover:text-accent-gold"
              >
                {t(`board.query.${queryMode}`)}
              </button>
              {query ? (
                <button type="button" onClick={() => setQuery('')} className="text-text-dim hover:text-text-primary">
                  <X size={13} />
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
          </div>
        </Panel>

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
              <button type="button" onClick={() => setLink(null)} className="text-text-muted hover:text-danger">
                <X size={14} />
              </button>
            </div>
          </Panel>
        ) : selectedNodes.length > 1 || selectedEdgeIds.size > 0 ? (
          <Panel position="bottom-center">
            <div className="board-chrome flex items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-xl backdrop-blur">
              <span className="text-xs text-text-muted">
                {t('board.selection.count')
                  .replace('{nodes}', String(selectedNodes.length))
                  .replace('{edges}', String(selectedEdgeIds.size))}
              </span>
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
              >
                <Trash2 size={13} />
              </button>
            </div>
          </Panel>
        ) : null}
      </ReactFlow>

      {(selectedNode || selectedEdge || panel) && (
        <aside className="board-chrome absolute right-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[300px] overflow-y-auto rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
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
              onPatch={(id, changes) => void editLayer(id, changes)}
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
              node={selectedNode}
              layers={layers}
              onPatch={(changes) =>
                graph.patchNodes([{ id: selectedNode.id, changes }], t('board.history.edit'), `edit:${selectedNode.id}`)
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
