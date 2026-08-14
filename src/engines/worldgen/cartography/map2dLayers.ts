/**
 * Layer ownership for the slippy 2D map.
 *
 * Terrain tiles may be absent, stale or represented by an ancestor during any
 * gesture. Anything whose disappearance would change the meaning of the map is
 * therefore drawn in screen space and never handed over by nominal zoom.
 */
export interface Map2DLayerPlan {
  tileLayers: { rivers: boolean; roads: false; fields: true };
  riverFallback: boolean;
  roadAlpha: 1;
  principalSettlements: true;
}

export function map2DLayerPlan(showRivers: boolean): Map2DLayerPlan {
  return {
    // World trunks are a screen-space vector, like principal roads and cities.
    // Baking them into shallow tiles makes an ancestor blur and magnify them
    // while a deeper tile loads. Deep tiles still draw their LOCAL streams.
    tileLayers: { rivers: false, roads: false, fields: true },
    riverFallback: showRivers,
    roadAlpha: 1,
    principalSettlements: true,
  };
}

/** Equirectangular atlas views can draw the source polyline directly. Other
 * projections keep the projected raster at their shallow, capped zoom range. */
export function map2DVectorRiverFallback(
  showRivers: boolean, viewMode: string, projection: string,
): boolean {
  return showRivers && viewMode === 'atlas' && projection === 'equirect';
}
