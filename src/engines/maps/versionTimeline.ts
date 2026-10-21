import type { MapVersion, TimelineEvent } from '@/types';
import { formatWorldDate, toDayNumber, type WorldCalendar } from '@/engines/timeline/worldCalendar';

export interface OrderedMapVersion {
  version: MapVersion;
  /** The linked event, when it still exists. */
  event?: TimelineEvent;
  /** Linked to an event that has since been deleted. */
  orphan: boolean;
  /** What to call the era's moment: the event's date when linked, else the typed date. */
  dateLabel: string;
}

/**
 * The calendar an event is dated in: one for the whole project, or a function
 * giving each event its own timeline's calendar (timelines may have their own).
 */
export type CalendarSource = WorldCalendar | null | undefined | ((event: TimelineEvent) => WorldCalendar | null | undefined);
const calendarOf = (source: CalendarSource, event: TimelineEvent) => (typeof source === 'function' ? source(event) : source);

/** A chronological key for an event: world-calendar day, real date, or timeline order. */
function eventKey(event: TimelineEvent, source: CalendarSource): [number, number] {
  const calendar = calendarOf(source, event);
  if (event.worldDate && calendar) { try { return [0, toDayNumber(calendar, event.worldDate)]; } catch { /* partial or invalid: fall through */ } }
  if (event.realDate) { const ms = Date.parse(event.realDate); if (Number.isFinite(ms)) return [1, ms]; }
  return [2, event.order];
}

/** Events in the world's chronology, for pickers. */
export function chronologicalEvents(events: TimelineEvent[], calendar: CalendarSource): TimelineEvent[] {
  return events.map((event, index) => ({ event, index, key: eventKey(event, calendar) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index).map(item => item.event);
}

/** How an event's moment reads: its world date, real date, or typed date. */
export function eventDate(event: TimelineEvent, source: CalendarSource): string {
  const calendar = calendarOf(source, event);
  if (event.worldDate && calendar) { try { return formatWorldDate(calendar, event.worldDate); } catch { /* use the stored text */ } }
  return event.realDate || event.date || '';
}

/**
 * An era linked to a moment and left without a typed date keeps that moment's
 * date as its own, so it still reads correctly if the event is later deleted.
 */
export function withMomentDate<T extends { date: string; eventId?: string | null }>(metadata: T, events: TimelineEvent[], calendar?: CalendarSource): T {
  if (metadata.date.trim() || !metadata.eventId) return metadata;
  const event = events.find(item => item.id === metadata.eventId);
  const date = event ? eventDate(event, calendar) : '';
  return date ? { ...metadata, date } : metadata;
}

/**
 * The eras in the order a reader travels through them: linked eras first, in
 * the timeline's own chronology, then unlinked eras in the order they were
 * saved. Nothing is reordered in storage.
 */
export function orderMapVersions(versions: MapVersion[], events: TimelineEvent[], calendar?: CalendarSource): OrderedMapVersion[] {
  const byId = new Map(events.map(event => [event.id, event]));
  const rows = versions.map((version, index) => {
    const event = version.timelineEventId ? byId.get(version.timelineEventId) : undefined;
    return { index, row: { version, event, orphan: !!version.timelineEventId && !event, dateLabel: event ? eventDate(event, calendar) : version.date } satisfies OrderedMapVersion, key: event ? eventKey(event, calendar) : null };
  });
  return rows.sort((a, b) => {
    if (a.key && b.key) return a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index;
    if (a.key) return -1;
    if (b.key) return 1;
    return a.index - b.index;
  }).map(item => item.row);
}
