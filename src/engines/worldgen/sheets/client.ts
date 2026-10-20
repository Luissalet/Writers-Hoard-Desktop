import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';
import { regionClient, type RegionRequestOptions } from '../region/client';
import { canonParams, tileGeometry, tileKey, tileWindow } from '../region/tiles';
import { canonWindowCover, composeCanonWindow } from '../region/composeWindow';
import { sheetSpec, type SheetFrame } from './frame';
import type { RegionData } from '../region/types';

export interface FixedSheetResult extends ReturnType<typeof sheetSpec> { region: RegionData }
export type SheetRequest = typeof requestFixedSheet;
/** Two requests at a time; shares the existing canon's cache, persistence and edit identity. */
export function requestFixedSheet(world: WorldData, geography: HumanGeography, frame: SheetFrame, options: Pick<RegionRequestOptions, 'edits' | 'signal' | 'workerFactory' | 'onProgress'> = {}) {
  const geometry = sheetSpec(world, frame), ids = canonWindowCover(world, geometry.spec), controller = new AbortController();
  const active = new Set<ReturnType<typeof regionClient.request>>(), placed: Array<{ id: typeof ids[number]; data: RegionData }> = [];
  const cancel = () => { controller.abort(); for (const handle of active) handle.cancel(); };
  options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) cancel();
  let cursor = 0, done = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = ids[cursor++], handle = regionClient.request(world, geography, tileWindow(world, id), { ...options, signal: controller.signal, params: canonParams(world), geometry: tileGeometry(world, id), canonKey: tileKey(id) });
      active.add(handle);
      try { placed.push({ id, data: await handle.promise }); options.onProgress?.('canon', ++done / ids.length); }
      finally { active.delete(handle); }
    }
  };
  const promise: Promise<FixedSheetResult> = Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker)).then(() => ({ ...geometry, region: composeCanonWindow(world, placed.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id)), geometry.spec) })).catch(error => { cancel(); throw error; }).finally(() => options.signal?.removeEventListener('abort', cancel));
  return { promise, cancel };
}
