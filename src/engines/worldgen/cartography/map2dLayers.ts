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
    tileLayers: { rivers: showRivers, roads: false, fields: true },
    riverFallback: showRivers,
    roadAlpha: 1,
    principalSettlements: true,
  };
}
