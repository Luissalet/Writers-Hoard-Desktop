import type { Route } from './travel';

const EN: Record<string, string> = {
  'mar': 'sea', 'lago': 'lake', 'marisma': 'marsh', 'turbera': 'peat bog', 'marisma salada': 'salt marsh', 'manglar': 'mangrove',
  'selva': 'rainforest', 'bosque tropical': 'tropical forest', 'bosque monzónico': 'monsoon forest', 'bosque nuboso': 'cloud forest',
  'bosque': 'forest', 'bosque húmedo': 'temperate rainforest', 'taiga': 'taiga', 'bosque de montaña': 'montane forest', 'soto': 'riparian forest',
  'pradera': 'grassland', 'sabana': 'savanna', 'estepa': 'steppe', 'matorral': 'shrubland', 'monte mediterráneo': 'chaparral', 'espinar': 'thorn scrub',
  'páramo': 'moorland', 'tundra': 'tundra', 'desierto': 'desert', 'mar de arena': 'sand sea', 'pedregal': 'stony desert', 'cárcavas': 'badlands',
  'desierto frío': 'cold desert', 'salar': 'salt flat', 'desierto de niebla': 'fog desert', 'roquedo': 'alpine rock', 'pastos de altura': 'alpine meadow',
  'glaciar': 'glacier', 'casquete': 'ice cap', 'playa': 'beach', 'puna': 'puna', 'malpaís': 'volcanic terrain', 'llano de ceniza': 'ash plain',
  'karst': 'karst', 'bambú': 'bamboo', 'calzada': 'road', 'la calzada': 'the road', 'campo abierto': 'open country',
  'no hay ruta de mar entre esos dos puntos': 'there is no sea route between these points',
  'no hay vía de agua continua entre esos dos puntos': 'there is no continuous waterway between these points',
  'un carro no puede llegar hasta allí': 'a cart cannot reach that place',
  'no hay ruta transitable entre esos dos puntos': 'there is no traversable route between these points',
};

/** Presentation only; names authored by the reader are never translated. */
export function englishRoute(route: Route): Route {
  return { ...route, impossible: route.impossible ? EN[route.impossible] ?? route.impossible : undefined,
    legs: route.legs.map(leg => ({ ...leg, terrain: EN[leg.terrain] ?? leg.terrain })),
    stages: route.stages.map(stage => ({ ...stage, terrain: EN[stage.terrain] ?? stage.terrain,
      nearest: stage.nearest ? { ...stage.nearest, kind: stage.nearest.kind === 'ruina' ? 'ruin' : stage.nearest.kind } : undefined })) };
}
