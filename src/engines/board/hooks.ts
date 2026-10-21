import { createLocalDraftStore } from '@/hooks/localDraftStore';
import {onDataChanged} from '@/engines/_shared/dataChanged';
import { commitEraBoardBatch, type EraBoardBaseline } from '@/services/worldEras/board';
import { listEraRows } from '@/services/worldEras/store';
import { useWorldEraScope, useEraEntities } from '@/services/worldEras/hooks';
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
import { registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';
import * as ops from './operations';
import {rebaseBoardRow} from './graph/merge';
import { planDeletion } from './graph/mutations';
import type { Board, BoardEdge, BoardLayer, BoardNode, BoardView } from './types';

const useBoardsOptions = {
  fetchFn: ops.getBoards,
  createFn: ops.createBoard,
  updateFn: ops.updateBoard,
  deleteFn: ops.deleteBoard,
};
const compareBoards = (a: Board, b: Board) => a.createdAt - b.createdAt;
const compareLayers = (a: BoardLayer, b: BoardLayer) => a.order - b.order;
const compareViews = (a: BoardView, b: BoardView) => a.order - b.order;
export function useBoards(scopeId: string) { return useEraEntities<Board>(scopeId, 'boards', 'projectId', useBoardsOptions, undefined, compareBoards); }

const useBoardLayersOptions = {
  fetchFn: ops.getBoardLayers,
  createFn: ops.createBoardLayer,
  updateFn: ops.updateBoardLayer,
  deleteFn: ops.deleteBoardLayer,
};
export function useBoardLayers(scopeId: string) { return useEraEntities<BoardLayer>(scopeId, 'boardLayers', 'boardId', useBoardLayersOptions, undefined, compareLayers); }

const useBoardViewsOptions = {
  fetchFn: ops.getBoardViews,
  createFn: ops.createBoardView,
  updateFn: ops.updateBoardView,
  deleteFn: ops.deleteBoardView,
};
export function useBoardViews(scopeId: string) { return useEraEntities<BoardView>(scopeId, 'boardViews', 'boardId', useBoardViewsOptions, undefined, compareViews); }

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

export interface BoardPendingReview {baseline:EraBoardBaseline;pendingVersion:number;changes:{id:string;title:string;field:string;saved:unknown;draft:unknown}[]}
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
  reviewPending: () => Promise<BoardPendingReview>;
  keepPending: (review:BoardPendingReview) => Promise<boolean>;
}

export function useBoardGraph(boardId: string,projectId?:string): BoardGraphApi {
  const scope = useWorldEraScope(projectId);
  const baseline = useRef<EraBoardBaseline>({ nodes: [], edges: [] });
  const journal = useMemo(() => createLocalDraftStore<{ baseline: EraBoardBaseline; pending: [string, PendingWrite][] }>(`wh.board-era-drafts.v1.${scope.projectId}${scope.eraId?`.era:${scope.eraId}`:''}`, (value): value is { baseline: EraBoardBaseline; pending: [string, PendingWrite][] } => !!value && typeof value === 'object' && 'baseline' in value && 'pending' in value && Array.isArray(value.pending)), [scope]);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [edges, setEdges] = useState<BoardEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const externalRefresh = useRef(false);
  const [externalRevision,setExternalRevision]=useState(0);
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
  const pendingVersion=useRef(0);
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
        scope.eraId ? commitEraBoardBatch(scope, boardId, { nodePuts, edgePuts, nodeDeletes, edgeDeletes }, baseline.current) : ops.commitBoardBatch({ nodePuts, edgePuts, nodeDeletes, edgeDeletes },baseline.current),
        () => flushRef.current(),
        `board:${boardId}:era:${scope.eraId ?? 'base'}`,
      );
      for (const [kind, puts, deletes] of [['nodes', nodePuts, nodeDeletes], ['edges', edgePuts, edgeDeletes]] as const) {
        const rows = new Map((baseline.current[kind] as (BoardNode | BoardEdge)[]).map(row => [row.id, row]));
        deletes.forEach(id => rows.delete(id)); puts.forEach(row => rows.set(row.id, row));
        Object.assign(baseline.current, { [kind]: [...rows.values()] });
      }
      if (pending.current.size) journal.set(boardId, { baseline: structuredClone(baseline.current), pending: [...pending.current] }); else journal.delete(boardId);
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
      journal.set(boardId,{baseline:structuredClone(baseline.current),pending:[...pending.current]});
      if (mounted.current) {
        setHasPendingWrites(true);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        if(!(reason instanceof Error)||!['BoardBatchConflict','WorldEraConflict'].includes(reason.name))scheduleFlush(RETRY_DELAY_MS);
      }
      return false;
    }
  }, [boardId, scheduleFlush, scope, journal]);

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
      pendingVersion.current++;
      pending.current.set(`${kind}:${id}`, { kind, id, row });
      journal.set(boardId, { baseline: structuredClone(baseline.current), pending: [...pending.current] });
      setHasPendingWrites(true);
      scheduleFlush();
    },
    [scheduleFlush, journal, boardId],
  );

  const reviewPending=useCallback(async():Promise<BoardPendingReview>=>{
    if(flushTimer.current!==null){window.clearTimeout(flushTimer.current);flushTimer.current=null;}
    if(inFlightFlush.current)await inFlightFlush.current;
    const version=pendingVersion.current;
    const [savedNodes,savedEdges]=await Promise.all([scope.eraId?listEraRows<BoardNode>(scope,'boardNodes').then(rows=>rows.filter(row=>row.boardId===boardId)):ops.getBoardNodes(boardId),scope.eraId?listEraRows<BoardEdge>(scope,'boardEdges').then(rows=>rows.filter(row=>row.boardId===boardId)):ops.getBoardEdges(boardId)]);
    const saved={nodes:savedNodes,edges:savedEdges},changes:BoardPendingReview['changes']=[];
    for(const write of pending.current.values()){
      const old=(write.kind==='node'?baseline.current.nodes:baseline.current.edges).find(row=>row.id===write.id),current=(write.kind==='node'?savedNodes:savedEdges).find(row=>row.id===write.id);
      if(!write.row){changes.push({id:write.id,title:old&&'title'in old?old.title:write.id,field:'delete',saved:current,draft:null});continue;}
      for(const field of new Set([...Object.keys(old??{}),...Object.keys(write.row)])){if(field==='updatedAt')continue;const value=write.row[field as keyof typeof write.row],before=old?.[field as keyof typeof old];if(JSON.stringify(before)===JSON.stringify(value))continue;changes.push({id:write.id,title:'title'in write.row?write.row.title:write.id,field,saved:current?.[field as keyof typeof current],draft:value});}
    }
    return{baseline:saved,pendingVersion:version,changes};
  },[scope,boardId]);
  const keepPending=useCallback(async(review:BoardPendingReview):Promise<boolean>=>{
    if(review.pendingVersion!==pendingVersion.current){setError(new Error('Pending changes changed. Review saved changes again.'));return false;}
    const rebased=new Map<string,PendingWrite>();
    for(const [key,write] of pending.current){const oldRows=write.kind==='node'?baseline.current.nodes:baseline.current.edges,savedRows=write.kind==='node'?review.baseline.nodes:review.baseline.edges;rebased.set(key,{...write,row:write.row?rebaseBoardRow(write.row,oldRows.find(row=>row.id===write.id),savedRows.find(row=>row.id===write.id)):null});}
    // Undo/redo must preserve fields authored remotely while this draft was pending.
    for(const command of [...undoStack.current,...redoStack.current])for(const op of command.ops){const oldRows=op.kind==='node'?baseline.current.nodes:baseline.current.edges,savedRows=op.kind==='node'?review.baseline.nodes:review.baseline.edges,old=oldRows.find(row=>row.id===op.id),saved=savedRows.find(row=>row.id===op.id);if(op.before)op.before=rebaseBoardRow(op.before,old,saved);if(op.after)op.after=rebaseBoardRow(op.after,old,saved);}
    baseline.current=structuredClone(review.baseline);pending.current=rebased;
    const nextNodes=new Map(review.baseline.nodes.map(row=>[row.id,row])),nextEdges=new Map(review.baseline.edges.map(row=>[row.id,row]));
    for(const write of rebased.values()){const rows=write.kind==='node'?nextNodes:nextEdges;if(write.row)rows.set(write.id,write.row as BoardNode&BoardEdge);else rows.delete(write.id);}
    nodesRef.current=[...nextNodes.values()];edgesRef.current=[...nextEdges.values()];setNodes(nodesRef.current);setEdges(edgesRef.current);
    journal.set(boardId,{baseline:structuredClone(baseline.current),pending:[...rebased]});const recoveryWrites=[...rebased.values()];const saved=await flush();if(saved){undoStack.current.push({label:'Recover pending changes',at:Date.now(),ops:recoveryWrites.map(write=>({kind:write.kind,id:write.id,before:(write.kind==='node'?review.baseline.nodes:review.baseline.edges).find(row=>row.id===write.id),after:write.row??undefined}))});redoStack.current=[];syncHistory();}return saved;
  },[boardId,journal,flush,syncHistory]);

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

    void Promise.all([scope.eraId ? listEraRows<BoardNode>(scope, 'boardNodes').then(rows => rows.filter(row => row.boardId === boardId)) : ops.getBoardNodes(boardId), scope.eraId ? listEraRows<BoardEdge>(scope, 'boardEdges').then(rows => rows.filter(row => row.boardId === boardId)) : ops.getBoardEdges(boardId)])
      .then(([loadedNodes, loadedEdges]) => {
        if (seq !== loadSeq.current || !mounted.current) return;
        const recovered = journal.get(boardId);
        baseline.current = recovered?.baseline ?? { nodes: structuredClone(loadedNodes), edges: structuredClone(loadedEdges) };
        if (recovered) {
          pending.current = new Map(recovered.pending);
          const nodes = new Map(loadedNodes.map(row => [row.id, row])), edges = new Map(loadedEdges.map(row => [row.id, row]));
          for (const [, write] of recovered.pending) { const rows = write.kind === 'node' ? nodes : edges; if (write.row) rows.set(write.id, write.row as BoardNode & BoardEdge); else rows.delete(write.id); }
          loadedNodes = [...nodes.values()]; loadedEdges = [...edges.values()]; setHasPendingWrites(true); scheduleFlush();
        }
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
  }, [boardId, scope, journal, scheduleFlush]);

  useEffect(()=>onDataChanged(detail=>{
    if(!['ai','undo','import'].includes(detail.source)||detail.projectId&&detail.projectId!==scope.projectId||detail.table&&!['boards','boardNodes','boardEdges','boardLayers','boardViews'].includes(detail.table))return;
    externalRefresh.current=true;setExternalRevision(value=>value+1);
  }),[scope]);
  // External commands update an idle canvas. Buffered gestures finish first,
  // preserving their in-memory draft and the era baseline used for CAS.
  useEffect(()=>{
    if(!externalRefresh.current||loading||hasPendingWrites)return;
    let cancelled=false;
    void (async()=>{
      if(inFlightFlush.current)await inFlightFlush.current;
      if(cancelled||pending.current.size)return;
      const [nextNodes,nextEdges]=await Promise.all([scope.eraId?listEraRows<BoardNode>(scope,'boardNodes').then(rows=>rows.filter(row=>row.boardId===boardId)):ops.getBoardNodes(boardId),scope.eraId?listEraRows<BoardEdge>(scope,'boardEdges').then(rows=>rows.filter(row=>row.boardId===boardId)):ops.getBoardEdges(boardId)]);
      if(cancelled||pending.current.size)return;
      externalRefresh.current=false;baseline.current={nodes:structuredClone(nextNodes),edges:structuredClone(nextEdges)};nodesRef.current=nextNodes;edgesRef.current=nextEdges;setNodes(nextNodes);setEdges(nextEdges);
    })().catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason:new Error(String(reason)));});
    return()=>{cancelled=true;};
  },[externalRevision,hasPendingWrites,loading,scope,boardId]);

  // Make the board's in-memory batch visible to the app-wide close guard.
  useEffect(() => {
    if (!hasPendingWrites) return;
    return registerPendingFlusher(`board:${boardId}:era:${scope.eraId ?? 'base'}`, () => flushRef.current());
  }, [boardId, hasPendingWrites, scope.eraId]);

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
    reviewPending,
    keepPending,
  };
}
