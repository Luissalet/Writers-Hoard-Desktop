export const PLACE_MODELS = ['auto', 'house', 'tower', 'keep', 'hall', 'cabin', 'windmill'] as const;
export const BUILDING_STYLES = ['auto', 'nordic', 'latin', 'celtic', 'desert', 'sylvan', 'orcish', 'imperial'] as const;
export const PLACE_LABEL_FONTS = ['theme', 'serif', 'sans', 'mono', 'script'] as const;
export const AREA_STYLES = ['outline', 'wash', 'hatch'] as const;
export type PlaceModel = typeof PLACE_MODELS[number];
export type BuildingStyle = typeof BUILDING_STYLES[number];
export type PlaceLabelFont = typeof PLACE_LABEL_FONTS[number];
