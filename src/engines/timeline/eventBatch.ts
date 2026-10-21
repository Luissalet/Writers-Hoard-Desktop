import { db } from '@/db';
import Dexie, { type Transaction } from 'dexie';
import { eraDocumentVersion, validateEraDocument } from '@/services/worldEras/adapters';
import { announceEraChange, listWorldDocuments, saveEraDocument } from '@/services/worldEras/store';
import type { EraDocument, WorldEraScope } from '@/services/worldEras/types';
import { resolveWorldCalendar } from './worldCalendarStore';
import { addDays, validateWorldRange, type WorldCalendar } from './worldCalendar';
import { validateTimelineDates } from './dateValidation';
import { timelineEventLabel } from './eventClock';
import type { TimelineEvent } from '@/types';

export interface TimelineBatchTarget { timelineId: string; version: string }
export type TimelineBatchAction = { kind: 'shift'; days: number } | { kind: 'remove' };
interface Receipt { scope: WorldEraScope; before: EraDocument[]; after: TimelineBatchTarget[]; claimed?: Transaction }
const receipts = new Map<string, Receipt>();
const DAY = 86400000;
function shiftIso(value: string, days: number): string {
  if (validateTimelineDates(value, '')) throw Error('timeline_batch_exact_dates_required');
  const date = new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY), iso = date.toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw Error('timeline_batch_date_out_of_range');
  return iso;
}
export function shiftTimelineEvent(event: TimelineEvent, days: number, calendar?: WorldCalendar | null): TimelineEvent {
  if (!Number.isSafeInteger(days)) throw Error('timeline_batch_invalid_days');
  let next: TimelineEvent;
  if (event.dateMode === 'calendar' && event.realDate) {
    next = { ...event, realDate: shiftIso(event.realDate, days), ...(event.realDateEnd ? { realDateEnd: shiftIso(event.realDateEnd, days) } : {}) };
  } else if (event.dateMode === 'world' && calendar && event.worldDate?.day !== undefined && event.worldDate.month !== undefined && (!event.worldDateEnd || event.worldDateEnd.day !== undefined && event.worldDateEnd.month !== undefined)) {
    next = { ...event, worldDate: { ...addDays(calendar, event.worldDate, days), ...(event.worldDate.approx ? { approx: true } : {}) }, ...(event.worldDateEnd ? { worldDateEnd: { ...addDays(calendar, event.worldDateEnd, days), ...(event.worldDateEnd.approx ? { approx: true } : {}) } } : {}) };
    if (validateWorldRange(calendar, next.worldDate!, next.worldDateEnd)) throw Error('timeline_batch_date_out_of_range');
  } else throw Error('timeline_batch_exact_dates_required');
  return { ...next, date: timelineEventLabel(next, calendar), updatedAt: Math.max(Date.now(), event.updatedAt + 1) };
}

export async function timelineBatchTargets(scope: WorldEraScope): Promise<TimelineBatchTarget[]> {
  return (await listWorldDocuments(scope, 'timeline')).map(item => ({ timelineId: item.document.root.id, version: item.version }));
}
async function writeDocument(scope: WorldEraScope, document: EraDocument, expectedVersion: string): Promise<string> {
  validateEraDocument(scope.projectId, 'timeline', document.root.id, document);
  if (scope.eraId) return (await saveEraDocument(scope, 'timeline', document, expectedVersion)).version;
  for (const table of ['timelineEvents', 'timelineConnections'] as const) for (const row of document.children[table] ?? []) {
    const existing = await db[table].get(row.id);
    if (existing && (existing.projectId !== scope.projectId || existing.timelineId !== document.root.id)) throw Error('timeline_batch_conflict');
  }
  // All writes run in the caller's single transaction. Replacing owned children
  // also restores connections removed by a batch without leaving dangling rows.
  await db.timelineEvents.where('timelineId').equals(document.root.id).delete();
  await db.timelineConnections.where('timelineId').equals(document.root.id).delete();
  await db.timelines.put(document.root as unknown as import('@/types').Timeline);
  if (document.children.timelineEvents?.length) await db.timelineEvents.bulkPut(document.children.timelineEvents as unknown as TimelineEvent[]);
  if (document.children.timelineConnections?.length) await db.timelineConnections.bulkPut(document.children.timelineConnections as unknown as import('@/types').TimelineConnection[]);
  return eraDocumentVersion(document);
}
function assertTargets(actual: TimelineBatchTarget[], expected: readonly TimelineBatchTarget[]) {
  if (expected.length !== actual.length || new Set(expected.map(item => item.timelineId)).size !== expected.length || actual.some(item => !expected.some(old => old.timelineId === item.timelineId && old.version === item.version))) throw Error('timeline_batch_conflict');
}

export async function applyTimelineBatch(scope: WorldEraScope, eventIds: readonly string[], action: TimelineBatchAction, expected: readonly TimelineBatchTarget[]) {
  if (!eventIds.length || new Set(eventIds).size !== eventIds.length || action.kind !== 'remove' && (action.kind !== 'shift' || !Number.isSafeInteger(action.days) || action.days === 0)) throw Error('timeline_batch_invalid_selection');
  const result = await db.transaction('rw', db.tables, async () => {
    const reads = await listWorldDocuments(scope, 'timeline');
    assertTargets(reads.map(item => ({ timelineId: item.document.root.id, version: item.version })), expected);
    const selected = new Set(eventIds), found = reads.flatMap(item => item.document.children.timelineEvents ?? []).filter(row => selected.has(row.id));
    if (found.length !== selected.size) throw Error('timeline_batch_event_missing');
    const changes: { before: EraDocument; after: EraDocument; version: string }[] = [];
    for (const read of reads) {
      const document = structuredClone(read.document), events = document.children.timelineEvents ?? [], links = document.children.timelineConnections ?? [];
      if (!events.some(row => selected.has(row.id)) && !(action.kind === 'remove' && links.some(row => selected.has(String(row.sourceEventId)) || selected.has(String(row.targetEventId))))) continue;
      const calendar = action.kind === 'shift' ? (await resolveWorldCalendar(scope.projectId, document.root.id, scope.eraId))?.calendar : undefined;
      document.children.timelineEvents = action.kind === 'remove' ? events.filter(row => !selected.has(row.id)) : events.map(row => selected.has(row.id) ? shiftTimelineEvent(row as unknown as TimelineEvent, action.days, calendar) as unknown as typeof row : row);
      if (action.kind === 'remove') document.children.timelineConnections = links.filter(row => !selected.has(String(row.sourceEventId)) && !selected.has(String(row.targetEventId)));
      document.root.updatedAt = Math.max(Date.now(), Number(document.root.updatedAt ?? 0) + 1);
      changes.push({ before: read.document, after: document, version: read.version });
    }
    // All dates and references have been checked before the first mutation.
    const after: TimelineBatchTarget[] = [];
    for (const change of changes) after.push({ timelineId: change.after.root.id, version: await writeDocument(scope, change.after, change.version) });
    return { before: changes.map(item => item.before), after };
  });
  const receiptId = crypto.randomUUID(); receipts.set(receiptId, { scope: { ...scope }, ...result });
  let outer = Dexie.currentTransaction; if (outer) { while (outer.parent) outer = outer.parent; outer.on('abort', () => { receipts.delete(receiptId); }); }
  announceEraChange(scope.projectId);
  return { receiptId, changedEvents: eventIds.length, targets: await timelineBatchTargets(scope) };
}
export async function undoTimelineBatch(scope: WorldEraScope, receiptId: string) {
  const receipt = receipts.get(receiptId);
  if (!receipt || receipt.scope.projectId !== scope.projectId || receipt.scope.eraId !== scope.eraId) throw Error('timeline_batch_receipt_missing');
  await db.transaction('rw', db.tables, async tx => {
    if (receipt.claimed || receipts.get(receiptId) !== receipt) throw Error('timeline_batch_receipt_missing');
    let outer: Transaction = tx; while (outer.parent) outer = outer.parent;
    receipt.claimed = outer;
    outer.on('complete', () => { receipts.delete(receiptId); });
    outer.on('abort', () => { if (receipts.get(receiptId) === receipt) receipt.claimed = undefined; });
    const current = await listWorldDocuments(scope, 'timeline');
    for (const target of receipt.after) if (current.find(item => item.document.root.id === target.timelineId)?.version !== target.version) throw Error('timeline_batch_conflict');
    // Both child identity spaces are shared across effective era aggregates.
    // Check the full scope before the first restore, including connections.
    for (const before of receipt.before) for (const table of ['timelineEvents', 'timelineConnections'] as const) {
      const restoring = new Set(before.children[table]?.map(row => row.id));
      if (current.some(item => item.document.root.id !== before.root.id && item.document.children[table]?.some(row => restoring.has(row.id)))) throw Error('timeline_batch_conflict');
    }
    for (const before of receipt.before) {
      const restored = structuredClone(before), now = Date.now();
      restored.root.updatedAt = Math.max(now, Number(restored.root.updatedAt ?? 0) + 1);
      restored.children.timelineEvents = restored.children.timelineEvents?.map(row => ({ ...row, updatedAt: Math.max(now, Number(row.updatedAt ?? 0) + 1) }));
      await writeDocument(scope, restored, receipt.after.find(item => item.timelineId === before.root.id)!.version);
    }
  });
  announceEraChange(scope.projectId);
  return { restored: true, targets: await timelineBatchTargets(scope) };
}
