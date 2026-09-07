// ============================================
// Board Engine — React hooks
// ============================================
//
// `useBoardGraph` replaces the pattern both legacy engines used, where every
// gesture wrote one row and then re-read the entire board — so dragging a card
// re-serialised every base64 image on the canvas and threw away the local
// state of every node. Here the in-memory graph is the single source of truth
// during a session:
//
//   • mutations apply locally and enqueue a write, debounced and batched;
//   • nothing is ever re-fetched mid-session, so React state survives;
//   • every mutation is a command with before/after row snapshots, which is
//     what makes undo/redo possible at all — neither old engine had it.
//
// The queue is flushed on a timer, when the board changes, on unmount and on
// window teardown, so closing the app mid-drag cannot lose the last gesture.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeEntityHook } from '@/engines/_shared';
import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';
import * as ops from './operations';
import { planDeletion } from './graph/mutations';
import type { Board, BoardEdge, BoardLayer, BoardNode, BoardView } from './types';

export const useBoards = makeEntityHook<Board>({
  fetchFn: ops.getBoards,
  createFn: ops.createBoard,
  updateFn: ops.updateBoard,
  deleteFn: ops.deleteBoard,
});

export const useBoardLayers = makeEntityHook<BoardLayer>({
  fetchFn: ops.getBoardLayers,
  createFn: ops.createBoardLayer,
  updateFn: ops.updateBoardLayer,
  deleteFn: ops.deleteBoardLayer,
});

export const useBoardViews = makeEntityHook<BoardView>({
  fetchFn: ops.getBoardViews,
  createFn: ops.createBoardView,
  updateFn: ops.updateBoardView,
  deleteFn: ops.deleteBoardView,
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type RowKind = 'node' | 'edge';

interface RowOp {
  kind: RowKind;
  id: string;
  /** Row as it was; absent means it did not exist. */
  before?: BoardNode | BoardEdge;
  /** Row as it becomes; absent means it is deleted. */
  after?: BoardNode | BoardEdge;
}

export interface Command {
  label: string;
  ops: RowOp[];
  /** Commands with the same coalesce key merge while typing or dragging. */
  coalesceKey?: string;
  at: number;
}

const COALESCE_WINDOW_MS = 700;
const FLUSH_DELAY_MS = 350;
const RETRY_DELAY_MS = 3000;

interface PendingWrite {
  kind: RowKind;
  id: string;
  row: BoardNode | BoardEdge | null;
}

export interface BoardGraphApi {
  nodes: BoardNode[];
  edges: BoardEdge[];
  nodeById: Map<string, BoardNode>;
  edgeById: Map<string, BoardEdge>;
  loading: boolean;
  error: Error | null;

  addNodes: (nodes: BoardNode[], label?: string) => void;
  addEdges: (edges: BoardEdge[], label?: string) => void;
  patchNodes: (
    patches: Array<{ id: string; changes: Partial<BoardNode> }>,
    label?: string,
    coalesceKey?: string,
  ) => void;
  patchEdges: (
    patches: Array<{ id: string; changes: Partial<BoardEdge> }>,
    label?: string,
    coalesceKey?: string,
  ) => void;
  remove: (nodeIds: string[], edgeIds: string[], label?: string) => void;
  /** Applies several kinds of change as one undoable step. */
  batch: (
    label: string,
    changes: {
      addNodes?: BoardNode[];
      addEdges?: BoardEdge[];
      patchNodes?: Array<{ id: string; changes: Partial<BoardNode> }>;
      patchEdges?: Array<{ id: string; changes: Partial<BoardEdge> }>;
      removeNodeIds?: string[];
      removeEdgeIds?: string[];
    },
  ) => void;

  /**
   * Applies changes without touching the undo stack. Used for housekeeping the
   * author did not perform — revalidating cross-engine references, for
   * instance, which must never be something you can "undo".
   */
  sync: (patches: Array<{ id: string; changes: Partial<BoardNode> }>) => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  flush: () => Promise<boolean>;
}

export function useBoardGraph(boardId: string): BoardGraphApi {
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [edges, setEdges] = useState<BoardEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
    undoLabel: null as string | null,
    redoLabel: null as string | null,
  });

  // Render-adjust on board change: the canvas must never paint the previous
  // board's nodes for even one frame, and an effect would let it.
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);
  if (openBoardId !== boardId) {
    setOpenBoardId(boardId);
    setNodes([]);
    setEdges([]);
    setLoading(Boolean(boardId));
    setError(null);
    setHistoryState({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  }

  // Mirrors of the state kept in refs, so command building never depends on a
  // stale closure and never forces a re-render of every callback.
  const nodesRef = useRef<BoardNode[]>([]);
  const edgesRef = useRef<BoardEdge[]>([]);
  const undoStack = useRef<Command[]>([]);
  const redoStack = useRef<Command[]>([]);
  const pending = useRef(new Map<string, PendingWrite>());
  const flushTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  const loadSeq = useRef(0);

  const syncHistory = useCallback(() => {
    const undoTop = undoStack.current[undoStack.current.length - 1];
    const redoTop = redoStack.current[redoStack.current.length - 1];
    setHistoryState({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
    });
  }, []);

  // ---- persistence ----------------------------------------------------

  // A failed flush re-queues itself, which makes `flush` and `scheduleFlush`
  // mutually recursive; the ref breaks the cycle without either going stale.
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const inFlightFlush = useRef<Promise<boolean> | null>(null);

  const scheduleFlush = useCallback((delayMs = FLUSH_DELAY_MS) => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      void flushRef.current();
    }, delayMs);
  }, []);

  const flushBatch = useCallback(async (): Promise<boolean> => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (pending.current.size === 0) return true;

    const writes = Array.from(pending.current.entries());
    pending.current.clear();
    if (mounted.current) setHasPendingWrites(false);

    const nodePuts: BoardNode[] = [];
    const edgePuts: BoardEdge[] = [];
    const nodeDeletes: string[] = [];
    const edgeDeletes: string[] = [];
    for (const [, write] of writes) {
      if (write.kind === 'node') {
        if (write.row) nodePuts.push(write.row as BoardNode);
        else nodeDeletes.push(write.id);
      } else if (write.row) edgePuts.push(write.row as BoardEdge);
      else edgeDeletes.push(write.id);
    }

    try {
      await trackPendingWrite(
        ops.commitBoardBatch({ nodePuts, edgePuts, nodeDeletes, edgeDeletes }),
        () => flushRef.current(),
        `board:${boardId}`,
      );
      if (mounted.current) {
        setError(null);
        setHasPendingWrites(pending.current.size > 0);
      }
      return true;
    } catch (reason) {
      console.error('[board] flush failed', reason);
      // Nothing was written — the transaction rolled the whole batch back — so
      // put it back on the queue and try again. Anything the author has
      // re-queued for the same row since is newer and keeps its place.
      for (const [key, write] of writes) {
        if (!pending.current.has(key)) pending.current.set(key, write);
      }
      if (mounted.current) {
        setHasPendingWrites(true);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        scheduleFlush(RETRY_DELAY_MS);
      }
      return false;
    }
  }, [boardId, scheduleFlush]);

  // A slow transaction must finish before the next one starts. Otherwise an
  // older failed batch can be retried AFTER a newer successful edit and put
  // the stale row back in the database. Callers also wait for the live batch
  // instead of mistaking an empty pending map for a completed save.
  const flush = useCallback((): Promise<boolean> => {
    if (inFlightFlush.current) {
      return inFlightFlush.current.then((saved) => saved ? flushRef.current() : false);
    }
    const task = flushBatch().finally(() => { inFlightFlush.current = null; });
    inFlightFlush.current = task;
    return task;
  }, [flushBatch]);

  useEffect(() => {
    flushRef.current = flush;
  });

  const enqueue = useCallback(
    (kind: RowKind, id: string, row: BoardNode | BoardEdge | null) => {
      pending.current.set(`${kind}:${id}`, { kind, id, row });
      setHasPendingWrites(true);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // ---- load -----------------------------------------------------------

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const seq = ++loadSeq.current;
    undoStack.current = [];
    redoStack.current = [];
    nodesRef.current = [];
    edgesRef.current = [];
    if (!boardId) return;

    void Promise.all([ops.getBoardNodes(boardId), ops.getBoardEdges(boardId)])
      .then(([loadedNodes, loadedEdges]) => {
        if (seq !== loadSeq.current || !mounted.current) return;
        nodesRef.current = loadedNodes;
        edgesRef.current = loadedEdges;
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (seq !== loadSeq.current || !mounted.current) return;
        console.error('[board] load failed', reason);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (seq === loadSeq.current && mounted.current) setLoading(false);
      });
  }, [boardId]);

  // Make the board's in-memory batch visible to the app-wide close guard.
  useEffect(() => {
    if (!hasPendingWrites) return;
    return registerPendingFlusher(`board:${boardId}`, () => flushRef.current());
  }, [boardId, hasPendingWrites]);

  // Flush whatever is queued when the board changes or the view goes away.
  // Window teardown itself is coordinated centrally by PendingWritesHost.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [boardId, flush]);

  // ---- command application --------------------------------------------

  const applyOps = useCallback(
    (rowOps: RowOp[], direction: 'do' | 'undo') => {
      const nextNodes = new Map(nodesRef.current.map((node) => [node.id, node]));
      const nextEdges = new Map(edgesRef.current.map((edge) => [edge.id, edge]));

      for (const op of rowOps) {
        const target = direction === 'do' ? op.after : op.before;
        const collection = op.kind === 'node' ? nextNodes : nextEdges;
        if (target) collection.set(op.id, target as BoardNode & BoardEdge);
        else collection.delete(op.id);
        enqueue(op.kind, op.id, target ?? null);
      }

      const nodeList = Array.from(nextNodes.values()) as BoardNode[];
      const edgeList = Array.from(nextEdges.values()) as BoardEdge[];
      nodesRef.current = nodeList;
      edgesRef.current = edgeList;
      setNodes(nodeList);
      setEdges(edgeList);
    },
    [enqueue],
  );

  const push = useCallback(
    (command: Command) => {
      if (command.ops.length === 0) return;

      const previous = undoStack.current[undoStack.current.length - 1];
      const canCoalesce =
        Boolean(command.coalesceKey) &&
        previous?.coalesceKey === command.coalesceKey &&
        command.at - previous.at < COALESCE_WINDOW_MS;

      if (canCoalesce && previous) {
        // Merge into the previous command so a burst of typing or a drag is
        // one undo step, keeping the *oldest* `before` and newest `after`.
        const merged = new Map(previous.ops.map((op) => [`${op.kind}:${op.id}`, op]));
        for (const op of command.ops) {
          const key = `${op.kind}:${op.id}`;
          const existing = merged.get(key);
          merged.set(key, existing ? { ...op, before: existing.before } : op);
        }
        previous.ops = Array.from(merged.values());
        previous.at = command.at;
      } else {
        // No ceiling. A command holds the rows it touched, not the board, so
        // an afternoon of editing is a few hundred kB — cheaper than the one
        // time you need to walk back further than an arbitrary limit allowed.
        undoStack.current.push(command);
      }

      redoStack.current = [];
      applyOps(command.ops, 'do');
      syncHistory();
    },
    [applyOps, syncHistory],
  );

  // ---- public mutations -----------------------------------------------

  const batch = useCallback<BoardGraphApi['batch']>(
    (label, changes) => {
      const nodeIndex = new Map(nodesRef.current.map((node) => [node.id, node]));
      const edgeIndex = new Map(edgesRef.current.map((edge) => [edge.id, edge]));
      const rowOps: RowOp[] = [];
      const now = Date.now();

      for (const node of changes.addNodes ?? []) {
        rowOps.push({ kind: 'node', id: node.id, after: node });
      }
      for (const edge of changes.addEdges ?? []) {
        rowOps.push({ kind: 'edge', id: edge.id, after: edge });
      }
      for (const patch of changes.patchNodes ?? []) {
        const before = nodeIndex.get(patch.id);
        if (!before) continue;
        rowOps.push({
          kind: 'node',
          id: patch.id,
          before,
          after: { ...before, ...patch.changes, updatedAt: now },
        });
      }
      for (const patch of changes.patchEdges ?? []) {
        const before = edgeIndex.get(patch.id);
        if (!before) continue;
        rowOps.push({
          kind: 'edge',
          id: patch.id,
          before,
          after: { ...before, ...patch.changes, updatedAt: now },
        });
      }

      const removeNodeIds = changes.removeNodeIds ?? [];
      const removeEdgeIds = changes.removeEdgeIds ?? [];
      if (removeNodeIds.length > 0 || removeEdgeIds.length > 0) {
        const plan = planDeletion(nodesRef.current, edgesRef.current, removeNodeIds, removeEdgeIds);
        for (const id of plan.removedNodeIds) {
          const before = nodeIndex.get(id);
          if (before) rowOps.push({ kind: 'node', id, before });
        }
        for (const id of plan.removedEdgeIds) {
          const before = edgeIndex.get(id);
          if (before) rowOps.push({ kind: 'edge', id, before });
        }
        for (const rewritten of plan.rewrittenEdges) {
          const before = edgeIndex.get(rewritten.id);
          if (before) rowOps.push({ kind: 'edge', id: rewritten.id, before, after: rewritten });
        }
      }

      push({ label, ops: rowOps, at: now });
    },
    [push],
  );

  const addNodes = useCallback<BoardGraphApi['addNodes']>(
    (newNodes, label = 'Add') => batch(label, { addNodes: newNodes }),
    [batch],
  );

  const addEdges = useCallback<BoardGraphApi['addEdges']>(
    (newEdges, label = 'Connect') => batch(label, { addEdges: newEdges }),
    [batch],
  );

  const patchNodes = useCallback<BoardGraphApi['patchNodes']>(
    (patches, label = 'Edit', coalesceKey) => {
      const nodeIndex = new Map(nodesRef.current.map((node) => [node.id, node]));
      const now = Date.now();
      const rowOps: RowOp[] = [];
      for (const patch of patches) {
        const before = nodeIndex.get(patch.id);
        if (!before) continue;
        rowOps.push({
          kind: 'node',
          id: patch.id,
          before,
          after: { ...before, ...patch.changes, updatedAt: now },
        });
      }
      push({ label, ops: rowOps, coalesceKey, at: now });
    },
    [push],
  );

  const patchEdges = useCallback<BoardGraphApi['patchEdges']>(
    (patches, label = 'Edit relation', coalesceKey) => {
      const edgeIndex = new Map(edgesRef.current.map((edge) => [edge.id, edge]));
      const now = Date.now();
      const rowOps: RowOp[] = [];
      for (const patch of patches) {
        const before = edgeIndex.get(patch.id);
        if (!before) continue;
        rowOps.push({
          kind: 'edge',
          id: patch.id,
          before,
          after: { ...before, ...patch.changes, updatedAt: now },
        });
      }
      push({ label, ops: rowOps, coalesceKey, at: now });
    },
    [push],
  );

  const remove = useCallback<BoardGraphApi['remove']>(
    (nodeIds, edgeIds, label = 'Delete') =>
      batch(label, { removeNodeIds: nodeIds, removeEdgeIds: edgeIds }),
    [batch],
  );

  const sync = useCallback<BoardGraphApi['sync']>(
    (patches) => {
      if (patches.length === 0) return;
      const nodeIndex = new Map(nodesRef.current.map((node) => [node.id, node]));
      const rowOps: RowOp[] = [];
      for (const patch of patches) {
        const before = nodeIndex.get(patch.id);
        if (!before) continue;
        rowOps.push({ kind: 'node', id: patch.id, before, after: { ...before, ...patch.changes } });
      }
      if (rowOps.length > 0) applyOps(rowOps, 'do');
    },
    [applyOps],
  );

  const undo = useCallback(() => {
    const command = undoStack.current.pop();
    if (!command) return;
    redoStack.current.push(command);
    applyOps(command.ops, 'undo');
    syncHistory();
  }, [applyOps, syncHistory]);

  const redo = useCallback(() => {
    const command = redoStack.current.pop();
    if (!command) return;
    undoStack.current.push(command);
    applyOps(command.ops, 'do');
    syncHistory();
  }, [applyOps, syncHistory]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edgeById = useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges]);

  return {
    nodes,
    edges,
    nodeById,
    edgeById,
    loading,
    error,
    addNodes,
    addEdges,
    patchNodes,
    patchEdges,
    remove,
    batch,
    sync,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    undoLabel: historyState.undoLabel,
    redoLabel: historyState.redoLabel,
    flush,
  };
}
