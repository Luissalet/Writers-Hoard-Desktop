import { useRef, useState } from 'react';
import { Check, CircleX, ExternalLink, MousePointer2, Pentagon, Redo2, Route, Trash2, Type, Undo2 } from 'lucide-react';
import type { CodexEntry, MapFeature, MapPoint } from '@/types';
import { ConfirmDialog } from '@/engines/_shared';
import type { MapFeatureEditor } from './useMapFeatures';
import { mapFeatureCenter, mapItemVisible, mapPoint, minimumMapPoints } from './mapGeometry';
import MapNamedLayers from './MapNamedLayers';

const button = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary hover:border-accent-gold disabled:opacity-50';
const field = 'w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary focus:border-accent-gold outline-none';
const tools = [{ key: 'select', icon: MousePointer2 }, { key: 'region', icon: Pentagon }, { key: 'path', icon: Route }, { key: 'label', icon: Type }] as const;

export function MapFeatureToolbar({ editor, onToolChange }: { editor: MapFeatureEditor; onToolChange: () => void }) {
  if (!editor.enabled || editor.readOnly) return null;
  const { copy } = editor;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={copy.features}>
      {tools.map(({ key, icon: Icon }) => <button key={key} type="button" className={`${button} ${editor.tool === key ? 'border-accent-gold text-accent-gold bg-accent-gold/10' : ''}`} aria-pressed={editor.tool === key} disabled={editor.busy} onClick={() => { editor.changeTool(key); onToolChange(); }} data-testid={`map-tool-${key}`}><Icon size={15} />{copy[key]}</button>)}
      <span className="h-6 w-px bg-border" />
      <button type="button" className={button} aria-label={copy.undo} title={copy.undo} disabled={editor.busy || !editor.past.length} onClick={() => void editor.undo()} data-testid="map-feature-undo"><Undo2 size={16} /></button>
      <button type="button" className={button} aria-label={copy.redo} title={copy.redo} disabled={editor.busy || !editor.future.length} onClick={() => void editor.undo(true)} data-testid="map-feature-redo"><Redo2 size={16} /></button>
      {editor.drawing && <>
        <button type="button" className={button} disabled={editor.busy || editor.points.length < minimumMapPoints(editor.tool as MapFeature['kind'])} onClick={() => void editor.finish()} data-testid="map-feature-finish"><Check size={15} />{copy.finish} ({editor.points.length})</button>
        <button type="button" className={button} disabled={editor.busy || !editor.points.length} onClick={editor.back} title={copy.back} aria-label={copy.back}><Undo2 size={15} /></button>
        <button type="button" className={button} disabled={editor.busy} onClick={() => editor.changeTool('select')}><CircleX size={15} />{copy.cancel}</button>
      </>}
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted" role="group" aria-label={copy.layers}>
      <span className="font-semibold">{copy.layers}</span>
      {(['pins', 'region', 'path', 'label'] as const).map(key => <label key={key} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={editor.layers[key]} disabled={editor.busy} onChange={() => void editor.toggleLayer(key)} data-testid={`map-layer-${key}`} className="accent-accent-gold" />{copy[key]}</label>)}
    </div>
    <MapNamedLayers editor={editor} />
    <p className="text-xs text-text-muted" role="status">{editor.drawing ? copy[`${editor.tool as MapFeature['kind']}Help`] : copy.editHelp}</p>
    {editor.failed && <p role="alert" className="text-sm text-danger">{copy.failed}</p>}
  </div>;
}

/** Shared percentage coordinate system with the underlying image and pins. */
export function MapFeatureCanvas({ editor, aspectRatio = 1 }: { editor: MapFeatureEditor; aspectRatio?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ pointer: number; index: number; points: MapPoint[] } | null>(null);
  if (!editor.enabled) return null;
  const fromEvent = (event: { clientX: number; clientY: number }): MapPoint => {
    const rect = ref.current!.getBoundingClientRect();
    return mapPoint((event.clientX - rect.left) * 100 / rect.width, (event.clientY - rect.top) * 100 / rect.height);
  };
  const visible = editor.features.filter(feature => editor.layers[feature.kind] && mapItemVisible(feature, editor.namedLayers));
  const drawingPoints = [...editor.points, ...(editor.preview && editor.tool !== 'label' ? [editor.preview] : [])];
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const svgPoints = (points: MapPoint[]) => points.map(point => `${point.x},${point.y / ratio}`).join(' ');
  return <svg ref={ref} className="absolute inset-0 h-full w-full" style={{ pointerEvents: editor.drawing ? 'auto' : 'none', cursor: editor.drawing ? 'crosshair' : undefined }} viewBox={`0 0 100 ${100 / ratio}`} preserveAspectRatio="none" data-testid="map-feature-canvas"
    onClick={event => { if (editor.drawing) { event.stopPropagation(); editor.addPoint(fromEvent(event)); } }}
    onPointerMove={event => { if (editor.drawing) editor.setPreview(fromEvent(event)); }}
    onPointerLeave={() => editor.setPreview(null)}>
    {visible.map(saved => {
      const feature = editor.draft?.id === saved.id ? editor.draft : saved;
      const points = svgPoints(feature.points);
      const center = mapFeatureCenter(feature.points);
      const selected = editor.selected?.id === feature.id;
      const activate = () => editor.select(saved);
      const attributes = { stroke: feature.color, strokeWidth: selected ? 3 : 2, vectorEffect: 'non-scaling-stroke', style: { pointerEvents: editor.drawing ? 'none' as const : 'auto' as const, cursor: 'pointer' }, onClick: (event: React.MouseEvent) => { event.stopPropagation(); activate(); }, onPointerDown: (event: React.PointerEvent) => event.stopPropagation(), tabIndex: editor.drawing ? -1 : 0, role: 'button', 'aria-label': `${editor.copy[feature.kind]}: ${feature.name}`, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } } };
      return <g key={feature.id} data-feature-id={feature.id}>
        <title>{feature.description || feature.name}</title>
        {feature.kind === 'region' && <polygon {...attributes} points={points} fill={feature.color} fillOpacity={feature.opacity ?? .22} />}
        {feature.kind === 'path' && <><polyline points={points} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" style={{ pointerEvents: editor.drawing ? 'none' : 'stroke', cursor: 'pointer' }} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); activate(); }} /><polyline {...attributes} points={points} fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
        <text {...attributes} x={center.x} y={center.y / ratio} stroke="#17191a" strokeWidth={3} fill={feature.color} fontSize={1.8} textAnchor="middle" paintOrder="stroke" fontFamily="Georgia,serif">{feature.name}</text>
        {selected && !editor.drawing && !editor.readOnly && feature.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y / ratio} r={.5} fill="#eeeae2" stroke={feature.color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: editor.busy ? 'none' : 'auto', cursor: 'move', touchAction: 'none' }} data-testid={`map-vertex-${index}`}
          onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
          onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ pointer: event.pointerId, index, points: feature.points }); }}
          onPointerMove={event => { if (!drag || drag.pointer !== event.pointerId || drag.index !== index) return; event.stopPropagation(); editor.patch({ points: feature.points.map((at, i) => i === index ? fromEvent(event) : at) }); }}
          onPointerUp={event => { if (!drag || drag.pointer !== event.pointerId) return; event.stopPropagation(); event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null); }}
          onPointerCancel={() => { if (drag) editor.patch({ points: drag.points }); setDrag(null); }}
          onClick={event => event.stopPropagation()} />)}
      </g>;
    })}
    {editor.drawing && <g pointerEvents="none">
      {editor.tool === 'region' ? <polygon points={svgPoints(drawingPoints)} fill="#d5b575" fillOpacity={.15} stroke="#d5b575" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : <polyline points={svgPoints(drawingPoints)} fill="none" stroke="#e4a853" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
      {editor.points.map((point, i) => <circle key={i} cx={point.x} cy={point.y / ratio} r={.4} fill="#d5b575" />)}
    </g>}
  </svg>;
}

export function MapFeatureInspector({ editor, entries, onOpenEntry }: { editor: MapFeatureEditor; entries: CodexEntry[]; onOpenEntry?: (entryId: string) => void }) {
  if (!editor.enabled) return null;
  const { copy, draft, selected } = editor;
  const filtered = editor.features.filter(feature => `${feature.name} ${feature.description ?? ''}`.toLocaleLowerCase().includes(editor.query.toLocaleLowerCase()));
  const linked = entries.find(entry => entry.id === draft?.linkedEntryId);
  return <section className="rounded-xl border border-border bg-surface p-4 space-y-4" aria-label={copy.features}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-serif font-bold text-accent-gold text-sm">{copy.features} ({editor.features.length})</h4>{editor.features.length > 0 && <input className={`${field} max-w-xs`} placeholder={copy.search} aria-label={copy.search} value={editor.query} onChange={event => editor.setQuery(event.target.value)} />}</div>
    {!editor.features.length && <p className="text-sm text-text-muted">{copy.empty}</p>}
    {!!editor.features.length && !filtered.length && <p className="text-sm text-text-muted">{copy.noResults}</p>}
    <div className="flex flex-wrap gap-2">{filtered.map(feature => <button key={feature.id} type="button" className={`${button} ${selected?.id === feature.id ? 'border-accent-gold' : ''}`} disabled={editor.busy || editor.drawing} onClick={() => editor.select(feature)} data-testid={`map-feature-select-${feature.id}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: feature.color }} /><span>{feature.name}</span><span className="text-xs text-text-muted">{copy[feature.kind]}{(!editor.layers[feature.kind] || !mapItemVisible(feature, editor.namedLayers)) && ` · ${copy.hidden}`}</span></button>)}</div>
    {selected && draft && editor.readOnly && <div className="space-y-2 border-t border-border pt-3"><h5 className="font-semibold text-text-primary">{draft.name}</h5>{draft.description && <p className="text-sm text-text-muted whitespace-pre-wrap">{draft.description}</p>}{linked && onOpenEntry && <button type="button" className={button} onClick={() => onOpenEntry(linked.id)}><ExternalLink size={14} />{copy.openEntry}: {linked.title}</button>}</div>}
    {selected && draft && !editor.readOnly && <fieldset disabled={editor.busy} className="space-y-4 border-t border-border pt-4" data-testid="map-feature-inspector">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.name}<input value={draft.name} onChange={event => editor.patch({ name: event.target.value })} className={field} data-testid="map-feature-name" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.linkedEntry}<select className={field} value={draft.linkedEntryId ?? ''} onChange={event => editor.patch({ linkedEntryId: event.target.value || undefined })} data-testid="map-feature-link"><option value="">{copy.noLink}</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      </div>
      {!!editor.namedLayers.length && <label className="text-xs text-text-muted space-y-1.5 block">{copy.layer}<select className={field} value={editor.namedLayers.some(layer => layer.id === draft.layerId) ? draft.layerId : ''} onChange={event => editor.patch({ layerId: event.target.value || undefined })} data-testid="map-feature-layer"><option value="">{copy.ungrouped}</option>{editor.namedLayers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>}
      <label className="text-xs text-text-muted space-y-1.5 block">{copy.description}<textarea rows={2} value={draft.description ?? ''} onChange={event => editor.patch({ description: event.target.value })} className={field} /></label>
      <div className="flex items-end flex-wrap gap-4">
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.color}<input type="color" value={draft.color} onChange={event => editor.patch({ color: event.target.value })} className="block h-9 w-16 rounded border border-border bg-elevated p-1" /></label>
        {draft.kind === 'region' && <label className="text-xs text-text-muted space-y-1.5 block">{copy.opacity} ({Math.round((draft.opacity ?? .22) * 100)}%)<input type="range" min="0" max="100" value={(draft.opacity ?? .22) * 100} onChange={event => editor.patch({ opacity: Number(event.target.value) / 100 })} className="block h-9 accent-accent-gold" /></label>}
        {linked && onOpenEntry && <button type="button" className={button} onClick={() => onOpenEntry(linked.id)}><ExternalLink size={14} />{copy.openEntry}: {linked.title}</button>}
        {(!editor.layers[draft.kind] || !mapItemVisible(draft, editor.namedLayers)) && <button type="button" className={button} onClick={() => { if (!editor.layers[draft.kind]) void editor.toggleLayer(draft.kind); else void editor.changeNamedLayers(editor.namedLayers.map(layer => layer.id === draft.layerId ? { ...layer, visible: true } : layer)); }}>{copy.show}</button>}
      </div>
      <details><summary className="cursor-pointer text-xs text-text-muted">{copy.vertices} ({draft.points.length})</summary><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{draft.points.map((point, index) => <div key={index} className="flex items-center gap-2"><span className="text-xs text-text-muted">{index + 1}</span>{(['x', 'y'] as const).map(axis => <label key={axis} className="flex items-center gap-1 text-xs text-text-muted">{axis.toUpperCase()}<input aria-label={`${copy[axis]} · ${index + 1}`} type="number" min="0" max="100" step="0.1" className={`${field} min-w-0`} value={Number(point[axis].toFixed(3))} onChange={event => editor.patch({ points: draft.points.map((at, i) => i === index ? mapPoint(axis === 'x' ? Number(event.target.value) : at.x, axis === 'y' ? Number(event.target.value) : at.y) : at) })} /></label>)}</div>)}</div></details>
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-text-muted flex-1" role="status">{editor.dirty ? copy.draft : copy.saved}</span><button type="button" className={`${button} text-danger`} onClick={() => editor.setPendingDelete(selected)}><Trash2 size={14} />{copy.remove}</button>{editor.dirty && <button type="button" className={button} onClick={editor.discard}>{copy.discard}</button>}<button type="button" disabled={!draft.name.trim() || !editor.dirty} onClick={() => void editor.save()} className="rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-deep disabled:opacity-50" data-testid="map-feature-save">{editor.busy ? copy.saving : copy.save}</button></div>
    </fieldset>}
    <ConfirmDialog open={!!editor.pendingDelete} destructive message={`${copy.deleteQuestion} ${editor.pendingDelete?.name ?? ''}`} onConfirm={editor.remove} onCancel={() => editor.setPendingDelete(null)} />
  </section>;
}
