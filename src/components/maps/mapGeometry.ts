import type { MapFeature, MapLayerVisibility, MapPoint, MapPin, MapNamedLayer } from '@/types';
import { patternSvg, patternTile, resolvedLabel, resolvedStroke } from './mapStyle';

export const DEFAULT_MAP_LAYERS: MapLayerVisibility = { pins: true, region: true, path: true, label: true };
export const EMPTY_MAP_FEATURES: MapFeature[] = [];
export const EMPTY_MAP_NAMED_LAYERS: MapNamedLayer[] = [];
/** The named layers an item belongs to: all of `layerIds`, or the single older `layerId`. */
export const mapItemLayers = (item: { layerId?: string; layerIds?: string[] }): string[] => item.layerIds?.length ? item.layerIds : item.layerId ? [item.layerId] : [];
/** Shown when it belongs to no named layer, or while any of its layers is visible (a deleted layer counts as visible). */
export const mapItemVisible = (item: { layerId?: string; layerIds?: string[] }, layers: MapNamedLayer[]): boolean => {
  const ids = mapItemLayers(item);
  return !ids.length || ids.some(id => layers.find(layer => layer.id === id)?.visible !== false);
};
/** The fields that record a new set of layers. */
export const withMapLayers = (ids: string[]): { layerId?: string; layerIds?: string[] } => ({ layerId: ids[0], layerIds: ids.length > 1 ? ids : undefined });
export const clampMapCoordinate = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
export const mapPoint = (x: number, y: number): MapPoint => ({ x: clampMapCoordinate(x), y: clampMapCoordinate(y) });
export const minimumMapPoints = (kind: MapFeature['kind']): number => kind === 'region' ? 3 : kind === 'path' ? 2 : 1;
export const mapFeatureCenter = (points: MapPoint[]): MapPoint => points.length
  ? { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }
  : { x: 50, y: 50 };

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Self-contained vector export: no services, script, foreignObject, or linked resources. */
export function exportMapSvg(background: string, width: number, height: number, features: MapFeature[], pins: MapPin[], layers: MapLayerVisibility, namedLayers: MapNamedLayer[] = []): string {
  const w = Math.max(1, width), h = Math.max(1, height);
  const position = (point: MapPoint) => `${point.x * w / 100},${point.y * h / 100}`;
  const label = (name: string, point: MapPoint, color: string) => `<text x="${point.x * w / 100}" y="${point.y * h / 100}" text-anchor="middle" fill="${escapeXml(color)}" stroke="#17191a" stroke-width="3" paint-order="stroke" font-family="Georgia,serif" font-size="${Math.max(14, w / 65)}">${escapeXml(name)}</text>`;
  // A shape's own lettering: the old look (14 px floor, Georgia, dark halo) unless the author styled it.
  const shapeLabel = (feature: MapFeature, point: MapPoint) => {
    const l = resolvedLabel(feature), x = point.x * w / 100, y = point.y * h / 100;
    const size = feature.labelStyle?.size !== undefined ? l.size * w / 100 : Math.max(14, w / 65);
    return `<text x="${x}" y="${y}" text-anchor="middle" fill="${escapeXml(l.fill)}" stroke="${escapeXml(l.outline)}" stroke-width="${l.outlineWidth}" paint-order="stroke" font-family="${escapeXml(l.family)}" font-size="${size}"${l.weight !== 400 ? ` font-weight="${l.weight}"` : ''}${l.style !== 'normal' ? ` font-style="${l.style}"` : ''}${l.rotation ? ` transform="rotate(${l.rotation} ${x} ${y})"` : ''}>${escapeXml(feature.name)}</text>`;
  };
  const defs: string[] = [];
  const shapes = features.filter(feature => layers[feature.kind] && mapItemVisible(feature, namedLayers)).map((feature, index) => {
    const points = feature.points.map(position).join(' ');
    const color = escapeXml(feature.color);
    const stroke = resolvedStroke(feature);
    const tile = feature.kind === 'region' ? patternTile(feature, w / 100) : null;
    if (tile) defs.push(patternSvg(`p${index}`, tile));
    const shape = feature.kind === 'region' ? `<polygon points="${points}" fill="${color}" fill-opacity="${feature.opacity ?? .22}" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.width}"/>${tile ? `<polygon points="${points}" fill="url(#p${index})" stroke="none"/>` : ''}`
      : feature.kind === 'path' ? `<polyline points="${points}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    return `<g><title>${escapeXml(feature.description || feature.name)}</title>${shape}${shapeLabel(feature, mapFeatureCenter(feature.points))}</g>`;
  }).join('');
  const pinRadius = { S: 5, M: 7, L: 10 } as const;
  const markers = layers.pins ? pins.filter(pin => mapItemVisible(pin, namedLayers)).map(pin => `<g><circle cx="${pin.position.x * w / 100}" cy="${pin.position.y * h / 100}" r="${pinRadius[pin.size ?? 'M']}" fill="${escapeXml(pin.color ?? '#d5b575')}"/>${label(pin.name, { x: pin.position.x, y: pin.position.y - 2 }, '#eeeae2')}</g>`).join('') : '';
  // Uploaded/Gallery backgrounds are data images. Do not turn a remote reference into a network request on export.
  const image = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(background) ? `<image href="${escapeXml(background)}" width="${w}" height="${h}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<rect width="100%" height="100%" fill="#17191a"/>${image}${shapes}${markers}</svg>`;
}
