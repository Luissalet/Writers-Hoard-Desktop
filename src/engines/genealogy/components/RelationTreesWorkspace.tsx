import { bindEraOperation, useWorldEraScope, useEraProject } from '@/services/worldEras/hooks';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Background, ConnectionMode, Controls, Handle, MarkerType, Position, NodeToolbar, ReactFlow, useStoreApi, type Node, type NodeProps, type Connection, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './relationTreeReconnect.css';
import { ArrowUp,ArrowDown,ArrowLeft,ArrowRight,Copy, Download, GitBranch, Network, Pencil, Plus, Redo2, Save, Skull, Trash2, Type, Undo2, User } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useProject } from '@/hooks/useProjects';
import { useCodexEntries } from '@/engines/codex/hooks';
import { ConfirmDialog } from '@/engines/_shared';
import { usePaneNavigate } from '@/engines/_shared/usePaneNavigate';
import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { useDeepLinkParam } from '@/engines/_shared';
import { generateId } from '@/utils/idGenerator';
import { db } from '@/db';
import type { CodexEntry } from '@/types';
import { rowToLink } from '../genealogyStore';
import { copyCanonicalTree, duplicateRelationTree, exportRelationTreeSvg, layoutRelationTree, RelationTreeValidationError, TREE_KINDS, validateRelationTree, type RelationTreeDocument, type RelationTreeEdge } from '../relationTrees';
import { deleteRelationTree as deleteRelationTreeScoped, RelationTreeConflict, saveRelationTree as saveRelationTreeScoped } from '../relationTreeStore';
import { relationTreeCopy, type RelationTreeCopy } from '../relationTreeCopy';
import { makeTreeStroke, makeTreeText, MAX_TREE_ANNOTATIONS, TREE_ANNOTATION_COLOR, type RelationTreeAnnotation } from '../relationTreeAnnotations';
import FreehandOverlay from '@/engines/board/components/FreehandOverlay';
import { AnnotationNode, TreeAnnotationInspector, type AnnotationFlowNode } from './TreeAnnotation';
import { insertTreeJunction, relationTreeSegments, removeTreeJunction, treeEdgeLabelPosition } from '../relationTreeRoutes';
import { RELATION_ICON_NAMES } from '../relationIcons';
import { ProjectIcon } from '@/components/common/ProjectIcon';
import { JunctionNode, TreeRelationFlowEdge, type JunctionFlowNode, type RelationFlowEdge } from './TreeRelationFlow';
import { createTreePreset, snapTreePoint, TREE_PRESETS, treePresetNames, type TreePreset } from '../treePresets';
import { decodeTreeImage, MAX_TREE_IMAGE_BYTES } from '../treeImages';
import {reconnectTreeEdge,type TreeSide} from '../treeAffordances';
import {TreeNeighborForm,TreeVocabularyPanel} from './TreeAffordancePanels';

const fieldClass = 'w-full min-w-0 px-2.5 py-2 text-sm text-text-primary bg-elevated border border-border rounded-lg outline-none focus:border-accent-gold';
const buttonClass = 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-40';
interface Draft { tree: RelationTreeDocument; baseRevision: number; dirty: boolean }
function draftsFor(projectId: string, eraId?: string) {
  return createLocalDraftStore<Draft>(`wh.relation-trees.v1.${projectId}${eraId ? `.era:${eraId}` : ''}`, (value): value is Draft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Draft;
    return !!draft.tree && typeof draft.tree.id === 'string' && Array.isArray(draft.tree.nodes) && Array.isArray(draft.tree.edges) && Number.isInteger(draft.baseRevision);
  });
}
type TreeNodeData = { label: string; avatar?: string; deceased?: boolean; missing?: boolean; copy: RelationTreeCopy;onNeighbor:(side:TreeSide)=>void } & Record<string, unknown>;
type PersonFlowNode = Node<TreeNodeData, 'person'>;
type FlowNode = PersonFlowNode | AnnotationFlowNode | JunctionFlowNode;
function PersonNode({ data, selected }: NodeProps<PersonFlowNode>) {
  return <div className={`group relative w-[200px] min-h-[75px] rounded-lg border bg-surface px-3 py-2 shadow-sm ${selected ? 'border-accent-gold ring-1 ring-accent-gold' : 'border-border'}`}>
    {([['top',ArrowUp,Position.Top],['bottom',ArrowDown,Position.Bottom],['left',ArrowLeft,Position.Left],['right',ArrowRight,Position.Right]] as const).map(([side,Icon,position])=><NodeToolbar key={side} isVisible={selected} position={position} offset={10}><button type="button" aria-label={`${data.copy.neighbor} · ${data.copy[side]} · ${data.label}`} title={`${data.copy.neighbor} · ${data.copy[side]}`} className="nodrag nopan flex h-8 w-8 items-center justify-center rounded border border-border bg-elevated text-accent-gold hover:bg-surface focus-visible:outline focus-visible:outline-accent-gold" onClick={event=>{event.stopPropagation();data.onNeighbor(side);}}><Icon size={15}/></button></NodeToolbar>)}
    {([['top', Position.Top], ['bottom', Position.Bottom], ['left', Position.Left], ['right', Position.Right]] as const).map(([id, position]) => <Handle key={id} id={id} type="source" position={position} className="!h-3 !w-3 !bg-accent-gold !border-surface" />)}
    <div className="flex items-center gap-2">
      {data.avatar ? <img src={data.avatar} alt="" className="w-9 h-9 rounded object-cover shrink-0" /> : <User size={20} className="text-text-muted shrink-0" aria-hidden="true" />}
      <span className={`text-sm font-semibold text-text-primary break-words min-w-0 ${data.deceased ? 'line-through' : ''}`}>{data.label}</span>
      {data.deceased && <Skull size={14} className="text-text-muted shrink-0" aria-label={data.copy.deceased} />}
    </div>
    {data.missing && <p className="mt-1 text-xs text-warning">{data.copy.missing}</p>}
  </div>;
}
const nodeTypes = { person: PersonNode, annotation: AnnotationNode, junction: JunctionNode };
const edgeTypes = { relation: TreeRelationFlowEdge };

// This child runs inside ReactFlow's store provider. Cancelling the gesture also
// clears our write intent: a later pointer-up over a valid handle stays a no-op.
function ReconnectEscape({activeEnd}:{activeEnd:RefObject<'source'|'target'|null>}) {
  const store=useStoreApi();
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||!activeEnd.current)return;
      event.preventDefault();event.stopPropagation();
      activeEnd.current=null;
      store.getState().cancelConnection();
    };
    document.addEventListener('keydown',cancel,true);
    return()=>document.removeEventListener('keydown',cancel,true);
  },[activeEnd,store]);
  return null;
}
export function TreeEditor({ projectId, current, entries, onSaved, onVariant, onDelete,onPendingChange }: { projectId: string; current: RelationTreeDocument; entries: CodexEntry[]; onSaved: () => void; onVariant: (tree: RelationTreeDocument) => void; onDelete: () => void;onPendingChange?:(pending:boolean)=>void }) {
  const scope = useWorldEraScope(projectId);
  const saveRelationTree = bindEraOperation(saveRelationTreeScoped, scope.eraId, 3);

  const { locale } = useTranslation();
  const navigateTo = usePaneNavigate();
  const copy = relationTreeCopy(locale);
  const [drafts] = useState(() => draftsFor(projectId, scope.eraId));
  const [session, setSession] = useState<Draft>(() => drafts.get(current.id) ?? { tree: structuredClone(current), baseRevision: current.revision, dirty: false });
  const latestSession = useRef(session); latestSession.current = session;
  const imageInput = useRef<HTMLInputElement>(null), imageRequest = useRef(0);
  useEffect(() => () => { imageRequest.current++; }, []);
  const [recovered, setRecovered] = useState(() => drafts.has(current.id));
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge' | 'annotation' | 'junction'; id: string; segmentIndex?: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [penColor, setPenColor] = useState(TREE_ANNOTATION_COLOR);
  const [penWidth, setPenWidth] = useState(3);
  const drawingButton = useRef<HTMLButtonElement>(null);
  const flow = useRef<ReactFlowInstance<FlowNode, RelationFlowEdge> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [nodeName, setNodeName] = useState('');
  const [newCodexId, setNewCodexId] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [neighbor,setNeighbor]=useState<{parentId:string;side:TreeSide}|null>(null);
  // XYFlow's start callback reports the fixed opposite handle, rather than the dragged end.
  const reconnectEnd=useRef<'source'|'target'|null>(null);
  const reconnectHelpId=useId();
  const [measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  const vocabularyTrees=useEraProject(projectId)?.relationTrees??[];
  const [connectionKind, setConnectionKind] = useState<RelationTreeEdge['kind']>(current.preset && current.preset !== 'family' ? 'custom' : 'partner');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'node' | 'edge' | 'annotation' | 'junction' | 'reload' | null>(null);
  const history = useRef<{ past: RelationTreeDocument[]; future: RelationTreeDocument[] }>({ past: [], future: [] });
  const submitting = useRef(false);
  const tree = session.tree;
  const byEntry = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  const nameFor = (node: RelationTreeDocument['nodes'][number]) => node.codexEntryId ? byEntry.get(node.codexEntryId)?.title ?? node.label : node.label;
  const selectedNode = selected?.kind === 'node' ? tree.nodes.find(node => node.id === selected.id) : undefined;
  const selectedEdge = selected?.kind === 'edge' ? tree.edges.find(edge => edge.id === selected.id) : undefined;
  const selectedAnnotation = selected?.kind === 'annotation' ? tree.annotations?.find(item => item.id === selected.id) : undefined;
  const selectedJunction = selected?.kind === 'junction' ? tree.junctions?.find(item => item.id === selected.id) : undefined;
  const endpoints = [...tree.nodes.map(node => ({ id: node.id, label: nameFor(node) })), ...(tree.junctions ?? []).map((point, index) => ({ id: point.id, label: `${copy.junction} ${index + 1}` }))];
  const finishDrawing = () => { setDrawing(false); drawingButton.current?.focus({ preventScroll: true }); };
  useEffect(() => { if (drawing) canvas.current?.querySelector<HTMLButtonElement>('[data-testid="board-freehand-done"]')?.focus({ preventScroll: true }); }, [drawing]);

  // Remote updates refresh a clean view; a dirty draft stays intact for an explicit conflict decision.
  if (!session.dirty && current.revision !== session.baseRevision) setSession({ tree: structuredClone(current), baseRevision: current.revision, dirty: false });
  useEffect(() => {
    if (session.dirty) drafts.set(tree.id, session);
    else drafts.delete(tree.id);
  }, [drafts, session, tree.id]);
  const remember = (snapshot: RelationTreeDocument = tree) => {
    history.current.past.push(structuredClone(snapshot));
    if (history.current.past.length > 80) history.current.past.shift();
    history.current.future = [];
  };
  const explain = (error: unknown) => error instanceof RelationTreeValidationError
    ? error.issues.some(issue => issue.includes('cycle')) ? copy.cycle : error.issues.includes('self_link') ? copy.self : copy.invalid
    : copy.failure;
  const change = (next: RelationTreeDocument, validate = false) => {
    if(next===tree)return;
    try {
      if (validate) validateRelationTree(next);
      remember(); setSession(previous => ({ ...previous, tree: next, dirty: true })); setNotice('');
    } catch (error) { setNotice(explain(error)); }
  };
  const addNode = () => {
    const entry = byEntry.get(newCodexId);
    const id = generateId('tree-node');
    change({ ...tree, nodes: [...tree.nodes, { id, label: entry?.title || nodeName.trim() || `${copy.node} ${tree.nodes.length + 1}`, codexEntryId: entry?.id, position: { x: (tree.nodes.length % 4) * 240, y: Math.floor(tree.nodes.length / 4) * 150 } }] });
    setSelected({ kind: 'node', id }); setNodeName('');
  };
  const uploadImage = async (file: File | undefined, nodeId: string) => {
    if (!file) return;
    const request = ++imageRequest.current;
    try {
      if (file.size > MAX_TREE_IMAGE_BYTES) throw Error('invalid_tree_image');
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('invalid_tree_image')); reader.onerror = () => reject(Error('invalid_tree_image')); reader.readAsDataURL(file); });
      await decodeTreeImage(image);
      if (request !== imageRequest.current || !latestSession.current.tree.nodes.some(node => node.id === nodeId)) return;
      remember(latestSession.current.tree);
      setSession(previous => ({ ...previous, dirty: true, tree: { ...previous.tree, nodes: previous.tree.nodes.map(node => node.id === nodeId ? { ...node, image } : node) } })); setNotice('');
    } catch { if (request === imageRequest.current) setNotice(locale === 'es' ? 'Elige una imagen PNG, JPEG o WebP válida de hasta 8 MB.' : 'Choose a valid PNG, JPEG or WebP image up to 8 MB.'); }
  };
  const addAnnotation = (annotation: RelationTreeAnnotation | null) => {
    if (!annotation || (tree.annotations?.length ?? 0) >= MAX_TREE_ANNOTATIONS) { setNotice(copy.annotationLimit); return; }
    change({ ...tree, annotations: [...(tree.annotations ?? []), annotation] }, true);
    setSelected({ kind: 'annotation', id: annotation.id });
  };
  const addText = () => {
    const rect = canvas.current?.getBoundingClientRect();
    const position = rect && flow.current ? flow.current.screenToFlowPosition({ x: rect.x + rect.width / 2 - 140, y: rect.y + 80 }) : { x: 0, y: 0 };
    setDrawing(false); addAnnotation(makeTreeText(generateId('tree-text'), copy.textAnnotation, position));
  };
  const connect = (connection: Pick<Connection, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>) => {
    if (!connection.source || !connection.target) return;
    const id = generateId('tree-edge');
    const next = { ...tree, edges: [...tree.edges, { id, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? 'bottom', targetHandle: connection.targetHandle ?? 'top', kind: connectionKind, style: 'solid' as const }] };
    try { validateRelationTree(next); change(next); setSelected({ kind: 'edge', id }); } catch (error) { setNotice(explain(error)); }
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true; setSaving(true); setNotice('');
    try {
      const saved = await saveRelationTree(projectId, tree, session.baseRevision);
      setSession({ tree: saved, baseRevision: saved.revision, dirty: false });
      drafts.delete(tree.id); setRecovered(false); setConflict(false); onSaved();
    } catch (error) {
      if (error instanceof RelationTreeConflict) setConflict(true);
      else setNotice(explain(error));
    } finally { submitting.current = false; setSaving(false); }
  };
  useEffect(()=>{onPendingChange?.(session.dirty||saving||!!nodeName.trim());return()=>onPendingChange?.(false);},[onPendingChange,session.dirty,saving,nodeName]);
  const undo = (redo: boolean) => {
    const from = redo ? history.current.future : history.current.past;
    const to = redo ? history.current.past : history.current.future;
    const next = from.pop(); if (!next) return;
    to.push(structuredClone(tree)); setSession(previous => ({ ...previous, tree: next, dirty: true })); setNotice('');
  };
  const download = () => {
    try {
      const svg = exportRelationTreeSvg(tree, new Map(entries.map(entry => [entry.id, entry.title])));
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const link = document.createElement('a'); link.href = url; link.download = `${tree.title.replace(/[<>:"/\\|?*]/g, '_') || 'tree'}.svg`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setNotice(explain(error)); }
  };
  const nodes: FlowNode[] = [
    ...(tree.annotations ?? []).map((annotation): AnnotationFlowNode => ({ id: annotation.id, type: 'annotation', measured:measurements[annotation.id], position: annotation.position, width: annotation.size.width, height: annotation.size.height, style: { width: annotation.size.width, height: annotation.size.height }, ariaLabel: annotation.kind === 'text' ? annotation.text.slice(0, 300) : copy.drawing, selected: selected?.kind === 'annotation' && selected.id === annotation.id, zIndex: 0, data: { annotation } })),
    ...(tree.junctions ?? []).map((point, index): JunctionFlowNode => ({ id: point.id, type: 'junction', measured:measurements[point.id], position: point.position, width: 16, height: 16, zIndex: 2, selected: selected?.kind === 'junction' && selected.id === point.id, ariaLabel: `${copy.junction} ${index + 1}`, data: { label: `${copy.junction} ${index + 1}` } })),
    ...tree.nodes.map((node): PersonFlowNode => ({ id: node.id, type: 'person', measured:measurements[node.id], position: node.position, zIndex: 1, selected: selected?.kind === 'node' && selected.id === node.id, data: { label: nameFor(node), deceased: node.deceased, avatar: node.image ?? (node.codexEntryId ? byEntry.get(node.codexEntryId)?.avatar : undefined), missing: !!node.codexEntryId && !byEntry.has(node.codexEntryId), copy,onNeighbor:side=>{setSelected({kind:'node',id:node.id});setNeighbor({parentId:node.id,side});} } })),
  ];
  const edges: RelationFlowEdge[] = relationTreeSegments(tree).map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? 'bottom', targetHandle: edge.targetHandle ?? 'top', reconnectable:edge.segmentIndex===0?(edge.last?true:'source'):(edge.last?'target':false), type: 'relation', ariaLabel: selected?.kind==='edge'&&selected.id===edge.logicalId ? copy.reconnectInstructions : undefined, data: { logicalId: edge.logicalId, segmentIndex: edge.segmentIndex, labelText: edge.segmentIndex || edge.label === '' ? '' : edge.label || copy[edge.kind], icon: edge.icon, labelPosition: treeEdgeLabelPosition(tree, tree.edges.find(item => item.id === edge.logicalId)!) }, selected: selected?.kind === 'edge' && selected.id === edge.logicalId, style: { stroke: selected?.id === edge.logicalId ? 'var(--color-accent-gold)' : 'var(--color-text-muted)', strokeWidth: 2, strokeDasharray: edge.style === 'dashed' ? '8 5' : edge.style === 'dotted' ? '2 5' : undefined }, markerEnd: edge.last && edge.kind.endsWith('_parent') ? { type: MarkerType.ArrowClosed } : undefined }));
  const patchNode = (patch: Partial<RelationTreeDocument['nodes'][number]>) => { if (selectedNode) change({ ...tree, nodes: tree.nodes.map(node => node.id === selectedNode.id ? { ...node, ...patch } : node) }); };
  const patchEdge = (patch: Partial<RelationTreeEdge>) => {
    if(!selectedEdge)return;
    const end=patch.source!==undefined||patch.sourceHandle!==undefined?'source':patch.target!==undefined||patch.targetHandle!==undefined?'target':null;
    try{if(end){const key=end==='source'?'sourceHandle':'targetHandle';change(reconnectTreeEdge(tree,selectedEdge.id,end,patch[end]??selectedEdge[end],(patch[key]??selectedEdge[key]??(end==='source'?'bottom':'top')) as TreeSide),true);}else change({...tree,edges:tree.edges.map(edge=>edge.id===selectedEdge.id?{...edge,...patch}:edge)},true);}catch(error){setNotice(explain(error));}
  };
  const reconnect=(edge:RelationFlowEdge,connection:Connection)=>{
    const logical=tree.edges.find(item=>item.id===(edge.data?.logicalId??edge.id)),end=reconnectEnd.current;if(!logical||!end)return;
    if(end==='source'&&edge.data?.segmentIndex!==0||end==='target'&&edge.data?.segmentIndex!==(logical.via?.length??0))return;
    const nodeId=connection[end],handle=end==='source'?connection.sourceHandle:connection.targetHandle;
    if(!nodeId||!['top','bottom','left','right'].includes(handle??''))return;
    try{change(reconnectTreeEdge(tree,logical.id,end,nodeId,handle as TreeSide),true);}catch(error){setNotice(explain(error));}
  };
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const dimensions=changes.flatMap(item=>item.type==='dimensions'&&item.dimensions?[[item.id,item.dimensions] as const]:[]);
    if(dimensions.length)setMeasurements(previous=>{let next=previous;for(const[id,size]of dimensions)if(previous[id]?.width!==size.width||previous[id]?.height!==size.height)next={...next,[id]:size};return next;});
    const selection = changes.find(change => change.type === 'select' && change.selected);
    if (selection?.type === 'select') setSelected({ kind: tree.nodes.some(node => node.id === selection.id) ? 'node' : tree.annotations?.some(item => item.id === selection.id) ? 'annotation' : 'junction', id: selection.id });
    const positions = new Map(changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, snapTreePoint(tree, change.id, change.position, 8 / (flow.current?.getZoom() ?? 1))] as const] : []));
    if (!positions.size) return;
    setSession(previous => ({ ...previous, dirty: true, tree: { ...previous.tree, nodes: previous.tree.nodes.map(node => positions.get(node.id) ? { ...node, position: positions.get(node.id)! } : node), annotations: previous.tree.annotations?.map(item => positions.get(item.id) ? { ...item, position: positions.get(item.id)! } : item), junctions: previous.tree.junctions?.map(item => positions.get(item.id) ? { ...item, position: positions.get(item.id)! } : item) } }));
  };
  return <div className="space-y-3" data-testid="relation-tree-editor" aria-busy={saving} inert={saving} onKeyDown={event => { if (drawing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishDrawing(); } }}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="min-w-[180px] flex-1"><span className="sr-only">{copy.name}</span><input aria-label={copy.name} className={fieldClass} value={tree.title} onChange={event => change({ ...tree, title: event.target.value })} /></label>
      <span role="status" className={`text-xs ${session.dirty ? 'text-accent-gold' : 'text-text-muted'}`}>{saving ? copy.saving : session.dirty ? copy.dirty : copy.saved}</span>
      <button type="button" className={buttonClass} disabled={saving || !session.dirty} onClick={() => void save()}><Save size={15} />{copy.save}</button>
      <button type="button" className={buttonClass} disabled={saving} onClick={() => onVariant(tree)}><Copy size={15} />{copy.variant}</button>
      <button type="button" className={buttonClass} disabled={saving} onClick={download}><Download size={15} />{copy.export}</button>
      <button type="button" className={buttonClass} disabled={saving} onClick={onDelete} aria-label={copy.removeTree} title={copy.removeTree}><Trash2 size={15} /></button>
    </div>
    {selectedEdge && <p id={reconnectHelpId} className="text-xs text-text-muted">{copy.reconnectInstructions}</p>}
    {recovered && <p role="status" className="text-sm text-accent-gold">{copy.recovered}</p>}
    {(conflict || current.revision !== session.baseRevision) && <div role="alert" className="rounded-lg border border-warning/50 p-3 space-y-2 text-sm text-text-primary"><p>{copy.conflict}</p><div className="flex gap-2 flex-wrap"><button type="button" className={buttonClass} onClick={() => onVariant(tree)}>{copy.variant}</button><button type="button" className={buttonClass} onClick={() => setConfirm('reload')}>{copy.reload}</button></div></div>}
    {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" className={buttonClass} onClick={() => undo(false)} disabled={!history.current.past.length} aria-label={copy.undo}><Undo2 size={15} /></button>
      <button type="button" className={buttonClass} onClick={() => undo(true)} disabled={!history.current.future.length} aria-label={copy.redo}><Redo2 size={15} /></button>
      <button type="button" className={buttonClass} onClick={() => change(layoutRelationTree(tree))}><Network size={15} />{copy.layout}</button>
      <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={tree.snapToNodes ?? false} onChange={event => change({ ...tree, snapToNodes: event.target.checked })} />{locale === 'es' ? 'Alinear al arrastrar' : 'Align while dragging'}</label>
      <button type="button" className={buttonClass} onClick={addText}><Type size={15} />{copy.addText}</button>
      <button ref={drawingButton} type="button" className={`${buttonClass} ${drawing ? 'border-accent-gold text-accent-gold' : ''}`} aria-pressed={drawing} onClick={() => setDrawing(value => !value)}><Pencil size={15} />{copy.draw}</button>
      <p className="text-xs text-text-muted flex-1">{copy.instructions}</p>
    </div>
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div ref={canvas} className="relative h-[620px] min-h-[420px] bg-deep border border-border rounded-lg overflow-hidden" data-testid="relation-tree-canvas">
        <ReactFlow<FlowNode, RelationFlowEdge> className="wh-relation-tree-flow" aria-describedby={selectedEdge?reconnectHelpId:undefined} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={instance => { flow.current = instance; }} connectionMode={ConnectionMode.Loose} onConnect={connect} onReconnectStart={(_event,_edge,end)=>{reconnectEnd.current=end==='source'?'target':'source';}} onReconnect={reconnect} onReconnectEnd={()=>{reconnectEnd.current=null;}} onNodesChange={onNodesChange} onNodeDragStart={() => remember()} onNodeDragStop={(_event, node) => setSession(previous => ({ ...previous, dirty: true, tree: { ...previous.tree, nodes: previous.tree.nodes.map(item => item.id === node.id ? { ...item, position: snapTreePoint(previous.tree, item.id, node.position, 8 / (flow.current?.getZoom() ?? 1)) } : item) } }))} onNodeClick={(_event, node) => setSelected({ kind: node.type === 'annotation' ? 'annotation' : node.type === 'junction' ? 'junction' : 'node', id: node.id })} onEdgeClick={(_event, edge) => setSelected({ kind: 'edge', id: edge.data?.logicalId ?? edge.id, segmentIndex: edge.data?.segmentIndex })} onPaneClick={() => setSelected(null)} onMoveEnd={(event, viewport) => { if (event) setSession(previous => ({ ...previous, dirty: true, tree: { ...previous.tree, viewport } })); }} defaultViewport={tree.viewport} fitView={!tree.viewport && nodes.length > 0} minZoom={0.1} maxZoom={4} deleteKeyCode={null} proOptions={{ hideAttribution: true }}><ReconnectEscape activeEnd={reconnectEnd}/><Background gap={24} color="var(--color-border)" /><Controls className="wh-canvas-controls" showInteractive={false} />{nodes.length === 0 && <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none"><p className="max-w-sm text-sm text-text-muted text-center">{copy.empty}</p></div>}{drawing && <FreehandOverlay color={penColor} width={penWidth} onColor={setPenColor} onWidth={setPenWidth} onDone={finishDrawing} onStroke={(points, zoom) => addAnnotation(makeTreeStroke(generateId('tree-stroke'), points, penColor, penWidth, zoom))} />}</ReactFlow>
      </div>
      <aside className="space-y-4 min-w-0 rounded-lg border border-border bg-surface p-3" aria-label={copy.selection}>
        {neighbor&&<TreeNeighborForm key={neighbor.parentId+neighbor.side} context={neighbor} tree={tree} trees={vocabularyTrees} locale={locale} entries={entries} onChange={next=>{change(next,true);setSelected({kind:"node",id:next.nodes[next.nodes.length-1].id});window.setTimeout(()=>canvas.current?.parentElement?.querySelector<HTMLInputElement>(`input[aria-label="${copy.nodeName} · ${copy.selection}"]`)?.focus(),0);}} onClose={()=>setNeighbor(null)}/>}
        <TreeVocabularyPanel key={selectedEdge?.id??"none"} tree={tree} trees={vocabularyTrees} locale={locale} edge={selectedEdge} onChange={next=>change(next,true)}/>
        <details open={!selected} className="space-y-3"><summary className="cursor-pointer rounded py-1 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold">{copy.addElements}</summary>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">{copy.addNode}</h3>
          <label className="block text-xs text-text-muted">{copy.person}<select aria-label={copy.person} className={`${fieldClass} mt-1`} value={newCodexId} onChange={event => setNewCodexId(event.target.value)}><option value="">{copy.freeNode}</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
          {!newCodexId && <label className="block text-xs text-text-muted">{copy.nodeName}<input aria-label={copy.nodeName} className={`${fieldClass} mt-1`} value={nodeName} onChange={event => setNodeName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addNode(); }} /></label>}
          <button type="button" className={buttonClass} onClick={addNode}><Plus size={14} />{copy.addNode}</button>
        </div>
        <div className="border-t border-border pt-3 space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">{copy.addEdge}</h3>
          <label className="block text-xs text-text-muted">{copy.from}<select aria-label={copy.from} className={`${fieldClass} mt-1`} value={source} onChange={event => setSource(event.target.value)}><option value="">—</option>{endpoints.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.to}<select aria-label={copy.to} className={`${fieldClass} mt-1`} value={target} onChange={event => setTarget(event.target.value)}><option value="">—</option>{endpoints.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.kind}<select aria-label={copy.kind} className={`${fieldClass} mt-1`} value={connectionKind} onChange={event => setConnectionKind(event.target.value as RelationTreeEdge['kind'])}>{TREE_KINDS.map(kind => <option key={kind} value={kind}>{copy[kind]}</option>)}</select></label>
          <button type="button" className={buttonClass} disabled={!source || !target} onClick={() => connect({ source, target, sourceHandle: 'bottom', targetHandle: 'top' })}><GitBranch size={14} />{copy.addEdge}</button>
        </div>
        </details>
        {selectedJunction ? <div className="border-t border-border pt-3 space-y-2" data-testid="tree-junction-inspector"><h3 className="text-sm font-semibold text-text-primary">{copy.junction}</h3><p className="text-xs text-text-muted">{copy.junctionHelp}</p><div className="grid grid-cols-2 gap-2">{(['x', 'y'] as const).map(axis => <label key={axis} className="text-xs text-text-muted">{copy[axis]}<input type="number" aria-label={copy[axis]} className={`${fieldClass} mt-1`} value={selectedJunction.position[axis]} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && Math.abs(value) <= 1e7) change({ ...tree, junctions: tree.junctions?.map(point => point.id === selectedJunction.id ? { ...point, position: { ...point.position, [axis]: value } } : point) }); }} /></label>)}</div><button type="button" className={`${buttonClass} text-danger`} onClick={() => setConfirm('junction')}><Trash2 size={14} />{copy.removeJunction}</button></div> : selectedAnnotation ? <TreeAnnotationInspector annotation={selectedAnnotation} copy={copy} onChange={next => change({ ...tree, annotations: tree.annotations?.map(item => item.id === next.id ? next : item) })} onRemove={() => setConfirm('annotation')} /> : selectedNode ? <div className="border-t border-border pt-3 space-y-2" data-testid="relation-tree-node-inspector">
          <h3 className="text-sm font-semibold text-text-primary">{copy.node}</h3>
          <label className="block text-xs text-text-muted">{copy.nodeName}<input aria-label={`${copy.nodeName} · ${copy.selection}`} className={`${fieldClass} mt-1`} value={selectedNode.label} onChange={event => patchNode({ label: event.target.value })} /></label>
          <label className="block text-xs text-text-muted">{copy.person}<select aria-label={`${copy.person} · ${copy.selection}`} className={`${fieldClass} mt-1`} value={selectedNode.codexEntryId ?? ''} onChange={event => { const entry = byEntry.get(event.target.value); patchNode({ codexEntryId: entry?.id, label: entry?.title ?? selectedNode.label }); }}><option value="">{copy.freeNode}</option>{selectedNode.codexEntryId && !byEntry.has(selectedNode.codexEntryId) && <option value={selectedNode.codexEntryId}>{copy.missing}</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="tree-node-image" aria-label={locale === 'es' ? 'Imagen local del nodo' : 'Local node image'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadImage(file, selectedNode.id); }} /><button type="button" className={buttonClass} onClick={() => imageInput.current?.click()}>{locale === 'es' ? 'Elegir imagen local' : 'Choose local image'}</button>{selectedNode.image && <button type="button" className={buttonClass} onClick={() => { imageRequest.current++; patchNode({ image: undefined }); }}>{locale === 'es' ? 'Quitar imagen propia' : 'Remove own image'}</button>}</div>
          <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={!!selectedNode.deceased} onChange={event => patchNode({ deceased: event.target.checked })} />{copy.deceased}</label>
          <div className="grid grid-cols-2 gap-2">{(['x', 'y'] as const).map(axis => <label key={axis} className="text-xs text-text-muted">{copy[axis]}<input type="number" aria-label={copy[axis]} className={`${fieldClass} mt-1`} value={selectedNode.position[axis]} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchNode({ position: { ...selectedNode.position, [axis]: value } }); }} /></label>)}</div>
          {selectedNode.codexEntryId && byEntry.has(selectedNode.codexEntryId) && <button type="button" className={buttonClass} onClick={() => navigateTo(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(selectedNode.codexEntryId!)}`)}>{copy.openEntry}</button>}
          <button type="button" className={`${buttonClass} text-danger`} onClick={() => setConfirm('node')}><Trash2 size={14} />{copy.removeNode}</button>
        </div> : selectedEdge ? <div className="border-t border-border pt-3 space-y-2" data-testid="relation-tree-edge-inspector">
          <h3 className="text-sm font-semibold text-text-primary">{copy.edge}</h3>
          <label className="block text-xs text-text-muted">{copy.from}<select aria-label={`${copy.from} · ${copy.selection}`} className={`${fieldClass} mt-1`} value={selectedEdge.source} onChange={event => patchEdge({ source: event.target.value })}>{endpoints.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.to}<select aria-label={`${copy.to} · ${copy.selection}`} className={`${fieldClass} mt-1`} value={selectedEdge.target} onChange={event => patchEdge({ target: event.target.value })}>{endpoints.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.kind}<select aria-label={`${copy.kind} · ${copy.selection}`} className={`${fieldClass} mt-1`} value={selectedEdge.kind} onChange={event => patchEdge({ kind: event.target.value as RelationTreeEdge['kind'] })}>{TREE_KINDS.map(kind => <option key={kind} value={kind}>{copy[kind]}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.label}<input aria-label={copy.label} className={`${fieldClass} mt-1`} value={selectedEdge.label ?? ''} onChange={event => patchEdge({ label: event.target.value })} /></label>
          <label className="block text-xs text-text-muted">{copy.style}<select aria-label={copy.style} className={`${fieldClass} mt-1`} value={selectedEdge.style} onChange={event => patchEdge({ style: event.target.value as RelationTreeEdge['style'] })}>{(['solid', 'dashed', 'dotted'] as const).map(style => <option key={style} value={style}>{copy[style]}</option>)}</select></label>
          <label className="block text-xs text-text-muted">{copy.icon}<span className="mt-1 flex items-center gap-2">{selectedEdge.icon && <ProjectIcon name={selectedEdge.icon} size={20} className="text-accent-gold shrink-0" />}<select aria-label={copy.icon} className={fieldClass} value={selectedEdge.icon ?? ''} onChange={event => patchEdge({ icon: event.target.value || undefined })}><option value="">{copy.noIcon}</option>{RELATION_ICON_NAMES.map(name => <option key={name} value={name}>{name}</option>)}</select></span></label>
          <div className="grid grid-cols-2 gap-2">{(['sourceHandle', 'targetHandle'] as const).map((handle, index) => <label key={handle} className="block text-xs text-text-muted">{index ? copy.anchorTo : copy.anchorFrom}<select aria-label={index ? copy.anchorTo : copy.anchorFrom} className={`${fieldClass} mt-1`} value={selectedEdge[handle] ?? (index ? 'top' : 'bottom')} onChange={event => patchEdge({ [handle]: event.target.value })}>{(['top', 'bottom', 'left', 'right'] as const).map(side => <option key={side} value={side}>{copy[side]}</option>)}</select></label>)}</div>
          <button type="button" className={buttonClass} onClick={() => { const id = generateId('tree-junction'); try { change(insertTreeJunction(tree, selectedEdge.id, id, selected?.segmentIndex), true); setSelected({ kind: 'junction', id }); } catch (error) { setNotice(explain(error)); } }}><Plus size={14} />{copy.insertJunction}</button>
          <button type="button" className={`${buttonClass} text-danger`} onClick={() => setConfirm('edge')}><Trash2 size={14} />{copy.removeEdge}</button>
        </div> : <p className="border-t border-border pt-3 text-xs text-text-muted">{copy.select}</p>}
      </aside>
    </div>
    <ConfirmDialog open={confirm !== null} destructive title={confirm === 'reload' ? copy.reload : confirm === 'junction' ? copy.removeJunction : confirm === 'annotation' ? copy.removeAnnotation : confirm === 'node' ? copy.removeNode : copy.removeEdge} message={confirm === 'reload' ? copy.reloadConfirm : confirm === 'junction' ? copy.removeJunctionConfirm : confirm === 'annotation' ? copy.removeAnnotationConfirm : confirm === 'node' ? copy.removeNodeConfirm : copy.removeEdgeConfirm} onCancel={() => setConfirm(null)} onConfirm={() => {
      if (confirm === 'reload') { drafts.delete(tree.id); setSession({ tree: structuredClone(current), baseRevision: current.revision, dirty: false }); setConflict(false); setRecovered(false); }
      else if (confirm === 'node' && selectedNode) { change({ ...tree, nodes: tree.nodes.filter(node => node.id !== selectedNode.id), edges: tree.edges.filter(edge => edge.source !== selectedNode.id && edge.target !== selectedNode.id) }); setSelected(null); }
      else if (confirm === 'edge' && selectedEdge) { change({ ...tree, edges: tree.edges.filter(edge => edge.id !== selectedEdge.id) }); setSelected(null); }
      else if (confirm === 'annotation' && selectedAnnotation) { change({ ...tree, annotations: tree.annotations?.filter(item => item.id !== selectedAnnotation.id) }); setSelected(null); }
      else if (confirm === 'junction' && selectedJunction) { change(removeTreeJunction(tree, selectedJunction.id), true); setSelected(null); }
      setConfirm(null);
    }} />
  </div>;
}

export default function RelationTreesWorkspace({ projectId, canonical }: { projectId: string; canonical: ReactNode }) {
  const scope = useWorldEraScope(projectId);
  const saveRelationTree = bindEraOperation(saveRelationTreeScoped, scope.eraId, 3);
  const deleteRelationTree = bindEraOperation(deleteRelationTreeScoped, scope.eraId, 3);

  const { locale } = useTranslation();
  const copy = relationTreeCopy(locale);
  const project = useEraProject(projectId); const { refresh } = useProject(projectId);
  const { items: entries } = useCodexEntries(projectId);
  const [activeId, setActiveId] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RelationTreeDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState<TreePreset>('blank');
  const trees = project?.relationTrees ?? [];
  const treeLink=useDeepLinkParam('tree'), entityLink=useDeepLinkParam('entity'), deepLink=treeLink??entityLink;const [appliedLink,setAppliedLink]=useState<string|null>(null);
  if(deepLink&&deepLink!==appliedLink&&trees.some(tree=>tree.id===deepLink)){setActiveId(deepLink);setAppliedLink(deepLink);}
  const active = trees.find(tree => tree.id === activeId) ?? draftsFor(projectId, scope.eraId).get(activeId)?.tree;
  const create = async (source?: RelationTreeDocument | 'canonical') => {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const id = generateId('relation-tree'), now = Date.now();
      const tree: RelationTreeDocument = source === 'canonical'
        ? copyCanonicalTree(id, `${copy.defaultName} ${trees.length + 1}`, entries.filter(entry => entry.type === 'character'), (await db.genealogyLinks.where('projectId').equals(projectId).toArray()).map(rowToLink), now)
        : source ? duplicateRelationTree(source, id, `${source.title} · ${copy.variantSuffix}`, now)
          : createTreePreset(id, `${treePresetNames(locale)[preset]} ${trees.length + 1}`, preset, locale, now);
      await saveRelationTree(projectId, tree, null); await refresh(); setActiveId(id);
    } catch { setNotice(copy.failure); } finally { setBusy(false); }
  };
  return <div className="space-y-4" data-testid="relation-trees-workspace">
    <div className="flex flex-wrap gap-2 items-center">
      <label className="flex-1 min-w-[200px]"><span className="sr-only">{copy.document}</span><select aria-label={copy.document} className={fieldClass} value={active?.id ?? ''} onChange={event => setActiveId(event.target.value)}><option value="">{copy.canonical}</option>{active && !trees.some(tree => tree.id === active.id) && <option value={active.id}>{active.title} · {copy.dirty}</option>}{trees.map(tree => <option key={tree.id} value={tree.id}>{tree.title}</option>)}</select></label>
      <label className="min-w-36"><span className="sr-only">{locale === 'es' ? 'Modelo de árbol' : 'Tree preset'}</span><select aria-label={locale === 'es' ? 'Modelo de árbol' : 'Tree preset'} className={fieldClass} value={preset} disabled={busy} onChange={event => setPreset(event.target.value as TreePreset)}>{TREE_PRESETS.map(id => <option key={id} value={id}>{treePresetNames(locale)[id]}</option>)}</select></label>
      <button type="button" className={buttonClass} disabled={busy || !project} onClick={() => void create()}><Plus size={15} />{copy.create}</button>
      <button type="button" className={buttonClass} disabled={busy || !project} onClick={() => void create('canonical')}><Copy size={15} />{copy.copyCanonical}</button>
    </div>
    <p className="text-xs text-text-muted">{copy.independent}</p>
    {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
    {active ? <TreeEditor key={active.id} projectId={projectId} current={active} entries={entries} onSaved={() => void refresh()} onVariant={tree => void create(tree)} onDelete={() => setPendingDelete(active)} /> : canonical}
    <ConfirmDialog open={!!pendingDelete} destructive title={copy.removeTree} message={copy.removeTreeConfirm} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
      if (!pendingDelete) return;
      try { await deleteRelationTree(projectId, pendingDelete.id, pendingDelete.revision); draftsFor(projectId, scope.eraId).delete(pendingDelete.id); setPendingDelete(null); setActiveId(''); await refresh(); }
      catch (error) { setNotice(error instanceof RelationTreeConflict ? copy.conflict : copy.failure); setPendingDelete(null); }
    }} />
  </div>;
}
