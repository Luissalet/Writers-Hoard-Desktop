// ============================================
// World Generator — el almacén de teselas ENTINTADAS
// ============================================
// Puerta Dexie del segundo nivel de la reestructura (tasks/ARQUITECTURA-
// TESELAS.md §3.2): la tesela final de 256² — el png/webp que el visor
// dibuja — guardada con clave de contenido, para que revisitar suelo ya
// dibujado cueste milisegundos ENTRE SESIONES. En renderd, el servidor de
// teselas de OpenStreetMap, el almacén de render ES el producto; aquí
// también: el canon (`canonSnapshots`) ahorra los minutos de GENERAR, esta
// tabla ahorra los segundos de ENTINTAR, y entre las dos la sensación es la
// de Google Maps — el suelo que ya viste vuelve al instante.
//
// Mismo molde que el canon: fuera de `region/` porque importa la base de
// datos (todo lo de allí corre en workers y bancos), todo falla blando (una
// fila ilegible es un fallo de caché, jamás de corrección), y LA CLAVE ES EL
// CONTENIDO — invalidar no existe como operación. La lista de ediciones
// entra FILTRADA a lo que puede tocar las (≤4) superteselas bajo la tesela,
// con las MISMAS reglas que la clave del canon (`relevantEditsForSheets`):
// una pincelada en otro continente no te cuesta la comarca entintada.

import { db } from '@/db';
import type { WorldData } from './core/types';
import { relevantEditsForSheets, resolveWorldId } from './canonSnapshots';
import { CANON_STORE_VERSION } from './region/canonStore';
import { traceTiles, type RenderedTile } from './region/client';
import { deepTileSpec, type TilePlace } from './region/deepTile';
import { canonWindowCover } from './region/composeWindow';
import { tileGeometry } from './region/tiles';
import { setRenderedTilePersistence } from './region/tileService';
import { hashEditsString, stableStringify } from './region/workerProtocol';
import { DEFAULT_HUMAN_PARAMS, type HumanGeography } from './core/settlements';
import { geographyContentKey } from './region/contentIdentity';
import type { TileKey } from './cartography/tiles';

/** Versión del ENTINTADO. Se sube cuando cambia lo que los pinceles dibujan
 *  (satelliteInk, deepTile carta): las filas viejas dejan de acertar y caen
 *  por LRU — sin migración, sin borrado. */
export const RENDERED_INK_VERSION = 6;

/**
 * Presupuesto del almacén. Una tesela honda entintada pesa ~20-80 KB en
 * webp; 128 MB son ~2-5 mil teselas — varias comarcas enteras a fondo de
 * zoom, y un orden de magnitud bajo el presupuesto del navegador.
 */
const BYTE_BUDGET = 128 * 1024 * 1024;
/** El desalojo materializa todas las filas (IndexedDB no da una columna
 *  suelta): sólo corre cuando el recuento sugiere peligro real. */
const EVICT_CHECK_COUNT = 1500;

function rowKey(
  world: WorldData, geography: HumanGeography, key: TileKey,
  editsJson: string, estilo: string,
): string {
  // Las superteselas cuyo contenido alimenta esta tesela — la ventana exacta
  // del render, margen de tinta incluido (deepTileSpec y satelliteTileSpec
  // son la misma ventana: margen 16 en ambas).
  const cover = canonWindowCover(world, deepTileSpec(world, key));
  const sheets = cover.map((id) => tileGeometry(world, id));
  const paramsHash = hashEditsString(stableStringify(world.params));
  const humanHash = hashEditsString(stableStringify(DEFAULT_HUMAN_PARAMS));
  const editsHash = hashEditsString(
    stableStringify(relevantEditsForSheets(world, sheets, editsJson)));
  return `${RENDERED_INK_VERSION}.${CANON_STORE_VERSION}`
    + `:${world.params.seed}:${world.width}x${world.height}`
    + `:p${paramsHash}:h${humanHash}`
    + `:g${geography.depth}:${geographyContentKey(geography)}:e${editsHash}:${estilo}`
    + `:${key.z}/${key.tx}/${key.ty}`;
}

/** Content-addressed primary key. Different geography/edit versions can coexist
 * until ordinary LRU eviction, so a late write can never overwrite newer land. */
function rowId(worldId: string, contentKey: string): string {
  return `${worldId}:${contentKey}`;
}

async function loadRenderedTile(
  world: WorldData, geography: HumanGeography, key: TileKey,
  editsJson: string, estilo: string,
): Promise<RenderedTile | null> {
  const worldId = resolveWorldId(world);
  if (!worldId) return null;
  try {
    const contentKey = rowKey(world, geography, key, editsJson, estilo);
    const id = rowId(worldId, contentKey);
    const row = await db.renderedTiles.get(id);
    if (!row) return null;
    if (row.version !== RENDERED_INK_VERSION) return null;
    if (row.key !== contentKey) return null;
    // Decodificar ANTES de tocar el LRU: si el blob está podrido, que la fila
    // no se refresque como si sirviera.
    const bitmap = await createImageBitmap(
      new Blob([row.bytes as unknown as BlobPart], { type: 'image/webp' }));
    const places = row.places
      ? (JSON.parse(row.places) as TilePlace[])
      : undefined;
    void db.renderedTiles.update(id, { savedAt: Date.now() }).catch(() => {});
    return { bitmap, places };
  } catch {
    return null;
  }
}

function saveRenderedTile(
  world: WorldData, geography: HumanGeography, key: TileKey,
  editsJson: string, estilo: string,
  bytes: Uint8Array, places: TilePlace[] | undefined,
): void {
  const worldId = resolveWorldId(world);
  if (!worldId) {
    traceTiles('tinta', `${key.z}/${key.tx}/${key.ty}`, 'save DESCARTADO (mundo no ligado)');
    return;
  }
  void (async () => {
    try {
      const contentKey = rowKey(world, geography, key, editsJson, estilo);
      await db.renderedTiles.put({
        id: rowId(worldId, contentKey),
        worldId,
        key: contentKey,
        version: RENDERED_INK_VERSION,
        bytes,
        byteLength: bytes.byteLength,
        places: places?.length ? JSON.stringify(places) : undefined,
        savedAt: Date.now(),
      });
      await evict();
    } catch (err) {
      console.warn('[worldgen] no se pudo guardar la tesela entintada', err);
    }
  })();
}

async function evict(): Promise<void> {
  if (await db.renderedTiles.count() <= EVICT_CHECK_COUNT) return;
  const rows = await db.renderedTiles.orderBy('savedAt').reverse()
    .toArray((all) => all.map((r) => ({ id: r.id, byteLength: r.byteLength })));
  let total = 0;
  const drop: string[] = [];
  for (const r of rows) {
    total += r.byteLength;
    if (total > BYTE_BUDGET) drop.push(r.id);
  }
  if (drop.length) await db.renderedTiles.bulkDelete(drop);
}

/** Al borrar un mundo se van sus teselas — como `dropCanonTiles`. */
export async function dropRenderedTiles(worldId: string): Promise<void> {
  try {
    await db.renderedTiles.where('worldId').equals(worldId).delete();
  } catch {
    // Sólo caché.
  }
}

/** Colgar el almacén del servicio. Idempotente; se llama al cargar el motor. */
export function registerRenderedTilePersistence(): void {
  setRenderedTilePersistence({ load: loadRenderedTile, save: saveRenderedTile });
}
