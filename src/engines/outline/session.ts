// ============================================================================
// Table sessions on top of outlines
// ============================================================================
//
// A session is an ordinary outline that carries four optional fields (kind,
// sessionStatus, sessionDate, linkedWritingId). Nothing here adds a table: the
// planner reads `outlines` and groups what is marked as a session. Every
// change bumps `sessionRevision`, which a caller may pass back to refuse a
// write based on a stale read.

import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared';
import { SESSION_STATUSES, type Outline, type SessionStatus } from './types';

export class SessionConflict extends Error {
  readonly current: number;
  constructor(current: number) {
    super('session_conflict');
    this.current = current;
    this.name = 'SessionConflict';
  }
}

export interface SessionPatch {
  status?: SessionStatus;
  /** `YYYY-MM-DD`; `null` clears it. */
  date?: string | null;
  /** A prep note (Writing) of the same project; `null` unlinks it. */
  linkedWritingId?: string | null;
}

export const isSession = (outline: Outline): boolean => outline.kind === 'session';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface SessionChange {
  outline: Outline;
  /** Fields as they were, in the shape the audit log restores (`__absent` names the ones that did not exist). */
  before: Record<string, unknown>;
}

const SESSION_FIELDS = ['kind', 'sessionStatus', 'sessionDate', 'linkedWritingId'] as const;

/**
 * Mark an outline as a session, or change its status, date or prep note.
 * Throws `Error('session_missing' | 'session_status' | 'session_date' |
 * 'session_note')` for bad input and `SessionConflict` for a stale revision.
 */
export async function updateSession(
  outlineId: string,
  patch: SessionPatch,
  expectedRevision?: number,
): Promise<SessionChange> {
  if (patch.status !== undefined && !SESSION_STATUSES.includes(patch.status)) throw new Error('session_status');
  if (typeof patch.date === 'string' && !validDay(patch.date)) throw new Error('session_date');
  const change = await db.transaction('rw', db.outlines, db.writings, async (): Promise<SessionChange> => {
    const current = await db.outlines.get(outlineId);
    if (!current) throw new Error('session_missing');
    const revision = current.sessionRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new SessionConflict(revision);
    if (typeof patch.linkedWritingId === 'string') {
      const note = await db.writings.get(patch.linkedWritingId);
      if (!note || note.projectId !== current.projectId) throw new Error('session_note');
    }
    const before: Record<string, unknown> = {};
    const absent: string[] = [];
    for (const key of SESSION_FIELDS) {
      if (current[key] === undefined) absent.push(key);
      else before[key] = current[key];
    }
    if (absent.length) before.__absent = absent;
    const next: Outline = {
      ...current,
      kind: 'session',
      sessionStatus: patch.status ?? current.sessionStatus ?? 'prep',
      sessionRevision: revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    };
    if (patch.date === null) delete next.sessionDate;
    else if (patch.date !== undefined) next.sessionDate = patch.date;
    if (patch.linkedWritingId === null) delete next.linkedWritingId;
    else if (patch.linkedWritingId !== undefined) next.linkedWritingId = patch.linkedWritingId;
    await db.outlines.put(next);
    return { outline: next, before };
  });
  notifyDataChanged({ source: 'other', projectId: change.outline.projectId });
  return change;
}

/** Turn the session marker off again. The status, date and note are forgotten. */
export async function clearSession(outlineId: string): Promise<void> {
  const current = await db.outlines.get(outlineId);
  if (!current) return;
  const next: Outline = { ...current, updatedAt: Math.max(Date.now(), current.updatedAt + 1) };
  delete next.kind;
  delete next.sessionStatus;
  delete next.sessionDate;
  delete next.linkedWritingId;
  next.sessionRevision = (current.sessionRevision ?? 0) + 1;
  await db.outlines.put(next);
  notifyDataChanged({ source: 'other', projectId: current.projectId });
}

export type SessionGroups = Record<SessionStatus, Outline[]>;

/** Planner order: live first, then up next, in prep and played. */
export const PLANNER_ORDER: readonly SessionStatus[] = ['live', 'next', 'prep', 'played'];

/**
 * Sessions grouped by status. Inside a group the soonest date comes first and
 * undated sessions go last; played sessions run newest first so the last one
 * played is on top.
 */
export function groupSessions(outlines: readonly Outline[]): SessionGroups {
  const groups: SessionGroups = { live: [], next: [], prep: [], played: [] };
  for (const outline of outlines) {
    if (!isSession(outline)) continue;
    groups[outline.sessionStatus ?? 'prep'].push(outline);
  }
  const key = (outline: Outline) => outline.sessionDate ?? '';
  for (const status of PLANNER_ORDER) {
    const direction = status === 'played' ? -1 : 1;
    groups[status].sort((a, b) => {
      const da = key(a), other = key(b);
      if (da !== other) {
        if (!da) return 1;
        if (!other) return -1;
        return da < other ? -direction : direction;
      }
      return a.createdAt - b.createdAt;
    });
  }
  return groups;
}
