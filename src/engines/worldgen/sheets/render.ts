import type { FixedSheetResult } from './client';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import { renderRegion } from '../region/render';
import type { WorldData } from '../core/types';
import { canonRefinement } from '../region/tiles';
import { resolveWorldSpatialEntity } from '../core/spatialEntities';

/** Exact requested edges are fractional canon cells; crop pixels, never resample/rebuild terrain. */
export function renderFixedSheet(result: FixedSheetResult, world: WorldData, theme: CartoTheme, canvas: HTMLCanvasElement, width: number, title: string) {
  const { spec, crop, frame } = result, ratio = frame.widthKm / frame.heightKm;
  canvas.width = Math.max(1, Math.round(ratio >= 1 ? width : width * ratio)); canvas.height = Math.max(1, Math.round(ratio >= 1 ? width / ratio : width));
  const source = document.createElement('canvas'), scale = canvas.width / crop.width;
  source.width = Math.max(1, Math.ceil(spec.cw * scale)); source.height = Math.max(1, Math.ceil(spec.ch * scale));
  const region = { ...result.region, places: result.region.places.flatMap(place => {
    const entity = resolveWorldSpatialEntity({ key: place.sourceKey, kind: 'region', type: place.landmark ?? place.kind, name: place.name, x: place.worldX, y: place.worldY, extent: .4, importance: place.importance, source: 'regional' }, world.painted);
    if (entity.hidden) return [];
    let dx = entity.x - result.region.originX; dx = ((dx % world.width) + world.width) % world.width;
    return [{ ...place, name: entity.name, x: dx / result.region.worldPerCellX, y: (entity.y - result.region.originY) / result.region.worldPerCellY, worldX: entity.x, worldY: entity.y }];
  }) };
  renderRegion(region, source.getContext('2d') as unknown as Ctx, { theme, width: source.width, height: source.height, layers: { frame: false, scaleBar: false, legend: false }, tileInk: { seed: world.params.seed, gx0: spec.gx0 - spec.margin, gy0: spec.gy0 - spec.margin, wrapX: world.width * canonRefinement(world), contourIntervalM: 100 } });
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, crop.x / spec.cw * source.width, crop.y / spec.ch * source.height, crop.width / spec.cw * source.width, crop.height / spec.ch * source.height, 0, 0, canvas.width, canvas.height);
  const font = Math.max(12, canvas.width / 75), pad = font;
  ctx.fillStyle = 'rgba(248,239,214,.88)'; ctx.fillRect(0, 0, canvas.width, font * 2.4); ctx.fillStyle = '#342c20'; ctx.font = `600 ${font}px Georgia,serif`; ctx.fillText(title, pad, font * 1.6, canvas.width - pad * 2);
  const distance = frame.widthKm / 5, bar = canvas.width / 5, y = canvas.height - pad;
  ctx.fillStyle = 'rgba(248,239,214,.88)'; ctx.fillRect(pad / 2, y - font * 1.8, bar + pad, font * 2.3); ctx.strokeStyle = '#342c20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, y - 4); ctx.lineTo(pad + bar, y - 4); ctx.stroke(); ctx.font = `${font * .8}px sans-serif`; ctx.fillStyle = '#342c20'; ctx.fillText(`${Number(distance.toFixed(3))} km`, pad, y - font * .65);
}
