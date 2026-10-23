// Tags on timeline events, the filter over them and the views saved from it.
// Pure: the engine, its filter bar, the wiki export and the bridge use these.
import type { TimelineEvent, TimelineEventType } from '@/types';

export const MAX_EVENT_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_TIMELINE_VIEWS = 30;
const EVENT_TYPES: readonly TimelineEventType[] = ['point', 'range', 'milestone'];

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/** Trimmed, without a leading "#", at most 40 characters, no repeats (case and accents aside), at most 20. */
export function normalizeEventTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || seen.has(fold(tag))) continue;
    seen.add(fold(tag)); out.push(tag);
    if (out.length >= MAX_EVENT_TAGS) break;
  }
  return out;
}

export interface TimelineFilter {
  /** Events carrying any of these tags (none = every event). */
  tags: string[];
  /** Event shapes shown (none = all). */
  types: TimelineEventType[];
  /** Words in the title, description, date or lane. */
  text: string;
  /** Hide the events kept out of the wiki. */
  wikiOnly?: boolean;
}
export const EMPTY_TIMELINE_FILTER: TimelineFilter = { tags: [], types: [], text: '' };
export const isFilterActive = (filter: TimelineFilter) => filter.tags.length > 0 || filter.types.length > 0 || !!filter.text.trim() || !!filter.wikiOnly;

export function normalizeTimelineFilter(value: unknown): TimelineFilter {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<TimelineFilter>;
  return {
    tags: normalizeEventTags(raw.tags),
    types: Array.isArray(raw.types) ? [...new Set(raw.types.filter((type): type is TimelineEventType => EVENT_TYPES.includes(type as TimelineEventType)))] : [],
    text: typeof raw.text === 'string' ? raw.text.slice(0, 120) : '',
    ...(raw.wikiOnly === true ? { wikiOnly: true } : {}),
  };
}

export function eventMatches(event: TimelineEvent, filter: TimelineFilter): boolean {
  if (filter.wikiOnly && event.hideFromWiki) return false;
  if (filter.types.length && !filter.types.includes(event.eventType || 'point')) return false;
  if (filter.tags.length) {
    const own = new Set((event.tags ?? []).map(fold));
    if (!filter.tags.some(tag => own.has(fold(tag)))) return false;
  }
  const words = fold(filter.text).split(/\s+/).filter(Boolean);
  if (words.length) {
    const hay = fold([event.title, event.description, event.date, event.lane, ...(event.tags ?? [])].join(' '));
    if (!words.every(word => hay.includes(word))) return false;
  }
  return true;
}
export function filterTimelineEvents<T extends TimelineEvent>(events: readonly T[], filter: TimelineFilter): T[] {
  return isFilterActive(filter) ? events.filter(event => eventMatches(event, filter)) : [...events];
}

/** Every tag in use with how many events carry it, most used first. */
export function timelineTagCounts(events: readonly TimelineEvent[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const event of events) for (const tag of event.tags ?? []) {
    const key = fold(tag), row = counts.get(key);
    if (row) row.count++; else counts.set(key, { tag, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Rename a tag on every event that carries it (into an existing tag = merge),
 * or take it off with `to` null. Returns only the events that change.
 */
export function retagEvents(events: readonly TimelineEvent[], from: string, to: string | null): Array<{ id: string; tags: string[] | undefined }> {
  const key = fold(from), target = to === null ? null : normalizeEventTags([to])[0];
  if (!key || target === undefined) return [];
  const changed: Array<{ id: string; tags: string[] | undefined }> = [];
  for (const event of events) {
    const tags = event.tags ?? [];
    if (!tags.some(tag => fold(tag) === key)) continue;
    const next = normalizeEventTags(tags.flatMap(tag => fold(tag) === key ? (target === null ? [] : [target]) : [tag]));
    changed.push({ id: event.id, tags: next.length ? next : undefined });
  }
  return changed;
}

export interface TimelineSavedView { id: string; name: string; filter: TimelineFilter }
export function normalizeTimelineViews(value: unknown): TimelineSavedView[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>(), out: TimelineSavedView[] = [];
  for (const raw of value as Partial<TimelineSavedView>[]) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id) || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    ids.add(raw.id); out.push({ id: raw.id, name: raw.name.trim().slice(0, 60), filter: normalizeTimelineFilter(raw.filter) });
    if (out.length >= MAX_TIMELINE_VIEWS) break;
  }
  return out;
}

export const TAG_COLORS = ['#c0504d', '#e08a3c', '#d5b575', '#6aa84f', '#3d85c6', '#8e7cc3', '#c27ba0', '#7f8c8d'] as const;
/** Tag colours kept: keyed by the folded tag, #rrggbb only. */
export function normalizeTagColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, color]) => key && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 200).map(([key, color]) => [fold(key), (color as string).toLowerCase()]));
}
export const tagColorOf = (colors: Record<string, string>, tag: string): string | undefined => colors[fold(tag)];
export const tagKey = (tag: string) => fold(tag);
