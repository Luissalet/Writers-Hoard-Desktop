// ============================================
// World Generator — the worlds currently open in a view
// ============================================
//
// An open `WorldView` reads its stored edit list ONCE and then owns it: every
// stroke appends to its `PaintSession` and a debounced save writes the whole
// list back. Anyone else writing that row while the view is open loses the race
// — the view's next save overwrites it, and the view never sees the change.
//
// So there is exactly ONE writer at a time. While a view has the world open it
// registers here, and an external writer (the AI bridge, the copilot) hands its
// edits TO the view, which appends them like a brush stroke and saves as it
// always does. When no view is open, the external writer appends to the row
// itself. `snapshot()` returns the view's live list so an audit entry records
// what the world looked like immediately before the change, unsaved strokes
// included.
//
// Pure module: no React, no Dexie, importable from the view and the bridge.

import type { WorldEdit } from './edits';

export interface LiveWorldHandle {
  /** Append edits as one step, exactly as a paint gesture would. */
  apply: (edits: WorldEdit[]) => void;
  /** The current edit list, serialised (what a save would write right now). */
  snapshot: () => string;
}

const live = new Map<string, LiveWorldHandle>();

/** Called by a view once its PaintSession exists; returns the unregister function. */
export function registerLiveWorld(worldId: string, handle: LiveWorldHandle): () => void {
  live.set(worldId, handle);
  return () => {
    if (live.get(worldId) === handle) live.delete(worldId);
  };
}

/** The open view for this world, if any. */
export function liveWorld(worldId: string): LiveWorldHandle | undefined {
  return live.get(worldId);
}
