import { getEraProject, readEraRow, saveWorldEra } from '@/services/worldEras/store';
import type { Timeline } from '@/types';
// ============================================================================
// World calendar — where a project's calendar lives, and dating events with it
// ============================================================================
//
// The calendar is stored on the project row (`Project.worldCalendar`), so it
// travels with every project backup and needs no schema change. A book of a
// saga (a project with `parentId`) that has no calendar of its own uses the
// first one up its chain of parents.

import { db } from '@/db';
import { updateProject } from '@/db/operations';
import type { Project, TimelineEvent } from '@/types';
import {
  formatWorldDate, toDayNumber, toLastDayNumber, validateWorldCalendar, validateWorldRange,
  type WorldCalendar, type WorldDate,
} from './worldCalendar';
import { clockMinutes, formatTimedRange } from './eventDetails';

export interface ResolvedWorldCalendar {
  calendar: WorldCalendar;
  /** Project that owns the calendar: this one, or a saga above it. */
  ownerProjectId: string;
  inherited: boolean;
  /** Set only when a timeline owns the override. */
  ownerTimelineId?: string;
}

export const MAX_PARENT_HOPS = 8;
/** Same inheritance rules for a captured Reader source; never queries live rows. */
export function resolveCapturedWorldCalendar(projectId:string,timelineId:string|undefined,projects:ReadonlyMap<string,Project>,timelines:readonly Timeline[]):ResolvedWorldCalendar|null{
 if(timelineId){const timeline=timelines.find(row=>row.id===timelineId&&row.projectId===projectId);if(!timeline)return null;if(timeline.worldCalendar)return{calendar:timeline.worldCalendar,ownerProjectId:projectId,ownerTimelineId:timeline.id,inherited:false};}
 let id:string|undefined=projectId;const seen=new Set<string>();
 for(let hop=0;id&&hop<=MAX_PARENT_HOPS&&!seen.has(id);hop++){seen.add(id);const project=projects.get(id);if(!project)return null;if(project.worldCalendar)return{calendar:project.worldCalendar,ownerProjectId:project.id,inherited:!!timelineId||project.id!==projectId};id=project.parentId;}return null;
}

export async function resolveWorldCalendar(projectId: string, timelineId?: string, eraId?: string): Promise<ResolvedWorldCalendar | null> {
  const timelines:Timeline[]=[];
  if(timelineId){const timeline=eraId?await readEraRow<Timeline>({projectId,eraId},'timelines',timelineId):await db.timelines.get(timelineId);if(!timeline||timeline.projectId!==projectId)return null;timelines.push(timeline);if(timeline.worldCalendar)return resolveCapturedWorldCalendar(projectId,timelineId,new Map(),timelines);}
  const projects=new Map<string,Project>();let id:string|undefined=projectId;
  while(id&&projects.size<=MAX_PARENT_HOPS&&!projects.has(id)){const project:Project|undefined=eraId&&id===projectId?await getEraProject({projectId,eraId}):await db.projects.get(id);if(!project)break;projects.set(id,project);if(project.worldCalendar)break;id=project.parentId;}
  return resolveCapturedWorldCalendar(projectId,timelineId,projects,timelines);
}

/** Save (or with `null` remove) the project's own calendar. Throws with the problems if invalid. */
export async function saveWorldCalendar(projectId: string, calendar: WorldCalendar | null, eraId?: string): Promise<void> {
  if (calendar) {
    const errors = validateWorldCalendar(calendar);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (eraId) { const era = (await db.projects.get(projectId))?.worldEras?.find(item => item.id === eraId); if (!era) throw new Error('world_era_missing'); await saveWorldEra(projectId, { ...era, defaults: { ...era.defaults, worldCalendar: calendar ?? undefined } }, era.revision); }
  else await updateProject(projectId, { worldCalendar: calendar ?? undefined });
}

/**
 * Sort key for an event dated in the world calendar: its first day, with the
 * span as tie-breaker. Null when the event is not world-dated or the calendar
 * no longer accepts its date (a month was removed, for instance).
 */
export function worldEventKey(event: Pick<TimelineEvent, 'dateMode' | 'worldDate' | 'time'>, calendar: WorldCalendar | null | undefined): number | null {
  if (event.dateMode !== 'world' || !event.worldDate || !calendar) return null;
  try {
    const minutes = clockMinutes(event.time, calendar.hoursPerDay ?? 24);
    return minutes === null ? null : toDayNumber(calendar, event.worldDate) + minutes / ((calendar.hoursPerDay ?? 24) * 60);
  } catch {
    return null;
  }
}

/** Last day covered by a world-dated event (its end, or the end of a partial start). */
export function worldEventEndKey(event: Pick<TimelineEvent, 'dateMode' | 'worldDate' | 'worldDateEnd' | 'time' | 'endTime'>, calendar: WorldCalendar | null | undefined): number | null {
  if (event.dateMode !== 'world' || !event.worldDate || !calendar) return null;
  try {
    const date = event.worldDateEnd ?? event.worldDate;
    const value = event.endTime || (!event.worldDateEnd ? event.time : undefined);
    const minutes = clockMinutes(value, calendar.hoursPerDay ?? 24);
    if (minutes === null) return null;
    return toLastDayNumber(calendar, date) + (event.time && event.worldDateEnd && !event.endTime ? 1 : minutes / ((calendar.hoursPerDay ?? 24) * 60));
  } catch {
    return null;
  }
}

/** Text shown for a world-dated event; falls back to the stored label if the calendar changed. */
export function worldEventLabel(event: Pick<TimelineEvent, 'date' | 'worldDate' | 'worldDateEnd' | 'time' | 'endTime'>, calendar: WorldCalendar | null | undefined): string {
  if (!event.worldDate || !calendar) return event.date || '';
  return validateWorldRange(calendar, event.worldDate, event.worldDateEnd) === null
    ? formatTimedRange(formatWorldDate(calendar, event.worldDate), event.worldDateEnd ? formatWorldDate(calendar, event.worldDateEnd) : undefined, event.time, event.endTime)
    : event.date || '';
}

/** Problem with a world-dated range in this calendar, or null. */
export function checkWorldRange(calendar: WorldCalendar | null | undefined, start?: WorldDate, end?: WorldDate): string | null {
  if (!calendar) return 'This project has no world calendar yet.';
  if (!start) return 'Add a start date.';
  return validateWorldRange(calendar, start, end);
}
