import type { RelationTreeDocument, RelationTreeEdge } from './relationTrees';

export interface RelationTreeJunction { id: string; position: { x: number; y: number } }
export const edgePathIds = (edge: RelationTreeEdge): string[] => [edge.source, ...(Array.isArray(edge.via) ? edge.via : []), edge.target];
export interface RelationTreeSegment extends RelationTreeEdge { logicalId: string; segmentIndex: number; last: boolean }
function centerFor(tree: RelationTreeDocument, id: string): { x: number; y: number } | undefined {
  const person = tree.nodes.find(node => node.id === id);
  if (person) return { x: person.position.x + 100, y: person.position.y + 37.5 };
  const junction = tree.junctions?.find(node => node.id === id);
  return junction ? { x: junction.position.x + 8, y: junction.position.y + 8 } : undefined;
}
export function treeEdgeLabelPosition(tree: RelationTreeDocument, edge: RelationTreeEdge): { x: number; y: number } | undefined {
  const point = edge.via?.[0] ? centerFor(tree, edge.via[0]) : undefined;
  const a = centerFor(tree, edge.source), b = centerFor(tree, edge.target);
  if (!point || !a || !b) return undefined;
  return { x: point.x, y: Math.abs(a.y - b.y) < 100 ? Math.min(a.y, b.y) - 60 : point.y - 24 };
}
/** Display segments share one stored relationship, so adding a point never duplicates its metadata. */
export function relationTreeSegments(tree: RelationTreeDocument): RelationTreeSegment[] {
  const occupied = new Set(tree.edges.map(edge => edge.id));
  const towards = (from: string, to: string) => {
    const a = centerFor(tree, from), b = centerFor(tree, to);
    if (!a || !b) return 'bottom';
    return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? b.x >= a.x ? 'right' : 'left' : b.y >= a.y ? 'bottom' : 'top';
  };
  return tree.edges.flatMap(edge => {
    const path = edgePathIds(edge);
    return path.slice(0, -1).map((source, index) => {
      let id = edge.id;
      if (index) { id = `segment:${JSON.stringify([edge.id, index])}`; while (occupied.has(id)) id = '_' + id; occupied.add(id); }
      return { ...edge, id, logicalId: edge.id, segmentIndex: index, source, target: path[index + 1], sourceHandle: index ? towards(source, path[index + 1]) : edge.sourceHandle, targetHandle: index === path.length - 2 ? edge.targetHandle : towards(path[index + 1], source), label: index ? undefined : edge.label, icon: index ? undefined : edge.icon, via: undefined, last: index === path.length - 2 };
    });
  });
}

/** Insertion preserves the logical relationship's id, endpoints, kind, label and icon. */
export function insertTreeJunction(tree: RelationTreeDocument, edgeId: string, id: string, requestedSegment = 0): RelationTreeDocument {
  const edge = tree.edges.find(item => item.id === edgeId);
  if (!edge || (tree.junctions?.length ?? 0) >= 1000) throw new Error('invalid_junction');
  const path = edgePathIds(edge), segment = Math.max(0, Math.min(path.length - 2, requestedSegment));
  const center = (nodeId: string) => {
    const person = tree.nodes.find(node => node.id === nodeId);
    if (person) return { x: person.position.x + 100, y: person.position.y + 37.5 };
    const junction = tree.junctions?.find(node => node.id === nodeId);
    if (!junction) throw new Error('missing_junction_endpoint');
    return { x: junction.position.x + 8, y: junction.position.y + 8 };
  };
  const a = center(path[segment]), b = center(path[segment + 1]), via = [...(edge.via ?? [])]; via.splice(segment, 0, id);
  return { ...tree, junctions: [...(tree.junctions ?? []), { id, position: { x: (a.x + b.x) / 2 - 8, y: (a.y + b.y) / 2 - 8 } }], edges: tree.edges.map(item => item.id === edge.id ? { ...item, via } : item) };
}

/** Removing a visual waypoint straightens routed relationships and removes its attached branches. */
export function removeTreeJunction(tree: RelationTreeDocument, id: string): RelationTreeDocument {
  return { ...tree, junctions: tree.junctions?.filter(point => point.id !== id), edges: tree.edges.filter(edge => edge.source !== id && edge.target !== id).map(edge => edge.via?.includes(id) ? { ...edge, via: edge.via.filter(point => point !== id) } : edge) };
}
