import { useState } from 'react';

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
) {
  const [seed, setSeed] = useState(row);
  const [draft, setDraft] = useState(() => seedFrom(row));
  const changes = changesOf(draft);
  /** Save would write something other than what is stored. */
  const dirty = !same(changes, row);
  if (seed.id !== row.id) {
    setSeed(row);
    setDraft(seedFrom(row));
  } else if (seed.updatedAt !== row.updatedAt) {
    setSeed(row);
    setDraft(mergeDraft(draft, seedFrom(seed), seedFrom(row)));
  }
  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));
  return { draft, patch, changes, dirty };
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
