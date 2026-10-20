import { DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { buildLanguageFamily } from '@/engines/worldgen/core/language';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import type { SavedWorldRegion } from '@/engines/worldgen/types';
import type { RegionWorkerLike } from '@/engines/worldgen/region/client';
import type { RegionGenerateWorkerRequest, RegionWorkerReply, RegionWorkerRequest } from '@/engines/worldgen/region/workerProtocol';
import { DEFAULT_REGION_PARAMS, type RegionData } from '@/engines/worldgen/region/types';
import type { RegionGeometry } from '@/engines/worldgen/region/terrain';

export const sheetWorld = { width: 2048, height: 1024, params: { ...DEFAULT_PARAMS, seed: 'fixed-sheet-fixture' }, revision: 7 } as WorldData;
export const sheetGeography: HumanGeography = { settlements: [], roads: [], realms: [], realmOf: new Int32Array(1), features: [], ruins: [], landforms: [], languages: buildLanguageFamily('fixed-sheet-fixture', 2), languageOf: {} };
export function fixedSheet(id = 'sheet'): SavedWorldRegion { return { id, title: 'Las costas del estuario', x: 1024, y: 512, spanKm: 90.125, frameMode: 'canon', params: { ...DEFAULT_REGION_PARAMS, aspect: 90.125 / 57.75 }, createdAt: 1, updatedAt: 1 }; }
/** Synthetic canon fixture; tests production copy/clipping/render paths without forging new terrain. */
export function sheetTile(g: RegionGeometry): RegionData {
  const n = g.width * g.height, region: RegionData = { ...g, window: { cx: g.originX, cy: g.originY, spanKm: g.width * g.metresPerCell / 1000 }, params: DEFAULT_REGION_PARAMS, elevation: new Float32Array(n), water: new Uint8Array(n), flow: new Float32Array(n), slope: new Float32Array(n), wet: new Float32Array(n), biome: new Uint8Array(n), cover: new Uint8Array(n), places: [], streams: [], tracks: [], fields: [], hedges: [], dykes: [], title: 'Estuario', subtitle: 'Costa del norte' };
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) { const at = y * g.width + x, wx = g.originX + x * g.worldPerCellX, wy = g.originY + y * g.worldPerCellY, height = Math.sin((wx - 1024) * 1.3) * .18 + (wy - 512) * .22 + Math.cos(wx * .8) * .07; region.elevation[at] = height; region.water[at] = height <= 0 ? 1 : 0; region.cover[at] = height <= 0 ? 0 : height > .5 ? 4 : 9; region.biome[at] = height <= 0 ? 0 : 7; region.flow[at] = .2; region.wet[at] = .3; region.slope[at] = .1; }
  const m = g.margin, left = g.originX + m * g.worldPerCellX, top = g.originY + m * g.worldPerCellY, wx = Math.max(left + .5, Math.min(left + 3.5, 1024)), wy = Math.max(top + .5, Math.min(top + 3.5, 512)), centre = (wx - g.originX) / g.worldPerCellX, centreY = (wy - g.originY) / g.worldPerCellY;
  region.places.push({ id: Math.round(wx + wy), sourceKey: `region:fixture:${wx},${wy}`, kind: 'village', x: centre, y: centreY, worldX: wx, worldY: wy, name: 'Puerto del Viento', importance: .8, households: 42 });
  const line = Array.from({ length: 20 }, (_, index) => ({ x: m + index * (g.width - m * 2) / 19, y: centreY + Math.sin(index / 3) * 4 }));
  region.streams.push({ id: 1, pts: line, flow: .3, areaKm2: 8, trunk: false }); region.tracks.push({ kind: 'path', pts: line.map(point => ({ x: point.x, y: point.y + 12 })), exits: ['e', 'w'], name: 'Camino de Salinas' });
  region.fields.push({ poly: [{ x: centre - 10, y: centreY - 10 }, { x: centre + 10, y: centreY - 10 }, { x: centre + 10, y: centreY + 10 }, { x: centre - 10, y: centreY + 10 }], cover: 11, strip: false }); region.hedges.push(line); region.dykes.push(line.map(point => ({ x: point.x, y: point.y - 9 })));
  return region;
}
export function sheetWorkerFactory(metrics = { generated: 0, active: 0, maxActive: 0, cancelled: 0 }) {
  return () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const worker: RegionWorkerLike = { onmessage: null, onerror: null, onmessageerror: null,
      postMessage(message: RegionWorkerRequest) { if (message.type !== 'generate') return; metrics.generated++; metrics.active++; metrics.maxActive = Math.max(metrics.maxActive, metrics.active); const timer = setTimeout(() => { timers.delete(timer); metrics.active--; const data = message as RegionGenerateWorkerRequest; worker.onmessage?.({ data: { type: 'done', requestId: data.requestId, region: sheetTile(data.geometry!) } as RegionWorkerReply } as MessageEvent<RegionWorkerReply>); }, 20); timers.add(timer); },
      terminate() { metrics.cancelled++; for (const timer of timers) { clearTimeout(timer); metrics.active--; } timers.clear(); },
    };
    return worker;
  };
}
