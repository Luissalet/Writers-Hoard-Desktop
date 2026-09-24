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
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  nextSlot,
  type ToolArgs,
} from './shared';

const DATE_MODES = ['text', 'calendar'] as const satisfies readonly DateMode[];
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
    eventType: event.eventType,
    lane: event.lane,
    color: event.color,
    order: event.order,
    linkedEntryId: event.linkedEntryId,
  };
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
    return { timelineId, events: events.map(serializeEvent) };
  }
  const projectId = resolveProjectId(args);
  const events = await getAllProjectEvents(projectId);
  return { projectId, events: events.map(serializeEvent) };
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

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
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
