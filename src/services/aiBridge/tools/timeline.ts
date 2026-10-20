// ============================================================================
// AI bridge tools — timelines, events and the links between them
// ============================================================================

import { db } from '@/db';
import type {
  DateMode,
  Timeline,
  TimelineConnection,
  TimelineConnectionStyle,
  TimelineEvent,
  TimelineEventType,
} from '@/types';
import {
  createConnection,
  createTimeline,
  createTimelineEvent,
  getAllProjectEvents,
  getTimelineEvents,
  getTimelines,
  updateTimelineEvent,
} from '@/engines/timeline/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  checkLinkedRow,
  BridgeError,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  nextSlot,
  type ToolArgs,
} from './shared';
import { requireWorldCalendar, worldDateArg } from './worldCalendar';
import { formatWorldRange, validateWorldRange, type WorldDate } from '@/engines/timeline/worldCalendar';
import { EVENT_ICONS, eventEntryIds, normalizeClock, safeEventImage } from '@/engines/timeline/eventDetails';
import { timelineEventLabel, validateEventClock } from '@/engines/timeline/eventClock';
import { validateTimelineDates } from '@/engines/timeline/dateValidation';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';

/**
 * World-calendar fields for an event: parse `worldDate`/`worldDateEnd` in the
 * project's calendar, check the range and build the label kept in `date`.
 */
async function worldDating(
  projectId: string,
  args: ToolArgs,
  current?: { worldDate?: WorldDate; worldDateEnd?: WorldDate },
  timelineId?: string,
): Promise<Pick<TimelineEvent, 'worldDate' | 'worldDateEnd' | 'date'>> {
  const calendar = await requireWorldCalendar(projectId, timelineId);
  const worldDate = worldDateArg(calendar, args.worldDate, 'worldDate') ?? current?.worldDate;
  if (!worldDate) throw new BridgeError('bad-args', 'dateMode "world" needs "worldDate" (text like "12 Frostfall 431 TE" or { year, month, day }).');
  const worldDateEnd = args.worldDateEnd === null || args.worldDateEnd === ''
    ? undefined
    : worldDateArg(calendar, args.worldDateEnd, 'worldDateEnd') ?? current?.worldDateEnd;
  const problem = validateWorldRange(calendar, worldDate, worldDateEnd);
  if (problem) throw new BridgeError('bad-args', problem);
  return { worldDate, worldDateEnd, date: formatWorldRange(calendar, worldDate, worldDateEnd) };
}

const DATE_MODES = ['text', 'calendar', 'world'] as const satisfies readonly DateMode[];
const EVENT_TYPES = ['point', 'range', 'milestone'] as const satisfies readonly TimelineEventType[];
const STYLES = ['solid', 'dashed', 'dotted'] as const satisfies readonly TimelineConnectionStyle[];
const DEFAULT_COLOR = '#c4973b';

function serializeEvent(event: TimelineEvent): Record<string, unknown> {
  return {
    id: event.id,
    timelineId: event.timelineId,
    title: event.title,
    description: event.description,
    date: event.date,
    dateMode: event.dateMode,
    realDate: event.realDate,
    realDateEnd: event.realDateEnd,
    worldDate: event.worldDate,
    worldDateEnd: event.worldDateEnd,
    eventType: event.eventType,
    lane: event.lane,
    color: event.color,
    order: event.order,
    linkedEntryId: event.linkedEntryId,
    linkedEntryIds: eventEntryIds(event),
    time: event.time,
    endTime: event.endTime,
    icon: event.icon,
    image: event.image,
  };
}

async function extraEventFields(projectId: string, args: ToolArgs, current?: TimelineEvent): Promise<Partial<TimelineEvent>> {
  const fields: Partial<TimelineEvent> = {};
  if (args.linkedEntryIds !== undefined || args.linkedEntryId !== undefined) {
    const multi = optStringArray(args, 'linkedEntryIds');
    if (args.linkedEntryIds !== undefined && (!multi || multi.length > 100 || !Array.isArray(args.linkedEntryIds) || args.linkedEntryIds.some(id => typeof id !== 'string' || !id))) throw new BridgeError('bad-args', 'linkedEntryIds must be an array of up to 100 Codex ids.');
    const primary = optString(args, 'linkedEntryId');
    const ids = [...new Set(multi ?? [...(primary ? [primary] : []), ...(current ? eventEntryIds(current).filter(id => id !== current.linkedEntryId && id !== primary) : [])])];
    for (const id of ids) await checkLinkedRow(db.codexEntries, id, projectId, 'codex entry');
    fields.linkedEntryIds = ids; fields.linkedEntryId = ids[0];
  }
  for (const key of ['time', 'endTime'] as const) if (args[key] !== undefined) fields[key] = optString(args, key) ? normalizeClock(optString(args, key)!) : undefined;
  if (args.icon !== undefined) {
    const icon = optString(args, 'icon');
    if (icon && !EVENT_ICONS.includes(icon as typeof EVENT_ICONS[number])) throw new BridgeError('bad-args', 'Unsupported timeline icon.');
    fields.icon = icon as TimelineEvent['icon'] || undefined;
  }
  if (args.image !== undefined) {
    const image = optString(args, 'image');
    if (image && (!safeEventImage(image) || image.length > Math.ceil(5 * 1024 * 1024 * 4 / 3) + 100)) throw new BridgeError('bad-args', 'image must be an embedded raster under 5 MB.');
    fields.image = image || undefined;
  }
  return fields;
}

async function validateEventDating(event: TimelineEvent): Promise<void> {
  const calendar = event.dateMode === 'world' ? await requireWorldCalendar(event.projectId, event.timelineId) : null;
  const problem = (event.dateMode === 'calendar' ? validateTimelineDates(event.realDate ?? '', event.realDateEnd ?? '') : null) ?? validateEventClock(event, calendar);
  if (problem) throw new BridgeError('bad-args', problem);
  if (event.dateMode !== 'text') event.date = timelineEventLabel(event, calendar);
}

export async function whListTimelines(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const timelines = await getTimelines(projectId);
  return {
    projectId,
    timelines: timelines.map((timeline) => ({
      id: timeline.id,
      title: timeline.title,
      description: timeline.description,
      color: timeline.color,
      worldCalendar: timeline.worldCalendar,
      yearRange: timeline.yearRange,
      displayPrecision: timeline.displayPrecision,
      updatedAt: timeline.updatedAt,
    })),
  };
}

export async function whCreateTimeline(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'timeline');
  const now = Date.now();
  const timeline: Timeline = {
    id: generateId('timeline'),
    projectId,
    title: requireString(args, 'title'),
    color: optString(args, 'color') ?? DEFAULT_COLOR,
    description: optString(args, 'description'),
    createdAt: now,
    updatedAt: now,
  };
  await createTimeline(timeline);
  return withAudit(
    { id: timeline.id, title: timeline.title, created: true },
    { projectId, entityId: timeline.id, summary: `created timeline "${timeline.title}"` },
  );
}

export async function whListEvents(args: ToolArgs): Promise<unknown> {
  const timelineId = optString(args, 'timelineId');
  if (timelineId) {
    const timeline = await db.timelines.get(timelineId);
    if (!timeline) throw new BridgeError('not-found', `No timeline with id "${timelineId}".`);
    assertRowInScope(args, timeline.projectId);
    const events = await getTimelineEvents(timelineId);
    const calendar = (await resolveWorldCalendar(timeline.projectId, timelineId))?.calendar;
    return { timelineId, events: events.map(event => serializeEvent({ ...event, date: timelineEventLabel(event, calendar) })) };
  }
  const projectId = resolveProjectId(args);
  const events = await getAllProjectEvents(projectId);
  const calendars = new Map(await Promise.all([...new Set(events.map(event => event.timelineId))].map(async id => [id, (await resolveWorldCalendar(projectId, id))?.calendar] as const)));
  return { projectId, events: events.map(event => serializeEvent({ ...event, date: timelineEventLabel(event, calendars.get(event.timelineId)) })) };
}

export async function whCreateEvent(args: ToolArgs): Promise<unknown> {
  const timelineId = requireString(args, 'timelineId');
  const timeline = await db.timelines.get(timelineId);
  if (!timeline) {
    throw new BridgeError(
      'not-found',
      `No timeline with id "${timelineId}". Call wh_list_timelines, or wh_create_timeline first.`,
    );
  }
  await assertEngineEnabled(timeline.projectId, 'timeline');
  assertRowInScope(args, timeline.projectId);
  const linkedEntryId = optString(args, 'linkedEntryId') || undefined;
  await checkLinkedRow(db.codexEntries, linkedEntryId, timeline.projectId, 'codex entry');
  const siblings = await getTimelineEvents(timelineId);
  const now = Date.now();
  const event: TimelineEvent = {
    id: generateId('event'),
    projectId: timeline.projectId,
    timelineId,
    title: requireString(args, 'title'),
    description: optString(args, 'description') ?? '',
    date: optString(args, 'date') ?? '',
    dateMode: optEnum(args, 'dateMode', DATE_MODES) ?? 'text',
    realDate: optString(args, 'realDate'),
    realDateEnd: optString(args, 'realDateEnd'),
    eventType: optEnum(args, 'eventType', EVENT_TYPES) ?? 'point',
    order: optNumber(args, 'order') ?? nextSlot(siblings, 'order'),
    lane: optString(args, 'lane') ?? '',
    color: optString(args, 'color') ?? timeline.color ?? DEFAULT_COLOR,
    linkedEntryId,
    createdAt: now,
    updatedAt: now,
  };
  if (event.dateMode === 'world') {
    Object.assign(event, await worldDating(timeline.projectId, args, undefined, timelineId));
    if (event.worldDateEnd && !args.eventType) event.eventType = 'range';
  }
  Object.assign(event, await extraEventFields(timeline.projectId, args));
  await validateEventDating(event);
  if (event.endTime && !args.eventType) event.eventType = 'range';
  await createTimelineEvent(event);
  return withAudit(
    { id: event.id, title: event.title, timelineId, created: true },
    {
      projectId: timeline.projectId,
      entityId: event.id,
      summary: `created event "${event.title}" on "${timeline.title}"`,
    },
  );
}

export async function whUpdateEvent(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await db.timelineEvents.get(id);
  if (!existing) throw new BridgeError('not-found', `No timeline event with id "${id}".`);
  await assertEngineEnabled(existing.projectId, 'timeline');
  assertRowInScope(args, existing.projectId);

  const changes: Partial<TimelineEvent> = {};
  const assignString = (key: 'title' | 'description' | 'date' | 'realDate' | 'realDateEnd' | 'lane' | 'color' | 'linkedEntryId'): void => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  };
  (['title', 'description', 'date', 'realDate', 'realDateEnd', 'lane', 'color', 'linkedEntryId'] as const)
    .forEach(assignString);
  await checkLinkedRow(db.codexEntries, changes.linkedEntryId, existing.projectId, 'codex entry');
  const dateMode = optEnum(args, 'dateMode', DATE_MODES);
  if (dateMode !== undefined) changes.dateMode = dateMode;
  const eventType = optEnum(args, 'eventType', EVENT_TYPES);
  if (eventType !== undefined) changes.eventType = eventType;
  const order = optNumber(args, 'order');
  if (order !== undefined) changes.order = order;
  const mode = changes.dateMode ?? existing.dateMode;
  if (mode === 'world' && (changes.dateMode === 'world' || args.worldDate !== undefined || args.worldDateEnd !== undefined)) {
    Object.assign(changes, await worldDating(existing.projectId, args, existing, existing.timelineId));
  } else if (args.worldDate !== undefined || args.worldDateEnd !== undefined) {
    throw new BridgeError('bad-args', 'worldDate/worldDateEnd need dateMode "world".');
  }

  Object.assign(changes, await extraEventFields(existing.projectId, args, existing));
  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const next = { ...existing, ...changes };
  await validateEventDating(next);
  if (next.dateMode !== 'text') changes.date = next.date;
  await updateTimelineEvent(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated event "${existing.title}"`,
      before: serializeEvent(existing),
    },
  );
}

export async function whConnectEvents(args: ToolArgs): Promise<unknown> {
  const sourceEventId = requireString(args, 'sourceEventId');
  const targetEventId = requireString(args, 'targetEventId');
  if (sourceEventId === targetEventId) {
    throw new BridgeError('bad-args', 'An event cannot be connected to itself.');
  }
  const [source, target] = await Promise.all([
    db.timelineEvents.get(sourceEventId),
    db.timelineEvents.get(targetEventId),
  ]);
  if (!source) throw new BridgeError('not-found', `No event with id "${sourceEventId}".`);
  await assertEngineEnabled(source.projectId, 'timeline');
  assertRowInScope(args, source.projectId);
  if (!target) throw new BridgeError('not-found', `No event with id "${targetEventId}".`);
  if (source.projectId !== target.projectId) {
    throw new BridgeError('bad-args', 'Both events must belong to the same project.');
  }

  const connection: TimelineConnection = {
    id: generateId('conn'),
    projectId: source.projectId,
    // Connections may cross timelines; they are stored on the target's.
    timelineId: target.timelineId,
    sourceEventId,
    targetEventId,
    label: optString(args, 'label'),
    color: optString(args, 'color') ?? DEFAULT_COLOR,
    style: optEnum(args, 'style', STYLES) ?? 'solid',
    createdAt: Date.now(),
  };
  await createConnection(connection);
  return withAudit(
    { id: connection.id, created: true },
    {
      projectId: source.projectId,
      entityId: connection.id,
      summary: `linked "${source.title}" to "${target.title}"`,
    },
  );
}
