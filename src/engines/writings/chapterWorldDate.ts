// Chapters dated in the project's world calendar. Pure: no database, no DOM.
import {
  formatWorldRange, toDayNumber, validateWorldRange,
  type WorldCalendar,
} from '@/engines/timeline/worldCalendar';
import type { Timeline, TimelineEvent, Writing } from '@/types';

export const MANUSCRIPT_LANE_ID = 'manuscript-lane';
export const MANUSCRIPT_EVENT_PREFIX = 'ms:';

type Dated = Pick<Writing, 'worldDate' | 'worldDateEnd'>;

/** The chapter's date as text in the calendar, or '' when undated or no longer valid there. */
export function chapterWorldLabel(calendar: WorldCalendar | null | undefined, writing: Dated): string {
  if (!calendar || !writing.worldDate) return '';
  try {
    if (validateWorldRange(calendar, writing.worldDate, writing.worldDateEnd) !== null) return '';
    return formatWorldRange(calendar, writing.worldDate, writing.worldDateEnd);
  } catch {
    return '';
  }
}

/** Day number of the chapter's start in the calendar, or null when it has none. */
export function chapterWorldKey(calendar: WorldCalendar | null | undefined, writing: Dated): number | null {
  if (!calendar || !writing.worldDate || !chapterWorldLabel(calendar, writing)) return null;
  try { return toDayNumber(calendar, writing.worldDate); } catch { return null; }
}

/**
 * Read-only lane and events that put the dated chapters on the timeline.
 * Ordered by world date (then chapter number, then title); never stored.
 */
export function manuscriptTimelineItems(
  calendar: WorldCalendar | null | undefined,
  writings: Writing[],
  projectId: string,
  laneTitle: string,
): { lane: Timeline; events: TimelineEvent[] } | null {
  if (!calendar) return null;
  const dated = writings
    .map((w) => ({ w, key: chapterWorldKey(calendar, w) }))
    .filter((x): x is { w: Writing; key: number } => x.key !== null)
    .sort((a, b) => a.key - b.key || (a.w.chapter ?? 1e9) - (b.w.chapter ?? 1e9) || a.w.title.localeCompare(b.w.title));
  if (dated.length === 0) return null;
  const lane: Timeline = {
    id: MANUSCRIPT_LANE_ID, projectId, title: laneTitle, color: '#8b7cc8', createdAt: 0, updatedAt: 0,
  };
  const events = dated.map(({ w }, index): TimelineEvent => ({
    id: `${MANUSCRIPT_EVENT_PREFIX}${w.id}`,
    projectId,
    timelineId: MANUSCRIPT_LANE_ID,
    title: w.chapter !== undefined ? `${w.chapter}. ${w.title}` : w.title,
    description: w.synopsis ?? '',
    date: chapterWorldLabel(calendar, w),
    dateMode: 'world',
    worldDate: w.worldDate,
    worldDateEnd: w.worldDateEnd,
    eventType: w.worldDateEnd ? 'range' : 'point',
    order: index,
    lane: MANUSCRIPT_LANE_ID,
    color: lane.color,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
  return { lane, events };
}

export function isManuscriptEventId(id: string): boolean {
  return id.startsWith(MANUSCRIPT_EVENT_PREFIX);
}
