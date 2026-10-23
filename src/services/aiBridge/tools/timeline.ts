import { scopedTableOps } from '@/services/worldEras/tableOps';
import { worldEraToolScope, checkEraLinkedRow } from '@/services/worldEras/toolScope';
import { listEraRows } from '@/services/worldEras/store';
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
import * as timelineBase from '@/engines/timeline/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
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
import { formatWorldRange, monthsInYear, validateWorldRange, type WorldDate } from '@/engines/timeline/worldCalendar';
import { EVENT_ICONS, eventEntryIds, normalizeClock, safeEventImage } from '@/engines/timeline/eventDetails';
import { timelineEventLabel, validateEventClock } from '@/engines/timeline/eventClock';
import { validateTimelineDates } from '@/engines/timeline/dateValidation';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { calendarMonth } from '@/engines/timeline/calendarGrid';
import { calendarLens } from '@/engines/timeline/calendarLens';
import { earthCalendar } from '@/engines/timeline/calendarPresets';
import { normalizeTagColors, tagKey, filterTimelineEvents, MAX_TIMELINE_VIEWS, normalizeEventTags, normalizeTimelineFilter, normalizeTimelineViews, retagEvents, timelineTagCounts } from '@/engines/timeline/timelineFilter';

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
  const calendar = await requireWorldCalendar(projectId, timelineId, optString(args, 'eraId'));
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
    tags: event.tags ?? [],
    hideFromWiki: !!event.hideFromWiki,
    repeat: event.repeat ?? null,
    bannerPattern: event.bannerPattern ?? 'solid',
    bannerShape: event.bannerShape ?? 'plain',
  };
}

async function extraEventFields(projectId: string, args: ToolArgs, current?: TimelineEvent): Promise<Partial<TimelineEvent>> {
  const fields: Partial<TimelineEvent> = {};
  if (args.linkedEntryIds !== undefined || args.linkedEntryId !== undefined) {
    const multi = optStringArray(args, 'linkedEntryIds');
    if (args.linkedEntryIds !== undefined && (!multi || multi.length > 100 || !Array.isArray(args.linkedEntryIds) || args.linkedEntryIds.some(id => typeof id !== 'string' || !id))) throw new BridgeError('bad-args', 'linkedEntryIds must be an array of up to 100 Codex ids.');
    const primary = optString(args, 'linkedEntryId');
    const ids = [...new Set(multi ?? [...(primary ? [primary] : []), ...(current ? eventEntryIds(current).filter(id => id !== current.linkedEntryId && id !== primary) : [])])];
    for (const id of ids) await checkEraLinkedRow(args, db.codexEntries, id, projectId, 'codex entry');
    fields.linkedEntryIds = ids; fields.linkedEntryId = ids[0];
  }
  for (const key of ['time', 'endTime'] as const) if (args[key] !== undefined) fields[key] = optString(args, key) ? normalizeClock(optString(args, key)!) : undefined;
  if (args.icon !== undefined) {
    const icon = optString(args, 'icon');
    if (icon && !EVENT_ICONS.includes(icon as typeof EVENT_ICONS[number])) throw new BridgeError('bad-args', 'Unsupported timeline icon.');
    fields.icon = icon as TimelineEvent['icon'] || undefined;
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags) || args.tags.some(tag => typeof tag !== 'string')) throw new BridgeError('bad-args', 'tags must be a list of words (up to 20, 40 characters each).');
    const tags = normalizeEventTags(args.tags);
    fields.tags = tags.length ? tags : undefined;
  }
  if (args.hideFromWiki !== undefined) {
    if (typeof args.hideFromWiki !== 'boolean') throw new BridgeError('bad-args', 'hideFromWiki is true or false.');
    fields.hideFromWiki = args.hideFromWiki ? true : undefined;
  }
  if (args.bannerPattern !== undefined) {
    if (!['solid', 'stripes', 'dots', 'checks'].includes(String(args.bannerPattern))) throw new BridgeError('bad-args', 'bannerPattern is solid, stripes, dots or checks.');
    fields.bannerPattern = args.bannerPattern === 'solid' ? undefined : args.bannerPattern as TimelineEvent['bannerPattern'];
  }
  if (args.bannerShape !== undefined) {
    if (typeof args.bannerShape !== 'string' || !['plain', 'ribbon', 'bunting', 'scallop'].includes(args.bannerShape)) throw new BridgeError('bad-args', 'bannerShape is plain, ribbon, bunting or scallop.');
    fields.bannerShape = args.bannerShape === 'plain' ? undefined : args.bannerShape as TimelineEvent['bannerShape'];
  }
  if (args.repeat !== undefined) {
    if (args.repeat === null) fields.repeat = undefined;
    else {
      const repeat = args.repeat as { every?: unknown; untilYear?: unknown };
      if (!repeat || !['year', 'month', 'week'].includes(String(repeat.every)) || (repeat.untilYear !== undefined && !Number.isSafeInteger(repeat.untilYear))) throw new BridgeError('bad-args', 'repeat is {every: year|month|week, untilYear?} or null.');
      fields.repeat = { every: repeat.every as 'year' | 'month' | 'week', ...(repeat.untilYear !== undefined ? { untilYear: repeat.untilYear as number } : {}) };
    }
  }
  if (args.image !== undefined) {
    const image = optString(args, 'image');
    if (image && (!safeEventImage(image) || image.length > Math.ceil(5 * 1024 * 1024 * 4 / 3) + 100)) throw new BridgeError('bad-args', 'image must be an embedded raster under 5 MB.');
    fields.image = image || undefined;
  }
  return fields;
}

async function validateEventDating(event: TimelineEvent, eraId?: string): Promise<void> {
  const calendar = event.dateMode === 'world' ? await requireWorldCalendar(event.projectId, event.timelineId, eraId) : null;
  const problem = (event.dateMode === 'calendar' ? validateTimelineDates(event.realDate ?? '', event.realDateEnd ?? '') : null) ?? validateEventClock(event, calendar);
  if (problem) throw new BridgeError('bad-args', problem);
  if (event.dateMode !== 'text') event.date = timelineEventLabel(event, calendar);
}

export async function whListTimelines(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const timelines = await timelineOperations(args).timelines.getAll(projectId);
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
  await timelineOperations(args).timelines.create(timeline);
  return withAudit(
    { id: timeline.id, title: timeline.title, created: true },
    { projectId, entityId: timeline.id, summary: `created timeline "${timeline.title}"` },
  );
}

/** The filter arguments of wh_list_events: tags (any), types, text, wikiOnly. */
function filterArg(args: ToolArgs) {
  return normalizeTimelineFilter({ tags: args.tags, types: args.types, text: args.text, wikiOnly: args.wikiOnly });
}

export async function whListEvents(args: ToolArgs): Promise<unknown> {
  const filter = filterArg(args);
  const timelineId = optString(args, 'timelineId');
  if (timelineId) {
    const timeline = await timelineOperations(args).timelines.getOne(timelineId);
    if (!timeline) throw new BridgeError('not-found', `No timeline with id "${timelineId}".`);
    assertRowInScope(args, timeline.projectId);
    const events = await timelineOperations(args).events.getAll(timelineId);
    const calendar = (await resolveWorldCalendar(timeline.projectId, timelineId, optString(args, 'eraId')))?.calendar;
    return { timelineId, events: filterTimelineEvents(events, filter).map(event => serializeEvent({ ...event, date: timelineEventLabel(event, calendar) })) };
  }
  const projectId = resolveProjectId(args);
  const events = worldEraToolScope(args) ? await listEraRows<TimelineEvent>(worldEraToolScope(args)!, 'timelineEvents') : await timelineBase.getAllProjectEvents(projectId);
  const calendars = new Map(await Promise.all([...new Set(events.map(event => event.timelineId))].map(async id => [id, (await resolveWorldCalendar(projectId, id, optString(args, 'eraId')))?.calendar] as const)));
  return { projectId, events: filterTimelineEvents(events, filter).map(event => serializeEvent({ ...event, date: timelineEventLabel(event, calendars.get(event.timelineId)) })) };
}

export async function whCreateEvent(args: ToolArgs): Promise<unknown> {
  const timelineId = requireString(args, 'timelineId');
  const timeline = await timelineOperations(args).timelines.getOne(timelineId);
  if (!timeline) {
    throw new BridgeError(
      'not-found',
      `No timeline with id "${timelineId}". Call wh_list_timelines, or wh_create_timeline first.`,
    );
  }
  await assertEngineEnabled(timeline.projectId, 'timeline');
  assertRowInScope(args, timeline.projectId);
  const linkedEntryId = optString(args, 'linkedEntryId') || undefined;
  await checkEraLinkedRow(args, db.codexEntries, linkedEntryId, timeline.projectId, 'codex entry');
  const siblings = await timelineOperations(args).events.getAll(timelineId);
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
  await validateEventDating(event, optString(args, 'eraId'));
  if (event.endTime && !args.eventType) event.eventType = 'range';
  await timelineOperations(args).events.create(event);
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
  const existing = await timelineOperations(args).events.getOne(id);
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
  await checkEraLinkedRow(args, db.codexEntries, changes.linkedEntryId, existing.projectId, 'codex entry');
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
  await validateEventDating(next, optString(args, 'eraId'));
  if (next.dateMode !== 'text') changes.date = next.date;
  await timelineOperations(args).events.update(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated event "${existing.title}"`,
      before: { ...serializeEvent(existing), ...(existing.bannerShape === undefined ? { __absent: ['bannerShape'] } : {}) },
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
    timelineOperations(args).events.getOne(sourceEventId),
    timelineOperations(args).events.getOne(targetEventId),
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
  await timelineOperations(args).connections.create(connection);
  return withAudit(
    { id: connection.id, created: true },
    {
      projectId: source.projectId,
      entityId: connection.id,
      summary: `linked "${source.title}" to "${target.title}"`,
    },
  );
}

/** Put a timeline's settings back (in its era when the change was made in one). */
export async function restoreTimelineSettings(projectId: string, eraId: string | undefined, id: string, before: { title: string; color: string; description: string | null; displayPrecision: string | null; yearRange: { start: number; end: number } | null }): Promise<void> {
  const ops = timelineOperations({ projectId, ...(eraId ? { eraId } : {}) });
  await ops.timelines.update(id, { title: before.title, color: before.color, description: before.description ?? undefined, displayPrecision: (before.displayPrecision ?? undefined) as Timeline['displayPrecision'], yearRange: before.yearRange ?? undefined } as Partial<Timeline>);
}

function timelineOperations(args: ToolArgs) {
  const scope = worldEraToolScope(args);
  return {
    timelines: scopedTableOps(scope, 'timelines', 'projectId', { getAll: timelineBase.getTimelines, getOne: id => db.timelines.get(id), create: timelineBase.createTimeline, update: timelineBase.updateTimeline, delete: timelineBase.deleteTimeline }),
    events: scopedTableOps(scope, 'timelineEvents', 'timelineId', { getAll: timelineBase.getTimelineEvents, getOne: id => db.timelineEvents.get(id), create: timelineBase.createTimelineEvent, update: timelineBase.updateTimelineEvent, delete: timelineBase.deleteTimelineEvent }),
    connections: scopedTableOps(scope, 'timelineConnections', 'projectId', { getAll: timelineBase.getConnectionsForProject, getOne: id => db.timelineConnections.get(id), create: timelineBase.createConnection, update: timelineBase.updateConnection, delete: timelineBase.deleteConnection }),
  };
}

/**
 * A copy of a timeline event, right after it on its timeline, as "Duplicate
 * event" in the swim lanes does: the same dates, kind, colour, links and
 * description, a new id and "(copy)" (or the given title). Undoable.
 */
export async function whDuplicateEvent(args: ToolArgs): Promise<unknown> {
  if (typeof args.projectId === 'string' && args.projectId) await assertEngineEnabled(resolveProjectId(args), 'timeline');
  const id = requireString(args, 'id');
  const existing = await timelineOperations(args).events.getOne(id);
  if (!existing) throw new BridgeError('not-found', `No timeline event with id "${id}".`);
  await assertEngineEnabled(existing.projectId, 'timeline');
  assertRowInScope(args, existing.projectId);
  const title = optString(args, 'title')?.trim() || `${existing.title} (copy)`;
  const now = Date.now();
  const siblings = (await timelineOperations(args).events.getAll(existing.timelineId)).sort((a, b) => a.order - b.order);
  const copy: TimelineEvent = { ...structuredClone(existing), id: generateId('event'), title, createdAt: now, updatedAt: now };
  delete copy.familySource;
  // Right after its original: the ones after it move one place along.
  const at = siblings.findIndex((event) => event.id === existing.id);
  const lane = [...siblings];
  lane.splice(at + 1, 0, copy);
  copy.order = at + 1;
  await timelineOperations(args).events.create(copy);
  for (const [index, event] of lane.entries()) if (event.id !== copy.id && event.order !== index) await timelineOperations(args).events.update(event.id, { order: index });
  return withAudit(
    { id: copy.id, title: copy.title, timelineId: copy.timelineId, duplicateOf: existing.id, created: true },
    { projectId: existing.projectId, entityId: copy.id, summary: `duplicated event "${existing.title}"` },
  );
}

/** Every event of the project in the effective scope (base or era). */
async function projectEvents(args: ToolArgs, projectId: string): Promise<TimelineEvent[]> {
  const scope = worldEraToolScope(args);
  return scope ? listEraRows<TimelineEvent>(scope, 'timelineEvents') : timelineBase.getAllProjectEvents(projectId);
}

/**
 * The tags on a project's timeline events: list them with their counts, rename
 * one on every event (into an existing tag = merge) or take one off every
 * event. Undoable.
 */
export async function whTimelineTags(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'timeline');
  const action = optEnum(args, 'action', ['list', 'rename', 'remove', 'color'] as const) ?? 'list';
  const events = await projectEvents(args, projectId);
  const colors = normalizeTagColors((await db.projects.get(projectId))?.timelineTagColors);
  if (action === 'list') return { projectId, tags: timelineTagCounts(events).map(row => ({ ...row, color: colors[tagKey(row.tag)] ?? null })) };
  if (action === 'color') {
    await assertEngineEnabled(projectId, 'timeline');
    const tag = requireString(args, 'tag'), color = typeof args.color === 'string' ? args.color : '';
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new BridgeError('bad-args', 'color is #rrggbb, or "" to remove it.');
    const next = { ...colors }; if (color) next[tagKey(tag)] = color.toLowerCase(); else delete next[tagKey(tag)];
    await db.projects.update(projectId, { timelineTagColors: Object.keys(next).length ? next : undefined, updatedAt: Date.now() });
    return withAudit({ projectId, tag, color: color || null }, { projectId, entityId: projectId, summary: `tag "${tag}" colour`, before: { __timelineTagColors: colors } });
  }
  await assertEngineEnabled(projectId, 'timeline');
  const tag = requireString(args, 'tag');
  const to = action === 'rename' ? requireString(args, 'to') : null;
  if (to !== null && !normalizeEventTags([to]).length) throw new BridgeError('bad-args', 'to must be a tag of 1 to 40 characters.');
  const changes = retagEvents(events, tag, to);
  if (!changes.length) throw new BridgeError('not-found', `No event carries the tag "${tag}"; see wh_timeline_tags action list.`);
  const before = changes.map(change => ({ id: change.id, tags: events.find(event => event.id === change.id)?.tags ?? [] }));
  for (const change of changes) await timelineOperations(args).events.update(change.id, { tags: change.tags });
  return withAudit(
    { projectId, action, tag, to, events: changes.length, tags: timelineTagCounts(await projectEvents(args, projectId)) },
    { projectId, entityId: projectId, summary: to ? `renamed tag "${tag}" to "${to}" on ${changes.length} event(s)` : `removed tag "${tag}" from ${changes.length} event(s)`, before: { __eventTags: before } },
  );
}
/** Put the tags back on the events a tag rename or removal changed. */
export async function restoreEventTags(args: ToolArgs, rows: Array<{ id: string; tags: string[] }>): Promise<void> {
  for (const row of rows) await timelineOperations(args).events.update(row.id, { tags: row.tags.length ? row.tags : undefined });
}

/** Saved views of the timeline (named filters): list, save (replaces one of the same name) or remove. */
export async function whTimelineViews(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'timeline');
  const action = optEnum(args, 'action', ['list', 'save', 'remove'] as const) ?? 'list';
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project not found.');
  const views = normalizeTimelineViews(project.timelineViews);
  if (action === 'list') return { projectId, views };
  await assertEngineEnabled(projectId, 'timeline');
  let next = views;
  let id: string | undefined;
  if (action === 'save') {
    const name = requireString(args, 'name').trim().slice(0, 60);
    const filter = filterArg(args);
    if (!filter.tags.length && !filter.types.length && !filter.text.trim() && !filter.wikiOnly) throw new BridgeError('bad-args', 'A view needs at least one of tags, types, text or wikiOnly.');
    const same = views.find(view => view.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    id = same?.id ?? generateId('tlview');
    next = [...views.filter(view => view.id !== id), { id, name, filter }];
    if (next.length > MAX_TIMELINE_VIEWS) throw new BridgeError('bad-args', `At most ${MAX_TIMELINE_VIEWS} saved views.`);
  } else {
    id = requireString(args, 'viewId');
    if (!views.some(view => view.id === id)) throw new BridgeError('not-found', 'No saved view with that viewId; see action list.');
    next = views.filter(view => view.id !== id);
  }
  await db.projects.update(projectId, { timelineViews: next.length ? next : undefined, updatedAt: Date.now() });
  return withAudit(
    { projectId, action, viewId: id, views: next },
    { projectId, entityId: projectId, summary: `timeline view ${action}`, before: { __timelineViews: views } },
  );
}

/**
 * The calendar view as data: one month's days (weekday, holidays, moon phase,
 * leap day, events) or a year's months with how many events each holds, on the
 * project's world calendar or the Gregorian one.
 */
export async function whTimelineCalendar(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const kind = optEnum(args, 'calendar', ['world', 'earth'] as const) ?? 'world';
  const projectWorld = (await resolveWorldCalendar(projectId, undefined, optString(args, 'eraId')))?.calendar ?? null;
  const world = kind === 'world' ? projectWorld : null;
  // With a correlation, the events of the other calendar show too, as in the calendar view.
  const lens = calendarLens(projectWorld);
  if (kind === 'world' && !world) throw new BridgeError('bad-args', 'The project has no world calendar; use calendar "earth" or set one with wh_world_calendar_set.');
  const calendar = world ?? earthCalendar(optEnum(args, 'locale', ['es', 'en'] as const) ?? 'es');
  const year = optNumber(args, 'year');
  if (year === undefined || !Number.isInteger(year)) throw new BridgeError('bad-args', 'year (an absolute year number) is required.');
  const filter = normalizeTimelineFilter({ tags: args.tags, types: args.types, text: args.text, wikiOnly: args.wikiOnly });
  const events = filterTimelineEvents(await projectEvents(args, projectId), filter);
  const month = optNumber(args, 'month');
  try {
    if (month !== undefined) {
      if (!Number.isInteger(month) || month < 1 || month > calendar.months.length) throw new BridgeError('bad-args', `month is 1 to ${calendar.months.length}.`);
      const grid = calendarMonth(calendar, kind, year, month, events, lens);
      return { calendar: calendar.name, year, month, name: grid.name, leapYear: grid.leapYear, intercalary: grid.intercalary, days: grid.days.map(day => ({ day: day.day, weekday: day.weekday, holidays: day.holidays, moon: day.moon, leapDay: day.leapDay || undefined, events: day.events.map(event => ({ id: event.id, title: event.title })) })) };
    }
    const months = monthsInYear(calendar, year).map(m => calendarMonth(calendar, kind, year, m, events, lens));
    return { calendar: calendar.name, year, months: months.map(m => ({ month: m.month, name: m.name, days: m.days.length, events: [...new Set(m.days.flatMap(day => day.events.map(event => event.id)))].length })) };
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('bad-args', error instanceof Error ? error.message : 'That year is not on this calendar.');
  }
}

/**
 * A timeline's own settings, as the timeline's settings panel changes them:
 * its title, colour and description, how precisely its dates are shown
 * (year, month, day or hour) and the span of years it covers. Undoable.
 */
export async function whTimelineSettings(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'timeline');
  const id = requireString(args, 'timelineId');
  const ops = timelineOperations(args);
  const timeline = await ops.timelines.getOne(id) as Timeline | undefined;
  if (!timeline || timeline.projectId !== projectId) throw new BridgeError('not-found', 'No timeline with that id in this project.');
  const before = { title: timeline.title, color: timeline.color, description: timeline.description ?? null, displayPrecision: timeline.displayPrecision ?? null, yearRange: timeline.yearRange ?? null };
  const changes: Partial<Timeline> = {};
  if (args.title !== undefined) { if (typeof args.title !== 'string' || !args.title.trim() || args.title.length > 200) throw new BridgeError('bad-args', 'title is 1 to 200 characters.'); changes.title = args.title.trim(); }
  if (args.color !== undefined) { if (typeof args.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(args.color)) throw new BridgeError('bad-args', 'color is #rrggbb.'); changes.color = args.color; }
  if (args.description !== undefined) { if (typeof args.description !== 'string' || args.description.length > 5000) throw new BridgeError('bad-args', 'description is up to 5000 characters.'); changes.description = args.description; }
  const settings: Pick<Partial<Timeline>, 'displayPrecision' | 'yearRange'> = {};
  if (args.displayPrecision !== undefined) { if (!['year', 'month', 'day', 'hour'].includes(String(args.displayPrecision))) throw new BridgeError('bad-args', 'displayPrecision is year, month, day or hour.'); settings.displayPrecision = args.displayPrecision as Timeline['displayPrecision']; }
  if (args.yearRange !== undefined) {
    if (args.yearRange === null) settings.yearRange = undefined;
    else { const range = args.yearRange as { start?: unknown; end?: unknown }; if (!range || typeof range.start !== 'number' || typeof range.end !== 'number') throw new BridgeError('bad-args', 'yearRange is {start, end} or null.'); settings.yearRange = { start: range.start, end: range.end }; }
  }
  if (!Object.keys(changes).length && !Object.keys(settings).length && args.yearRange === undefined) throw new BridgeError('bad-args', 'Pass title, color, description, displayPrecision or yearRange.');
  // The checked settings first: if the range or precision is refused, nothing has changed.
  if (Object.keys(settings).length || args.yearRange !== undefined) {
    const { saveTimelineSettings } = await import('@/engines/timeline/timelineSettings');
    try { await saveTimelineSettings(projectId, id, { displayPrecision: settings.displayPrecision ?? timeline.displayPrecision, yearRange: args.yearRange !== undefined ? settings.yearRange : timeline.yearRange }, optString(args, 'eraId')); }
    catch (error) { throw new BridgeError('bad-args', error instanceof Error ? error.message : String(error)); }
  }
  if (Object.keys(changes).length) await ops.timelines.update(id, changes);
  const after = await ops.timelines.getOne(id) as Timeline;
  return withAudit(
    { id, title: after.title, color: after.color, displayPrecision: after.displayPrecision ?? 'hour', yearRange: after.yearRange ?? null },
    { projectId, entityId: id, kind: 'update', summary: `changed timeline "${after.title}" settings`, before: { __timelineSettings: before, ...(optString(args, 'eraId') ? { __eraId: optString(args, 'eraId') } : {}) } },
  );
}
