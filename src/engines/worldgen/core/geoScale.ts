// ============================================
// World Generator — how big the map is
// ============================================
// A generated world is a planet unless the author makes it a sheet: a map a
// set number of kilometres wide (and half that tall). The grid, the plates,
// the rivers and the towns are worked out on the grid as before; what changes
// is what one cell measures, how far apart two places are (on a flat sheet,
// not round a sphere) and which latitudes the climate sees — a sheet lies
// round one latitude instead of running from pole to pole.

/** Round the equator of every generated planet, in km. */
export const PLANET_KM = 40075;
/** How wide a sheet may be made, in km (the widest is the planet itself). */
export const WORLD_KM = { min: 1000, max: PLANET_KM } as const;
/** The latitude a sheet lies round, in degrees north: temperate, as most maps are. */
export const SHEET_LAT = 40;
/** How many times its own size a single landmass's sheet is, so the sea goes all round it. */
export const SHEET_PER_LANDMASS = 3.2;

type Sized = { worldKm?: number; sourceFrame?: { version: 1; kind: 'flat-sheet'; widthKm: number; centerLatitudeDeg: number } } | undefined | null;

/** The map's width in km: the sheet's, or the planet's. */
export function worldKmOf(params: Sized): number {
  if (params?.sourceFrame?.version === 1 && Number.isFinite(params.sourceFrame.widthKm) && params.sourceFrame.widthKm > 0) return params.sourceFrame.widthKm;
  const v = params?.worldKm;
  return typeof v === 'number' && Number.isFinite(v) && v >= WORLD_KM.min && v < PLANET_KM ? v : PLANET_KM;
}

/** Whether the world is a flat sheet of a set width rather than a planet. */
export function isSheet(params: Sized): boolean {
  return params?.sourceFrame?.version === 1 || worldKmOf(params) < PLANET_KM;
}

/** Km a world cell measures across (along the equator on a planet). */
export function cellKmOf(params: Sized, width: number): number {
  return worldKmOf(params) / Math.max(1, width);
}

/** How much smaller than the planet the map is: 1 for a planet. */
export function sheetScale(params: Sized): number {
  return worldKmOf(params) / PLANET_KM;
}

/**
 * The latitude the climate sees at a height on the map (v from 0 at the top
 * to 1 at the bottom): pole to pole on a planet; on a sheet, a band round
 * SHEET_LAT as wide as the sheet is tall.
 */
export function climateLatDeg(v: number, params: Sized): number {
  if (params?.sourceFrame) return Math.max(-89, Math.min(89, params.sourceFrame.centerLatitudeDeg + (0.5 - v) * worldKmOf(params) * 180 / PLANET_KM));
  const grid = (0.5 - v) * 180;
  if (!isSheet(params)) return grid;
  return Math.max(-89, Math.min(89, SHEET_LAT + grid * sheetScale(params)));
}

/** The sheet a single landmass of this size is laid on, in km. */
export function sheetKmForLandmass(landmassKm: number): number {
  return Math.round(Math.min(WORLD_KM.max - 1, Math.max(WORLD_KM.min, landmassKm * SHEET_PER_LANDMASS)) / 10) * 10;
}

/**
 * Distance on the map in km between two cell positions (continuous, x round
 * the east/west seam): flat on a sheet, the great circle on a planet.
 */
export function mapDistanceKm(params: Sized, width: number, height: number, ax: number, ay: number, bx: number, by: number): number {
  if (isSheet(params)) {
    let dx = Math.abs(bx - ax);
    if (dx > width / 2) dx = width - dx;
    return Math.hypot(dx, by - ay) * cellKmOf(params, width);
  }
  const R = PLANET_KM / (2 * Math.PI);
  const lonA = (ax / width) * Math.PI * 2, lonB = (bx / width) * Math.PI * 2;
  const latA = (0.5 - ay / height) * Math.PI, latB = (0.5 - by / height) * Math.PI;
  const hav = Math.sin((latA - latB) / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin((lonA - lonB) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, hav)))) * R;
}

/** Explicit reading metric. The original helpers above remain generation-only. */
export interface MapMetric { worldKm?: number; sourceFrame?: NonNullable<Sized>['sourceFrame']; mapWidthKm?: number; width?: number; height?: number; finite?: boolean; baseCellKm?: number; originX?: number; originY?: number; sourceWidth?: number; sourceHeight?: number }
export interface WorldScaleSource { params?: { worldKm?: number; width?: number; sourceFrame?: NonNullable<Sized>['sourceFrame'] }; width?: number; height?: number; mapWidthKm?: number; scaleRevision?: number; edits?: string; domain?: { bounds: { x?: number; y?: number; width: number; height: number }; topology: string; source: { width?: number; height?: number; baseCellKm: number } } }
export function mapMetric(world: WorldScaleSource): MapMetric {
  let bounds = world.domain?.bounds, finite = world.domain?.topology === 'finite';
  // Rows carry one journal authority; runtime worlds carry its already derived descriptor.
  if (!world.domain && world.edits) {
    try {
      const document = JSON.parse(world.edits);
      if (document?.v === 3) {
        bounds = document.initial.bounds;
        for (const step of document.steps) if (step.kind === 'resize') bounds = step.bounds;
        finite = document.initial.topology === 'finite' || document.steps.some((step: { kind: string }) => step.kind === 'resize');
      }
    } catch { /* Old unreadable edit strings keep their previous metric. */ }
  }
  if (bounds) return { worldKm: world.params?.worldKm, sourceFrame: world.params?.sourceFrame, mapWidthKm: world.mapWidthKm, width: bounds.width, height: bounds.height, finite,
    originX: bounds.x ?? 0, originY: bounds.y ?? 0, sourceWidth: world.domain?.source.width ?? world.params?.width, sourceHeight: world.domain?.source.height ?? ((world.params?.width ?? bounds.width) >> 1),
    baseCellKm: world.domain?.source.baseCellKm ?? cellKmOf(world.params, world.params?.width ?? bounds.width) };
  if (world.params?.sourceFrame) return { worldKm: world.params.worldKm, sourceFrame: world.params.sourceFrame, mapWidthKm: world.mapWidthKm, width: world.width ?? world.params.width, height: world.height };
  return { worldKm: world.params?.worldKm, mapWidthKm: world.mapWidthKm, width: world.width ?? world.params?.width, height: world.height };
}
export function metricWidthKmOf(metric: MapMetric | undefined): number {
  if (metric?.finite) return typeof metric.mapWidthKm === 'number' && Number.isFinite(metric.mapWidthKm) && metric.mapWidthKm > 0 ? metric.mapWidthKm : (metric.baseCellKm ?? 1) * (metric.width ?? 1);
  return isSheet(metric) && typeof metric?.mapWidthKm === 'number' && Number.isFinite(metric.mapWidthKm) && metric.mapWidthKm > 0 ? metric.mapWidthKm : worldKmOf(metric);
}
export function metricCellKmOf(metric: MapMetric | undefined, width: number): number { return metricWidthKmOf(metric) / Math.max(1, width); }
export function metricSheetScale(metric: MapMetric | undefined): number { return metricWidthKmOf(metric) / PLANET_KM; }
export function metricDistanceKm(metric: MapMetric | undefined, width: number, height: number, ax: number, ay: number, bx: number, by: number): number {
  if (metric?.finite) return Math.hypot(bx - ax, by - ay) * metricCellKmOf(metric, width);
  if (!isSheet(metric)) return mapDistanceKm(metric, width, height, ax, ay, bx, by);
  let dx = Math.abs(bx - ax); if (dx > width / 2) dx = width - dx;
  return Math.hypot(dx, by - ay) * metricCellKmOf(metric, width);
}
export function resolveWorldScale(world: WorldScaleSource) {
  const metric = mapMetric(world), width = metric.width ?? 1, height = metric.height ?? (width >> 1), sourceWidthKm = worldKmOf(world.params), widthKm = metricWidthKmOf(metric);
  return { width, height, widthKm, heightKm: widthKm * height / width, cellKm: widthKm / width, sourceWidthKm, revision: world.scaleRevision ?? 0, overridden: (metric.finite || isSheet(world.params)) && typeof world.mapWidthKm === 'number' && widthKm === world.mapWidthKm };
}
/** Metadata only; retain the live object, all buffers and its generation parameters. */
export function applyWorldScaleMetadata<T extends WorldScaleSource>(data: T, record: Pick<WorldScaleSource, 'mapWidthKm' | 'scaleRevision'>): T {
  if (record.mapWidthKm === undefined) delete data.mapWidthKm; else data.mapWidthKm = record.mapWidthKm;
  if (record.scaleRevision === undefined) delete data.scaleRevision; else data.scaleRevision = record.scaleRevision;
  return data;
}
