// The "pick on the map" message between the map, the engine and the place
// editor: a one-shot delivery of coordinates into a draft. Not a component
// file, so react-refresh leaves the editor alone.

export interface PickKey {
  placeId: string;
  seq: number;
}

let pickSeq = 0;

/** A sequence number no earlier pick of this session has used, whichever engine mount issued it. */
export function nextPickSeq(): number {
  pickSeq += 1;
  return pickSeq;
}

/**
 * Picks already applied to a draft, by place and `seq`. Recording the
 * consumption in the editor's own state was not enough: an editor that
 * unmounts (the selection cleared) and mounts again for the same place
 * started with no memory and applied the pick again, over a value the writer
 * had corrected by hand meanwhile. Bounded: a session does not pick
 * thousands of coordinates.
 */
const consumedPicks = new Set<string>();
const CONSUMED_PICKS_LIMIT = 500;

/** True the first time this pick is seen; false for every later sighting. */
export function consumePick(pick: PickKey): boolean {
  const key = `${pick.placeId}:${pick.seq}`;
  if (consumedPicks.has(key)) return false;
  if (consumedPicks.size >= CONSUMED_PICKS_LIMIT) consumedPicks.clear();
  consumedPicks.add(key);
  return true;
}
