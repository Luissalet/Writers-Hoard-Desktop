import { readEraRow } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { Writing } from '@/types';
import { db } from '@/db';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { listWorldLinks, worldgenScopeOperations } from './era';
import { openWorldForReading } from './bridgeAccess';
import { describeWorldPresence } from './placeCards';
import { validateWeatherDate } from './core/weather';

/** Explicit place links only. Several settings remain selectable, never guessed from prose. */
export async function chapterWorldContext(scope: WorldEraScope, writingId: string) {
  const writing = await readEraRow<Writing>(scope, 'writings', writingId);
  if (!writing || writing.projectId !== scope.projectId) return { status: 'missing' as const, places: [] };
  const resolved = await resolveWorldCalendar(scope.projectId, undefined, scope.eraId);
  const context = resolved && writing.worldDate ? { calendar: resolved.calendar, date: writing.worldDate } : undefined;
  let exact = false;
  if (context) { try { validateWeatherDate(context); exact = true; } catch { /* A partial date remains unknown. */ } }
  // Outline has no era adapter: its narrative spine is project-shared.
  const beats = await db.outlineBeats.where('projectId').equals(scope.projectId).toArray();
  const scenes = new Set(beats.filter(beat => beat.linkedWritingId === writingId).map(beat => beat.linkedSceneId).filter(Boolean));
  const worlds = await worldgenScopeOperations(scope).worlds.getAll(scope.projectId);
  const places: { worldId: string; worldTitle: string; key: string; name: string; card: ReturnType<typeof describeWorldPresence> }[] = [];
  let pending = false;
  for (const world of worlds) {
    const links = (await listWorldLinks(scope, world.id)).filter(link => link.sourceEntityType === 'world-spatial'
      && (link.targetEngineId === 'writings' && link.targetEntityId === writingId || link.targetEntityType === 'scene' && scenes.has(link.targetEntityId)));
    if (!links.length) continue;
    const opened = await openWorldForReading(world, 'full', scope.eraId);
    if (!opened.ok) { pending = true; continue; }
    for (const link of links) {
      const key = link.sourceEntityId.slice(`${world.id}::`.length);
      const place = opened.world.atlas.byKey.get(key);
      if (!place || places.some(p => p.worldId === world.id && p.key === key)) continue;
      places.push({ worldId: world.id, worldTitle: world.title, key, name: place.name,
        card: describeWorldPresence(opened.world.data, opened.world.geo, place, exact ? context : undefined, world.edits) });
    }
  }
  return { status: pending ? 'pending' as const : !exact ? 'undated' as const : 'ready' as const, places };
}
