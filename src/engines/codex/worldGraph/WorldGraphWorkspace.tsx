import { useMemo, useRef, useState } from 'react';
import { Background, ControlButton, Controls, Handle, MarkerType, Position, ReactFlow, ViewportPortal, getViewportForBounds, useReactFlow, useStore, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Download, Eye, EyeOff, ExternalLink, GitBranch, Maximize, Network, Pin, Save, Search, Settings2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useTranslation } from '@/i18n/useTranslation';
import { codexTypeColors, codexTypeIcons } from '@/components/codex/codexTypeMeta';
import type { CodexEntryType } from '@/types';
import { filterWorldGraph, layoutWorldGraph } from './model';
import { DEFAULT_GRAPH_DISPLAY, normalizeWorldGraphDisplay, WORLD_GRAPH_CARD_SIZE, type CodexGraphLayout, type WorldGraph, type WorldGraphDisplay, type WorldGraphEdgeKind, type WorldGraphFilters, type WorldGraphNode, type WorldGraphView } from './types';
import { worldGraphTypeAreas } from './areas';
import { graphText, worldGraphCopy } from './copy';
import { exportWorldGraphSvg, WORLD_GRAPH_COLORS } from './svg';
import {hierarchyOrder,templatePath} from '../templateHierarchy';
import type {CodexTemplate} from '../templateTypes';

const field = 'min-w-0 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus:border-accent-gold outline-none';
const button = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50';
const KINDS: WorldGraphEdgeKind[] = ['mention', 'codex', 'reference', 'relationship'];
const TYPES: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];
const defaultFilters = (): WorldGraphFilters => ({ query: '', type: 'all', tag: '', kinds: [...KINDS], focusId: '', depth: 1, showIsolated: true, nodeLimit: 150, edgeLimit: 500 });
type CardData = WorldGraphNode & { typeLabel: string; avatar?: string; pinned: boolean; pinnedLabel: string; showName: boolean; size: WorldGraphDisplay['nodeSize'] } & Record<string, unknown>;
type CardNode = Node<CardData, 'worldCard'>;

function WorldCardNode({ data, selected }: NodeProps<CardNode>) {
  const Icon = codexTypeIcons[data.type] ?? Network;
  return <div className={`min-h-[44px] rounded-lg border bg-surface p-3 shadow-sm ${selected ? 'border-accent-gold ring-1 ring-accent-gold' : 'border-border'} ${data.showName ? '' : 'group'}`} style={{ width: WORLD_GRAPH_CARD_SIZE[data.size].width }} title={data.title} data-testid={`world-graph-node-${data.id}`} data-name-shown={data.showName}>
    <Handle type="source" position={Position.Right} id="out-right" className="!opacity-0 !pointer-events-none" /><Handle type="target" position={Position.Left} id="in-left" className="!opacity-0 !pointer-events-none" />
    <Handle type="source" position={Position.Left} id="out-left" className="!opacity-0 !pointer-events-none" /><Handle type="target" position={Position.Right} id="in-right" className="!opacity-0 !pointer-events-none" />
    <div className="flex items-start gap-2.5">{data.avatar ? <img src={data.avatar} alt="" className="h-10 w-10 rounded object-cover shrink-0" /> : <Icon size={22} style={{ color: codexTypeColors[data.type] }} className="mt-1 shrink-0" />}<div className="min-w-0 flex-1"><p className={`text-sm font-semibold text-text-primary truncate ${data.showName || selected ? '' : 'invisible group-hover:visible'}`} title={data.title}>{data.title}</p>{data.size !== 'small' && <p className="mt-1 text-xs text-text-muted">{data.typeLabel}</p>}</div>{data.pinned && <Pin size={12} className="text-text-muted shrink-0" aria-label={data.pinnedLabel} />}</div>
  </div>;
}
const nodeTypes = { worldCard: WorldCardNode };

interface Props {
  graph: WorldGraph;
  initialLayout?: CodexGraphLayout;
  avatars?: Record<string, string>;
  onOpenEntry: (id: string) => void;
  onSaveLayout: (positions: CodexGraphLayout['positions']) => Promise<void>;
  onSaveSettings?: (patch: Partial<Omit<CodexGraphLayout, 'positions'>>) => Promise<void>;
  indexing?: boolean;
  templates?: CodexTemplate[];
}

export default function WorldGraphWorkspace({ graph, initialLayout, avatars, onOpenEntry, onSaveLayout, onSaveSettings, indexing = false,templates=[] }: Props) {
  const { t, locale } = useTranslation(); const copy = worldGraphCopy[locale];
  const [filters, setFilters] = useState(defaultFilters);
  const [manual, setManual] = useState<CodexGraphLayout['positions']>(() => ({ ...initialLayout?.positions }));
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false), [layoutFailed, setLayoutFailed] = useState(false), [layoutEpoch, setLayoutEpoch] = useState(0);
  const writeGeneration = useRef(0);
  const [display, setDisplay] = useState<WorldGraphDisplay>(() => ({ ...DEFAULT_GRAPH_DISPLAY, ...normalizeWorldGraphDisplay(initialLayout?.display) }));
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => initialLayout?.hiddenIds ?? []), [showHidden, setShowHidden] = useState(false);
  const [views, setViews] = useState<WorldGraphView[]>(() => initialLayout?.views ?? []), [viewName, setViewName] = useState(''), [settingsOpen, setSettingsOpen] = useState(false);
  const settingsGeneration = useRef(0);
  const [settingsBusy, setSettingsBusy] = useState(false), [failedSettings, setFailedSettings] = useState<Partial<Omit<CodexGraphLayout, 'positions'>> | null>(null);
  const saveSettings = (patch: Partial<Omit<CodexGraphLayout, 'positions'>>) => {
    if (patch.display) setDisplay({ ...DEFAULT_GRAPH_DISPLAY, ...normalizeWorldGraphDisplay(patch.display) }); if (patch.hiddenIds) setHiddenIds(patch.hiddenIds); if (patch.views) setViews(patch.views);
    const generation = ++settingsGeneration.current; setFailedSettings(null);
    if (!onSaveSettings) return;
    setSettingsBusy(true);
    void onSaveSettings(patch).catch(() => { if (settingsGeneration.current === generation) setFailedSettings(patch); }).finally(() => { if (settingsGeneration.current === generation) setSettingsBusy(false); });
  };
  const visibleGraph = useMemo(() => { if (showHidden || !hiddenIds.length) return graph; const hidden = new Set(hiddenIds); return { ...graph, nodes: graph.nodes.filter(node => !hidden.has(node.id)), edges: graph.edges.filter(edge => !hidden.has(edge.source) && !hidden.has(edge.target)) }; }, [graph, hiddenIds, showHidden]);
  const view = useMemo(() => filterWorldGraph(visibleGraph, filters,templates), [visibleGraph, filters,templates]);
  // "Main" names: the most connected fifth of the cards on screen (at least the top 5).
  const mainThreshold = useMemo(() => { const degrees = view.nodes.map(node => node.degree).sort((a, b) => b - a); return degrees[Math.max(0, Math.min(degrees.length - 1, Math.max(4, Math.floor(degrees.length / 5) - 1)))] ?? 0; }, [view.nodes]);
  const activeTypes=filters.types??(filters.type==='all'?TYPES:[filters.type]);
  const positions = useMemo(() => layoutWorldGraph(view.nodes, view.edges, { positions: manual, display }), [view, manual, display]);
  const areas = useMemo(() => display.typeAreas ? worldGraphTypeAreas(view.nodes, positions, display.nodeSize) : [], [display.typeAreas, display.nodeSize, view.nodes, positions]);
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const selectedNode = selected?.kind === 'node' ? byId.get(selected.id) : undefined;
  const selectedEdge = selected?.kind === 'edge' ? graph.edges.find(edge => edge.id === selected.id) : undefined;
  const tags = [...new Set(graph.nodes.flatMap(node => node.tags))].sort((a, b) => a.localeCompare(b));
  const nodes: CardNode[] = view.nodes.map(node => ({ id: node.id, type: 'worldCard', position: positions[node.id], ...WORLD_GRAPH_CARD_SIZE[display.nodeSize], selected: selectedNode?.id === node.id, data: { ...node, avatar: display.pictures ? avatars?.[node.id] : undefined, typeLabel: t(`codex.types.${node.type}`), pinned: !!manual[node.id], pinnedLabel: copy.pinned, showName: display.names === 'all' || (display.names === 'main' && node.degree >= mainThreshold && node.degree > 0), size: display.nodeSize } }));
  const pairCounts = new Map<string, number>();
  const edges: Edge[] = view.edges.map(edge => {
    const pair = [edge.source, edge.target].sort().join('|'), offset = pairCounts.get(pair) ?? 0; pairCounts.set(pair, offset + 1);
    const forward = (positions[edge.source]?.x ?? 0) <= (positions[edge.target]?.x ?? 0), color = WORLD_GRAPH_COLORS[edge.kind];
    const related = !selected || selectedEdge?.id === edge.id || selectedNode?.id === edge.source || selectedNode?.id === edge.target;
    return { id: edge.id, source: edge.source, target: edge.target, type: 'default', sourceHandle: forward ? 'out-right' : 'out-left', targetHandle: forward ? 'in-left' : 'in-right', pathOptions: { curvature: .2 + offset * .18 }, label: selected && related ? edge.label || `${copy[`${edge.kind}Short`]}${edge.kind === 'mention' ? ` · ${edge.count}` : ''}` : undefined, markerEnd: edge.directional ? { type: MarkerType.ArrowClosed, color } : undefined, style: { stroke: color, strokeWidth: selectedEdge?.id === edge.id ? 3 : 1.7, strokeDasharray: edge.kind === 'mention' ? '6 5' : undefined, opacity: (related ? 1 : .3) * display.linkOpacity }, labelStyle: { fill: color, fontSize: 10 }, labelBgStyle: { fill: 'var(--color-surface)' }, labelBgPadding: [5, 3], labelBgBorderRadius: 4, interactionWidth: 20 };
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
    <div className="flex items-start justify-between flex-wrap gap-3"><div><h3 className="flex items-center gap-2 font-serif text-lg text-accent-gold"><Network size={18} />{copy.title}</h3><p className="mt-1 text-sm text-text-muted">{graphText(copy.total, { nodes: graph.nodes.length, edges: graph.edges.length })}</p></div><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={layoutBusy} onClick={() => { setManual({}); setLayoutEpoch(value => value + 1); void persist({}); }} data-testid="world-graph-auto-layout"><GitBranch size={14} />{copy.reset}</button><button type="button" className={button} disabled={!view.nodes.length} onClick={() => saveAs(new Blob([exportWorldGraphSvg(view.nodes, view.edges, positions, labels, typeLabels, display)], { type: 'image/svg+xml;charset=utf-8' }), 'world-graph.svg')}><Download size={14} />{copy.export}</button></div></div>
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
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" data-testid="world-graph-views">
      <label className="inline-flex items-center gap-1">{locale === 'es' ? 'Grafos guardados' : 'Saved graphs'}<select className={`${field} py-1 text-xs`} data-testid="world-graph-view-select" value="" onChange={event => { const found = views.find(item => item.id === event.target.value); if (found) { setFilters({ ...defaultFilters(), ...found.filters }); setDisplay({ ...DEFAULT_GRAPH_DISPLAY, ...normalizeWorldGraphDisplay(found.display) }); setSelected(null); } }}><option value="">{views.length ? (locale === 'es' ? 'Abrir…' : 'Open…') : (locale === 'es' ? 'Ninguno aún' : 'None yet')}</option>{views.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <form className="inline-flex items-center gap-1" onSubmit={event => { event.preventDefault(); const name = viewName.trim(); if (!name) return; const existing = views.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()); const entry: WorldGraphView = { id: existing?.id ?? crypto.randomUUID(), name, filters: { ...filters }, display }; saveSettings({ views: existing ? views.map(item => item.id === existing.id ? entry : item) : [...views, entry] }); setViewName(''); }}><input className={`${field} py-1 text-xs`} placeholder={locale === 'es' ? 'Nombre del grafo' : 'Graph name'} aria-label={locale === 'es' ? 'Nombre del grafo' : 'Graph name'} data-testid="world-graph-view-name" value={viewName} onChange={event => setViewName(event.target.value)} /><button type="submit" className={`${button} py-1 text-xs`} data-testid="world-graph-view-save" disabled={!viewName.trim()}><Save size={12} />{locale === 'es' ? 'Guardar grafo' : 'Save graph'}</button></form>
      {views.length > 0 && <select className={`${field} py-1 text-xs`} aria-label={locale === 'es' ? 'Borrar un grafo guardado' : 'Delete a saved graph'} data-testid="world-graph-view-delete" value="" onChange={event => { if (event.target.value) saveSettings({ views: views.filter(item => item.id !== event.target.value) }); }}><option value="">{locale === 'es' ? 'Borrar…' : 'Delete…'}</option>{views.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <button type="button" className={`${button} ml-auto py-1 text-xs`} aria-expanded={settingsOpen} data-testid="world-graph-settings" onClick={() => setSettingsOpen(value => !value)}><Settings2 size={12} />{locale === 'es' ? 'Ajustes de vista' : 'Display settings'}</button>
      {hiddenIds.length > 0 && <button type="button" className={`${button} py-1 text-xs`} data-testid="world-graph-show-hidden" aria-pressed={showHidden} onClick={() => setShowHidden(value => !value)}>{showHidden ? <EyeOff size={12} /> : <Eye size={12} />}{locale === 'es' ? `${hiddenIds.length} oculta${hiddenIds.length === 1 ? '' : 's'} · ${showHidden ? 'ocultar' : 'mostrar'}` : `${hiddenIds.length} hidden · ${showHidden ? 'hide' : 'show'}`}</button>}
    </div>
    {settingsOpen && <fieldset className="flex flex-wrap items-end gap-4 rounded-xl border border-border p-3 text-xs text-text-muted" data-testid="world-graph-settings-panel">
      <label className="space-y-1">{locale === 'es' ? 'Nombres' : 'Names'}<select className={`${field} block py-1 text-xs`} data-testid="world-graph-names" value={display.names} onChange={event => saveSettings({ display: { ...display, names: event.target.value as WorldGraphDisplay['names'] } })}><option value="all">{locale === 'es' ? 'Todos' : 'All'}</option><option value="main">{locale === 'es' ? 'Los principales' : 'Main ones'}</option><option value="hover">{locale === 'es' ? 'Al pasar el ratón' : 'On hover'}</option></select></label>
      <label className="space-y-1">{locale === 'es' ? 'Tamaño de las fichas' : 'Card size'}<select className={`${field} block py-1 text-xs`} data-testid="world-graph-size" value={display.nodeSize} onChange={event => saveSettings({ display: { ...display, nodeSize: event.target.value as WorldGraphDisplay['nodeSize'] } })}><option value="small">{locale === 'es' ? 'Pequeñas' : 'Small'}</option><option value="medium">{locale === 'es' ? 'Medianas' : 'Medium'}</option><option value="large">{locale === 'es' ? 'Grandes' : 'Large'}</option></select></label>
      <label className="space-y-1">{locale === 'es' ? 'Separación' : 'Spacing'} <span className="tabular-nums" data-testid="world-graph-spacing-value">{(display.spacing ?? 1).toFixed(1)}</span><input type="range" min={0.5} max={1.5} step={0.1} className="block accent-accent-gold" data-testid="world-graph-spacing" value={display.spacing ?? 1} onChange={event => saveSettings({ display: { ...display, spacing: Number(event.target.value) } })} /></label>
      <label className="space-y-1">{locale === 'es' ? 'Intensidad de los enlaces' : 'Link opacity'}<input type="range" min={0.1} max={1} step={0.1} className="block accent-accent-gold" data-testid="world-graph-opacity" value={display.linkOpacity} onChange={event => saveSettings({ display: { ...display, linkOpacity: Number(event.target.value) } })} /></label>
      <label className="inline-flex min-h-8 items-center gap-1.5"><input type="checkbox" className="accent-accent-gold" data-testid="world-graph-pictures" checked={display.pictures} onChange={event => saveSettings({ display: { ...display, pictures: event.target.checked } })} />{locale === 'es' ? 'Imágenes' : 'Pictures'}</label>
      <label className="inline-flex min-h-8 items-center gap-1.5"><input type="checkbox" className="accent-accent-gold" data-testid="world-graph-type-areas" checked={display.typeAreas ?? false} onChange={event => saveSettings({ display: { ...display, typeAreas: event.target.checked } })} />{locale === 'es' ? 'Áreas por tipo' : 'Type areas'}</label>
      <button type="button" className={`${button} py-1 text-xs`} data-testid="world-graph-settings-reset" onClick={() => saveSettings({ display: { ...DEFAULT_GRAPH_DISPLAY } })}>{locale === 'es' ? 'Restablecer' : 'Reset'}</button>
    </fieldset>}
    {settingsBusy && <p role="status" className="text-xs text-text-muted">{locale === 'es' ? 'Guardando ajustes…' : 'Saving settings…'}</p>}
    {failedSettings && <p role="alert" className="text-xs text-danger" data-testid="world-graph-settings-error">{locale === 'es' ? 'No se pudieron guardar los ajustes del grafo.' : 'Could not save graph settings.'}<button type="button" className="ml-2 underline" onClick={() => saveSettings(failedSettings)}>{copy.retry}</button></p>}
    <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted"><span className="flex-1" role="status" data-testid="world-graph-counts">{graphText(copy.visible, { nodes: view.nodes.length, matchingNodes: view.matchingNodes, edges: view.edges.length, matchingEdges: view.matchingEdges })}</span><label>{copy.nodeLimit} <select className={`${field} py-1 text-xs`} value={filters.nodeLimit} onChange={event => patchFilters({ nodeLimit: Number(event.target.value) })} data-testid="world-graph-node-limit">{[150, 300, 600, 1000].map(limit => <option key={limit} value={limit}>{limit}</option>)}<option value={Number.MAX_SAFE_INTEGER}>{graphText(copy.allCount, { count: graph.nodes.length })}</option></select></label><label>{copy.edgeLimit} <select className={`${field} py-1 text-xs`} value={filters.edgeLimit} onChange={event => patchFilters({ edgeLimit: Number(event.target.value) })}>{[500, 1500, 5000].map(limit => <option key={limit} value={limit}>{limit}</option>)}<option value={Number.MAX_SAFE_INTEGER}>{graphText(copy.allCount, { count: graph.edges.length })}</option></select></label></div>
    {(view.omittedNodes > 0 || view.omittedEdges > 0) && <p className="text-xs text-accent-gold">{copy.limits}</p>}
    {indexing && <p className="text-xs text-text-muted" role="status">{copy.indexing}</p>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-w-0 h-[600px] rounded-xl border border-border bg-deep overflow-hidden" data-testid="world-graph-canvas">
        <ReactFlow key={`${layoutEpoch}:${filters.focusId}:${filters.query}:${filters.type}:${filters.types?.join()}:${filters.templateId}:${filters.includeDescendants}:${filters.tag}:${filters.nodeLimit}:${display.nodeSize}:${hiddenIds.length}:${showHidden}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={(_event, node) => { const next = { ...manual, [node.id]: node.position }; setManual(next); void persist(next); }} onNodeClick={(_event, node) => setSelected({ kind: 'node', id: node.id })} onNodeDoubleClick={(_event, node) => open(node.id)} onEdgeClick={(_event, edge) => setSelected({ kind: 'edge', id: edge.id })} onPaneClick={() => setSelected(null)} fitView minZoom={.03} maxZoom={3} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} proOptions={{ hideAttribution: true }} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': copy.zoomIn, 'controls.zoomOut.ariaLabel': copy.zoomOut, 'controls.fitView.ariaLabel': copy.fit }}>
          <Background color="var(--color-border)" gap={28} /><GraphControls fitLabel={copy.fit} />
          {!!areas.length && <ViewportPortal><svg data-testid="world-graph-type-areas-layer" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: -1 }}>{areas.map(area => <g key={area.type} data-testid={`world-graph-type-area-${area.type}`}><polygon points={area.points.map(point => `${point.x},${point.y}`).join(' ')} fill={codexTypeColors[area.type]} fillOpacity={0.08} stroke={codexTypeColors[area.type]} strokeOpacity={0.5} strokeWidth={1.5} strokeLinejoin="round" /><text x={area.label.x} y={area.label.y} fill="var(--color-text-muted)" fontSize={12}>{t(`codex.types.${area.type}`)}</text></g>)}</svg></ViewportPortal>}
          {!view.nodes.length && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted"><p>{copy.empty}</p><button type="button" className={button} onClick={() => setFilters(defaultFilters())}>{copy.clear}</button></div>}
        </ReactFlow>
      </div>
      <aside className="rounded-xl border border-border bg-surface p-4 min-w-0 max-h-[600px] overflow-y-auto" data-testid="world-graph-inspector">
        {!selectedNode && !selectedEdge && <p className="text-sm text-text-muted">{copy.select}</p>}
        {selectedNode && <div className="space-y-4"><button type="button" className={`${button} w-full py-1 text-xs`} data-testid="world-graph-hide-node" onClick={() => { const hidden = hiddenIds.includes(selectedNode.id); saveSettings({ hiddenIds: hidden ? hiddenIds.filter(id => id !== selectedNode.id) : [...hiddenIds, selectedNode.id] }); setSelected(null); }}>{hiddenIds.includes(selectedNode.id) ? <Eye size={12} /> : <EyeOff size={12} />}{hiddenIds.includes(selectedNode.id) ? (locale === 'es' ? 'Volver a mostrar en el grafo' : 'Show in the graph again') : (locale === 'es' ? 'Ocultar del grafo' : 'Hide from the graph')}</button><div><p className="text-xs text-text-muted">{t(`codex.types.${selectedNode.type}`)}</p><h4 className="mt-1 font-serif text-lg text-accent-gold break-words">{selectedNode.title}</h4></div>{selectedNode.summary && <p className="text-sm text-text-muted">{selectedNode.summary}</p>}{!!selectedNode.aliases.length && <p className="text-xs text-text-muted"><strong>{copy.aliases}: </strong>{selectedNode.aliases.join(' · ')}</p>}{!!selectedNode.tags.length && <p className="text-xs text-text-muted"><strong>{copy.tags}: </strong>{selectedNode.tags.join(' · ')}</p>}<div className="flex flex-wrap gap-2"><button type="button" className={`${button} text-accent-gold`} onClick={() => open(selectedNode.id)} data-testid="world-graph-open-card"><ExternalLink size={14} />{copy.open}</button><button type="button" className={button} onClick={() => focus(selectedNode.id)}>{copy.focusNode}</button></div><div className="border-t border-border pt-3"><h5 className="text-xs font-semibold text-text-muted">{copy.neighbors} ({selectedConnections.length})</h5><div className="mt-2 space-y-2">{!selectedConnections.length && <p className="text-xs text-text-muted">{copy.noConnections}</p>}{selectedConnections.map(edge => <button key={edge.id} type="button" className="w-full rounded border border-border p-2 text-left hover:bg-elevated" onClick={() => setSelected({ kind: 'edge', id: edge.id })} data-testid={`world-graph-connection-${edge.id}`}><span className="block text-xs" style={{ color: WORLD_GRAPH_COLORS[edge.kind] }}>{copy[edge.kind]}{edge.label ? ` · ${edge.label}` : ''}</span><span className="mt-1 block text-sm text-text-primary">{byId.get(edge.source === selectedNode.id ? edge.target : edge.source)?.title}</span></button>)}</div></div></div>}
        {selectedEdge && <div className="space-y-4"><p className="text-xs" style={{ color: WORLD_GRAPH_COLORS[selectedEdge.kind] }}>{copy[selectedEdge.kind]} · {selectedEdge.kind === 'mention' ? copy.inferred : copy.explicit}</p>{selectedEdge.label && <h4 className="font-serif text-lg text-accent-gold">{selectedEdge.label}</h4>}{([['source', selectedEdge.source], ['target', selectedEdge.target]] as const).map(([label, id]) => <div key={label}><p className="text-xs text-text-muted">{copy[label]}</p><button type="button" className="mt-1 text-sm text-text-primary hover:text-accent-gold underline decoration-border" onClick={() => open(id)}>{byId.get(id)?.title} <ExternalLink size={12} className="inline" /></button></div>)}{selectedEdge.description && <p className="whitespace-pre-wrap text-sm text-text-muted">{selectedEdge.description}</p>}{selectedEdge.kind === 'mention' && <><h5 className="text-xs text-text-muted">{copy.evidence} · {graphText(copy.occurrences, { count: selectedEdge.count })}</h5>{selectedEdge.ambiguousCount > 0 && <p className="text-xs text-warning">{copy.ambiguous}</p>}{selectedEdge.evidence.map((evidence, index) => <blockquote key={index} className="border-l-2 border-border pl-3 text-xs text-text-muted"><p className="mb-1 text-text-primary">{evidence.field ? `${copy.unknownField}: ${t(`codex.field.${evidence.field}`) === `codex.field.${evidence.field}` ? evidence.field : t(`codex.field.${evidence.field}`)}` : copy.body} · “{evidence.matchedAlias}”</p><p>{evidence.excerpt}</p></blockquote>)}</>}</div>}
      </aside>
    </div>
    {graph.stats.ambiguousMatches > 0 && <p className="text-xs text-text-muted">{graphText(copy.ambiguousCount, { count: graph.stats.ambiguousMatches })}</p>}
    {graph.stats.unresolvedReferences > 0 && <p className="text-xs text-text-muted">{graphText(copy.unresolved, { count: graph.stats.unresolvedReferences })}</p>}
    {(layoutBusy || layoutFailed || Object.keys(manual).length > 0) && <p className={`text-xs ${layoutFailed ? 'text-danger' : 'text-text-muted'}`} role={layoutFailed ? 'alert' : 'status'}>{layoutFailed ? copy.layoutFailed : layoutBusy ? copy.layoutSaving : copy.layoutSaved}{layoutFailed && <button type="button" className="ml-2 underline" onClick={() => void persist(manual)}>{copy.retry}</button>}</p>}
  </div>;
}

/**
 * The graph's controls, with a Fit View that measures the canvas when it is
 * pressed. React Flow's own button fits to the size its store last recorded,
 * and a canvas that has just narrowed (a pane resized, a window not painting)
 * can still be on the old one: the fit then frames the old width and nodes
 * fall off the side. Measuring the element itself always frames what shows.
 */
function GraphControls({ fitLabel }: { fitLabel: string }) {
  const flow = useReactFlow();
  const domNode = useStore((state) => state.domNode);
  const fitNow = () => {
    const rect = domNode?.getBoundingClientRect();
    const nodes = flow.getNodes();
    if (!rect || rect.width < 2 || rect.height < 2 || !nodes.length) { void flow.fitView({ padding: 0.1 }); return; }
    void flow.setViewport(getViewportForBounds(flow.getNodesBounds(nodes), rect.width, rect.height, 0.03, 3, 0.1));
  };
  return (
    <Controls showInteractive={false} showFitView={false} className="[&>button]:!bg-elevated [&>button]:!text-text-primary [&>button]:!border-border">
      <ControlButton onClick={fitNow} aria-label={fitLabel} title={fitLabel} className="react-flow__controls-fitview">
        <Maximize size={12} />
      </ControlButton>
    </Controls>
  );
}
