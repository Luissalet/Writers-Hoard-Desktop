// ============================================================================
// Reference-panel pins — which codex entries the author pinned, per chapter
// ============================================================================
//
// Kept in the browser's localStorage, one key per chapter, because pins are a
// reading convenience and must never touch the chapter row (a write there
// would bump its revision and collide with the autosave).

const PREFIX = 'writers-hoard:reference:pins:';
const EVENT = 'writers-hoard:reference-pins-changed';

export function readPins(writingId: string): string[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + writingId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function setPinned(writingId: string, entryId: string, pinned: boolean): string[] {
  const current = readPins(writingId).filter((id) => id !== entryId);
  const next = pinned ? [...current, entryId] : current;
  try {
    if (next.length) window.localStorage.setItem(PREFIX + writingId, JSON.stringify(next));
    else window.localStorage.removeItem(PREFIX + writingId);
  } catch {
    // A blocked store only forgets the pin.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { writingId } }));
  return next;
}

export function onPinsChanged(listener: (writingId: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ writingId: string }>).detail.writingId);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
