import { useLiveQuery } from 'dexie-react-hooks';
import { formatWorldDate, type WorldCalendar, type WorldDate } from './worldCalendar';
import { resolveWorldCalendar, type ResolvedWorldCalendar } from './worldCalendarStore';

/** The calendar the project dates its events in (its own or its saga's); undefined while loading. */
export function useWorldCalendar(projectId: string): ResolvedWorldCalendar | null | undefined {
  return useLiveQuery(() => resolveWorldCalendar(projectId), [projectId]);
}

/** Text a world date is edited as. */
export function worldDateText(calendar: WorldCalendar | null | undefined, date?: WorldDate): string {
  if (!calendar || !date) return '';
  try { return formatWorldDate(calendar, date); } catch { return ''; }
}

