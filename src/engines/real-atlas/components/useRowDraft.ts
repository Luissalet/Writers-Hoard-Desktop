import { useState } from 'react';

/**
 * A form-shaped copy of a stored row, written back only on Save.
 *
 * The entity hooks refetch after every write and on `wh:data-changed`, so the
 * `row` prop is a NEW object on every refresh even when nothing in it changed;
 * re-seeding from it each time would wipe whatever the author is typing. The
 * draft is therefore re-seeded only when the row's identity changes, or when its
 * `updatedAt` moved and either the draft already matches the row (our own Save
 * just landed) or nothing was typed since the last seed (the bridge or an undo
 * wrote it, and nothing here would be lost). A draft with typed work in it
 * survives external writes until the author saves or reverts. Render-adjust
 * rather than an effect: the compiler rule forbids the effect form, and this
 * way the first render after a switch is already right.
 */
export function useRowDraft<Row extends { id: string; updatedAt: number }, Draft>(
  row: Row,
  seedFrom: (row: Row) => Draft,
  changesOf: (draft: Draft) => Partial<Row>,
) {
  const [seed, setSeed] = useState(row);
  const [draft, setDraft] = useState(() => seedFrom(row));
  const changes = changesOf(draft);
  /** Save would write something other than what is stored. */
  const dirty = !same(changes, row);
  /** The author typed since the seed — compared normalised, so an untidy stored value does not count as typing. */
  const touched = !same(changes, changesOf(seedFrom(seed)));
  if (seed.id !== row.id || (seed.updatedAt !== row.updatedAt && (!dirty || !touched))) {
    setSeed(row);
    setDraft(seedFrom(row));
  }
  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));
  return { draft, patch, changes, dirty };
}

/**
 * Field-wise equality of what Save WOULD write — not of the raw draft: "a\n\nb"
 * in the sources box and the stored ['a', 'b'] are the same thing, and a Save
 * button that stays lit after saving reads as a save that did not take.
 */
function same<Row>(changes: Partial<Row>, against: Partial<Row>): boolean {
  return (Object.keys(changes) as (keyof Row)[]).every((key) => {
    const next = changes[key];
    const current = against[key];
    if (Array.isArray(next) && Array.isArray(current)) {
      return next.length === current.length && next.every((value, i) => value === current[i]);
    }
    return next === current;
  });
}
