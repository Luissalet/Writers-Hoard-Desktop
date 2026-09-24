// ============================================
// World Generator — what the AI bridge needs from a world
// ============================================
//
// Two things, both shaped by how worlds are stored (seed + params + an ordered
// edit list, terrain regenerated on demand):
//
//   READING. A tool that lists places needs the world in memory with its edits
//   applied. If a view has the world open, its live object IS the current state
//   — read it, touch nothing. Otherwise load the snapshot (~1 s) into a PRIVATE
//   object, replay the stored edits onto it and build the geography there; an
//   open view's object is never mutated from here. No snapshot yet (a world
//   that was never opened on this machine) → forge it in the background and ask
//   the caller to try again in a moment rather than block a tool call for the
//   twenty-six seconds a full generation takes.
//
//   WRITING. One writer at a time (see core/liveWorlds.ts): an open view gets
//   the edits handed to it and appends them like a stroke; with no view open the
//   edits are appended to the stored list directly. Either way the caller gets
//   the list as it was immediately before, for the audit trail.

import { db } from '@/db';
import type { GeneratedWorld } from './types';
import type { WorldData, WorldParams } from './core/types';
import { unpackWorld } from './core/types';
import { deserializeEdits, serializeEdits, type WorldEdit } from './core/edits';
import { PaintSession } from './core/paintSession';
import { liveWorld } from './core/liveWorlds';
import { buildAtlas, type Atlas } from './core/atlas';
import { getGeography } from './cartography/texture';
import type { GeoDepth, HumanGeography } from './core/settlements';
import { getCachedWorld, paramsKey } from './useWorldGeneration';
import { loadSnapshot, saveSnapshot } from './snapshots';
import { forgeAvailable, forgeDegraded, spawnForgeWorker } from './forge/bridge';
import { generatedWorldOps } from './operations';
import { flushWorldEdits } from './editWriter';
import type { WorkerReply } from './worldgen.worker';

export interface ReadableWorld {
  data: WorldData;
  geo: HumanGeography;
  atlas: Atlas;
  /** True when this is the object an open view is painting on. */
  live: boolean;
}

export type OpenWorldResult =
  | { ok: true; world: ReadableWorld }
  | { ok: false; code: 'generating' | 'unavailable'; message: string };

// A reader that lists places, then finds one, then describes it should not pay
// the snapshot + replay + geography bill three times. Private objects only —
// the live world is never cached here (it is already free to read).
interface Built { key: string; world: ReadableWorld; at: number }
const built = new Map<string, Built>();
const BUILT_TTL_MS = 5 * 60_000;
const BUILT_MAX = 2;

function buildKey(world: GeneratedWorld, depth: GeoDepth): string {
  return `${world.id}|${paramsKey(world.params)}|${depth}|${world.edits ?? ''}`;
}

const forging = new Set<string>();

/**
 * Generate the world off-thread and keep its snapshot, so the next read finds
 * it. Fire-and-forget by design; a failure just means the next read forges
 * again.
 */
function startBackgroundForge(worldId: string, params: WorldParams): void {
  if (forging.has(worldId)) return;
  forging.add(worldId);
  const key = paramsKey(params);
  let worker: Worker;
  try {
    worker = forgeAvailable() && !forgeDegraded()
      ? (spawnForgeWorker('worldgen') as unknown as Worker)
      : new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    forging.delete(worldId);
    return;
  }
  const finish = () => {
    forging.delete(worldId);
    worker.terminate();
  };
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const msg = e.data;
    if (msg.type === 'progress') return;
    if (msg.type === 'done') {
      // Un `unpackWorld` que lanza no puede dejar el mundo «forjándose» para
      // toda la sesión: cualquier salida de aquí suelta la marca.
      let data: WorldData;
      try { data = unpackWorld(msg.world); } catch { finish(); return; }
      void saveSnapshot(worldId, key, data).finally(finish);
      return;
    }
    finish();
  };
  worker.onerror = finish;
  try { worker.postMessage({ type: 'generate', params }); } catch { finish(); }
}

/** Whether a background forge for this world is still running. */
export function isForging(worldId: string): boolean {
  return forging.has(worldId);
}

/**
 * The world with its edits applied, its human geography and its atlas — for
 * reading only. `depth: 'places'` is settlements, ruins and landmarks; `'full'`
 * adds realms, named seas/ranges and roads (slower to build the first time).
 */
export async function openWorldForReading(world: GeneratedWorld, depth: GeoDepth = 'full'): Promise<OpenWorldResult> {
  // 1. An open view: its object is the current state, and its geography is
  //    already built (or will be adopted by the view, a deeper answer being
  //    valid for shallower questions too).
  if (liveWorld(world.id)) {
    const data = getCachedWorld(world.id, world.params);
    if (data) {
      const geo = getGeography(data, depth);
      return { ok: true, world: { data, geo, atlas: buildAtlas(data, geo), live: true } };
    }
  }

  // 2. A recent private build for exactly this list.
  const key = buildKey(world, depth);
  const hit = built.get(world.id);
  if (hit && hit.key === key && Date.now() - hit.at < BUILT_TTL_MS) return { ok: true, world: hit.world };

  // 3. The snapshot, replayed privately.
  const snap = await loadSnapshot(world.id, paramsKey(world.params));
  if (snap) {
    let edits: WorldEdit[] = [];
    if (world.edits) {
      try {
        edits = deserializeEdits(world.edits);
      } catch {
        edits = [];
      }
    }
    // Replays onto `snap`, which is ours alone.
    new PaintSession(snap, edits);
    const geo = getGeography(snap, depth);
    const readable: ReadableWorld = { data: snap, geo, atlas: buildAtlas(snap, geo), live: false };
    built.delete(world.id);
    built.set(world.id, { key, world: readable, at: Date.now() });
    while (built.size > BUILT_MAX) {
      const oldest = built.keys().next().value;
      if (!oldest) break;
      built.delete(oldest);
    }
    return { ok: true, world: readable };
  }

  // 4. Never generated here: start it, say so.
  startBackgroundForge(world.id, world.params);
  return {
    ok: false,
    code: 'generating',
    message: `The world "${world.title}" has not been generated on this machine yet; it is being forged now (about half a minute). Ask again shortly.`,
  };
}

/**
 * Append edits to a world through whichever writer currently owns it.
 * Returns the serialised list as it stood immediately before the change.
 */
export async function applyWorldEdits(
  world: GeneratedWorld,
  edits: WorldEdit[],
): Promise<{ before: string; delivered: 'view' | 'row' }> {
  const handle = liveWorld(world.id);
  if (handle) {
    const before = handle.snapshot();
    handle.apply(edits);
    return { before, delivered: 'view' };
  }
  // Sin vista registrada no significa sin vista: una que se cierra o que aún
  // prepara su sesión (tras regenerar, al reintentar) puede tener un guardado
  // en vuelo. Se deja llegar primero; si no, aterrizaría DESPUÉS con la lista
  // vieja y taparía esta edición.
  if (!await flushWorldEdits(world.id)) {
    throw new Error('The world has unsaved edits that could not be written yet; try again shortly.');
  }
  // Y la lista se lee de la FILA, no de `world`: el llamante la cargó antes de
  // abrir el mundo para leerlo (segundos, a veces), y añadir sobre esa copia
  // borraba lo que se hubiera guardado entretanto — trazos de la vista, una
  // regeneración entera.
  const before = await db.transaction('rw', db.generatedWorlds, async () => {
    const row = await db.generatedWorlds.get(world.id);
    const current = row ? row.edits ?? '' : world.edits ?? '';
    let list: WorldEdit[] = [];
    if (current) {
      try {
        list = deserializeEdits(current);
      } catch {
        list = [];
      }
    }
    list.push(...edits);
    await generatedWorldOps.update(world.id, { edits: serializeEdits(list) });
    return current;
  });
  // The private build for the old list is stale now.
  built.delete(world.id);
  return { before, delivered: 'row' };
}
