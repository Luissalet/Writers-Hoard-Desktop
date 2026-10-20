import { BaseEdge, EdgeLabelRenderer, Handle, Position, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { ProjectIcon } from '@/components/common/ProjectIcon';
export type JunctionFlowNode = Node<{ label: string } & Record<string, unknown>, 'junction'>;
export function JunctionNode({ data, selected }: NodeProps<JunctionFlowNode>) {
  return <div className={`h-4 w-4 rounded-full border-2 bg-surface ${selected ? 'border-accent-gold ring-2 ring-accent-gold/30' : 'border-text-muted'}`} title={data.label} data-testid="tree-junction">
    {([['top', Position.Top], ['bottom', Position.Bottom], ['left', Position.Left], ['right', Position.Right]] as const).map(([id, position]) => <Handle key={id} id={id} type="source" position={position} className="!h-2 !w-2 !min-h-0 !min-w-0 !bg-accent-gold !border-surface" />)}
  </div>;
}
export type RelationFlowEdge = Edge<{ logicalId: string; segmentIndex: number; labelText: string; icon?: string; labelPosition?: { x: number; y: number } }>;
export function TreeRelationFlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<RelationFlowEdge>) {
  const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const position = data?.labelPosition ?? { x, y };
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />{data && (data.labelText || data.icon) && <EdgeLabelRenderer><div className="pointer-events-none absolute flex max-w-56 items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-center text-xs text-text-primary" style={{ transform: `translate(-50%,-50%) translate(${position.x}px,${position.y}px)` }}>{data.icon && <ProjectIcon name={data.icon} size={13} className="shrink-0" aria-label={data.icon} />}<span className="min-w-0 break-words">{data.labelText}</span></div></EdgeLabelRenderer>}</>;
}
