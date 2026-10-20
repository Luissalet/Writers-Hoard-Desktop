/** Shared local geometry for generic charts and RPG trait comparisons. */
export function radarCoordinate(index: number, count: number, fraction: number, centerX: number, centerY: number, radius: number): { x: number; y: number } {
  const angle = index / Math.max(1, count) * Math.PI * 2 - Math.PI / 2;
  return { x: centerX + Math.cos(angle) * radius * fraction, y: centerY + Math.sin(angle) * radius * fraction };
}
