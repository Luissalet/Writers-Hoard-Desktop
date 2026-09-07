import { memo, useMemo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { computeEdgeGeometry, type EdgeGeometry } from '../graph/geometry';
import type { BoardBox, BoardEdge } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

export interface EdgeLayerProps {
  edges: BoardEdge[];
  boxes: Map<string, BoardBox>;
  selectedEdgeIds: Set<string>;
  dimmedEdgeIds: Set<string>;
  /** Edges on the path currently being traced. */
  pathEdgeIds: Set<string>;
  /** Edges staged as endpoints of the link being built. */
  linkingEdgeIds: Set<string>;
  layerOpacityByEdge: Map<string, number>;
  showLabels: boolean;
  onSelectEdge: (id: string, additive: boolean) => void;
  onOpenEdge: (id: string) => void;
}

/**
 * All edges are drawn here rather than by React Flow.
 *
 * React Flow's edge model is strictly one source and one target, both nodes.
 * The board needs many-to-many relations and relations whose endpoint is
 * another relation, so the geometry is computed in flow coordinates and
 * painted into a `ViewportPortal`, which pans and zooms with the canvas.
 *
 * Stacking: the portal sits at z-index 1; frames render at 0 and every other
 * node at 2, so string passes over the regions it crosses and behind the cards
 * it connects — which is how it looks on a real corkboard.
 */
function EdgeLayer({
  edges,
  boxes,
  selectedEdgeIds,
  dimmedEdgeIds,
  pathEdgeIds,
  linkingEdgeIds,
  layerOpacityByEdge,
  showLabels,
  onSelectEdge,
  onOpenEdge,
}: EdgeLayerProps) {
  const geometry = useMemo(() => computeEdgeGeometry(edges, boxes), [edges, boxes]);

  const bounds = useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (const box of boxes.values()) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
    // Generous margin: self-loops and bowed relations reach outside the nodes.
    return { minX: minX - 800, minY: minY - 800, maxX: maxX + 800, maxY: maxY + 800 };
  }, [boxes]);

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          left: bounds.minX,
          top: bounds.minY,
          width,
          height,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        <g transform={`translate(${-bounds.minX} ${-bounds.minY})`}>
          {edges.map((edge) => {
            const shape = geometry.get(edge.id);
            if (!shape) return null;
            return (
              <EdgeShape
                key={edge.id}
                edge={edge}
                shape={shape}
                selected={selectedEdgeIds.has(edge.id)}
                dimmed={dimmedEdgeIds.has(edge.id)}
                onPath={pathEdgeIds.has(edge.id)}
                linking={linkingEdgeIds.has(edge.id)}
                layerOpacity={layerOpacityByEdge.get(edge.id) ?? 1}
                showLabel={showLabels}
                onSelect={onSelectEdge}
                onOpen={onOpenEdge}
              />
            );
          })}
        </g>
      </svg>
    </ViewportPortal>
  );
}

interface EdgeShapeProps {
  edge: BoardEdge;
  shape: EdgeGeometry;
  selected: boolean;
  dimmed: boolean;
  onPath: boolean;
  linking: boolean;
  layerOpacity: number;
  showLabel: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onOpen: (id: string) => void;
}

const DASH: Record<BoardEdge['style'], string | undefined> = {
  solid: undefined,
  dashed: '10 6',
  dotted: '2 5',
};

function EdgeShape({
  edge,
  shape,
  selected,
  dimmed,
  onPath,
  linking,
  layerOpacity,
  showLabel,
  onSelect,
  onOpen,
}: EdgeShapeProps) {
  const { t } = useTranslation();
  // Width follows relation strength unless the author pinned it explicitly.
  const strokeWidth = edge.width > 0 ? edge.width : 1.6 + Math.min(4.4, edge.weight * 1.4);
  const opacity = dimmed ? 0.08 : layerOpacity * (0.35 + 0.65 * Math.max(0, Math.min(1, edge.certainty)));
  const stroke = linking ? '#e4a853' : onPath ? '#c4973b' : edge.color;
  const showStart = edge.direction === 'backward' || edge.direction === 'both';
  const showEnd = edge.direction === 'forward' || edge.direction === 'both';

  return (
    <g opacity={opacity} role="button" tabIndex={dimmed ? -1 : 0}
      aria-label={edge.label || t(`board.edgeKind.${edge.kind}`)} aria-pressed={selected}
      data-board-edge-id={edge.id}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); onSelect(edge.id, event.shiftKey || event.metaKey || event.ctrlKey);
        }
      }} style={{ pointerEvents: dimmed ? 'none' : undefined }}>
      {shape.legs.map((leg, index) => (
        <g key={`${edge.id}-${index}`}>
          {/* Fat invisible stroke: the visible line is too thin to click. */}
          <path
            d={leg.d}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth + 14)}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: dimmed ? 'none' : 'stroke', cursor: 'pointer' }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(edge.id, event.shiftKey || event.metaKey || event.ctrlKey);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onOpen(edge.id);
            }}
          />
          {selected || onPath ? (
            <path
              d={leg.d}
              fill="none"
              stroke="#c4973b"
              strokeOpacity={0.35}
              strokeWidth={strokeWidth + 7}
              strokeLinecap="round"
            />
          ) : null}
          <path
            d={leg.d}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={DASH[edge.style]}
            strokeLinecap="round"
          />
          {/* A plain edge is a single leg drawn source → target, so it carries
              both heads; a hyper-edge splits them across its legs. */}
          {showEnd && (shape.simple || leg.side === 'target') ? (
            <Arrow x={leg.end.x} y={leg.end.y} angle={leg.endAngle} color={stroke} size={strokeWidth} />
          ) : null}
          {showStart && (shape.simple || leg.side === 'source') ? (
            <Arrow x={leg.start.x} y={leg.start.y} angle={leg.startAngle} color={stroke} size={strokeWidth} />
          ) : null}
        </g>
      ))}

      {shape.hub ? (
        <circle
          cx={shape.hub.x}
          cy={shape.hub.y}
          r={5 + strokeWidth / 2}
          fill="#111119"
          stroke={stroke}
          strokeWidth={2}
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(edge.id, event.shiftKey || event.metaKey || event.ctrlKey);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onOpen(edge.id);
          }}
        />
      ) : null}

      {showLabel && edge.label ? (
        <g transform={`translate(${shape.mid.x} ${shape.mid.y})`} style={{ pointerEvents: dimmed ? 'none' : 'all', cursor: 'pointer' }}
          onClick={(event) => { event.stopPropagation(); onSelect(edge.id, event.shiftKey || event.metaKey || event.ctrlKey); }}
          onDoubleClick={(event) => { event.stopPropagation(); onOpen(edge.id); }}>
          <rect
            x={-(edge.label.length * 3.4 + 8)}
            y={-9}
            width={edge.label.length * 6.8 + 16}
            height={18}
            rx={5}
            fill="#e8e5e0"
            opacity={0.9}
          />
          <text textAnchor="middle" y={4} fontSize={11} fontWeight={600} fill="#1a1a25">
            {edge.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function Arrow({ x, y, angle, color, size }: { x: number; y: number; angle: number; color: string; size: number }) {
  const length = 7 + size * 1.4;
  const spread = 4 + size * 0.9;
  return (
    <path
      d={`M 0 0 L ${-length} ${-spread} L ${-length * 0.7} 0 L ${-length} ${spread} Z`}
      fill={color}
      transform={`translate(${x} ${y}) rotate(${angle})`}
    />
  );
}

export default memo(EdgeLayer);
