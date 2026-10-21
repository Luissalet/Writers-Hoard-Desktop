/** Recognize only boundaries generated for declared comments in this source. */
export function manuscriptMarkerPattern(prefix: string, commentIds: readonly string[]): RegExp {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!commentIds.length) return /(?!)/g;
  return new RegExp(`${escape(prefix)}(start|end)-(${commentIds.map(escape).join('|')})\\uE001`, 'g');
}
