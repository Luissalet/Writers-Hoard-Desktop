// ============================================
// World Generator — the snapshot bin
// ============================================
// Dexie access for the world cache. Kept out of `core/` on purpose: everything
// under `core/` is pure and runs in a worker, in a harness and in a browser
// alike, and the moment it imports the database it stops being any of those.
//
// Every function here fails soft. A snapshot that cannot be read, cannot be
// written, or does not match the parameters it was made from is a cache miss,
// and a cache miss costs twenty-six seconds — never correctness.

import { db } from '@/db';
import type { WorldData } from './core/types';
import type { WorldSnapshot } from './types';
import { decodeWorld, encodeWorld, SNAPSHOT_VERSION, supportsSnapshotVersion } from './core/worldStore';

export type { WorldSnapshot };

/**
 * How many forged worlds are kept.
 *
 * Each is about eleven megabytes. Four is a reader with a couple of projects
 * open and no thought spared for the bread bin; a hundred would be a database
 * that grows without anyone asking it to.
 */
const KEEP = 4;

/** Read back a forged world, or null if there isn't one that still applies. */
export async function loadSnapshot(worldId: string, key: string): Promise<WorldData | null> {
  try {
    const row = await db.worldSnapshots.get(worldId);
    if (!row || row.key !== key || !supportsSnapshotVersion(row.version)) return null;
    const world = await decodeWorld(row.bytes);
    // Touch it so the eviction below keeps what is actually being used rather
    // than what happened to be forged most recently.
    void db.worldSnapshots.update(worldId, { savedAt: Date.now() }).catch(() => {});
    return world;
  } catch (err) {
    console.warn('[worldgen] instantánea ilegible, se vuelve a forjar', err);
    void dropSnapshot(worldId);
    return null;
  }
}

/**
 * Keep a forged world.
 *
 * Deliberately fire-and-forget from the caller's point of view: the reader has
 * their world on screen already and nothing about this is worth making them
 * wait for, or worth an error dialogue if the disk is full.
 */
export async function saveSnapshot(worldId: string, key: string, world: WorldData): Promise<void> {
  try {
    const bytes = await encodeWorld(world);
    await db.worldSnapshots.put({
      worldId,
      key,
      version: SNAPSHOT_VERSION,
      bytes,
      width: world.width,
      height: world.height,
      savedAt: Date.now(),
    });
    await evict();
  } catch (err) {
    console.warn('[worldgen] no se pudo guardar la instantánea', err);
  }
}

export async function dropSnapshot(worldId: string): Promise<void> {
  try {
    await db.worldSnapshots.delete(worldId);
  } catch {
    // Nothing to do: a snapshot that will not delete is still only a cache.
  }
}

async function evict(): Promise<void> {
  const keys = await db.worldSnapshots.orderBy('savedAt').reverse().primaryKeys();
  if (keys.length <= KEEP) return;
  await db.worldSnapshots.bulkDelete(keys.slice(KEEP) as string[]);
}
