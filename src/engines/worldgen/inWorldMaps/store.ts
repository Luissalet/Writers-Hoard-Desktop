import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { assertValidDate, defaultWorldCalendar, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { readEraRow } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry } from '@/types';
import { THEMES } from '../cartography/theme';
import { FOG_OPS } from '../core/readerFog';
import { worldgenScopeOperations } from '../era';
import { stableStringify } from '../region/workerProtocol';
import type { InWorldMap } from './types';

export const MIN_REACH = 0.025;
export const MAX_REACH = 0.35;
export const MAX_MARKS = 500;
const FALLBACK = defaultWorldCalendar();
export const defaultMapCalendars = {
  en: FALLBACK,
  es: { ...FALLBACK, name: 'Calendario', months: FALLBACK.months.map((month, index) => ({ ...month, name: 'Mes ' + (index + 1) })),
    weekdays: FALLBACK.weekdays.map((_, index) => 'Día ' + (index + 1)),
    eras: [{ name: 'Era común', abbr: 'EC', startYear: 1 }], moons: [{ ...FALLBACK.moons[0], name: 'Luna' }] },
};

export class InWorldMapError extends Error {
  readonly code: 'bad-args' | 'not-found' | 'conflict';
  constructor(code: InWorldMapError['code'], message: string) { super(message); this.code = code; }
}

export function validateInWorldMap(map: InWorldMap, calendar: WorldCalendar): void {
  const bounded = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
  if (!map.id || typeof map.title !== 'string' || !map.title.trim() || map.title.length > 120
      || !map.origin || !['culture', 'place'].includes(map.origin.kind) || typeof map.origin.id !== 'string' || !map.origin.id
      || !bounded(map.reach, MIN_REACH, MAX_REACH) || !bounded(map.distortion, 0, 1)
      || !THEMES.some(theme => theme.id === map.themeId)
      || (map.chapter !== undefined && (!Number.isSafeInteger(map.chapter) || map.chapter < 1))
      || (map.entryId !== undefined && (typeof map.entryId !== 'string' || !map.entryId))
      || !map.date || !Number.isSafeInteger(map.date.year)
      || !Array.isArray(map.marks) || map.marks.length > MAX_MARKS
      || map.marks.some(mark => !mark || !Number.isFinite(mark.x) || !Number.isFinite(mark.y)
        || !bounded(mark.radius, 1, 4096) || !FOG_OPS.includes(mark.op))) {
    throw new InWorldMapError('bad-args', 'Invalid map details');
  }
  try { assertValidDate(calendar, map.date); }
  catch { throw new InWorldMapError('bad-args', 'Invalid map date'); }
}

export interface MapChange {
  id: string;
  before: InWorldMap | null;
  after: InWorldMap | null;
}

export async function changeInWorldMap(scope: WorldEraScope, worldId: string, change: MapChange, restoring = false) {
  const { worlds } = worldgenScopeOperations(scope);
  await db.transaction('rw', scope.eraId ? db.tables : [db.generatedWorlds, db.codexEntries], async () => {
    const row = await worlds.getOne(worldId);
    if (!row || row.projectId !== scope.projectId) throw new InWorldMapError('not-found', 'World no longer exists');
    const current = row.inWorldMaps ?? [];
    const found = current.find(map => map.id === change.id) ?? null;
    if (stableStringify(found) !== stableStringify(change.before)) throw new InWorldMapError('conflict', 'Map changed');
    if (change.after?.entryId && change.after.entryId !== found?.entryId && !restoring) {
      const entry = scope.eraId ? await readEraRow<CodexEntry>(scope, 'codexEntries', change.after.entryId) : await db.codexEntries.get(change.after.entryId);
      if (!entry || entry.projectId !== scope.projectId) throw new InWorldMapError('not-found', 'Codex card no longer exists');
    }
    const next = found
      ? current.flatMap(map => map.id === change.id ? (change.after ? [change.after] : []) : [map])
      : [...current, ...(change.after ? [change.after] : [])];
    await worlds.update(worldId, { inWorldMaps: next, updatedAt: Date.now() });
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', projectId: scope.projectId, entityId: worldId });
}

export async function revertInWorldMap(scope: WorldEraScope, worldId: string, change: MapChange) {
  await changeInWorldMap(scope, worldId, { id: change.id, before: change.after, after: change.before }, true);
}
