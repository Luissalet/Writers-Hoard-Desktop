// A fingerprint of what a write left behind, kept in its audit line. Undoing
// the line puts the old state back; if the state is no longer the one the
// write left (the user or another call changed it since) that would silently
// throw their later work away, so the undo refuses instead.

/** JSON with sorted keys, so the same data always gives the same text. */
export function stableText(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableText(record[key])}`).join(',')}}`;
}

/** A short fingerprint (53-bit) of any plain data. */
export function contentStamp(value: unknown): string {
  const text = stableText(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** What an encounter holds apart from its bookkeeping (revision and timestamps move on every save, including an undo). */
export const encounterStamp = (encounter: { revision?: unknown; updatedAt?: unknown; createdAt?: unknown } | null | undefined) => {
  if (!encounter) return contentStamp(null);
  const content: Record<string, unknown> = { ...encounter };
  delete content.revision; delete content.updatedAt; delete content.createdAt;
  return contentStamp(content);
};
/** The recorded stamp of a list's contents without its revision. */
export const todosStamp = (list: { items: unknown }) => contentStamp(list.items);
export const kanbansStamp = (list: { boards: unknown }) => contentStamp(list.boards);
export const soundscapesStamp = (list: { items: unknown }) => contentStamp(list.items);
export const diceStamp = (tray: { log: unknown; formulas: unknown }) => contentStamp({ log: tray.log, formulas: tray.formulas });
export const graphStamp = (settings: { display?: unknown; hiddenIds?: unknown; views?: unknown }) => contentStamp({ display: settings.display ?? null, hiddenIds: settings.hiddenIds ?? [], views: settings.views ?? [] });
