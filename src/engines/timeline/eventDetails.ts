import type { TimelineEvent } from '@/types';

/** Single compatibility boundary shared by every event-link reader. */
export function eventEntryIds(event: Pick<TimelineEvent, 'linkedEntryId' | 'linkedEntryIds'>): string[] {
  return [...new Set([...(event.linkedEntryIds ?? []), ...(event.linkedEntryId ? [event.linkedEntryId] : [])].filter(id => typeof id === 'string' && id.length > 0))];
}

export const EVENT_ICONS = ['calendar', 'flag', 'star', 'swords', 'crown', 'heart', 'book', 'sun', 'moon', 'ship', 'mountain'] as const;
export const safeEventImage = (value: string | undefined): value is string => !!value && /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value);

export interface EventDetailDraft { linkedEntryIds: string[]; image: string; icon: NonNullable<TimelineEvent['icon']> | ''; time: string; endTime: string }
export const emptyEventDetails = (): EventDetailDraft => ({ linkedEntryIds: [], image: '', icon: '', time: '', endTime: '' });
export const editEventDetails = (event: TimelineEvent): EventDetailDraft => ({ linkedEntryIds: eventEntryIds(event), image: event.image ?? '', icon: event.icon ?? '', time: event.time ?? '', endTime: event.endTime ?? '' });
export function eventDetailFields(draft: EventDetailDraft, mode: TimelineEvent['dateMode']): Partial<TimelineEvent> {
  const ids = [...new Set(draft.linkedEntryIds)];
  return { linkedEntryIds: ids, linkedEntryId: ids[0], image: safeEventImage(draft.image) ? draft.image : undefined, icon: EVENT_ICONS.includes(draft.icon as typeof EVENT_ICONS[number]) ? draft.icon as TimelineEvent['icon'] : undefined, time: mode !== 'text' && draft.time ? normalizeClock(draft.time) : undefined, endTime: mode !== 'text' && draft.endTime ? normalizeClock(draft.endTime) : undefined };
}

export function clockMinutes(value: string | undefined, hours = 24): number | null {
  if (!value) return 0;
  const match = /^(\d{1,4}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) >= hours || Number(match[2]) >= 60) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
export function normalizeClock(value: string): string { return value.replace(/^(\d+):/, (_, hour: string) => `${Number(hour).toString().padStart(2, '0')}:`); }
export function formatTimedRange(start: string, end?: string, time?: string, endTime?: string): string {
  const first = `${start}${time ? ` · ${normalizeClock(time)}` : ''}`;
  return end ? `${first} – ${end}${endTime ? ` · ${normalizeClock(endTime)}` : ''}` : endTime ? `${first} – ${normalizeClock(endTime)}` : first;
}
