import { DEFAULT_GRAPH_DISPLAY, normalizeWorldGraphDisplay, WORLD_GRAPH_CARD_SIZE, type CodexGraphLayout, type WorldGraphDisplay, type WorldGraphEdge, type WorldGraphEdgeKind, type WorldGraphNode } from './types';
import { worldGraphTypeAreas } from './areas';
import { codexTypeColors } from '@/components/codex/codexTypeMeta';

export const WORLD_GRAPH_COLORS: Record<WorldGraphEdgeKind, string> = { mention: '#a1a49e', codex: '#d5b575', reference: '#4a9e6d', relationship: '#9b7ed8' };
const xml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Self-contained diagram of the visible graph; titles and labels are escaped text. */
export function exportWorldGraphSvg(nodes: WorldGraphNode[], edges: WorldGraphEdge[], positions: CodexGraphLayout['positions'], labels: Record<WorldGraphEdgeKind, string>, typeLabels: Record<string, string> = {}, display?: WorldGraphDisplay): string {
  const presentation = display ? { ...DEFAULT_GRAPH_DISPLAY, ...normalizeWorldGraphDisplay(display) } : undefined;
  const size = WORLD_GRAPH_CARD_SIZE[presentation?.nodeSize ?? 'medium'];
  const areas = presentation?.typeAreas ? worldGraphTypeAreas(nodes, positions, presentation.nodeSize) : [];
  const areaPoints = areas.flatMap(area => area.points);
  const points = nodes.map(node => positions[node.id] ?? { x: 0, y: 0 });
  const left = Math.min(0, ...points.map(point => point.x), ...areaPoints.map(point => point.x)) - 48, top = Math.min(0, ...points.map(point => point.y), ...areaPoints.map(point => point.y)) - 48;
  const right = Math.max(size.width, ...points.map(point => point.x + size.width), ...areaPoints.map(point => point.x)) + 48, bottom = Math.max(size.height, ...points.map(point => point.y + size.height), ...areaPoints.map(point => point.y)) + 48;
  const drawn = edges.map(edge => {
    const a = positions[edge.source], b = positions[edge.target]; if (!a || !b) return '';
    const color = WORLD_GRAPH_COLORS[edge.kind], forward = a.x <= b.x, x1 = a.x + (forward ? size.width : 0), y1 = a.y + size.height / 2, x2 = b.x + (forward ? 0 : size.width), y2 = b.y + size.height / 2;
    return `<g${presentation ? ` opacity="${presentation.linkOpacity}"` : ''}><title>${xml(`${labels[edge.kind]}${edge.label ? `: ${edge.label}` : ''}`)}</title><path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="2"${edge.directional ? ` marker-end="url(#arrow-${edge.kind})"` : ''}${edge.kind === 'mention' ? ' stroke-dasharray="6 5"' : ''}/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" fill="${color}" font-size="11">${xml(edge.label || labels[edge.kind])}</text></g>`;
  }).join('');
  const cards = nodes.map(node => {
    const point = positions[node.id] ?? { x: 0, y: 0 };
    const titleLength = size.width === 220 ? 26 : Math.floor((size.width - 24) / 7.5);
    return `<g><title>${xml(node.title)}</title><rect x="${point.x}" y="${point.y}" width="${size.width}" height="${size.height}" rx="8" fill="#202223" stroke="#626560"/><text x="${point.x + 12}" y="${point.y + 28}" fill="#eeeae2" font-size="14">${xml(node.title.length > titleLength ? `${node.title.slice(0, titleLength - 1)}…` : node.title)}</text>${presentation?.nodeSize === 'small' ? '' : `<text x="${point.x + 12}" y="${point.y + 53}" fill="#babcb6" font-size="11">${xml(typeLabels[node.type] ?? node.type)}</text>`}</g>`;
  }).join('');
  const regions = areas.map(area => `<g data-world-graph-type-area="${xml(area.type)}"><polygon points="${area.points.map(point => `${point.x},${point.y}`).join(' ')}" fill="${codexTypeColors[area.type]}" fill-opacity="0.08" stroke="${codexTypeColors[area.type]}" stroke-opacity="0.5" stroke-width="1.5" stroke-linejoin="round"/><text x="${area.label.x}" y="${area.label.y}" fill="#babcb6" font-size="12">${xml(typeLabels[area.type] ?? area.type)}</text></g>`).join('');
  const arrows = Object.entries(WORLD_GRAPH_COLORS).map(([kind, color]) => `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${right - left}" height="${bottom - top}" viewBox="${left} ${top} ${right - left} ${bottom - top}" font-family="Arial,sans-serif"><defs>${arrows}</defs><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="#17191a"/>${regions}${drawn}${cards}</svg>`;
}
