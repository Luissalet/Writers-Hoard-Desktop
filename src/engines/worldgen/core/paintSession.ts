// ============================================
// World Generator — Paint session
// ============================================
// The edit list is the source of truth; this is the object that lets a UI treat
// it like a drawing program.
//
// Two facts shape the whole design:
//
//   1. `applyEdits` MUTATES the world, and terrain ops are not idempotent.
//      Applying the list twice raises the ground twice. So the session keeps a
//      pristine snapshot of the three fields an edit can touch, and every change
//      means "restore and replay", not "add" or "subtract".
//   2. REPLAY IS AFFORDABLE, which is the reason (1) is acceptable. The expensive
//      part of applying edits is not the strokes — those are local — it is the one
//      global pass that re-derives coast distance, relief and the biome
//      classification. That pass runs ONCE per apply regardless of how many
//      strokes it is handed, so replaying fifty strokes costs one global pass plus
//      fifty cheap rasterisations, not fifty global passes.
//
// An earlier version tried to apply each new stroke on its own and only replay on
// undo. It was faster and wrong in two ways at once: a later terrain stroke re-ran
// the biome classifier and erased every biome the reader had painted, and any
// river in the list got its channel carved again on every subsequent apply.

import type { WorldData } from './types';
import { applyEdits, serializeEdits, deserializeEdits, type WorldEdit } from './edits';

interface Snapshot {
  elevation: Float32Array;
  biome: Uint8Array;
  lake: Uint8Array;
}

export class PaintSession {
  private pristine: Snapshot;
  private undone: WorldEdit[] = [];
  edits: WorldEdit[] = [];

  private world: WorldData;

  // Explicit field, not a constructor parameter property: the project builds
  // with `erasableSyntaxOnly`.
  constructor(world: WorldData, edits: WorldEdit[] = []) {
    this.world = world;
    this.pristine = {
      elevation: Float32Array.from(world.elevation),
      biome: Uint8Array.from(world.biome),
      lake: Uint8Array.from(world.lake),
    };
    if (edits.length) {
      this.edits = edits.slice();
      this.replay();
    }
  }

  /** True when the world currently differs from the generated one. */
  get dirty(): boolean {
    return this.edits.length > 0;
  }

  get canUndo(): boolean { return this.edits.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }

  /** Add one edit and bring the world up to date. */
  push(edit: WorldEdit): void {
    this.edits.push(edit);
    this.undone.length = 0;
    this.replay();
  }

  undo(): void {
    const e = this.edits.pop();
    if (!e) return;
    this.undone.push(e);
    this.replay();
  }

  redo(): void {
    const e = this.undone.pop();
    if (!e) return;
    this.edits.push(e);
    this.replay();
  }

  /** Throw everything away and go back to the generated world. */
  clear(): void {
    this.edits.length = 0;
    this.undone.length = 0;
    this.replay();
  }

  /** Replace the whole list, e.g. when loading a saved world. */
  load(json: string): void {
    this.edits = deserializeEdits(json);
    this.undone.length = 0;
    this.replay();
  }

  serialize(): string {
    return serializeEdits(this.edits);
  }

  /**
   * Adopt a regenerated world object under the same edit list.
   *
   * Worlds are stored as seed + params + edits and regenerated on demand, so the
   * object identity changes whenever the reader alters a parameter. The edits
   * survive that; the snapshot must not.
   */
  rebind(world: WorldData): void {
    this.world = world;
    this.pristine = {
      elevation: Float32Array.from(world.elevation),
      biome: Uint8Array.from(world.biome),
      lake: Uint8Array.from(world.lake),
    };
    this.replay();
  }

  private replay(): void {
    this.world.elevation.set(this.pristine.elevation);
    this.world.biome.set(this.pristine.biome);
    this.world.lake.set(this.pristine.lake);
    this.world.painted = undefined;
    // Bump even on an empty list: the caches must let go of the painted state.
    this.world.revision = (this.world.revision ?? 0) + 1;
    if (this.edits.length) applyEdits(this.world, this.edits);
  }
}
