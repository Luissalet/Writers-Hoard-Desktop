// Groups on a relationship tree (a house, a faction, a company) and how the
// names of the relationships are shown. Pure: the editor, the SVG export and
// the bridge all use these.
import type { RelationTreeDocument } from './relationTrees';

export interface RelationTreeGroup {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  nodeIds: string[];
}
export type RelationLabelMode = 'always' | 'hover' | 'hidden';
export const RELATION_LABEL_MODES: readonly RelationLabelMode[] = ['always', 'hover', 'hidden'];
export const MAX_TREE_GROUPS = 40;
export const TREE_GROUP_COLORS = ['#c0504d', '#e08a3c', '#d5b575', '#6aa84f', '#3d85c6', '#8e7cc3', '#c27ba0', '#7f8c8d'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

export function groupIssues(groups: unknown, nodeIds: ReadonlySet<string>): string[] {
  if (groups === undefined) return [];
  if (!Array.isArray(groups) || groups.length > MAX_TREE_GROUPS) return ['invalid_group'];
  const ids = new Set<string>(), issues: string[] = [];
  for (const group of groups as RelationTreeGroup[]) {
    if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 60 || typeof group.color !== 'string' || !HEX.test(group.color) || !Array.isArray(group.nodeIds) || new Set(group.nodeIds).size !== group.nodeIds.length || group.nodeIds.some(id => !nodeIds.has(id))) issues.push('invalid_group');
    if (group?.id) ids.add(group.id);
  }
  return issues;
}

/** Add or replace a group; a person is in one group at most, so members leave any other. */
export function setTreeGroup(tree: RelationTreeDocument, group: RelationTreeGroup): RelationTreeDocument {
  const members = new Set(group.nodeIds);
  const others = (tree.groups ?? []).filter(item => item.id !== group.id).map(item => ({ ...item, nodeIds: item.nodeIds.filter(id => !members.has(id)) }));
  const existing = (tree.groups ?? []).findIndex(item => item.id === group.id);
  const clean = { ...group, color: group.color.toLowerCase(), nodeIds: [...members] };
  const groups = existing >= 0 ? (tree.groups ?? []).map(item => item.id === group.id ? clean : others.find(other => other.id === item.id)!) : [...others, clean];
  return { ...tree, groups };
}
export function removeTreeGroup(tree: RelationTreeDocument, id: string): RelationTreeDocument {
  const groups = (tree.groups ?? []).filter(item => item.id !== id);
  return { ...tree, groups: groups.length ? groups : undefined };
}
/** Move one person into a group (or out of all with null). */
export function placeInTreeGroup(tree: RelationTreeDocument, nodeId: string, groupId: string | null): RelationTreeDocument {
  const groups = (tree.groups ?? []).map(item => ({ ...item, nodeIds: item.id === groupId ? [...new Set([...item.nodeIds, nodeId])] : item.nodeIds.filter(id => id !== nodeId) }));
  return { ...tree, groups: groups.length ? groups : undefined };
}
/** Members gone from the tree leave their groups. */
export function pruneTreeGroups(tree: RelationTreeDocument): RelationTreeDocument {
  if (!tree.groups) return tree;
  const ids = new Set(tree.nodes.map(node => node.id));
  return { ...tree, groups: tree.groups.map(item => ({ ...item, nodeIds: item.nodeIds.filter(id => ids.has(id)) })) };
}
export function groupOf(tree: RelationTreeDocument, nodeId: string): RelationTreeGroup | undefined {
  return tree.groups?.find(item => item.nodeIds.includes(nodeId));
}
/** The box drawn round a group's members (nodes 200×75 unless measured), with room for the name. */
export function groupBox(tree: RelationTreeDocument, group: RelationTreeGroup, sizes: Readonly<Record<string, { width: number; height: number }>> = {}): { x: number; y: number; width: number; height: number } | null {
  const members = tree.nodes.filter(node => group.nodeIds.includes(node.id));
  if (!members.length) return null;
  const pad = 16, top = 22;
  const x0 = Math.min(...members.map(node => node.position.x)) - pad;
  const y0 = Math.min(...members.map(node => node.position.y)) - pad - top;
  const x1 = Math.max(...members.map(node => node.position.x + (sizes[node.id]?.width ?? 200))) + pad;
  const y1 = Math.max(...members.map(node => node.position.y + (sizes[node.id]?.height ?? 75))) + pad;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
