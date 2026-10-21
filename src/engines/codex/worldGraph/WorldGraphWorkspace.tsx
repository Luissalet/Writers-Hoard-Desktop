import { useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Download, ExternalLink, GitBranch, Network, Pin, Search } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import { codexTypeColors, codexTypeIcons } from '@/components/codex/codexTypeMeta';
import type { CodexEntryType } from '@/types';
import { filterWorldGraph, layoutWorldGraph } from './model';
import type { CodexGraphLayout, WorldGraph, WorldGraphEdgeKind, WorldGraphFilters, WorldGraphNode } from './types';
import { graphText, worldGraphCopy } from './copy';
import { exportWorldGraphSvg, WORLD_GRAPH_COLORS } from './svg';
import {hierarchyOrder,templatePath} from '../templateHierarchy';
import type {CodexTemplate} from '../templateTypes';

const field = 'min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus:border-accent-gold outline-none';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const KINDS: WorldGraphEdgeKind[] = ['mention', 'codex', 'reference', 'relationship'];
const TYPES: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
const defaultFilters = (): WorldGraphFilters => ({ query: '', type: 'all', tag: '', kinds: [...KINDS], focusId: '', depth: 1, showIsolated: true, nodeLimit: 150, edgeLimit: 500 });
type CardData = WorldGraphNode & { typeLabel: string; avatar?: string; pinned: boolean; pinnedLabel: string } & Record<string, unknown>;
type CardNode = Node<CardData, 'worldCard'>;

function WorldCardNode({ data, selected }: NodeProps<CardNode>) {
  const Icon = codexTypeIcons[data.type] ?? Network;
  return <div className={`w-[220px] min-h-[74px] rounded-lg border bg-surface p-3 shadow-sm ${selected ? 'border-accent-gold ring-1 ring-accent-gold' : 'border-border'}`} data-testid={`world-graph-node-${data.id}`}>
    <Handle type="source" position={Position.Right} id="out-right" className="!opacity-0 !pointer-events-none" /><Handle type="target" position={Position.Left} id="in-left" className="!opacity-0 !pointer-events-none" />
    <Handle type="source" position={Position.Left} id="out-left" className="!opacity-0 !pointer-events-none" /><Handle type="target" position={Position.Right} id="in-right" className="!opacity-0 !pointer-events-none" />
    <div className="flex items-start gap-2.5">{data.avatar ? <img src={data.avatar} alt="" className="h-10 w-10 rounded object-cover shrink-0" /> : <Icon size={22} style={{ color: codexTypeColors[data.type] }} className="mt-1 shrink-0" />}<div className="min-w-0 flex-1"><p className="text-sm font-semibold text-text-primary truncate" title={data.title}>{data.title}</p><p className="mt-1 text-xs text-text-muted">{data.typeLabel}</p></div>{data.pinned && <Pin size={12} className="text-text-muted shrink-0" aria-label={data.pinnedLabel} />}</div>
  </div>;
}
const nodeTypes = { worldCard: WorldCardNode };

interface Props {
  graph: WorldGraph;
  initialLayout?: CodexGraphLayout;
  avatars?: Record<string, string>;
  onOpenEntry: (id: string) => void;
  onSaveLayout: (positions: CodexGraphLayout['positions']) => Promise<void>;
  indexing?: boolean;
  templates?: CodexTemplate[];
}

export default function WorldGraphWorkspace({ graph, initialLayout, avatars, onOpenEntry, onSaveLayout, indexing = false,templates=[] }: Props) {
  const { t, locale } = useTranslation(); const copy = worldGraphCopy[locale];
  const [filters, setFilters] = useState(defaultFilters);
  const [manual, setManual] = useState<CodexGraphLayout['positions']>(() => ({ ...initialLayout?.positions }));
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false), [layoutFailed, setLayoutFailed] = useState(false), [layoutEpoch, setLayoutEpoch] = useState(0);
  const writeGeneration = useRef(0);
  const view = useMemo(() => filterWorldGraph(graph, filters,templates), [graph, filters,templates]);
  const activeTypes=filters.types??(filters.type==='all'?TYPES:[filters.type]);
  const positions = useMemo(() => layoutWorldGraph(view.nodes, view.edges, { positions: manual }), [view, manual]);
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const selectedNode = selected?.kind === 'node' ? byId.get(selected.id) : undefined;
  const selectedEdge = selected?.kind === 'edge' ? graph.edges.find(edge => edge.id === selected.id) : undefined;
  const tags = [...new Set(graph.nodes.flatMap(node => node.tags))].sort((a, b) => a.localeCompare(b));
  const nodes: CardNode[] = view.nodes.map(node => ({ id: node.id, type: 'worldCard', position: positions[node.id], width: 220, height: 74, selected: selectedNode?.id === node.id, data: { ...node, avatar: avatars?.[node.id], typeLabel: t(`codex.types.${node.type}`), pinned: !!manual[node.id], pinnedLabel: copy.pinned } }));
  const pairCounts = new Map<string, number>();
  const edges: Edge[] = view.edges.map(edge => {
    const pair = [edge.source, edge.target].sort().join('|'), offset = pairCounts.get(pair) ?? 0; pairCounts.set(pair, offset + 1);
    const forward = (positions[edge.source]?.x ?? 0) <= (positions[edge.target]?.x ?? 0), color = WORLD_GRAPH_COLORS[edge.kind];
    const related = !selected || selectedEdge?.id === edge.id || selectedNode?.id === edge.source || selectedNode?.id === edge.target;
    return { id: edge.id, source: edge.source, target: edge.target, type: 'default', sourceHandle: forward ? 'out-right' : 'out-left', targetHandle: forward ? 'in-left' : 'in-right', pathOptions: { curvature: .2 + offset * .18 }, label: selected && related ? edge.label || `${copy[`${edge.kind}Short`]}${edge.kind === 'mention' ? ` · ${edge.count}` : ''}` : undefined, markerEnd: edge.directional ? { type: MarkerType.ArrowClosed, color } : undefined, style: { stroke: color, strokeWidth: selectedEdge?.id === edge.id ? 3 : 1.7, strokeDasharray: edge.kind === 'mention' ? '6 5' : undefined, opacity: related ? 1 : .3 }, labelStyle: { fill: color, fontSize: 10 }, labelBgStyle: { fill: 'var(--color-surface)' }, labelBgPadding: [5, 3], labelBgBorderRadius: 4, interactionWidth: 20 };
  });
  const patchFilters = (changes: Partial<WorldGraphFilters>) => { setFilters(previous => ({ ...previous, ...changes })); setSelected(null); };
  const persist = async (next: CodexGraphLayout['positions']) => {
    const generation = ++writeGeneration.current; setLayoutBusy(true); setLayoutFailed(false);
    try { await onSaveLayout(next); }
    catch { if (writeGeneration.current === generation) setLayoutFailed(true); }
    finally { if (writeGeneration.current === generation) setLayoutBusy(false); }
  };
  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    const updates = changes.filter(change => change.type === 'position' && change.position);
    if (!updates.length) return;
    setManual(previous => { const next = { ...previous }; for (const change of updates) if (change.type === 'position' && change.position) next[change.id] = change.position; return next; });
  };
  const labels = Object.fromEntries(KINDS.map(kind => [kind, copy[kind]])) as Record<WorldGraphEdgeKind, string>;
  const typeLabels = Object.fromEntries(TYPES.map(type => [type, t(`codex.types.${type}`)]));
  const open = (id: string) => { if (byId.has(id)) onOpenEntry(id); };
  const focus = (id: string) => { patchFilters({ focusId: id, query: '', type: 'all',types:undefined,templateId:'', tag: '' }); setSelected({ kind: 'node', id }); };
  const selectedConnections = selectedNode ? graph.edges.filter(edge => filters.kinds.includes(edge.kind) && (edge.source === selectedNode.id || edge.target === selectedNode.id)) : [];
  return <div className="space-y-4" data-testid="world-graph-workspace">
    <div className="flex items-start justify-between flex-wrap gap-3"><div><h3 className="flex items-center gap-2 font-serif text-lg text-accent-gold"><Network size={18} />{copy.title}</h3><p className="mt-1 text-sm text-text-muted">{graphText(copy.total, { nodes: graph.nodes.length, edges: graph.edges.length })}</p></div><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={layoutBusy} onClick={() => { setManual({}); setLayoutEpoch(value => value + 1); void persist({}); }} data-testid="world-graph-auto-layout"><GitBranch size={14} />{copy.reset}</button><button type="button" className={button} disabled={!view.nodes.length} onClick={() => saveAs(new Blob([exportWorldGraphSvg(view.nodes, view.edges, positions, labels, typeLabels)], { type: 'image/svg+xml;charset=utf-8' }), 'world-graph.svg')}><Download size={14} />{copy.export}</button></div></div>
    <p className="text-xs text-text-muted max-w-4xl">{copy.explanation}</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="relative min-w-52 flex-1"><Search size={15} className="absolute left-3 top-3 text-text-muted" /><input className={`${field} w-full pl-9`} value={filters.query} onChange={event => patchFilters({ query: event.target.value })} placeholder={copy.query} aria-label={copy.query} data-testid="world-graph-search" /></label>
      <label className="space-y-1 text-xs text-text-muted">{copy.type}<select value={filters.type} onChange={event => patchFilters({ type: event.target.value as WorldGraphFilters['type'],types:undefined })} className={`${field} block`} data-testid="world-graph-type"><option value="all">{copy.all}</option>{TYPES.map(type => <option key={type} value={type}>{t(`codex.types.${type}`)}</option>)}</select></label>
      {!!templates.length&&<label className="space-y-1 min-w-0 text-xs text-text-muted">{copy.template}<select aria-label={copy.template} value={filters.templateId??''} onChange={event=>patchFilters({templateId:event.target.value})} className={`${field} block max-w-64`}><option value="">{copy.all}</option>{filters.templateId&&!templates.some(item=>item.id===filters.templateId)&&<option value={filters.templateId}>{copy.unavailable}</option>}{hierarchyOrder(templates).map(item=><option key={item.id} value={item.id}>{templatePath(item,templates)}</option>)}</select></label>}
      {filters.templateId&&<label className="inline-flex min-h-10 items-center gap-2 text-xs text-text-muted"><input className="accent-accent-gold" type="checkbox" checked={filters.includeDescendants!==false} onChange={event=>patchFilters({includeDescendants:event.target.checked})}/>{copy.descendants}</label>}
      {!!tags.length && <label className="space-y-1 text-xs text-text-muted">{copy.tag}<select value={filters.tag} onChange={event => patchFilters({ tag: event.target.value })} className={`${field} block`}><option value="">{copy.all}</option>{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>}
      <label className="space-y-1 text-xs text-text-muted">{copy.focus}<select value={filters.focusId} onChange={event => patchFilters({ focusId: event.target.value })} className={`${field} block max-w-64`} data-testid="world-graph-focus"><option value="">{copy.whole}</option>{[...graph.nodes].sort((a, b) => a.title.localeCompare(b.title)).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
      {filters.focusId && <label className="space-y-1 text-xs text-text-muted">{copy.depth}<select value={filters.depth} onChange={event => patchFilters({ depth: Number(event.target.value) as 1 | 2 })} className={`${field} block`}><option value="1">{copy.one}</option><option value="2">{copy.two}</option></select></label>}
    </div>
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted"><legend className="mb-2">{copy.categories}</legend>{TYPES.map(type=><label key={type} className="inline-flex min-h-8 items-center gap-1.5"><input className="accent-accent-gold" type="checkbox" data-testid={`world-graph-category-${type}`} checked={activeTypes.includes(type)} onChange={()=>patchFilters({type:'all',types:activeTypes.includes(type)?activeTypes.filter(item=>item!==type):[...activeTypes,type]})}/>{t(`codex.types.${type}`)} ({graph.nodes.filter(node=>node.type===type).length})</label>)}<button className={`${button} py-1`} onClick={()=>patchFilters({type:'all',types:undefined})}>{copy.all}</button><button className={`${button} py-1`} onClick={()=>patchFilters({type:'all',types:[]})}>{copy.clearTypes}</button></fieldset>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted" role="group" aria-label={copy.title}>{KINDS.map(kind => <label key={kind} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={filters.kinds.includes(kind)} onChange={() => patchFilters({ kinds: filters.kinds.includes(kind) ? filters.kinds.filter(item => item !== kind) : [...filters.kinds, kind] })} className="accent-accent-gold" data-testid={`world-graph-kind-${kind}`} /><span className="w-5 border-t-2" style={{ borderColor: WORLD_GRAPH_COLORS[kind], borderTopStyle: kind === 'mention' ? 'dashed' : 'solid' }} />{copy[kind]}</label>)}<label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={filters.showIsolated} onChange={() => patchFilters({ showIsolated: !filters.showIsolated })} className="accent-accent-gold" />{copy.isolated}</label></div>
    <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted"><span className="flex-1" role="status" data-testid="world-graph-counts">{graphText(copy.visible, { nodes: view.nodes.length, matchingNodes: view.matchingNodes, edges: view.edges.length, matchingEdges: view.matchingEdges })}</span><label>{copy.nodeLimit} <select className={`${field} py-1 text-xs`} value={filters.nodeLimit} onChange={event => patchFilters({ nodeLimit: Number(event.target.value) })} data-testid="world-graph-node-limit">{[150, 300, 600, 1000].map(limit => <option key={limit} value={limit}>{limit}</option>)}<option value={Number.MAX_SAFE_INTEGER}>{graphText(copy.allCount, { count: graph.nodes.length })}</option></select></label><label>{copy.edgeLimit} <select className={`${field} py-1 text-xs`} value={filters.edgeLimit} onChange={event => patchFilters({ edgeLimit: Number(event.target.value) })}>{[500, 1500, 5000].map(limit => <option key={limit} value={limit}>{limit}</option>)}<option value={Number.MAX_SAFE_INTEGER}>{graphText(copy.allCount, { count: graph.edges.length })}</option></select></label></div>
    {(view.omittedNodes > 0 || view.omittedEdges > 0) && <p className="text-xs text-accent-gold">{copy.limits}</p>}
    {indexing && <p className="text-xs text-text-muted" role="status">{copy.indexing}</p>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-w-0 h-[600px] rounded-xl border border-border bg-deep overflow-hidden" data-testid="world-graph-canvas">
        <ReactFlow key={`${layoutEpoch}:${filters.focusId}:${filters.query}:${filters.type}:${filters.types?.join()}:${filters.templateId}:${filters.includeDescendants}:${filters.tag}:${filters.nodeLimit}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={(_event, node) => { const next = { ...manual, [node.id]: node.position }; setManual(next); void persist(next); }} onNodeClick={(_event, node) => setSelected({ kind: 'node', id: node.id })} onNodeDoubleClick={(_event, node) => open(node.id)} onEdgeClick={(_event, edge) => setSelected({ kind: 'edge', id: edge.id })} onPaneClick={() => setSelected(null)} fitView minZoom={.03} maxZoom={3} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': copy.zoomIn, 'controls.zoomOut.ariaLabel': copy.zoomOut, 'controls.fitView.ariaLabel': copy.fit }}>
          <Background color="var(--color-border)" gap={28} /><Controls showInteractive={false} className="[&>button]:!bg-elevated [&>button]:!text-text-primary [&>button]:!border-border" />
          {!view.nodes.length && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted"><p>{copy.empty}</p><button type="button" className={button} onClick={() => setFilters(defaultFilters())}>{copy.clear}</button></div>}
        </ReactFlow>
      </div>
      <aside className="rounded-xl border border-border bg-surface p-4 min-w-0 max-h-[600px] overflow-y-auto" data-testid="world-graph-inspector">
        {!selectedNode && !selectedEdge && <p className="text-sm text-text-muted">{copy.select}</p>}
        {selectedNode && <div className="space-y-4"><div><p className="text-xs text-text-muted">{t(`codex.types.${selectedNode.type}`)}</p><h4 className="mt-1 font-serif text-lg text-accent-gold break-words">{selectedNode.title}</h4></div>{selectedNode.summary && <p className="text-sm text-text-muted">{selectedNode.summary}</p>}{!!selectedNode.aliases.length && <p className="text-xs text-text-muted"><strong>{copy.aliases}: </strong>{selectedNode.aliases.join(' · ')}</p>}{!!selectedNode.tags.length && <p className="text-xs text-text-muted"><strong>{copy.tags}: </strong>{selectedNode.tags.join(' · ')}</p>}<div className="flex flex-wrap gap-2"><button type="button" className={`${button} text-accent-gold`} onClick={() => open(selectedNode.id)} data-testid="world-graph-open-card"><ExternalLink size={14} />{copy.open}</button><button type="button" className={button} onClick={() => focus(selectedNode.id)}>{copy.focusNode}</button></div><div className="border-t border-border pt-3"><h5 className="text-xs font-semibold text-text-muted">{copy.neighbors} ({selectedConnections.length})</h5><div className="mt-2 space-y-2">{!selectedConnections.length && <p className="text-xs text-text-muted">{copy.noConnections}</p>}{selectedConnections.map(edge => <button key={edge.id} type="button" className="w-full rounded border border-border p-2 text-left hover:bg-elevated" onClick={() => setSelected({ kind: 'edge', id: edge.id })} data-testid={`world-graph-connection-${edge.id}`}><span className="block text-xs" style={{ color: WORLD_GRAPH_COLORS[edge.kind] }}>{copy[edge.kind]}{edge.label ? ` · ${edge.label}` : ''}</span><span className="mt-1 block text-sm text-text-primary">{byId.get(edge.source === selectedNode.id ? edge.target : edge.source)?.title}</span></button>)}</div></div></div>}
        {selectedEdge && <div className="space-y-4"><p className="text-xs" style={{ color: WORLD_GRAPH_COLORS[selectedEdge.kind] }}>{copy[selectedEdge.kind]} · {selectedEdge.kind === 'mention' ? copy.inferred : copy.explicit}</p>{selectedEdge.label && <h4 className="font-serif text-lg text-accent-gold">{selectedEdge.label}</h4>}{([['source', selectedEdge.source], ['target', selectedEdge.target]] as const).map(([label, id]) => <div key={label}><p className="text-xs text-text-muted">{copy[label]}</p><button type="button" className="mt-1 text-sm text-text-primary hover:text-accent-gold underline decoration-border" onClick={() => open(id)}>{byId.get(id)?.title} <ExternalLink size={12} className="inline" /></button></div>)}{selectedEdge.description && <p className="whitespace-pre-wrap text-sm text-text-muted">{selectedEdge.description}</p>}{selectedEdge.kind === 'mention' && <><h5 className="text-xs text-text-muted">{copy.evidence} · {graphText(copy.occurrences, { count: selectedEdge.count })}</h5>{selectedEdge.ambiguousCount > 0 && <p className="text-xs text-warning">{copy.ambiguous}</p>}{selectedEdge.evidence.map((evidence, index) => <blockquote key={index} className="border-l-2 border-border pl-3 text-xs text-text-muted"><p className="mb-1 text-text-primary">{evidence.field ? `${copy.unknownField}: ${t(`codex.field.${evidence.field}`) === `codex.field.${evidence.field}` ? evidence.field : t(`codex.field.${evidence.field}`)}` : copy.body} · “{evidence.matchedAlias}”</p><p>{evidence.excerpt}</p></blockquote>)}</>}</div>}
      </aside>
    </div>
    {graph.stats.ambiguousMatches > 0 && <p className="text-xs text-text-muted">{graphText(copy.ambiguousCount, { count: graph.stats.ambiguousMatches })}</p>}
    {graph.stats.unresolvedReferences > 0 && <p className="text-xs text-text-muted">{graphText(copy.unresolved, { count: graph.stats.unresolvedReferences })}</p>}
    {(layoutBusy || layoutFailed || Object.keys(manual).length > 0) && <p className={`text-xs ${layoutFailed ? 'text-danger' : 'text-text-muted'}`} role={layoutFailed ? 'alert' : 'status'}>{layoutFailed ? copy.layoutFailed : layoutBusy ? copy.layoutSaving : copy.layoutSaved}{layoutFailed && <button type="button" className="ml-2 underline" onClick={() => void persist(manual)}>{copy.retry}</button>}</p>}
  </div>;
}
