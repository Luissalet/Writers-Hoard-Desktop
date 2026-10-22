import { createElement, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Check, CircleX, ExternalLink, MousePointer2, Pentagon, Redo2, Route, Trash2, Type, Undo2 } from 'lucide-react';
import type { CodexEntry, CodexEntryType, MapFeature, MapPoint } from '@/types';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import type { MapFeatureEditor } from './useMapFeatures';
import { mapFeatureCenter, mapItemLayers, mapItemVisible, mapPoint, minimumMapPoints, withMapLayers } from './mapGeometry';
import MapNamedLayers from './MapNamedLayers';
import CodexEntryPicker from './CodexEntryPicker';
import { MAP_LABEL_FONTS, MAP_LABEL_OUTLINE, MAP_LABEL_SIZE, MAP_PATTERNS, MAP_PATTERN_SCALE, MAP_STROKE_WIDTH, DEFAULT_LABEL_SIZE, patternTile, pathLook, MAP_PATH_STYLES, reorderFeature, resolvedLabel, resolvedStroke } from './mapStyle';
import { areaKm2, formatKm, formatKm2, lineLengthKm } from './mapScale';
import { mapScaleCopy } from './mapScaleCopy';
import MapTravelReadout from './MapTravelReadout';

/** SVG attribute names in the tile spec are kebab-case; React wants camelCase. */
const reactAttrs = (attrs: Record<string, string | number>) => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v]));

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
      const stroke = resolvedStroke(feature);
      const look = feature.kind === 'path' ? pathLook(feature.pathStyle, stroke.color, stroke.width) : {};
      const lettering = resolvedLabel(feature);
      const tile = feature.kind === 'region' ? patternTile(feature, 1) : null;
      const attributes = { stroke: stroke.color, strokeWidth: stroke.width + (selected ? 1 : 0), vectorEffect: 'non-scaling-stroke', style: { pointerEvents: editor.drawing ? 'none' as const : 'auto' as const, cursor: 'pointer' }, onClick: (event: React.MouseEvent) => { event.stopPropagation(); activate(); }, onPointerDown: (event: React.PointerEvent) => event.stopPropagation(), tabIndex: editor.drawing ? -1 : 0, role: 'button', 'aria-label': `${editor.copy[feature.kind]}: ${feature.name}`, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } } };
      return <g key={feature.id} data-feature-id={feature.id}>
        <title>{feature.description || feature.name}</title>
        {tile && <defs><pattern id={`mp-${feature.id}`} patternUnits="userSpaceOnUse" width={tile.size} height={tile.size} patternTransform={tile.rotate ? `rotate(${tile.rotate})` : undefined}>{tile.marks.map((mark, i) => createElement(mark.tag, { key: i, ...reactAttrs(mark.attrs) }))}</pattern></defs>}
        {feature.kind === 'region' && <polygon {...attributes} points={points} fill={feature.color} fillOpacity={feature.opacity ?? .22} />}
        {tile && <polygon points={points} fill={`url(#mp-${feature.id})`} stroke="none" style={{ pointerEvents: 'none' }} data-testid={`map-pattern-${feature.id}`} />}
        {feature.kind === 'path' && <><polyline points={points} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" style={{ pointerEvents: editor.drawing ? 'none' : 'stroke', cursor: 'pointer' }} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); activate(); }} />{look.under && <polyline points={points} fill="none" stroke={look.under.color} strokeOpacity={look.under.opacity} strokeWidth={look.under.width + (selected ? 1 : 0)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />}<polyline {...attributes} points={points} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={look.dash} data-path-style={feature.pathStyle ?? 'plain'} /></>}
        <text {...attributes} x={center.x} y={center.y / ratio} stroke={lettering.outline} strokeWidth={lettering.outlineWidth} fill={lettering.fill} fontSize={lettering.size} fontWeight={lettering.weight} fontStyle={lettering.style} textAnchor="middle" paintOrder="stroke" fontFamily={lettering.family} transform={lettering.rotation ? `rotate(${lettering.rotation} ${center.x} ${center.y / ratio})` : undefined} data-testid={`map-label-${feature.id}`}>{feature.name}</text>
        {/* "Add a point": a handle halfway along each edge; pressing it inserts a vertex there and drags it. Drawn under the vertices, and its ring never reaches them, so a vertex is always the one pressed. */}
        {selected && !editor.drawing && !editor.readOnly && feature.kind !== 'label' && feature.points.map((point, index) => {
          const nextIndex = index + 1 < feature.points.length ? index + 1 : (feature.kind === 'region' ? 0 : -1);
          if (nextIndex < 0) return null;
          const other = feature.points[nextIndex];
          const mid = mapPoint((point.x + other.x) / 2, (point.y + other.y) / 2);
          const ring = Math.max(.35, Math.min(1.1, Math.hypot(other.x - point.x, (other.y - point.y) / ratio) / 2 - .6));
          // The visible dot is small; a wider transparent ring around it takes the press.
          return <g key={`mid-${index}`} style={{ pointerEvents: editor.busy ? 'none' : 'auto', cursor: 'copy', touchAction: 'none' }} data-testid={`map-midpoint-${index}`}
            onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onPointerDown={event => { event.preventDefault(); event.stopPropagation(); const inserted = [...feature.points.slice(0, index + 1), mid, ...feature.points.slice(index + 1)]; editor.patch({ points: inserted }); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ pointer: event.pointerId, index: index + 1, points: feature.points }); }}
            onPointerMove={event => { if (!drag || drag.pointer !== event.pointerId) return; event.stopPropagation(); editor.patch({ points: (editor.draft?.points ?? feature.points).map((at, i) => i === drag.index ? fromEvent(event) : at) }); }}
            onPointerUp={event => { if (!drag || drag.pointer !== event.pointerId) return; event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null); }}
            onPointerCancel={() => { if (drag) editor.patch({ points: drag.points }); setDrag(null); }}
            onClick={event => event.stopPropagation()}>
            <circle cx={mid.x} cy={mid.y / ratio} r={ring} fill="transparent" stroke="none" />
            <circle cx={mid.x} cy={mid.y / ratio} r={.35} fill={feature.color} fillOpacity={.55} stroke="#eeeae2" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
          </g>;
        })}
        {selected && !editor.drawing && !editor.readOnly && feature.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y / ratio} r={.5} fill="#eeeae2" stroke={feature.color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: editor.busy ? 'none' : 'auto', cursor: 'move', touchAction: 'none' }} data-testid={`map-vertex-${index}`}
          onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
          onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ pointer: event.pointerId, index, points: feature.points }); }}
          onPointerMove={event => { if (!drag || drag.pointer !== event.pointerId || drag.index !== index) return; event.stopPropagation(); editor.patch({ points: feature.points.map((at, i) => i === index ? fromEvent(event) : at) }); }}
          onPointerUp={event => { if (!drag || drag.pointer !== event.pointerId) return; event.stopPropagation(); event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null); }}
          onPointerCancel={() => { if (drag) editor.patch({ points: drag.points }); setDrag(null); }}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => { event.stopPropagation(); if (feature.points.length > minimumMapPoints(feature.kind)) editor.patch({ points: feature.points.filter((_, i) => i !== index) }); }} />)}
      </g>;
    })}
    {editor.drawing && <g pointerEvents="none">
      {editor.tool === 'region' ? <polygon points={svgPoints(drawingPoints)} fill="#d5b575" fillOpacity={.15} stroke="#d5b575" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : <polyline points={svgPoints(drawingPoints)} fill="none" stroke="#e4a853" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
      {editor.points.map((point, i) => <circle key={i} cx={point.x} cy={point.y / ratio} r={.4} fill="#d5b575" />)}
    </g>}
  </svg>;
}

export function MapFeatureInspector({ editor, entries, onOpenEntry, onCreateEntry, scale }: { editor: MapFeatureEditor; entries: CodexEntry[]; onOpenEntry?: (entryId: string) => void; onCreateEntry?: (title: string, type: CodexEntryType) => Promise<string>; scale?: { widthKm: number; aspect: number } }) {
  const { locale } = useTranslation();
  if (!editor.enabled) return null;
  const { copy, draft, selected } = editor;
  const sc = mapScaleCopy[locale === 'en' ? 'en' : 'es'];
  // Length, area and travel time once the map has a scale.
  const measured = scale && draft && draft.kind !== 'label' ? <div className="space-y-1 rounded-lg border border-border/70 px-3 py-2 text-xs text-text-muted" data-testid="map-feature-measure">
    {draft.kind === 'path' ? <>
      <p>{sc.length}: <strong className="text-text-primary" data-km={lineLengthKm(draft.points, scale.widthKm, scale.aspect).toFixed(3)}>{formatKm(lineLengthKm(draft.points, scale.widthKm, scale.aspect), locale)}</strong></p>
      <MapTravelReadout km={lineLengthKm(draft.points, scale.widthKm, scale.aspect)} />
    </> : <p>{sc.area}: <strong className="text-text-primary" data-km2={areaKm2(draft.points, scale.widthKm, scale.aspect).toFixed(3)}>{formatKm2(areaKm2(draft.points, scale.widthKm, scale.aspect), locale)}</strong> · {sc.perimeter}: {formatKm(lineLengthKm(draft.points, scale.widthKm, scale.aspect, true), locale)}</p>}
  </div> : null;
  const filtered = editor.features.filter(feature => `${feature.name} ${feature.description ?? ''}`.toLocaleLowerCase().includes(editor.query.toLocaleLowerCase()));
  const linked = entries.find(entry => entry.id === draft?.linkedEntryId);
  return <section className="rounded-xl border border-border bg-surface p-4 space-y-4" aria-label={copy.features}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-serif font-bold text-accent-gold text-sm">{copy.features} ({editor.features.length})</h4>{editor.features.length > 0 && <input className={`${field} max-w-xs`} placeholder={copy.search} aria-label={copy.search} value={editor.query} onChange={event => editor.setQuery(event.target.value)} />}</div>
    {!editor.features.length && <p className="text-sm text-text-muted">{copy.empty}</p>}
    {!!editor.features.length && !filtered.length && <p className="text-sm text-text-muted">{copy.noResults}</p>}
    <div className="flex flex-wrap gap-2">{filtered.map(feature => <button key={feature.id} type="button" className={`${button} ${selected?.id === feature.id ? 'border-accent-gold' : ''}`} disabled={editor.busy || editor.drawing} onClick={() => editor.select(feature)} data-testid={`map-feature-select-${feature.id}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: feature.color }} /><span>{feature.name}</span><span className="text-xs text-text-muted">{copy[feature.kind]}{(!editor.layers[feature.kind] || !mapItemVisible(feature, editor.namedLayers)) && ` · ${copy.hidden}`}</span></button>)}</div>
    {selected && draft && editor.readOnly && <div className="space-y-2 border-t border-border pt-3"><h5 className="font-semibold text-text-primary">{draft.name}</h5>{measured}{draft.description && <p className="text-sm text-text-muted whitespace-pre-wrap">{draft.description}</p>}{linked && onOpenEntry && <button type="button" className={button} onClick={() => onOpenEntry(linked.id)}><ExternalLink size={14} />{copy.openEntry}: {linked.title}</button>}</div>}
    {selected && draft && !editor.readOnly && <fieldset disabled={editor.busy} className="space-y-4 border-t border-border pt-4" data-testid="map-feature-inspector">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.name}<input value={draft.name} onChange={event => editor.patch({ name: event.target.value })} className={field} data-testid="map-feature-name" /></label>
        <div className="min-w-0 text-xs text-text-muted space-y-1.5 block"><span>{copy.linkedEntry}</span><CodexEntryPicker entries={entries} value={draft.linkedEntryId} onChange={id => editor.patch({ linkedEntryId: id })} onCreate={onCreateEntry} testId="map-feature-link" disabled={editor.busy} /></div>
      </div>
      {!!editor.namedLayers.length && <fieldset className="text-xs text-text-muted space-y-1.5" data-testid="map-feature-layers"><legend>{copy.layersOf}</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{editor.namedLayers.map(layer => { const ids = mapItemLayers(draft); return <label key={layer.id} className="flex items-center gap-1.5"><input type="checkbox" className="accent-accent-gold" checked={ids.includes(layer.id)} onChange={event => editor.patch(withMapLayers(event.target.checked ? [...ids, layer.id] : ids.filter(id => id !== layer.id)))} data-testid={`map-feature-layer-${layer.id}`} />{layer.name}</label>; })}</div><p className="text-[11px]">{copy.layersHelp}</p></fieldset>}
      <label className="text-xs text-text-muted space-y-1.5 block">{copy.description}<textarea rows={2} value={draft.description ?? ''} onChange={event => editor.patch({ description: event.target.value })} className={field} /></label>
      {draft.kind === 'path' && <label className="text-xs text-text-muted space-y-1.5 block">{sc.pathStyle}<select className={field} value={draft.pathStyle ?? ''} onChange={event => editor.patch({ pathStyle: (event.target.value || undefined) as MapFeature['pathStyle'] })} data-testid="map-feature-path-style"><option value="">{sc.pathPlain}</option>{MAP_PATH_STYLES.map(style => <option key={style} value={style}>{sc[style === 'road' ? 'pathRoad' : style === 'trail' ? 'pathTrail' : 'pathRiver']}</option>)}</select></label>}
      {measured}
      <div className="flex items-end flex-wrap gap-4">
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.color}<input type="color" value={draft.color} onChange={event => editor.patch({ color: event.target.value })} className="block h-9 w-16 rounded border border-border bg-elevated p-1" /></label>
        {draft.kind === 'region' && <label className="text-xs text-text-muted space-y-1.5 block">{copy.opacity} ({Math.round((draft.opacity ?? .22) * 100)}%)<input type="range" min="0" max="100" value={(draft.opacity ?? .22) * 100} onChange={event => editor.patch({ opacity: Number(event.target.value) / 100 })} className="block h-9 accent-accent-gold" /></label>}
        {linked && onOpenEntry && <button type="button" className={button} onClick={() => onOpenEntry(linked.id)}><ExternalLink size={14} />{copy.openEntry}: {linked.title}</button>}
        {(!editor.layers[draft.kind] || !mapItemVisible(draft, editor.namedLayers)) && <button type="button" className={button} onClick={() => { if (!editor.layers[draft.kind]) void editor.toggleLayer(draft.kind); else void editor.changeNamedLayers(editor.namedLayers.map(layer => layer.id === mapItemLayers(draft)[0] ? { ...layer, visible: true } : layer)); }}>{copy.show}</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="map-feature-style">
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.strokeColor}<input type="color" value={resolvedStroke(draft).color} onChange={event => editor.patch({ strokeColor: event.target.value })} className="block h-9 w-16 rounded border border-border bg-elevated p-1" data-testid="map-feature-stroke-color" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.strokeWidth} ({resolvedStroke(draft).width})<input type="range" min={MAP_STROKE_WIDTH.min} max={MAP_STROKE_WIDTH.max} step="0.5" value={resolvedStroke(draft).width} onChange={event => editor.patch({ strokeWidth: Number(event.target.value) })} className="block w-full accent-accent-gold" data-testid="map-feature-stroke-width" /></label>
        {draft.kind === 'region' && <label className="text-xs text-text-muted space-y-1.5 block">{copy.pattern}<select className={field} value={draft.pattern ?? ''} onChange={event => editor.patch({ pattern: (event.target.value || undefined) as typeof draft.pattern })} data-testid="map-feature-pattern"><option value="">{copy.patternNone}</option>{MAP_PATTERNS.map(p => <option key={p} value={p}>{copy[`pattern_${p}`]}</option>)}</select></label>}
        {draft.kind === 'region' && draft.pattern && <label className="text-xs text-text-muted space-y-1.5 block">{copy.patternScale} ({draft.patternScale ?? 1})<input type="range" min={MAP_PATTERN_SCALE.min} max={MAP_PATTERN_SCALE.max} step="0.25" value={draft.patternScale ?? 1} onChange={event => editor.patch({ patternScale: Number(event.target.value) })} className="block w-full accent-accent-gold" data-testid="map-feature-pattern-scale" /></label>}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border p-3" data-testid="map-feature-label-style">
        <legend className="px-1 text-xs text-text-muted">{copy.lettering}</legend>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.font}<select className={field} value={draft.labelStyle?.font ?? 'serif'} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, font: event.target.value as NonNullable<typeof draft.labelStyle>['font'] } })} data-testid="map-label-font">{MAP_LABEL_FONTS.map(f => <option key={f} value={f}>{copy[`font_${f}`]}</option>)}</select></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.fontSize} ({draft.labelStyle?.size ?? DEFAULT_LABEL_SIZE})<input type="range" min={MAP_LABEL_SIZE.min} max={MAP_LABEL_SIZE.max} step="0.1" value={draft.labelStyle?.size ?? DEFAULT_LABEL_SIZE} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, size: Number(event.target.value) } })} className="block w-full accent-accent-gold" data-testid="map-label-size" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.rotation} ({draft.labelStyle?.rotation ?? 0}°)<input type="range" min="-180" max="180" step="1" value={draft.labelStyle?.rotation ?? 0} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, rotation: Number(event.target.value) } })} className="block w-full accent-accent-gold" data-testid="map-label-rotation" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.textColor}<input type="color" value={resolvedLabel(draft).fill} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, color: event.target.value } })} className="block h-9 w-16 rounded border border-border bg-elevated p-1" data-testid="map-label-color" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.outline}<input type="color" value={resolvedLabel(draft).outline} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, outline: event.target.value } })} className="block h-9 w-16 rounded border border-border bg-elevated p-1" data-testid="map-label-outline" /></label>
        <label className="text-xs text-text-muted space-y-1.5 block">{copy.outlineWidth} ({resolvedLabel(draft).outlineWidth})<input type="range" min={MAP_LABEL_OUTLINE.min} max={MAP_LABEL_OUTLINE.max} step="0.5" value={resolvedLabel(draft).outlineWidth} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, outlineWidth: Number(event.target.value) } })} className="block w-full accent-accent-gold" data-testid="map-label-outline-width" /></label>
        <div className="flex items-center gap-3 text-xs text-text-muted sm:col-span-3">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!draft.labelStyle?.bold} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, bold: event.target.checked } })} className="accent-accent-gold" data-testid="map-label-bold" /><b>{copy.bold}</b></label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!draft.labelStyle?.italic} onChange={event => editor.patch({ labelStyle: { ...draft.labelStyle, italic: event.target.checked } })} className="accent-accent-gold" data-testid="map-label-italic" /><i>{copy.italic}</i></label>
          {draft.labelStyle && <button type="button" className="ml-auto underline" onClick={() => editor.patch({ labelStyle: undefined })}>{copy.resetLettering}</button>}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={copy.order} data-testid="map-feature-order">
        <span className="text-xs text-text-muted">{copy.order}</span>
        {([['back', ArrowDownToLine], ['backward', ArrowDown], ['forward', ArrowUp], ['front', ArrowUpToLine]] as const).map(([how, Icon]) => <button key={how} type="button" className={button} title={copy[`order_${how}`]} aria-label={copy[`order_${how}`]} disabled={editor.busy || editor.dirty} onClick={() => void editor.persist(reorderFeature(editor.features, draft.id, how))} data-testid={`map-order-${how}`}><Icon size={14} /></button>)}
        {editor.dirty && <span className="text-[11px] text-text-muted">{copy.orderSaveFirst}</span>}
      </div>
      <details><summary className="cursor-pointer text-xs text-text-muted">{copy.vertices} ({draft.points.length})</summary><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{draft.points.map((point, index) => <div key={index} className="flex items-center gap-2"><span className="text-xs text-text-muted">{index + 1}</span>{(['x', 'y'] as const).map(axis => <label key={axis} className="flex items-center gap-1 text-xs text-text-muted">{axis.toUpperCase()}<input aria-label={`${copy[axis]} · ${index + 1}`} type="number" min="0" max="100" step="0.1" className={`${field} min-w-0`} value={Number(point[axis].toFixed(3))} onChange={event => editor.patch({ points: draft.points.map((at, i) => i === index ? mapPoint(axis === 'x' ? Number(event.target.value) : at.x, axis === 'y' ? Number(event.target.value) : at.y) : at) })} /></label>)}</div>)}</div></details>
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-text-muted flex-1" role="status">{editor.dirty ? copy.draft : copy.saved}</span><button type="button" className={`${button} text-danger`} onClick={() => editor.setPendingDelete(selected)}><Trash2 size={14} />{copy.remove}</button>{editor.dirty && <button type="button" className={button} onClick={editor.discard}>{copy.discard}</button>}<button type="button" disabled={!draft.name.trim() || !editor.dirty} onClick={() => void editor.save()} className="rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-deep disabled:opacity-50" data-testid="map-feature-save">{editor.busy ? copy.saving : copy.save}</button></div>
    </fieldset>}
    <ConfirmDialog open={!!editor.pendingDelete} destructive message={`${copy.deleteQuestion} ${editor.pendingDelete?.name ?? ''}`} onConfirm={editor.remove} onCancel={() => editor.setPendingDelete(null)} />
  </section>;
}
