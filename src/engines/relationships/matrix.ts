import type { Relationship } from './types';

/** Direction belongs to the relationship, never to whether a pair is visible. */
export function relationshipPairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

export function indexRelationships(rows: Relationship[]): Map<string, Relationship[]> {
  const result = new Map<string, Relationship[]>();
  for (const row of rows) {
    const key = relationshipPairKey(row.entityAId, row.entityBId);
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  // Typing in one relation must not reorder the pair picker below the pointer.
  for (const group of result.values()) group.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return result;
}
