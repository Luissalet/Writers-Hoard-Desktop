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
import { captureEnvironment, restoreEnvironment, getRecalculationCheckpoint, installRecalculationCheckpoints, type EnvironmentFields } from './recalculate';

interface Snapshot {
  elevation: Float32Array;
  environment: EnvironmentFields;
}

export class PaintSession {
  private pristine: Snapshot;
  private undone: WorldEdit[][] = [];
  edits: WorldEdit[] = [];
  /**
   * How many edits each undo step covers.
   *
   * One brush stroke is one step even when symmetry makes it four edits, because
   * a reader who pressed the button once expects one Ctrl+Z to take it back.
   * Sizes, not identifiers: the list itself stays plain JSON with nothing extra
   * in it, so a saved world is exactly what it was.
   */
  private groups: number[] = [];

  private world: WorldData;

  /**
   * The elevation as generated, before any edit. The canonical tiles amplify
   * THIS and re-run the edit list at their own resolution; handing them the
   * edited field instead would apply every stroke twice. Read-only by
   * convention — it is the same buffer replay() restores from.
   */
  get pristineElevation(): Float32Array {
    return this.pristine.elevation;
  }

  /** Read-only source, like pristineElevation. Worker postMessage clones it once. */
  get pristineWorld(): WorldData {
    return { ...this.world, ...this.pristine.environment, elevation: this.pristine.elevation, painted: undefined };
  }

  get undoEdits(): WorldEdit[] {
    const count = this.groups.at(-1) ?? (this.edits.length ? 1 : 0);
    return this.edits.slice(0, this.edits.length - count);
  }

  get redoEdits(): WorldEdit[] { return [...this.edits, ...(this.undone.at(-1) ?? [])]; }

  // Explicit field, not a constructor parameter property: the project builds
  // with `erasableSyntaxOnly`.
  constructor(world: WorldData, edits: WorldEdit[] = []) {
    this.world = world;
    this.pristine = {
      elevation: Float32Array.from(world.elevation),
      environment: captureEnvironment(world),
    };
    if (edits.length) {
      this.edits = edits.slice();
      this.groups = edits.map(() => 1);
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
    this.pushMany([edit]);
  }

  /**
   * Add several edits as one step.
   *
   * A symmetric brush stroke is genuinely several edits — one per mirror — and
   * pushing them one at a time would replay the whole list once per arm and, worse,
   * leave undo unpicking a single gesture in pieces.
   */
  pushMany(edits: WorldEdit[]): void {
    if (!edits.length) return;
    // Match saved precision immediately so an explicit derivation reopens bit-for-bit.
    this.edits.push(...deserializeEdits(serializeEdits(edits)));
    this.groups.push(edits.length);
    this.undone.length = 0;
    this.replay();
  }

  /** Adopt only the matching revision. Owned worker results can be consumed without another full-grid copy. */
  pushRecalculation(environment: EnvironmentFields, expectedRevision: number, takeOwnership = false): boolean {
    if ((this.world.revision ?? 0) !== expectedRevision) return false;
    const edit: WorldEdit = { kind: 'recalculate', version: 1 };
    installRecalculationCheckpoints(this.world, [{
      key: serializeEdits([...this.edits, edit]), elevation: this.world.elevation.slice(), environment: takeOwnership ? environment : captureEnvironment(environment),
    }]);
    this.push(edit);
    return true;
  }

  undo(): void {
    const n = this.groups.pop() ?? (this.edits.length ? 1 : 0);
    if (!n) return;
    const group = this.edits.splice(this.edits.length - n, n);
    if (!group.length) return;
    this.undone.push(group);
    this.replay();
  }

  redo(): void {
    const group = this.undone.pop();
    if (!group) return;
    this.edits.push(...group);
    this.groups.push(group.length);
    this.replay();
  }

  /** Throw everything away and go back to the generated world. */
  clear(): void {
    this.edits.length = 0;
    this.groups.length = 0;
    this.undone.length = 0;
    this.replay();
  }

  /**
   * Replace the whole list, e.g. when loading a saved world.
   *
   * Grouping is not stored — it is a fact about the session, not about the world —
   * so a reopened world undoes one edit at a time.
   */
  load(json: string): void {
    this.edits = deserializeEdits(json);
    this.groups = this.edits.map(() => 1);
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
      environment: captureEnvironment(world),
    };
    this.replay();
  }

  private replay(): void {
    // applyEdits restores its newest cached prefix directly. Restoring the
    // pristine grids first would write ~84 MiB that is immediately overwritten.
    let hasCheckpoint = false;
    for (let index = this.edits.length - 1; index >= 0; index--) {
      if (this.edits[index].kind === 'recalculate' && getRecalculationCheckpoint(this.world, serializeEdits(this.edits.slice(0, index + 1)))) { hasCheckpoint = true; break; }
    }
    if (!hasCheckpoint) {
      this.world.elevation.set(this.pristine.elevation);
      restoreEnvironment(this.world, this.pristine.environment);
    }
    this.world.painted = undefined;
    // Bump even on an empty list: the caches must let go of the painted state.
    this.world.revision = (this.world.revision ?? 0) + 1;
    if (this.edits.length) applyEdits(this.world, this.edits);
  }
}
