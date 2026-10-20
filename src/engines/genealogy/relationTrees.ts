import { applyGenealogy } from './genealogyOps';
import { buildGenealogyTree } from './tree';
import { layoutGenealogyTree } from './layout';
import type { GenealogyLink, GenealogyLinkKind } from './validate';
import { annotationIssues, annotationLines, annotationPolyline, type RelationTreeAnnotation } from './relationTreeAnnotations';
import { edgePathIds, relationTreeSegments, treeEdgeLabelPosition, type RelationTreeJunction } from './relationTreeRoutes';
import { isRelationIcon, relationIconSvg } from './relationIcons';

export interface RelationTreeNode {
  id: string;
  label: string;
  codexEntryId?: string;
  position: { x: number; y: number };
  deceased?: boolean;
}
export interface RelationTreeEdge {
  id: string;
  source: string;
  target: string;
  kind: 'biological_parent' | 'adoptive_parent' | 'guardian' | 'partner' | 'custom';
  label?: string;
  style: 'solid' | 'dashed' | 'dotted';
  sourceHandle?: string;
  targetHandle?: string;
  icon?: string;
  via?: string[];
}
export interface RelationTreeDocument {
  id: string;
  title: string;
  nodes: RelationTreeNode[];
  edges: RelationTreeEdge[];
  annotations?: RelationTreeAnnotation[];
  junctions?: RelationTreeJunction[];
  viewport?: { x: number; y: number; zoom: number };
  copiedFrom?: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export const TREE_KINDS = ['biological_parent', 'adoptive_parent', 'guardian', 'partner', 'custom'] as const;
const STYLES = new Set(['solid', 'dashed', 'dotted']);
const HANDLES = new Set(['top', 'bottom', 'left', 'right']);
export class RelationTreeValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) { super(issues.join('\n')); this.issues = issues; this.name = 'RelationTreeValidationError'; }
}

/** Parent cycles use the existing canonical genealogy validator; custom relations may cycle. */
export function validateRelationTree(tree: RelationTreeDocument): void {
  const issues: string[] = [];
  if (!tree.id || typeof tree.id !== 'string' || !tree.title?.trim()) issues.push('invalid_title');
  const nodeIds = new Set<string>();
  for (const node of tree.nodes) {
    if (!node.id || nodeIds.has(node.id)) issues.push('duplicate_node');
    nodeIds.add(node.id);
    if (!node.label?.trim() && !node.codexEntryId) issues.push('empty_node');
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) issues.push('invalid_position');
  }
  const junctionIds = new Set<string>();
  if (tree.junctions !== undefined && (!Array.isArray(tree.junctions) || tree.junctions.length > 1000)) issues.push('invalid_junction');
  for (const junction of Array.isArray(tree.junctions) ? tree.junctions : []) {
    if (!junction || !junction.id || typeof junction.id !== 'string' || nodeIds.has(junction.id) || junctionIds.has(junction.id)) issues.push('duplicate_junction');
    if (!junction?.position || !Number.isFinite(junction.position.x) || !Number.isFinite(junction.position.y) || Math.abs(junction.position.x) > 1e7 || Math.abs(junction.position.y) > 1e7) issues.push('invalid_junction');
    if (junction?.id) { junctionIds.add(junction.id); nodeIds.add(junction.id); }
  }
  const edgeIds = new Set<string>();
  issues.push(...annotationIssues(tree.annotations, nodeIds));
  for (const edge of tree.edges) {
    if (!edge.id || edgeIds.has(edge.id)) issues.push('duplicate_edge');
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) issues.push('missing_ref');
    if (!TREE_KINDS.includes(edge.kind)) issues.push('unknown_kind');
    if (!STYLES.has(edge.style)) issues.push('invalid_style');
    if ((edge.sourceHandle && !HANDLES.has(edge.sourceHandle)) || (edge.targetHandle && !HANDLES.has(edge.targetHandle))) issues.push('invalid_handle');
    if (edge.icon !== undefined && !isRelationIcon(edge.icon)) issues.push('invalid_icon');
    if (edge.via !== undefined && (!Array.isArray(edge.via) || edge.via.length > 100 || new Set(edge.via).size !== edge.via.length || edge.via.some(id => !junctionIds.has(id) || id === edge.source || id === edge.target))) issues.push('invalid_route');
    if (edge.source === edge.target && edge.kind !== 'custom') issues.push('self_link');
  }
  if (tree.viewport && (!Number.isFinite(tree.viewport.x) || !Number.isFinite(tree.viewport.y) || !Number.isFinite(tree.viewport.zoom) || tree.viewport.zoom < 0.1 || tree.viewport.zoom > 4)) issues.push('invalid_viewport');
  const typed: GenealogyLink[] = tree.edges.filter(edge => edge.kind !== 'custom').flatMap(edge => { const path = edgePathIds(edge); return path.slice(0, -1).map((from, index) => ({ id: JSON.stringify([edge.id, index]), from, to: path[index + 1], kind: edge.kind as GenealogyLinkKind, label: edge.label })); });
  const result = applyGenealogy([...nodeIds].map(id => ({ id })), [], typed, 'relation-tree-validation');
  issues.push(...result.rejected.flatMap(rejected => rejected.issues.map(issue => issue.code)));
  if (issues.length) throw new RelationTreeValidationError([...new Set(issues)]);
}

export function layoutRelationTree(tree: RelationTreeDocument): RelationTreeDocument {
  const typed = relationTreeSegments(tree).filter(edge => edge.kind !== 'custom').map(edge => ({ id: edge.id, from: edge.source, to: edge.target, kind: edge.kind as GenealogyLinkKind }));
  const layout = layoutGenealogyTree(buildGenealogyTree([...tree.nodes.map(node => ({ id: node.id, name: node.label })), ...(tree.junctions ?? []).map(node => ({ id: node.id, name: '' }))], typed));
  return { ...tree, junctions: tree.junctions?.map(junction => { const point = layout.positions.get(junction.id); return point ? { ...junction, position: { x: point.col * 250 + 92, y: point.row * 165 + 30 } } : junction; }), nodes: tree.nodes.map((node, index) => {
    const point = layout.positions.get(node.id);
    return { ...node, position: point ? { x: point.col * 250, y: point.row * 165 } : { x: index * 250, y: 0 } };
  }) };
}

export function copyCanonicalTree(id: string, title: string, characters: readonly { id: string; title: string }[], links: readonly GenealogyLink[], now: number): RelationTreeDocument {
  const nodes = characters.map(character => ({ id: `${id}:${character.id}`, label: character.title, codexEntryId: character.id, position: { x: 0, y: 0 } }));
  const byCharacter = new Map(nodes.map(node => [node.codexEntryId, node.id]));
  const edges = links.filter(link => byCharacter.has(link.from) && byCharacter.has(link.to)).map(link => ({ id: `${id}:${link.id}`, source: byCharacter.get(link.from)!, target: byCharacter.get(link.to)!, kind: link.kind, label: link.label, style: 'solid' as const }));
  return layoutRelationTree({ id, title, nodes, edges, copiedFrom: 'canonical', revision: 0, createdAt: now, updatedAt: now });
}

export function duplicateRelationTree(tree: RelationTreeDocument, id: string, title: string, now: number): RelationTreeDocument {
  const copy = structuredClone(tree);
  return { ...copy, id, title, copiedFrom: tree.id, revision: 0, createdAt: now, updatedAt: now };
}

/** Local SVG export preserves authored positions and escapes all author text. */
export function exportRelationTreeSvg(tree: RelationTreeDocument, names: ReadonlyMap<string, string> = new Map()): string {
  validateRelationTree(tree);
  const esc = (value: string) => Array.from(value).filter(char => { const code = char.codePointAt(0)!; return (code >= 32 || [9, 10, 13].includes(code)) && code !== 65534 && code !== 65535; }).join('').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const nodes = new Map<string, { position: { x: number; y: number }; width: number; height: number }>([...tree.nodes.map(node => [node.id, { position: node.position, width: 200, height: 75 }] as const), ...(tree.junctions ?? []).map(node => [node.id, { position: node.position, width: 16, height: 16 }] as const)]);
  const annotations = tree.annotations ?? [];
  const x0 = Math.min(0, ...[...nodes.values()].map(node => node.position.x), ...annotations.map(item => item.position.x)) - 50;
  const y0 = Math.min(0, ...[...nodes.values()].map(node => node.position.y), ...annotations.map(item => item.position.y)) - 50;
  const x1 = Math.max(250, ...[...nodes.values()].map(node => node.position.x + node.width), ...annotations.map(item => item.position.x + item.size.width)) + 50;
  const y1 = Math.max(100, ...[...nodes.values()].map(node => node.position.y + node.height), ...annotations.map(item => item.position.y + item.size.height)) + 50;
  const drawings = annotations.map(item => item.kind === 'stroke'
    ? `<g transform="translate(${item.position.x} ${item.position.y})"><polyline points="${annotationPolyline(item)}" fill="none" stroke="${item.color}" stroke-width="${item.width}" stroke-linecap="round" stroke-linejoin="round"/></g>`
    : `<svg x="${item.position.x}" y="${item.position.y}" width="${item.size.width}" height="${item.size.height}" overflow="hidden"><title>${esc(item.text)}</title><text x="8" y="${item.fontSize + 4}" fill="${item.color}" font-size="${item.fontSize}" xml:space="preserve">${annotationLines(item).map((line, lineIndex) => `<tspan x="8" dy="${lineIndex ? item.fontSize * 1.3 : 0}">${esc(line)}</tspan>`).join('')}</text></svg>`).join('');
  const edges = relationTreeSegments(tree).map(edge => {
    const from = nodes.get(edge.source)!, to = nodes.get(edge.target)!;
    const anchor = (node: typeof from, side: string) => ({ x: node.position.x + (side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2), y: node.position.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2) });
    const sourceSide = edge.sourceHandle ?? 'bottom', targetSide = edge.targetHandle ?? 'top';
    const a = anchor(from, sourceSide), b = anchor(to, targetSide), x = a.x, y = a.y, tx = b.x, ty = b.y;
    const offset = Math.min(60, Math.hypot(tx - x, ty - y) / 2);
    const tangent = (point: typeof a, side: string) => ({ x: point.x + (side === 'left' ? -offset : side === 'right' ? offset : 0), y: point.y + (side === 'top' ? -offset : side === 'bottom' ? offset : 0) });
    const c1 = tangent(a, sourceSide), c2 = tangent(b, targetSide);
    const dash = edge.style === 'dashed' ? '8 5' : edge.style === 'dotted' ? '2 5' : '';
    const label = edge.segmentIndex ? '' : edge.label || edge.kind;
    const labelPoint = treeEdgeLabelPosition(tree, tree.edges.find(item => item.id === edge.logicalId)!) ?? { x: (x + tx) / 2, y: (y + ty) / 2 - 8 };
    return `<g><path d="M${x} ${y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${tx} ${ty}" fill="none" stroke="#716650" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}${edge.last && edge.kind.endsWith('_parent') ? ' marker-end="url(#arrow)"' : ''}/>${relationIconSvg(edge.icon, labelPoint.x - 9, labelPoint.y - 25)}${label ? `<text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" font-size="12">${esc(label)}</text>` : ''}</g>`;
  }).join('');
  const cards = tree.nodes.map(node => {
    const label = node.codexEntryId ? names.get(node.codexEntryId) ?? node.label : node.label;
    return `<g transform="translate(${node.position.x} ${node.position.y})"><rect width="200" height="75" rx="8" fill="${node.deceased ? '#e4e1db' : '#faf8f2'}" stroke="#716650"/><text x="12" y="30" font-size="14"${node.deceased ? ' text-decoration="line-through"' : ''}>${esc(label.length > 26 ? `${label.slice(0, 25)}…` : label)}</text>${node.deceased ? '<path d="M180 12V34M172 20H188" stroke="#716650" stroke-width="2"/>' : ''}<title>${esc(label)}</title></g>`;
  }).join('');
  const points = (tree.junctions ?? []).map(point => `<circle cx="${point.position.x + 8}" cy="${point.position.y + 8}" r="6" stroke="#716650" stroke-width="2" fill="white"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${x1 - x0}" height="${y1 - y0}"><title>${esc(tree.title)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#716650"/></marker></defs><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="white"/><g fill="#242d36" font-family="system-ui,sans-serif">${drawings}${edges}${cards}${points}</g></svg>`;
}
