import type { HumanGeography } from '../core/settlements';
import type { TilePlace } from './deepTile';
import type { WorldData } from '../core/types';
import type { RegionGeometry } from './terrain';
import type { RegionData, RegionParams, RegionWindow } from './types';

/**
 * Worker-safe geography.
 *
 * `Language.orthography` is a function and therefore cannot cross the
 * structured-clone boundary. The whole family is deterministic from the world
 * seed and living-language count, so the worker rebuilds it instead.
 */
export type RegionWorkerGeography = Omit<HumanGeography, 'languages'> & {
  languageCount: number;
};

/** FNV-1a, shared by both sides of the canon persistence handshake: the
 *  worker stamps `canonBuilt` with the hash of the edit list it generated
 *  from, and the client compares against the hash of the list it holds NOW —
 *  same function or the comparison is theatre. */
export function hashEditsString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * JSON con las claves ORDENADAS, recursivo. `JSON.stringify` serializa en
 * orden de inserción, y los `params` de un mundo recién generado y los del
 * mismo mundo decodificado de la instantánea pueden llevar las mismas claves
 * en distinto orden — con lo que una clave de invalidación «cambiaba» entre
 * sesiones y el almacén nunca acertaba: trece superteselas guardadas y cero
 * sembradas (la captura de Luis, 2026-08-12). La identidad debe depender del
 * CONTENIDO, nunca del orden en que un objeto fue construido. Vive aquí — el
 * módulo puro que ya comparten cliente, workers y puertas de persistencia —
 * porque dos copias de esta función son dos claves que pueden divergir.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function packRegionGeography(
  geography: HumanGeography,
): RegionWorkerGeography {
  const { languages, ...cloneable } = geography;
  return {
    ...cloneable,
    languageCount: Math.max(2, languages.living.length),
  };
}

export interface RegionConfigureWorkerRequest {
  type: 'configure';
  contextId: string;
  world: WorldData;
  geography: RegionWorkerGeography;
  /** The client persists canon supertiles (Dexie). When set, the worker
   *  encodes each freshly generated supertile and posts it back as
   *  `canonBuilt` BEFORE the tile that caused it — absent (benches, hosts
   *  with no storage) the worker never pays the encode. */
  persistCanon?: boolean;
}

export interface RegionGenerateWorkerRequest {
  type: 'generate';
  requestId: string;
  contextId: string;
  window: RegionWindow;
  params: RegionParams;
  /** Canon tiles pass their world-aligned grid; freeform sheets omit it. */
  geometry?: RegionGeometry;
  /** Serialized edit list, applied at sheet resolution (canon path only —
   *  requires the configured world to carry PRISTINE elevation). */
  edits?: string;
  /** Política de sembrado explícita (hojas libres: el mundo va editado y no
   *  puede mandar `edits` sin aplicarlos dos veces). Ver RegionBuildOptions. */
  sitesPolicy?: import('../core/edits').SitesPolicy;
  /**
   * Set when this sheet IS a supertile of the canon lattice (`c:tx:ty`) —
   * the regional composite's case. It buys three things: the worker answers
   * from its resident canon without generating; a fresh build is installed in
   * the session cache (so the display tiles and the 3D's `consumeOnly` find
   * the ground the composite just paid for); and, under `persistCanon`, the
   * build is encoded and posted as `canonBuilt` — the composite was the one
   * canon producer whose work died with the session.
   */
  canonKey?: string;
}

/**
 * Read the canon under one point.
 *
 * Deliberately incapable of generating anything: it answers only from canon
 * tiles this session has ALREADY built, and says so when it cannot. A hover
 * readout that could trigger a nine-second supertile build would make the
 * cursor a trap; this way it is free, and by the time the reader is looking at
 * canon ground the canon under the cursor is by definition resident.
 */
export interface RegionProbeWorkerRequest {
  type: 'probe';
  requestId: string;
  contextId: string;
  /** World cell coordinates (x wraps). */
  wx: number;
  wy: number;
}

export interface RegionProbe {
  /** Metres above sea level, at ~153 m resolution. */
  elevationM: number;
  /** 0 land · 1 sea · 2 lake. */
  water: number;
  /** Regional ground cover id (see region/types Cover). */
  cover: number;
  /** World biome id, after the sheet's own correction. */
  biome: number;
  /** Metres per metre. */
  slope: number;
  /** 0–1 topographic wetness. */
  wet: number;
  /** Ground resolution this reading came from. */
  metresPerCell: number;
}

export interface RegionCancelWorkerRequest {
  type: 'cancel';
  requestId: string;
}

/**
 * Seed the worker's canon cache from the client's persistence (PENDIENTE
 * §2b.1: pay the ~31 s of canon generation once per WORLD, not once per
 * session). Posted BEFORE the `renderTile` that needs the ground; the worker
 * processes messages in arrival order, so no acknowledgement is needed — by
 * the time the tile request runs, the supertiles are resident. Decode is
 * ~300 ms against the ~31.900 ms it replaces, and a bad payload is simply a
 * cache miss: the tile path regenerates as it always did.
 */
export interface RegionSeedCanonWorkerRequest {
  type: 'seedCanon';
  contextId: string;
  tiles: { key: string; bytes: ArrayBuffer }[];
}

/**
 * One carta display tile, drawn by this worker because it already holds the
 * cloned world and geography — the whole cost of a tile is the render, not
 * another 80 MB structured clone. Theme travels by id: a CartoTheme is data
 * plus nothing, but the id is smaller and cannot drift from the registry.
 */
export interface RegionRenderTileWorkerRequest {
  type: 'renderTile';
  /**
   * Which vocabulary to ink this tile in.
   *
   * `carta` is the paper sheet the Carta view reads. `satellite` is the ground
   * seen from above, which is what the 2D view edits on. Same worker, same
   * cloned world, same canon cache — a satellite tile and a carta tile over the
   * same hillside share the expensive part and differ only in the paint.
   * Absent means `carta`, so every existing caller keeps its behaviour.
   */
  ink?: 'carta' | 'satellite';
  requestId: string;
  contextId: string;
  z: number;
  tx: number;
  ty: number;
  themeId: string;
  layers: Record<string, boolean>;
  density: number;
  reliefAmount: number;
  /** Serialized edit list for DEEP tiles (z ≥ DEEP_TILE_Z): the canon ground
   *  re-applies strokes at its own resolution, so the session world must be
   *  the PRISTINE one and the edits ride the request. */
  edits?: string;
  /**
   * SÓLO CONSUMIR: una tesela honda se entinta únicamente si TODAS sus
   * superteselas de canon ya son residentes en la caché del worker; si falta
   * alguna, el worker responde `declined` en microsegundos en vez de pagar
   * segundos de generación. Es el contrato del 3D (decisión de Luis,
   * 2026-08-11: «el 3D consume, no genera»): la vista pide lo que el 2D ya
   * dibujó barato y nada más. Ausente = falso, todos los llamantes de antes
   * quedan igual.
   */
  consumeOnly?: boolean;
}

export type RegionWorkerRequest =
  | RegionConfigureWorkerRequest
  | RegionGenerateWorkerRequest
  | RegionRenderTileWorkerRequest
  | RegionProbeWorkerRequest
  | RegionCancelWorkerRequest
  | RegionSeedCanonWorkerRequest;

export type RegionWorkerReply =
  | { type: 'configured'; contextId: string }
  | { type: 'progress'; requestId: string; stage: string; overall: number }
  | { type: 'done'; requestId: string; region: RegionData }
  | {
    type: 'tile';
    requestId: string;
    /** Same-process host (web worker): a zero-copy bitmap. */
    bitmap?: ImageBitmap;
    /** Cross-process host (the Forge): raw pixels; the client rebuilds the
     *  bitmap on arrival. */
    rgba?: ArrayBuffer;
    width?: number;
    height?: number;
    places?: TilePlace[];
    /** Petición `consumeOnly` cuyo canon no estaba residente: sin mapa de bits
     *  y sin coste. El cliente lo resuelve como null, no como error. */
    declined?: boolean;
    /**
     * EL BUS DE DESALOJOS. Claves de canon que ESTA sesión ha desalojado de su
     * LRU desde su última respuesta de tesela. Sin esto, el libro de siembras
     * del cliente (`session.seeded`) daba por residente lo que el worker ya
     * había tirado, la siembra de 300 ms se saltaba, y la tesela pagaba una
     * REGENERACIÓN de decenas de segundos — el atasco cuadrático del primer
     * paseo hondo (0/45 con EN VUELO 4, captura de Luis 2026-08-12). La vía
     * `consumeOnly` ya tenía su tachadura vía `declined`; ésta es la misma
     * verdad para la vía que genera.
     */
    evictedCanon?: string[];
  }
  | { type: 'probed'; requestId: string; probe: RegionProbe | null }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
  /** A freshly generated canon supertile, encoded for storage. Posted BEFORE
   *  the `tile` reply of the request that generated it, while the client's
   *  message handler for that request is still attached. `editsHash` is the
   *  hash of the request's edit list, so the client can refuse to store a
   *  supertile the reader has already painted past. */
  | {
    type: 'canonBuilt';
    requestId: string;
    key: string;
    editsHash: string;
    bytes: ArrayBuffer;
  };

/** Transfer the heavy raster layers without copying the generated result back to the renderer. */
export function regionTransferables(region: RegionData): Transferable[] {
  return [
    region.elevation.buffer,
    region.water.buffer,
    region.flow.buffer,
    region.slope.buffer,
    region.wet.buffer,
    region.biome.buffer,
    region.cover.buffer,
  ] as Transferable[];
}
