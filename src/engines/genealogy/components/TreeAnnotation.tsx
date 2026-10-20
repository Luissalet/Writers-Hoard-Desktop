import type { Node, NodeProps } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { annotationLines, annotationPolyline, type RelationTreeAnnotation } from '../relationTreeAnnotations';
import type { RelationTreeCopy } from '../relationTreeCopy';

export type AnnotationFlowNode = Node<{ annotation: RelationTreeAnnotation } & Record<string, unknown>, 'annotation'>;
export function AnnotationNode({ data: { annotation }, selected }: NodeProps<AnnotationFlowNode>) {
  return <div className={`h-full w-full rounded ${selected ? 'outline outline-1 outline-accent-gold' : ''}`} data-testid={`tree-annotation-${annotation.kind}`}>
    <svg width="100%" height="100%" viewBox={`0 0 ${annotation.size.width} ${annotation.size.height}`} overflow="hidden" aria-label={annotation.kind === 'text' ? annotation.text : undefined}>
      {annotation.kind === 'stroke'
        ? <polyline points={annotationPolyline(annotation)} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" />
        : <text x={8} y={annotation.fontSize + 4} fill={annotation.color} fontSize={annotation.fontSize} fontFamily="system-ui,sans-serif" xmlSpace="preserve">{annotationLines(annotation).map((line, index) => <tspan key={index} x={8} dy={index ? annotation.fontSize * 1.3 : 0}>{line}</tspan>)}</text>}
    </svg>
  </div>;
}

const fieldClass = 'w-full min-w-0 px-2.5 py-2 text-sm text-text-primary bg-elevated border border-border rounded-lg outline-none focus:border-accent-gold';
export function TreeAnnotationInspector({ annotation, copy, onChange, onRemove }: { annotation: RelationTreeAnnotation; copy: RelationTreeCopy; onChange: (next: RelationTreeAnnotation) => void; onRemove: () => void }) {
  const numeric = (label: string, value: number, change: (value: number) => void, min = -1e7, max = 1e7) => <label className="text-xs text-text-muted">{label}<input type="number" aria-label={label} min={min} max={max} className={`${fieldClass} mt-1`} value={value} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) change(next); }} /></label>;
  return <div className="border-t border-border pt-3 space-y-2" data-testid="tree-annotation-inspector">
    <h3 className="text-sm font-semibold text-text-primary">{annotation.kind === 'text' ? copy.textAnnotation : copy.drawing}</h3>
    {annotation.kind === 'text' && <label className="block text-xs text-text-muted">{copy.annotationText}<textarea aria-label={copy.annotationText} className={`${fieldClass} mt-1 resize-y min-h-28`} maxLength={20000} value={annotation.text} onChange={event => onChange({ ...annotation, text: event.target.value })} /></label>}
    <label className="flex items-center gap-2 text-xs text-text-muted">{copy.color}<input aria-label={copy.color} type="color" value={annotation.color} onChange={event => onChange({ ...annotation, color: event.target.value })} className="h-9 w-12 rounded border border-border bg-elevated" /></label>
    {annotation.kind === 'text' ? numeric(copy.fontSize, annotation.fontSize, fontSize => onChange({ ...annotation, fontSize }), 10, 96) : numeric(copy.strokeWidth, annotation.width, width => onChange({ ...annotation, width }), 1, 24)}
    <div className="grid grid-cols-2 gap-2">{(['x', 'y'] as const).map(axis => <span key={axis}>{numeric(copy[axis], annotation.position[axis], value => onChange({ ...annotation, position: { ...annotation.position, [axis]: value } }))}</span>)}</div>
    <div className="grid grid-cols-2 gap-2">{(['width', 'height'] as const).map(axis => <span key={axis}>{numeric(copy[axis], annotation.size[axis], value => onChange({ ...annotation, size: { ...annotation.size, [axis]: value } }), 8, 50000)}</span>)}</div>
    <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-danger hover:bg-elevated" onClick={onRemove}><Trash2 size={14} />{copy.removeAnnotation}</button>
  </div>;
}
