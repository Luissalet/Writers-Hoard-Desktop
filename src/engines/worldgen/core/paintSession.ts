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

import { isViewOnlyEdit } from './storyEvents';
import type { WorldData } from './types';
import { applyEdits, serializeEdits, deserializeEdits, type WorldEdit } from './edits';
import { captureEnvironment, restoreEnvironment, getRecalculationCheckpoint, installRecalculationCheckpoints, type EnvironmentFields } from './recalculate';
import { appendDomainEdits, domainEdits, readDomainDocument, serializeDomainDocument, undoDomainStep, type DomainDocument } from './domainDocument';
import { replayDomain, unprojectDomainEdit } from './domainReplay';
import { domainCanonElevation } from './domainCanon';

interface Snapshot {
  elevation: Float32Array;
  environment: EnvironmentFields;
}

/** True when every edit is for the reader's-eye views only (fog, story events), which the world itself ignores. */
function onlyFog(edits: readonly WorldEdit[]): boolean {
  return edits.length > 0 && edits.every(isViewOnlyEdit);
}

export class PaintSession {
  private domain: DomainDocument | null = null;
  private domainSource: WorldData | null = null;
  private domainBefore: DomainDocument[] = [];
  private domainRedo: DomainDocument[] = [];
  private domainRevision = 0;
  private canonicalBase?: { document: DomainDocument; source: WorldData; elevation: Float32Array };
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
    if (this.domainSource) return this.domainSource.elevation;
    return this.pristine.elevation;
  }

  /** Read-only source, like pristineElevation. Worker postMessage clones it once. */
  get pristineWorld(): WorldData {
    if (this.domainSource) return this.domainSource;
    return { ...this.world, ...this.pristine.environment, elevation: this.pristine.elevation, painted: undefined };
  }

  /** Compatible current geometry plus a pristine geometric elevation base.
   * The regional worker replays physical strokes once, at its own resolution. */
  canonicalSource(): { world: WorldData; edits: string } {
    if (!this.domain || !this.domainSource) return {
      world: this.edits.length ? { ...this.world, elevation: this.pristineElevation } : this.world,
      edits: this.serialize(),
    };
    if (this.canonicalBase?.document !== this.domain || this.canonicalBase.source !== this.domainSource) {
      this.canonicalBase = { document: this.domain, source: this.domainSource, elevation: domainCanonElevation(this.domainSource, this.domain) };
    }
    return { world: { ...this.world, elevation: this.canonicalBase.elevation }, edits: this.serialize() };
  }

  get undoEdits(): WorldEdit[] {
    if (this.domain) return domainEdits(this.domainBefore.at(-1) ?? undoDomainStep(this.domain));
    const count = this.groups.at(-1) ?? (this.edits.length ? 1 : 0);
    return this.edits.slice(0, this.edits.length - count);
  }

  get redoEdits(): WorldEdit[] { return this.domain && this.domainRedo.length ? domainEdits(this.domainRedo.at(-1)!) : [...this.edits, ...(this.undone.at(-1) ?? [])]; }

  historySerialized(action: 'undo' | 'redo' | 'clear'): string {
    if (!this.domain) return serializeEdits(action === 'undo' ? this.undoEdits : action === 'redo' ? this.redoEdits : []);
    const next = action === 'undo' ? this.domainBefore.at(-1) ?? undoDomainStep(this.domain) : action === 'redo' ? this.domainRedo.at(-1) ?? this.domain : { ...this.domain, legacy: { ...this.domain.legacy, count: 0 }, steps: [] };
    return serializeDomainDocument(next);
  }

  // Explicit field, not a constructor parameter property: the project builds
  // with `erasableSyntaxOnly`.
  constructor(world: WorldData, edits: WorldEdit[] | string = []) {
    this.world = world;
    this.pristine = {
      elevation: Float32Array.from(world.elevation),
      environment: captureEnvironment(world),
    };
    if (typeof edits === 'string') { this.load(edits); return; }
    if (edits.length) {
      this.edits = edits.slice();
      this.groups = edits.map(() => 1);
      this.replay();
    }
  }

  /** True when the world currently differs from the generated one. */
  get dirty(): boolean {
    return !!this.domain || this.edits.length > 0;
  }

  get canUndo(): boolean { return this.domain ? this.domain.steps.length > 0 || this.domain.legacy.count > 0 : this.edits.length > 0; }
  get canRedo(): boolean { return this.domain ? this.domainRedo.length > 0 : this.undone.length > 0; }

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
    // Reading drops what would not survive a reopen (a malformed record): the
    // step counts what was KEPT, or the next undo would take a neighbour too.
    const kept = deserializeEdits(serializeEdits(edits));
    if (!kept.length) return;
    if (this.domain) {
      this.domainBefore.push(this.domain); this.domainRedo.length = 0;
      this.domain = appendDomainEdits(this.domain, kept.map(edit => unprojectDomainEdit(edit, this.world.domain!.bounds)));
      this.edits = domainEdits(this.domain);
      if (!onlyFog(edits)) this.replay();
      return;
    }
    this.edits.push(...kept);
    this.groups.push(kept.length);
    this.undone.length = 0;
    // The reader's-eye fog changes nothing in the world: replaying for it would
    // bump the revision and send the geography off to a full rebuild.
    if (!onlyFog(edits)) this.replay();
  }

  /** Adopt only the matching revision. Owned worker results can be consumed without another full-grid copy. */
  pushRecalculation(environment: EnvironmentFields, expectedRevision: number, takeOwnership = false): boolean {
    if ((this.world.revision ?? 0) !== expectedRevision) return false;
    const edit: WorldEdit = { kind: 'recalculate', version: 1 };
    if (this.domain) {
      this.domainBefore.push(this.domain); this.domainRedo.length = 0;
      this.domain = appendDomainEdits(this.domain, [edit]); this.edits = domainEdits(this.domain);
      // The worker derived this exact terrain revision. Keep its result rather
      // than replaying the whole journal and deriving it again on the UI thread.
      if (takeOwnership) Object.assign(this.world, environment); else restoreEnvironment(this.world, environment);
      this.world.revision = expectedRevision + 1;
      return true;
    }
    installRecalculationCheckpoints(this.world, [{
      key: serializeEdits([...this.edits, edit]), elevation: this.world.elevation.slice(), environment: takeOwnership ? environment : captureEnvironment(environment),
    }]);
    this.push(edit);
    return true;
  }

  undo(prepared?: WorldData): void {
    if (this.domain) {
      if (!this.domain.steps.length && !this.domain.legacy.count) return;
      this.domainRedo.push(this.domain); this.domain = this.domainBefore.pop() ?? undoDomainStep(this.domain); this.edits = domainEdits(this.domain); this.replay(prepared); return;
    }
    const n = this.groups.pop() ?? (this.edits.length ? 1 : 0);
    if (!n) return;
    const group = this.edits.splice(this.edits.length - n, n);
    if (!group.length) return;
    this.undone.push(group);
    if (!onlyFog(group)) this.replay();
  }

  redo(prepared?: WorldData): void {
    if (this.domain) {
      const next = this.domainRedo.pop(); if (!next) return;
      this.domainBefore.push(this.domain); this.domain = next; this.edits = domainEdits(next); this.replay(prepared); return;
    }
    const group = this.undone.pop();
    if (!group) return;
    this.edits.push(...group);
    this.groups.push(group.length);
    if (!onlyFog(group)) this.replay();
  }

  /** Throw everything away and go back to the generated world. */
  clear(prepared?: WorldData): void {
    if (this.domain) { this.domainBefore.push(this.domain); this.domainRedo.length = 0; this.domain = { ...this.domain, legacy: { ...this.domain.legacy, count: 0 }, steps: [] }; this.edits = []; this.replay(prepared); return; }
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
  load(json: string, domainRevision?: number, prepared?: WorldData): void {
    this.canonicalBase = undefined;
    const document = json ? readDomainDocument(json) : null;
    if (document) {
      if (!this.domainSource) { this.domainSource = structuredClone(this.pristineWorld); delete this.domainSource.domain; }
      this.domain = document; this.domainRevision = domainRevision ?? this.world.domain?.revision ?? 0;
      this.domainBefore.length = 0; this.domainRedo.length = 0; this.edits = domainEdits(document);
      if (prepared) {
        if (prepared.domain?.source.sourceKey !== document.catalogue.sourceKey || prepared.domain.revision !== this.domainRevision) throw new Error('Prepared domain no longer matches this journal');
        const revision = this.world.revision; Object.assign(this.world, prepared); this.world.revision = revision + 1;
      } else this.replay();
      return;
    }
    if (this.domainSource) { Object.assign(this.world, structuredClone(this.domainSource)); delete this.world.domain; this.domainSource = null; }
    this.domain = null;
    this.edits = deserializeEdits(json);
    this.groups = this.edits.map(() => 1);
    this.undone.length = 0;
    this.replay();
  }

  serialize(): string {
    if (this.domain) return serializeDomainDocument(this.domain);
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
    this.canonicalBase = undefined;
    this.world = world;
    this.pristine = {
      elevation: Float32Array.from(world.elevation),
      environment: captureEnvironment(world),
    };
    if (this.domain) { this.domainSource = structuredClone(world); delete this.domainSource.domain; }
    this.replay();
  }

  private replay(prepared?: WorldData): void {
    if (this.domain && this.domainSource) {
      const revision = this.world.revision;
      const next = prepared ?? replayDomain(this.domainSource, this.domain, this.domainRevision);
      if (prepared?.domain) this.domainRevision = prepared.domain.revision;
      Object.assign(this.world, next); this.world.revision = revision + 1; return;
    }
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
