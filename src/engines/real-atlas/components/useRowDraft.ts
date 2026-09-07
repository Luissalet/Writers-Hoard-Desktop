import { useState } from 'react';

/** Engine-owned drafts survive selection changes and map/editor tab switches. */
export type RowDraftStore = Map<string, { seed: { id: string; updatedAt: number }; draft: object }>;

export function isRowDraftSnapshot(value: unknown): value is { seed: { id: string; updatedAt: number }; draft: object } {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as { seed?: Record<string, unknown>; draft?: Record<string, unknown> };
  if (!snapshot.seed || typeof snapshot.seed.id !== 'string' || typeof snapshot.seed.updatedAt !== 'number' || !snapshot.draft) return false;
  // Mandatory collection fields are consumed by each editor when seeding a row.
  const strings = (keys: string[]) => keys.every((key) => typeof snapshot.draft![key] === 'string');
  return Array.isArray(snapshot.seed.tags) && Array.isArray(snapshot.draft.tags)
    && (typeof snapshot.seed.name === 'string'
      ? Array.isArray(snapshot.seed.aliases) && Array.isArray(snapshot.seed.sources)
        && Array.isArray(snapshot.draft.aliases) && typeof snapshot.draft.fictional === 'boolean'
        && strings(['name', 'kind', 'country', 'address', 'lat', 'lon', 'parentId', 'era', 'description', 'realNotes', 'sources'])
      : typeof snapshot.seed.title === 'string' && strings(['title', 'category', 'placeId', 'reality', 'fiction', 'reason', 'since']));
}

/**
 * A form-shaped copy of a stored row, written back only on Save.
 *
 * The entity hooks refetch after every write and on `wh:data-changed`, so the
 * `row` prop is a NEW object on every refresh even when nothing in it changed;
 * re-seeding from it each time would wipe whatever the author is typing. The
 * draft is therefore re-seeded only when the row's identity changes, and MERGED
 * when its `updatedAt` moved: every field the author has not touched since the
 * last seed takes the row's new value, every field they have keeps theirs. That
 * is what lets a pin dragged on the map land in an editor with a half-typed
 * description — the old rule kept the whole stale draft as soon as anything was
 * typed, and the next Save quietly put the pin back. Render-adjust rather than
 * an effect: the compiler rule forbids the effect form, and this way the first
 * render after a switch is already right.
 */
export function useRowDraft<Row extends { id: string; updatedAt: number }, Draft extends object>(
  row: Row,
  seedFrom: (row: Row) => Draft,
  changesOf: (draft: Draft) => Partial<Row>,
  store?: RowDraftStore,
) {
  const [seed, setSeed] = useState(() => (store?.get(row.id)?.seed as Row | undefined) ?? row);
  const [draft, setDraft] = useState(() => (store?.get(row.id)?.draft as Draft | undefined) ?? seedFrom(row));
  const changes = changesOf(draft);
  /** Save would write something other than what is stored. */
  const dirty = !same(changes, row);
  if (seed.id !== row.id) {
    const cached = store?.get(row.id);
    setSeed((cached?.seed as Row | undefined) ?? row);
    setDraft(cached ? mergeDraft(cached.draft as Draft, seedFrom(cached.seed as Row), seedFrom(row)) : seedFrom(row));
  } else if (seed.updatedAt !== row.updatedAt) {
    setSeed(row);
    setDraft(mergeDraft(draft, seedFrom(seed), seedFrom(row)));
  }
  const patch = (partial: Partial<Draft>) => {
    const next = { ...draft, ...partial };
    store?.set(row.id, { seed, draft: next });
    setDraft(next);
  };
  const storedSnapshot = store?.get(row.id);
  const acknowledge = () => {
    // A slow successful save may not discard a newer edit made in the meantime.
    if (storedSnapshot && store?.get(row.id) === storedSnapshot) store.delete(row.id);
  };
  return { draft, patch, changes, dirty, acknowledge };
}

/**
 * Field by field: what the draft still holds from the previous seed is
 * replaced by the new seed's value; what the author changed stays. A field
 * they changed to exactly what the row now says is "theirs" as well, which
 * makes no difference to the result.
 */
export function mergeDraft<Draft extends object>(draft: Draft, previous: Draft, next: Draft): Draft {
  const merged = { ...draft };
  for (const key of Object.keys(next) as (keyof Draft)[]) {
    if (equalValue(draft[key], previous[key])) merged[key] = next[key];
  }
  return merged;
}

function equalValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  return a === b;
}

/**
 * Field-wise equality of what Save WOULD write — not of the raw draft: "a\n\nb"
 * in the sources box and the stored ['a', 'b'] are the same thing, and a Save
 * button that stays lit after saving reads as a save that did not take.
 */
function same<Row>(changes: Partial<Row>, against: Partial<Row>): boolean {
  return (Object.keys(changes) as (keyof Row)[]).every((key) => equalValue(changes[key], against[key]));
}
