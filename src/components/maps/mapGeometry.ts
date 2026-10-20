import type { MapFeature, MapLayerVisibility, MapPoint, MapPin, MapNamedLayer } from '@/types';

export const DEFAULT_MAP_LAYERS: MapLayerVisibility = { pins: true, region: true, path: true, label: true };
export const EMPTY_MAP_FEATURES: MapFeature[] = [];
export const EMPTY_MAP_NAMED_LAYERS: MapNamedLayer[] = [];
export const mapItemVisible = (item: { layerId?: string }, layers: MapNamedLayer[]): boolean => !item.layerId || layers.find(layer => layer.id === item.layerId)?.visible !== false;
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
  const shapes = features.filter(feature => layers[feature.kind] && mapItemVisible(feature, namedLayers)).map(feature => {
    const points = feature.points.map(position).join(' ');
    const color = escapeXml(feature.color);
    const shape = feature.kind === 'region' ? `<polygon points="${points}" fill="${color}" fill-opacity="${feature.opacity ?? .22}" stroke="${color}" stroke-width="2"/>`
      : feature.kind === 'path' ? `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    return `<g><title>${escapeXml(feature.description || feature.name)}</title>${shape}${label(feature.name, mapFeatureCenter(feature.points), feature.color)}</g>`;
  }).join('');
  const markers = layers.pins ? pins.filter(pin => mapItemVisible(pin, namedLayers)).map(pin => `<g><circle cx="${pin.position.x * w / 100}" cy="${pin.position.y * h / 100}" r="7" fill="${escapeXml(pin.color ?? '#d5b575')}"/>${label(pin.name, { x: pin.position.x, y: pin.position.y - 2 }, '#eeeae2')}</g>`).join('') : '';
  // Uploaded/Gallery backgrounds are data images. Do not turn a remote reference into a network request on export.
  const image = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(background) ? `<image href="${escapeXml(background)}" width="${w}" height="${h}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#17191a"/>${image}${shapes}${markers}</svg>`;
}
