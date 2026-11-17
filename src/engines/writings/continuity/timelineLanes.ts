// Travel legs of the continuity check as read-only timeline lanes: one lane per
// character, one band per leg from the day they leave to the day they must
// arrive, coloured by verdict. Pure: never stored; clicking a band opens the
// destination chapter (the id carries it after the manuscript prefix).
import { formatWorldRange, fromDayNumber, type WorldCalendar } from '@/engines/timeline/worldCalendar';
import { MANUSCRIPT_EVENT_PREFIX, MANUSCRIPT_LANE_ID } from '@/engines/writings/chapterWorldDate';
import type { Timeline, TimelineEvent } from '@/types';
import type { TravelLeg, TravelVerdict } from './travel';
import type { ChapterRef } from './types';

export const TRAVEL_LANE_PREFIX = `${MANUSCRIPT_LANE_ID}:travel:`;

export const VERDICT_COLORS: Record<TravelVerdict, string> = {
  impossible: '#dc2626',
  tight: '#d97706',
  comfortable: '#16a34a',
  unknown: '#8a8578',
};

export interface TravelLaneLabels {
  lane: (characterName: string) => string;
  verdict: (verdict: TravelVerdict) => string;
  intended: string;
}

/** The chapter a timeline event id opens: the part after the manuscript prefix, before any `#`. */
export function writingIdOfTimelineEvent(id: string): string {
  return id.slice(MANUSCRIPT_EVENT_PREFIX.length).split('#')[0];
}

export function isTravelLaneId(id: string): boolean {
  return id.startsWith(TRAVEL_LANE_PREFIX);
}

export function travelTimelineItems(
  calendar: WorldCalendar | null | undefined,
  legs: ReadonlyArray<TravelLeg & { intentional?: string }>,
  chapters: readonly ChapterRef[],
  titles: Readonly<Record<string, string>>,
  projectId: string,
  labels: TravelLaneLabels,
): { lanes: Timeline[]; events: TimelineEvent[] } {
  if (!calendar) return { lanes: [], events: [] };
  const byWriting = new Map(chapters.map((c) => [c.writingId, c]));
  const lanes = new Map<string, Timeline>();
  const events: TimelineEvent[] = [];
  legs.forEach((leg, index) => {
    const start = byWriting.get(leg.from.writingId)?.start, end = byWriting.get(leg.to.writingId)?.end;
    if (start == null || end == null || end < start) return;
    const laneId = `${TRAVEL_LANE_PREFIX}${leg.characterId}`;
    if (!lanes.has(laneId)) lanes.set(laneId, { id: laneId, projectId, title: labels.lane(titles[leg.characterId] ?? leg.characterId), color: '#b08968', createdAt: 0, updatedAt: 0 });
    let worldDate, worldDateEnd;
    try { worldDate = fromDayNumber(calendar, start); worldDateEnd = fromDayNumber(calendar, end); } catch { return; }
    const verdict = labels.verdict(leg.verdict);
    events.push({
      id: `${MANUSCRIPT_EVENT_PREFIX}${leg.to.writingId}#leg:${leg.id}`,
      projectId,
      timelineId: laneId,
      title: `${leg.from.label} → ${leg.to.label}`,
      description: leg.intentional !== undefined ? `${verdict} · ${labels.intended}: ${leg.intentional}` : verdict,
      date: formatWorldRange(calendar, worldDate, end > start ? worldDateEnd : undefined),
      dateMode: 'world',
      worldDate,
      worldDateEnd: end > start ? worldDateEnd : undefined,
      eventType: end > start ? 'range' : 'point',
      order: index,
      lane: laneId,
      color: leg.intentional !== undefined ? VERDICT_COLORS.unknown : VERDICT_COLORS[leg.verdict],
      createdAt: 0,
      updatedAt: 0,
    });
  });
  return { lanes: [...lanes.values()].sort((a, b) => a.title.localeCompare(b.title)), events };
}
