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
  formatWorldRange, toDayNumber, toLastDayNumber, validateWorldCalendar, validateWorldRange,
  type WorldCalendar, type WorldDate,
} from './worldCalendar';

export interface ResolvedWorldCalendar {
  calendar: WorldCalendar;
  /** Project that owns the calendar: this one, or a saga above it. */
  ownerProjectId: string;
  inherited: boolean;
}

const MAX_PARENT_HOPS = 8;

export async function resolveWorldCalendar(projectId: string): Promise<ResolvedWorldCalendar | null> {
  let id: string | undefined = projectId;
  const seen = new Set<string>();
  for (let hop = 0; id && hop <= MAX_PARENT_HOPS && !seen.has(id); hop++) {
    seen.add(id);
    const project: Project | undefined = await db.projects.get(id);
    if (!project) return null;
    if (project.worldCalendar) {
      return { calendar: project.worldCalendar, ownerProjectId: project.id, inherited: project.id !== projectId };
    }
    id = project.parentId;
  }
  return null;
}

/** Save (or with `null` remove) the project's own calendar. Throws with the problems if invalid. */
export async function saveWorldCalendar(projectId: string, calendar: WorldCalendar | null): Promise<void> {
  if (calendar) {
    const errors = validateWorldCalendar(calendar);
    if (errors.length) throw new Error(errors.join(' '));
  }
  await updateProject(projectId, { worldCalendar: calendar ?? undefined });
}

/**
 * Sort key for an event dated in the world calendar: its first day, with the
 * span as tie-breaker. Null when the event is not world-dated or the calendar
 * no longer accepts its date (a month was removed, for instance).
 */
export function worldEventKey(event: Pick<TimelineEvent, 'dateMode' | 'worldDate'>, calendar: WorldCalendar | null | undefined): number | null {
  if (event.dateMode !== 'world' || !event.worldDate || !calendar) return null;
  try {
    return toDayNumber(calendar, event.worldDate);
  } catch {
    return null;
  }
}

/** Last day covered by a world-dated event (its end, or the end of a partial start). */
export function worldEventEndKey(event: Pick<TimelineEvent, 'dateMode' | 'worldDate' | 'worldDateEnd'>, calendar: WorldCalendar | null | undefined): number | null {
  if (event.dateMode !== 'world' || !event.worldDate || !calendar) return null;
  try {
    return toLastDayNumber(calendar, event.worldDateEnd ?? event.worldDate);
  } catch {
    return null;
  }
}

/** Text shown for a world-dated event; falls back to the stored label if the calendar changed. */
export function worldEventLabel(event: Pick<TimelineEvent, 'date' | 'worldDate' | 'worldDateEnd'>, calendar: WorldCalendar | null | undefined): string {
  if (!event.worldDate || !calendar) return event.date || '';
  return validateWorldRange(calendar, event.worldDate, event.worldDateEnd) === null
    ? formatWorldRange(calendar, event.worldDate, event.worldDateEnd)
    : event.date || '';
}

/** Problem with a world-dated range in this calendar, or null. */
export function checkWorldRange(calendar: WorldCalendar | null | undefined, start?: WorldDate, end?: WorldDate): string | null {
  if (!calendar) return 'This project has no world calendar yet.';
  if (!start) return 'Add a start date.';
  return validateWorldRange(calendar, start, end);
}
