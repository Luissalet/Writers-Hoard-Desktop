// ============================================
// World Generator — the canon supertile bin
// ============================================
// Dexie access for persisted canon supertiles (PENDIENTE §2b.1): pay the
// ~31 s of canonical generation once per WORLD, not once per session. Kept
// out of `region/` for the same reason `snapshots.ts` is kept out of `core/`:
// everything there is pure and runs in workers, harnesses and the Forge, and
// the moment it imports the database it stops being any of those. This module
// is the one door to the table, and `WorldView` registers it with the region
// client at engine load.
//
// Every function fails soft. A supertile that cannot be read, cannot be
// written, or was built under an edit list the reader has since changed is a
// cache miss — the tile path regenerates exactly as it did before this table
// existed. Never correctness.
//
// INVALIDATION. A world is seed + params + ONE ordered list of edits — the
// engine's contract — so a supertile's identity is those three things plus
// the generator's format version and the (constant) human-geography recipe.
// The edit list enters the key FILTERED to what can reach this supertile:
// strokes and drawn courses are included only when their reach touches the
// sheet (the replay's own converter answers that), while everything acting
// through the global human geography — moves, renames, markers, realm fills —
// invalidates every supertile of the world, because a moved town re-routes
// tracks three sheets away. A stroke painted on another continent no longer
// costs the reader their warmed countryside.

import { db } from '@/db';
import type { WorldData } from './core/types';
import type { Stroke, WorldEdit } from './core/edits';
import { deserializeEdits } from './core/edits';
import { DEFAULT_HUMAN_PARAMS, type HumanGeography } from './core/settlements';
import { CANON_STORE_VERSION } from './region/canonStore';
import { strokeTouchesSheet } from './region/canonEdits';
import { tileGeometry } from './region/tiles';
import { setCanonPersistence, traceTiles } from './region/client';
import { hashEditsString, stableStringify } from './region/workerProtocol';
import { geographyContentKey } from './region/contentIdentity';
import type { CanonTileRow } from './types';

export type { CanonTileRow };

/**
 * Total bytes the bin may hold, LRU-evicted by `savedAt`. Around 160 stored
 * supertiles of a 2048-width world — several worlds' warmed neighbourhoods —
 * and an order of magnitude under the browser's storage estimate.
 */
const BYTE_BUDGET = 320 * 1024 * 1024;

/** worldId for a live WorldData object, taught by `useWorldGeneration` the
 *  moment a world enters its session cache. Unbound worlds (benches, mid-
 *  generation previews) simply do not persist. */
const WORLD_IDS = new WeakMap<WorldData, string>();

/**
 * Y EL RESPALDO POR SEMILLA. Los consumidores no comparten un único objeto
 * mundo: las teselas hondas viajan con el PRÍSTINO del `canonSource`, la vía
 * barata con el editado, y cualquier clon futuro con lo suyo. Un vínculo que
 * dependa de la identidad del objeto muere con el primer derivado — que es
 * exactamente como 41 superteselas «guardadas» acabaron en la basura mientras
 * «sembradas» marcaba 0 (capturas de Luis, 2026-08-12). La semilla + las
 * dimensiones identifican la fila igual de bien, y si dos filas duplicadas
 * colisionan, comparten caché de un canon IDÉNTICO — correcto también.
 */
const WORLD_IDS_BY_SEED = new Map<string, string>();

const seedKey = (world: WorldData): string =>
  `${world.params.seed}:${world.width}x${world.height}`;

/** Exportado: la puerta de las teselas entintadas (`renderedSnapshots.ts`)
 *  resuelve sus filas con el MISMO vínculo mundo→id, respaldo por semilla
 *  incluido — dos registros del vínculo serían dos maneras de desincronizarse. */
export function resolveWorldId(world: WorldData): string | undefined {
  return WORLD_IDS.get(world) ?? WORLD_IDS_BY_SEED.get(seedKey(world));
}

export function bindCanonWorld(world: WorldData, worldId: string): void {
  WORLD_IDS.set(world, worldId);
  WORLD_IDS_BY_SEED.set(seedKey(world), worldId);
  // El respaldo no debe crecer sin techo en una sesión que abre muchos mundos.
  if (WORLD_IDS_BY_SEED.size > 64) {
    const first = WORLD_IDS_BY_SEED.keys().next().value;
    if (first !== undefined) WORLD_IDS_BY_SEED.delete(first);
  }
}

/** DEBUG (temporal): ¿este objeto mundo resuelve a una fila del almacén? El
 *  HUD lo pinta para que la próxima captura confirme el vínculo. */
export function canonWorldBound(world: WorldData): boolean {
  return resolveWorldId(world) !== undefined;
}

/**
 * Las ediciones cuya HUELLA puede tocar alguna de estas sábanas — la rodaja
 * de la lista de la que depende la identidad del suelo que cubren. Exportada:
 * la clave de una supertesela usa UNA sábana; la de una tesela de pantalla
 * usa las (≤4) superteselas bajo ella, y las dos deben filtrar con las
 * MISMAS reglas o una invalidaría lo que la otra conserva.
 */
export function relevantEditsForSheets(
  world: WorldData, sheets: ReturnType<typeof tileGeometry>[], editsJson: string,
): WorldEdit[] {
  if (!editsJson) return [];
  if (!sheets.length) return deserializeEdits(editsJson);
  const asStroke = (pts: { x: number; y: number }[], radius: number): Stroke =>
    ({ pts, radius, strength: 1, softness: 0 });
  const touches = (stroke: Stroke): boolean =>
    sheets.some((g) => strokeTouchesSheet(stroke, g, world.width));
  const edits = deserializeEdits(editsJson);
  let environmentPrefix = edits.length - 1;
  while (environmentPrefix >= 0 && edits[environmentPrefix].kind !== 'recalculate') environmentPrefix--;
  return edits.filter((e, index) => {
    // A distant ridge can change this sheet's rainfall after recalculation.
    // The checkpoint therefore depends on its entire prefix, not only local strokes.
    if (index <= environmentPrefix) return true;
    if ('stroke' in e) return touches(e.stroke);
    if (e.kind === 'river') return touches(asStroke(e.pts, Math.max(1, e.width)));
    if (e.kind === 'road' || e.kind === 'realmArea') {
      return touches(asStroke(e.pts, 1));
    }
    // Una zona de lugares invalida SÓLO las superteselas que su pincelada
    // pisa — su geometría es un trazo como el de una calzada. El grifo global
    // (`placesEverywhere`) cae en el «todo lo demás» de abajo a propósito:
    // abrirlo o cerrarlo re-fragua el mundo entero, que es exactamente lo que
    // hace.
    if (e.kind === 'placesZone') {
      return touches(asStroke(e.pts, Math.max(1, e.radius)));
    }
    // Everything else reaches the supertile through the global geography
    // (moves, markers, renames, fills, erasers): include it always.
    return true;
  });
}

/** The per-supertile slice of the edit list that its identity depends on. */
function relevantEdits(world: WorldData, canonKey: string, editsJson: string): WorldEdit[] {
  if (!editsJson) return [];
  const parts = canonKey.split(':');
  const id = { tx: Number(parts[1]), ty: Number(parts[2]) };
  if (!Number.isFinite(id.tx) || !Number.isFinite(id.ty)) return deserializeEdits(editsJson);
  return relevantEditsForSheets(world, [tileGeometry(world, id)], editsJson);
}

function rowKey(
  world: WorldData, geography: HumanGeography, canonKey: string, editsJson: string,
): string {
  const paramsHash = hashEditsString(stableStringify(world.params));
  const humanHash = hashEditsString(stableStringify(DEFAULT_HUMAN_PARAMS));
  const editsHash = hashEditsString(stableStringify(relevantEdits(world, canonKey, editsJson)));
  return `${CANON_STORE_VERSION}:${world.params.seed}:${world.width}x${world.height}`
    + `:${paramsHash}:${humanHash}:g${geography.depth}:${geographyContentKey(geography)}:e${editsHash}`;
}

function rowId(worldId: string, canonKey: string, contentKey: string): string {
  return `${worldId}:${canonKey}:${contentKey}`;
}

async function loadCanonTile(
  world: WorldData, geography: HumanGeography, canonKey: string, editsJson: string,
): Promise<ArrayBuffer | null> {
  const worldId = resolveWorldId(world);
  if (!worldId) {
    traceTiles('almacén', canonKey, 'load SIN VÍNCULO (mundo no ligado)');
    return null;
  }
  try {
    const contentKey = rowKey(world, geography, canonKey, editsJson);
    const id = rowId(worldId, canonKey, contentKey);
    const row = await db.canonTiles.get(id);
    if (!row) {
      traceTiles('almacén', canonKey, 'load miss (sin fila)');
      return null;
    }
    if (row.version !== CANON_STORE_VERSION) {
      traceTiles('almacén', canonKey, `load miss (versión ${row.version}≠${CANON_STORE_VERSION})`);
      return null;
    }
    if (row.key !== contentKey) {
      traceTiles('almacén', canonKey, 'load miss (CLAVE DISTINTA)',
        `guardada ${row.key.slice(0, 46)}…`, `esperada ${contentKey.slice(0, 46)}…`);
      return null;
    }
    void db.canonTiles.update(id, { savedAt: Date.now() }).catch(() => {});
    const b = row.bytes;
    return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength
      ? b.buffer as ArrayBuffer
      : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

function saveCanonTile(
  world: WorldData, geography: HumanGeography, canonKey: string,
  editsJson: string, bytes: ArrayBuffer,
): void {
  const worldId = resolveWorldId(world);
  if (!worldId) {
    traceTiles('almacén', canonKey, 'save DESCARTADO (mundo no ligado)');
    return;
  }
  traceTiles('almacén', canonKey, `save ${(bytes.byteLength / 1e6).toFixed(1)}MB → ${worldId}`);
  void (async () => {
    try {
      const contentKey = rowKey(world, geography, canonKey, editsJson);
      await db.canonTiles.put({
        id: rowId(worldId, canonKey, contentKey),
        worldId,
        key: contentKey,
        version: CANON_STORE_VERSION,
        bytes: new Uint8Array(bytes),
        byteLength: bytes.byteLength,
        savedAt: Date.now(),
      });
      await evict();
    } catch (err) {
      console.warn('[worldgen] no se pudo guardar el canon', err);
    }
  })();
}

async function evict(): Promise<void> {
  // La pasada completa materializa TODAS las filas (IndexedDB no entrega una
  // columna suelta), así que sólo corre cuando el recuento sugiere que el
  // presupuesto puede estar en peligro — no en cada guardado.
  if (await db.canonTiles.count() <= 120) return;
  const rows = await db.canonTiles.orderBy('savedAt').reverse()
    .toArray((all) => all.map((r) => ({ id: r.id, byteLength: r.byteLength })));
  let total = 0;
  const drop: string[] = [];
  for (const r of rows) {
    total += r.byteLength;
    if (total > BYTE_BUDGET) drop.push(r.id);
  }
  if (drop.length) await db.canonTiles.bulkDelete(drop);
}

export async function dropCanonTiles(worldId: string): Promise<void> {
  try {
    await db.canonTiles.where('worldId').equals(worldId).delete();
  } catch {
    // Still only a cache.
  }
}

/** Hand the region client its storage. Idempotent; called at engine load. */
export function registerCanonPersistence(): void {
  setCanonPersistence({ load: loadCanonTile, save: saveCanonTile });
}
