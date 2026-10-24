import type { WorldData } from './types';
import type { WorldSpatialStyle } from './spatialEntities';
import type { CultureId } from './naming';
import { editKey } from './edits';
import { normalizePlaceImage } from './placeImage';
import { normalizePlaceCatalogIcon,hasCatalogPlaceIcon } from './placeIconCatalog';

export { PLACE_MODELS, BUILDING_STYLES, PLACE_LABEL_FONTS, AREA_STYLES } from './placeStyleCatalog';
export type { PlaceModel, BuildingStyle, PlaceLabelFont } from './placeStyleCatalog';
import { PLACE_MODELS, BUILDING_STYLES, PLACE_LABEL_FONTS, AREA_STYLES, type PlaceModel } from './placeStyleCatalog';

/** A moved settlement still addresses its original authored style. */
export function settlementStyle(world: Pick<WorldData, 'painted'>, s: { x: number; y: number; sourceKey?: string }): WorldSpatialStyle {
  const key = s.sourceKey ?? editKey('settlement', s.x, s.y);
  return world.painted?.styles?.[key] ?? {};
}

export function placeFont(style: WorldSpatialStyle, fallback: string): string {
  switch (style.labelFont) {
    case 'serif': return 'Georgia, "Times New Roman", serif';
    case 'sans': return '"Segoe UI", Arial, sans-serif';
    case 'mono': return 'Consolas, "Courier New", monospace';
    // A real system cursive stack; no unbundled face or network dependency.
    case 'script': return '"Segoe Print", "Comic Sans MS", cursive';
    default: return fallback;
  }
}
export function labelScale(style: WorldSpatialStyle): number { return Math.min(2, Math.max(.6, style.labelSize ?? 1)); }
export function symbolScale(style: WorldSpatialStyle): number { return Math.min(2.4, Math.max(.65, style.size ?? 1)); }
export function hasPlaceModel(style: WorldSpatialStyle): boolean {
  if(hasCatalogPlaceIcon(style))return false;
  return !!((style.model && style.model !== 'auto') || ((!style.icon || style.icon === 'auto') && style.buildingStyle && style.buildingStyle !== 'auto'));
}

/** Strict public/UI boundary; saved older sparse styles remain readable. */
export function validatePlaceStyle(input: Record<string, unknown>): WorldSpatialStyle {
  const out: Record<string, unknown> = {};
  const enums = { model: PLACE_MODELS, buildingStyle: BUILDING_STYLES, labelFont: PLACE_LABEL_FONTS, areaStyle: AREA_STYLES };
  const numbers: Record<string, [number, number]> = { size: [.65, 2.4], labelSize: [.6, 2], areaOpacity: [0, 1] };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'catalogIcon') { out[key] = normalizePlaceCatalogIcon(value); continue; }
    if (key === 'iconImage') { out[key] = normalizePlaceImage(value); continue; }
    if (key in enums) {
      if (!(enums[key as keyof typeof enums] as readonly unknown[]).includes(value)) throw new Error(`Invalid ${key}.`);
    } else if (key in numbers) {
      const [min, max] = numbers[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    } else if (key === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('color must be #RRGGBB.');
    } else if (key === 'icon') {
      if (typeof value !== 'string' || !value.trim() || value.length > 16 || [...value].some(c => c.charCodeAt(0) < 32)) throw new Error('icon must contain 1–16 printable characters.');
    } else if (key === 'labelVisible') {
      if (typeof value !== 'boolean') throw new Error('labelVisible must be boolean.');
    } else throw new Error(`Unknown place style property: ${key}.`);
    out[key] = value;
  }
  if (!Object.keys(out).length) throw new Error('Provide at least one style property.');
  return out as WorldSpatialStyle;
}

/** Shared by the engraved projection and the actual 3D mesh, in local units. */
export interface PlacePart { shape: 'box' | 'roof' | 'blade'; x: number; y: number; z: number; w: number; h: number; d: number; material: 'wall' | 'roof' | 'trim'; angle?: number }
export interface BuildingPalette { wall: string; roof: string; trim: string; pitch: number }
// Existing cultural identities, with our own small construction palettes.
export const BUILDING_PALETTES: Record<CultureId, BuildingPalette> = {
  nordic: { wall: '#bcb5a2', roof: '#4e6267', trim: '#53483d', pitch: .75 },
  latin: { wall: '#dfc8a1', roof: '#a25f43', trim: '#6b5543', pitch: .4 },
  celtic: { wall: '#b1b0a0', roof: '#687250', trim: '#565548', pitch: .65 },
  desert: { wall: '#d7b985', roof: '#bb9862', trim: '#725b41', pitch: .12 },
  sylvan: { wall: '#c8d0ba', roof: '#4f7862', trim: '#52604b', pitch: .95 },
  orcish: { wall: '#848371', roof: '#5c5145', trim: '#383d34', pitch: .5 },
  imperial: { wall: '#d0c7b6', roof: '#667080', trim: '#625b55', pitch: .55 },
};
export function buildingPalette(style: WorldSpatialStyle, culture: CultureId = 'imperial'): BuildingPalette {
  const palette = BUILDING_PALETTES[style.buildingStyle && style.buildingStyle !== 'auto' ? style.buildingStyle : culture];
  return style.color ? { ...palette, wall: style.color } : palette;
}
export function placeParts(model: Exclude<PlaceModel, 'auto'>, palette: BuildingPalette): PlacePart[] {
  const parts: PlacePart[] = [];
  const box = (x: number, z: number, w: number, h: number, d: number, y = h / 2) => parts.push({ shape: 'box', x, y, z, w, h, d, material: 'wall' });
  const roof = (x: number, z: number, w: number, y: number, d: number) => parts.push({ shape: 'roof', x, y, z, w, h: w * palette.pitch, d, material: 'roof' });
  if (model === 'tower' || model === 'windmill') {
    box(0, 0, .72, 1.8, .72); roof(0, 0, .9, 1.8, .9);
    if (model === 'windmill') for (let i = 0; i < 4; i++) parts.push({ shape: 'blade', x: 0, y: 1.65, z: .5, w: .14, h: 1.1, d: .07, material: 'trim', angle: Math.PI / 4 + i * Math.PI / 2 });
  } else if (model === 'keep') {
    box(0, 0, 1.5, .75, 1.1);
    for (const x of [-.65, .65]) for (const z of [-.45, .45]) { box(x, z, .48, 1.35, .48); roof(x, z, .58, 1.35, .58); }
    box(0, 0, .7, 1.7, .6); roof(0, 0, .85, 1.7, .75);
  } else {
    const w = model === 'hall' ? 1.7 : model === 'cabin' ? .9 : 1.2;
    const h = model === 'hall' ? 1 : model === 'cabin' ? .65 : 1.05;
    box(0, 0, w, h, .9); roof(0, 0, w + .15, h, 1.05);
    if (model === 'hall') { box(.65, 0, .4, 1.7, .4); roof(.65, 0, .5, 1.7, .5); }
  }
  return parts;
}
